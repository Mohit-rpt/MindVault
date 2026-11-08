/**
 * MindVault — Worker: Dispatch Recovery Service
 *
 * Implements the Claim-First, Record-Intent, Dispatch-Second, Reconcile-Third
 * pattern specified in Phase 6.4 Blueprint §6.3.5, §6.3.6, and §6.3.7.
 *
 * Responsibilities:
 * 1. Leader-elected background loop using pg_try_advisory_xact_lock(10064, 2).
 * 2. Drains unconfirmed pendingDispatch intents (older than 30s grace period).
 * 3. Idempotently handles enqueue-success / DB-ack failure without creating duplicate jobs.
 * 4. Reconciles lost acknowledged Redis jobs (Queue-Presence Verification) for QUEUED/PROCESSING documents with stale heartbeats.
 * 5. Strictly decouples Redis network calls from PostgreSQL transactions.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { BullMQWorkerGraphQueue, type IWorkerGraphQueue } from '../lib/graph-queue.js';
import { Logger } from '../utils/logger.js';
import { type PendingDispatch, formatExtractionJobId } from '@mindvault/shared';
import crypto from 'node:crypto';

export interface DispatchRecoverySweepResult {
  locked: boolean;
  drainedCount: number;
  confirmedCount: number;
  presenceReconciledCount: number;
  errors: string[];
}

/**
 * Redacts sensitive credentials including Redis/Postgres URI passwords,
 * Bearer tokens, and key=value secrets.
 */
export function sanitizeErrorMessage(msg?: string): string {
  if (!msg) return '';
  return msg
    .replace(/:\/\/([^:\s@/]+):([^@\s/]+)@/g, '://$1:[REDACTED]@')
    .replace(/:\/\/:([^@\s/]+)@/g, '://:[REDACTED]@')
    .replace(/bearer\s+[a-zA-Z0-9_\-.]+/gi, 'Bearer [REDACTED]')
    .replace(/(password|secret|key|token|api_key|apikey)=[^&\s]+/gi, '$1=[REDACTED]');
}

export class DispatchRecoveryService {
  private logger = new Logger('DispatchRecoveryService');
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private activeSweepPromise: Promise<DispatchRecoverySweepResult> | null = null;
  private prisma: PrismaClient;
  private queue: IWorkerGraphQueue;

  constructor(prismaClient?: PrismaClient, queue?: IWorkerGraphQueue) {
    this.prisma = prismaClient || new PrismaClient();
    this.queue = queue || new BullMQWorkerGraphQueue();
  }

  /**
   * Starts the periodic recovery loop. Runs immediately on startup, then every intervalMs.
   */
  public start(intervalMs = 60000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.info(`Starting DispatchRecoveryService (interval: ${intervalMs}ms)`);

    // Run first sweep on next tick
    setImmediate(() => {
      this.executeSweep().catch((err) => {
        this.logger.error(
          `Initial dispatch recovery sweep failed: ${sanitizeErrorMessage(err.message)}`,
        );
      });
    });

    this.timer = setInterval(() => {
      this.executeSweep().catch((err) => {
        this.logger.error(
          `Periodic dispatch recovery sweep failed: ${sanitizeErrorMessage(err.message)}`,
        );
      });
    }, intervalMs);
  }

  /**
   * Stops the periodic recovery loop.
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.activeSweepPromise) {
      this.logger.info('Awaiting in-flight dispatch recovery sweep before stopping...');
      try {
        await this.activeSweepPromise;
      } catch {
        // Ignored
      }
    }
    this.logger.info('DispatchRecoveryService stopped');
  }

  /**
   * Executes a single leader-elected dispatch recovery sweep.
   */
  public async executeSweep(): Promise<DispatchRecoverySweepResult> {
    if (this.activeSweepPromise) {
      return this.activeSweepPromise;
    }
    this.activeSweepPromise = this.internalExecuteSweep().finally(() => {
      this.activeSweepPromise = null;
    });
    return this.activeSweepPromise;
  }

  private async internalExecuteSweep(): Promise<DispatchRecoverySweepResult> {
    const result: DispatchRecoverySweepResult = {
      locked: false,
      drainedCount: 0,
      confirmedCount: 0,
      presenceReconciledCount: 0,
      errors: [],
    };

    try {
      let pendingCandidates: {
        id: string;
        workspaceId: string;
        metadata: any;
      }[] = [];
      let presenceCandidates: {
        id: string;
        workspaceId: string;
        metadata: any;
      }[] = [];

      // Step 1: PostgreSQL-Only Transaction Phase
      // Strictly local database operations under pg_try_advisory_xact_lock(10064, 2).
      // Zero Redis, BullMQ, or network I/O inside this transaction.
      await this.prisma.$transaction(
        async (tx) => {
          // 1. Leader Election: pg_try_advisory_xact_lock(10064, 2)
          const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(10064, 2) AS locked;
          `;
          const lockRow = Array.isArray(lockRows) ? lockRows[0] : undefined;

          if (!lockRow || !lockRow.locked) {
            this.logger.debug(
              'Another worker instance holds dispatch recovery lock (10064, 2); skipping sweep',
            );
            return;
          }

          result.locked = true;

          // 2. Select unconfirmed pendingDispatch intents (Grace period: 30 seconds)
          pendingCandidates = await tx.$queryRaw<
            {
              id: string;
              workspaceId: string;
              metadata: any;
            }[]
          >`
            SELECT id, "workspaceId", metadata
            FROM "documents"
            WHERE metadata->'pendingDispatch'->>'enqueuedAt' IS NULL
              AND metadata->>'graphStatus' = 'QUEUED'
              AND (metadata->'pendingDispatch'->>'createdAt')::timestamptz < NOW() - INTERVAL '30 seconds'
            ORDER BY (metadata->'pendingDispatch'->>'createdAt')::timestamptz ASC
            LIMIT 50;
          `;

          // 3. Select candidates with stale queue presence (QUEUED/PROCESSING with stale heartbeat > 5 min)
          presenceCandidates = await tx.$queryRaw<
            {
              id: string;
              workspaceId: string;
              metadata: any;
            }[]
          >`
            SELECT id, "workspaceId", metadata
            FROM "documents"
            WHERE metadata->'pendingDispatch'->>'enqueuedAt' IS NOT NULL
              AND metadata->>'graphStatus' IN ('QUEUED', 'PROCESSING')
              AND (
                (metadata->>'graphHeartbeatAt' IS NOT NULL AND (metadata->>'graphHeartbeatAt')::timestamptz < clock_timestamp() - INTERVAL '5 minutes')
                OR
                (metadata->>'graphHeartbeatAt' IS NULL AND (metadata->'pendingDispatch'->>'enqueuedAt')::timestamptz < clock_timestamp() - INTERVAL '5 minutes')
              )
            ORDER BY updated_at ASC
            LIMIT 50;
          `;
        },
        {
          maxWait: 5000,
          timeout: 10000,
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        },
      );

      // If lock was not acquired, exit cleanly
      if (!result.locked) {
        return result;
      }

      // Step 2: Post-Commit Phase — All Redis Operations & Fast Standalone CAS Updates Strictly Outside Transactions
      // A. Drain unconfirmed pendingDispatch intents
      if (pendingCandidates.length > 0) {
        const drained = await this.drainPendingCandidates(pendingCandidates);
        result.drainedCount = drained.drainedCount;
        result.confirmedCount = drained.confirmedCount;
      }

      // B. Reconcile stale queue presence
      if (presenceCandidates.length > 0) {
        result.presenceReconciledCount = await this.reconcilePresenceCandidates(presenceCandidates);
      }
    } catch (err: any) {
      const sanitized = sanitizeErrorMessage(err.message);
      result.errors.push(sanitized);
      this.logger.error(`Dispatch recovery sweep failed: ${sanitized}`);
    }

    return result;
  }

  /**
   * Post-Commit Phase: Drains pendingDispatch intents that were not confirmed within 30 seconds (§6.3.5).
   * All Redis getJob and enqueue calls execute strictly outside interactive transactions.
   * State transitions in PostgreSQL use standalone atomic CAS queries on extractionRunId.
   */
  private async drainPendingCandidates(
    candidates: {
      id: string;
      workspaceId: string;
      metadata: any;
    }[],
  ): Promise<{ drainedCount: number; confirmedCount: number }> {
    let drainedCount = 0;
    let confirmedCount = 0;

    for (const doc of candidates) {
      const metadata = (doc.metadata || {}) as Record<string, any>;
      const pending = (metadata.pendingDispatch || {}) as PendingDispatch;
      const extractionRunId = pending.extractionRunId || metadata.extractionRunId;
      if (!extractionRunId) continue;

      const jobId = pending.jobId || formatExtractionJobId(doc.id, extractionRunId);

      // Check if job already exists in BullMQ (handles enqueue success / DB ack failure idempotently)
      let existingJob = null;
      try {
        if (typeof this.queue.getJob === 'function') {
          existingJob = await this.queue.getJob(jobId);
        }
      } catch (err: any) {
        this.logger.warn(
          `Failed to inspect BullMQ for job ${jobId}: ${sanitizeErrorMessage(err.message)}`,
        );
      }

      if (existingJob) {
        // Enqueue succeeded earlier; confirm DB acknowledgment now via fast standalone CAS update
        const rowsUpdated = await this.prisma.$executeRaw`
          UPDATE "documents"
          SET metadata = jsonb_set(
            metadata,
            '{pendingDispatch,enqueuedAt}',
            to_jsonb(NOW()::text)
          ), updated_at = CURRENT_TIMESTAMP
          WHERE id = ${doc.id}
            AND metadata->>'extractionRunId' = ${extractionRunId}
            AND metadata->>'graphStatus' IN ('QUEUED', 'PROCESSING')
            AND (
              metadata->'graphFinalizationReceipt' IS NULL
              OR metadata->'graphFinalizationReceipt'->>'terminalStatus' IS NULL
              OR metadata->'graphFinalizationReceipt'->>'extractionRunId' != ${extractionRunId}
            );
        `;
        if (rowsUpdated > 0) {
          confirmedCount++;
          this.logger.info(`Confirmed existing BullMQ job ${jobId} for document ${doc.id}`);
        } else {
          this.logger.debug(
            `Skipped confirming job ${jobId} for document ${doc.id}: run was superseded or terminal receipt exists`,
          );
        }
      } else {
        // Job missing: attempt Redis enqueue strictly outside transaction
        try {
          await this.queue.enqueue({
            documentId: doc.id,
            workspaceId: doc.workspaceId,
            extractionRunId,
            chunkManifestHash: metadata.chunkManifestHash,
          });

          // Confirm enqueuedAt in PostgreSQL via fast standalone CAS update
          const rowsUpdated = await this.prisma.$executeRaw`
            UPDATE "documents"
            SET metadata = jsonb_set(
              metadata,
              '{pendingDispatch,enqueuedAt}',
              to_jsonb(NOW()::text)
            ), updated_at = CURRENT_TIMESTAMP
            WHERE id = ${doc.id}
              AND metadata->>'extractionRunId' = ${extractionRunId}
              AND metadata->>'graphStatus' IN ('QUEUED', 'PROCESSING')
              AND (
                metadata->'graphFinalizationReceipt' IS NULL
                OR metadata->'graphFinalizationReceipt'->>'terminalStatus' IS NULL
                OR metadata->'graphFinalizationReceipt'->>'extractionRunId' != ${extractionRunId}
              );
          `;
          if (rowsUpdated > 0) {
            drainedCount++;
            this.logger.info(
              `Drained pending intent: enqueued job ${jobId} for document ${doc.id}`,
            );
          } else {
            this.logger.debug(
              `Skipped confirming drained intent for document ${doc.id}: run was superseded or terminal receipt exists`,
            );
          }
        } catch (err: any) {
          // Redis still unavailable: record attempt and error via standalone CAS update
          const sanitizedErr = sanitizeErrorMessage(err.message);
          const pendingAttempts = Number(pending.attempts || 0);
          const rowsUpdated = await this.prisma.$executeRaw`
            UPDATE "documents"
            SET metadata = jsonb_set(
              jsonb_set(
                jsonb_set(
                  metadata,
                  '{pendingDispatch,attempts}',
                  to_jsonb(${pendingAttempts + 1}::int)
                ),
                '{pendingDispatch,lastAttemptAt}',
                to_jsonb(NOW()::text)
              ),
              '{pendingDispatch,lastError}',
              to_jsonb(${sanitizedErr}::text)
            ), updated_at = CURRENT_TIMESTAMP
            WHERE id = ${doc.id}
              AND metadata->>'extractionRunId' = ${extractionRunId}
              AND metadata->>'graphStatus' IN ('QUEUED', 'PROCESSING')
              AND (
                metadata->'graphFinalizationReceipt' IS NULL
                OR metadata->'graphFinalizationReceipt'->>'terminalStatus' IS NULL
                OR metadata->'graphFinalizationReceipt'->>'extractionRunId' != ${extractionRunId}
              )
              AND COALESCE((metadata->'pendingDispatch'->>'attempts')::int, 0) = ${pendingAttempts};
          `;
          if (rowsUpdated > 0) {
            this.logger.warn(
              `Failed to drain pending intent for document ${doc.id}: ${sanitizedErr}`,
            );
          } else {
            this.logger.debug(
              `Skipped recording failure for document ${doc.id}: run was concurrently modified, superseded, or completed`,
            );
          }
        }
      }
    }

    return { drainedCount, confirmedCount };
  }

  /**
   * Post-Commit Phase: Reconciles acknowledged jobs lost from Redis due to restarts, flushes, or evictions (§6.3.6).
   * All Redis getJob and enqueue calls execute strictly outside interactive transactions.
   * State transitions in PostgreSQL use standalone atomic CAS queries on extractionRunId.
   */
  private async reconcilePresenceCandidates(
    candidates: {
      id: string;
      workspaceId: string;
      metadata: any;
    }[],
  ): Promise<number> {
    let presenceReconciledCount = 0;

    for (const doc of candidates) {
      const metadata = (doc.metadata || {}) as Record<string, any>;
      const extractionRunId = metadata.extractionRunId;
      if (!extractionRunId) continue;

      const jobId =
        (metadata.pendingDispatch && metadata.pendingDispatch.jobId) ||
        formatExtractionJobId(doc.id, extractionRunId);

      let job = null;
      try {
        if (typeof this.queue.getJob === 'function') {
          job = await this.queue.getJob(jobId);
        }
      } catch (err: any) {
        this.logger.warn(
          `Failed to inspect BullMQ for job presence ${jobId}: ${sanitizeErrorMessage(err.message)}`,
        );
        continue;
      }

      // If job is still present in BullMQ/Redis, no action required
      if (job) {
        continue;
      }

      // If job is missing from Redis:
      // DEF-2: Verify PostgreSQL receipt strictly against ACTIVE runId
      const receipt = metadata.graphFinalizationReceipt;
      const hasValidActiveTerminalReceipt =
        receipt && receipt.terminalStatus && receipt.extractionRunId === extractionRunId;

      if (hasValidActiveTerminalReceipt) {
        this.logger.info(
          `Document ${doc.id} missing from Redis but has terminal receipt for active run ${extractionRunId}; skipping re-dispatch`,
        );
        continue;
      }

      const currentAttempts = Number(metadata.graphAttempts || 1);
      if (currentAttempts < 5) {
        // Re-establish dispatch under a fresh extractionRunId to prevent duplicate key collision
        const newRunId = crypto.randomUUID();
        const newJobId = formatExtractionJobId(doc.id, newRunId);
        const nowIso = new Date().toISOString();

        const newPendingDispatch: PendingDispatch = {
          extractionRunId: newRunId,
          jobId: newJobId,
          enqueuedAt: null,
          createdAt: nowIso,
          attempts: 0,
          lastAttemptAt: null,
          lastError: null,
        };

        // Atomic standalone CAS update: allocate new extractionRunId, increment graphAttempts, set status QUEUED,
        // and record durable pendingDispatch intent in PostgreSQL (enqueuedAt: null), preserving graphProgress.
        // Fenced against terminal completion races, receipt presence, concurrent attempt modifications, and stale heartbeat races.
        const rowsUpdated = await this.prisma.$executeRaw`
          UPDATE "documents"
          SET metadata = jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(metadata, '{extractionRunId}', to_jsonb(${newRunId}::text)),
                '{graphStatus}', to_jsonb('QUEUED'::text)
              ),
              '{graphAttempts}', to_jsonb(${currentAttempts + 1}::int)
            ),
            '{pendingDispatch}', ${JSON.stringify(newPendingDispatch)}::jsonb
          ), updated_at = CURRENT_TIMESTAMP
          WHERE id = ${doc.id}
            AND metadata->>'extractionRunId' = ${extractionRunId}
            AND metadata->>'graphStatus' IN ('QUEUED', 'PROCESSING')
            AND (
              metadata->'graphFinalizationReceipt' IS NULL
              OR metadata->'graphFinalizationReceipt'->>'terminalStatus' IS NULL
              OR metadata->'graphFinalizationReceipt'->>'extractionRunId' != ${extractionRunId}
            )
            AND COALESCE((metadata->>'graphAttempts')::int, 1) = ${currentAttempts}
            AND metadata->'pendingDispatch'->>'enqueuedAt' IS NOT NULL
            AND (
              (
                metadata->>'graphHeartbeatAt' IS NOT NULL
                AND (metadata->>'graphHeartbeatAt')::timestamptz
                    < clock_timestamp() - INTERVAL '5 minutes'
              )
              OR
              (
                metadata->>'graphHeartbeatAt' IS NULL
                AND (metadata->'pendingDispatch'->>'enqueuedAt')::timestamptz
                    < clock_timestamp() - INTERVAL '5 minutes'
              )
            );
        `;

        // If CAS failed (rowsUpdated === 0), document was modified concurrently, completed, or superseded; skip safely
        if (rowsUpdated === 0) {
          this.logger.debug(
            `CAS update failed for document ${doc.id}; run was completed, superseded, or modified concurrently`,
          );
          continue;
        }

        // Redis enqueue executes strictly outside transaction
        try {
          await this.queue.enqueue({
            documentId: doc.id,
            workspaceId: doc.workspaceId,
            extractionRunId: newRunId,
            chunkManifestHash: metadata.chunkManifestHash,
          });

          // Confirm enqueuedAt in PostgreSQL via fast standalone CAS update
          await this.prisma.$executeRaw`
            UPDATE "documents"
            SET metadata = jsonb_set(
              metadata,
              '{pendingDispatch,enqueuedAt}',
              to_jsonb(NOW()::text)
            ), updated_at = CURRENT_TIMESTAMP
            WHERE id = ${doc.id} AND metadata->>'extractionRunId' = ${newRunId};
          `;

          presenceReconciledCount++;
          this.logger.info(
            `Re-established lost dispatch for document ${doc.id}: newRun=${newRunId}`,
          );
        } catch (err: any) {
          // If Redis enqueue fails, the durable pendingDispatch intent remains in DB with enqueuedAt: null.
          // drainPendingCandidates will recover it on subsequent sweeps!
          const sanitized = sanitizeErrorMessage(err.message);
          this.logger.warn(
            `Failed to enqueue re-established job for document ${doc.id}: ${sanitized}. Intent remains pending in DB for recovery.`,
          );
        }
      } else {
        // DEF-1: Lifetime attempts ceiling reached (MAX_TOTAL_RUNS = 5)
        // Flags document as FAILED_RETRYABLE, clears pendingDispatch, preserves graphProgress and existing receipt.
        // Fenced against terminal completion races, receipt presence, concurrent attempt modifications, and stale heartbeat races.
        const rowsUpdated = await this.prisma.$executeRaw`
          UPDATE "documents"
          SET metadata = jsonb_set(
            jsonb_set(metadata, '{graphStatus}', to_jsonb('FAILED_RETRYABLE'::text)),
            '{pendingDispatch}', 'null'::jsonb
          ), updated_at = CURRENT_TIMESTAMP
          WHERE id = ${doc.id}
            AND metadata->>'extractionRunId' = ${extractionRunId}
            AND metadata->>'graphStatus' IN ('QUEUED', 'PROCESSING')
            AND (
              metadata->'graphFinalizationReceipt' IS NULL
              OR metadata->'graphFinalizationReceipt'->>'terminalStatus' IS NULL
              OR metadata->'graphFinalizationReceipt'->>'extractionRunId' != ${extractionRunId}
            )
            AND COALESCE((metadata->>'graphAttempts')::int, 1) = ${currentAttempts}
            AND metadata->'pendingDispatch'->>'enqueuedAt' IS NOT NULL
            AND (
              (
                metadata->>'graphHeartbeatAt' IS NOT NULL
                AND (metadata->>'graphHeartbeatAt')::timestamptz
                    < clock_timestamp() - INTERVAL '5 minutes'
              )
              OR
              (
                metadata->>'graphHeartbeatAt' IS NULL
                AND (metadata->'pendingDispatch'->>'enqueuedAt')::timestamptz
                    < clock_timestamp() - INTERVAL '5 minutes'
              )
            );
        `;
        if (rowsUpdated > 0) {
          this.logger.warn(
            `Document ${doc.id} reached lifetime extraction attempts ceiling (${currentAttempts}); marked FAILED_RETRYABLE`,
          );
        } else {
          this.logger.debug(
            `Skipped ceiling transition for document ${doc.id}: run was completed, superseded, or modified concurrently`,
          );
        }
      }
    }

    return presenceReconciledCount;
  }
}
