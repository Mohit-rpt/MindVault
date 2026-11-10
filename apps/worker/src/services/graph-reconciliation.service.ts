/**
 * MindVault — Worker: Distributed Graph Reconciliation Service
 *
 * Implements Phase 6.4 Blueprint v4.5.6 §6.4.0, §6.4.5, §6.6, AC-09, AC-15, AC-16, AC-20, AC-21, AC-24.
 *
 * Core Responsibilities:
 * 1. Distributed Leader Election: Uses dedicated transaction-level PostgreSQL advisory lock
 *    `pg_try_advisory_xact_lock(10064, 1)` inside a dedicated Prisma interactive transaction.
 *    Isolated from DispatchRecoveryService (10064, 2) and 64-bit relation locks.
 * 2. Absolute PostgreSQL Receipt Authority: Valid `GraphFinalizationReceipt` takes precedence
 *    over all BullMQ job states (COMPLETED, PARTIAL, FAILED). Terminal statuses are adopted
 *    and redundant Redis jobs evicted without repeating extraction.
 * 3. 6-Step Receipt-First Decision Sequence:
 *    PostgreSQL read -> runId check -> manifest check -> receipt validation -> terminal adoption -> BullMQ fallback.
 * 4. Complete 6-State BullMQ Fallback Matrix: Handles waiting, delayed, active, completed, failed, missing.
 * 5. Infrastructure Retry Exhaustion Recovery: When BullMQ attempts >= 3 fail without receipt,
 *    recovers under fresh extractionRunId with 10s delay, preserving checkpoints up to ceiling.
 * 6. Untrusted Completed Job Recovery: Treats BullMQ jobs marked completed without valid PostgreSQL receipt
 *    as untrusted split-brain, evicting the job and re-enqueuing under fresh runId.
 * 7. Recovery Ceiling Enforcement: Max 5 total runs (15 processor attempts). At ceiling, marks FAILED_RETRYABLE.
 * 8. Fail-Closed Redis Handling: Any Redis connection failure safely aborts the sweep and rolls back
 *    the transaction, preventing duplicate dispatch storms.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { BullMQWorkerGraphQueue, type IWorkerGraphQueue } from '../lib/graph-queue.js';
import { Logger } from '../utils/logger.js';
import {
  type PendingDispatch,
  validateFinalizationReceipt,
  computeChunkManifestHash,
  formatExtractionJobId,
} from '@mindvault/shared';
import crypto from 'node:crypto';
import { sanitizeErrorMessage } from './dispatch-recovery.service.js';

export const RECONCILIATION_LOCK_CLASS_ID = 10064;
export const RECONCILIATION_LOCK_OBJ_ID = 1;
export const MAX_TOTAL_RUNS = 5;
export const BULLMQ_ATTEMPTS_PER_RUN = 3;
export const MAX_TOTAL_PROCESSOR_ATTEMPTS = 15;
export const STALE_HEARTBEAT_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
export const BATCH_LIMIT = 50;

export interface GraphReconciliationSweepResult {
  locked: boolean;
  reconciledCount: number;
  adoptedReceiptCount: number;
  exhaustedRecoveredCount: number;
  untrustedRecoveredCount: number;
  presenceRecoveredCount: number;
  ceilingReachedCount: number;
  errors: string[];
}

export class GraphReconciliationService {
  private logger = new Logger('GraphReconciliationService');
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private activeSweepPromise: Promise<GraphReconciliationSweepResult> | null = null;
  private prisma: PrismaClient;
  private queue: IWorkerGraphQueue;

  constructor(prismaClient?: PrismaClient, queue?: IWorkerGraphQueue) {
    this.prisma = prismaClient || new PrismaClient();
    this.queue = queue || new BullMQWorkerGraphQueue();
  }

  /**
   * Starts periodic reconciliation sweeps.
   */
  public start(intervalMs = 60000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.info(
      `Starting GraphReconciliationService periodic loop (interval: ${intervalMs}ms)`,
    );

    this.timer = setInterval(() => {
      this.executeStartupReconciliation().catch((err) => {
        this.logger.error(
          `Periodic graph reconciliation sweep failed: ${sanitizeErrorMessage(err.message)}`,
        );
      });
    }, intervalMs);
  }

  /**
   * Gracefully stops the reconciliation service and awaits any in-flight sweep.
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.activeSweepPromise) {
      this.logger.info('Awaiting in-flight graph reconciliation sweep before stopping...');
      try {
        await this.activeSweepPromise;
      } catch {
        // Ignored
      }
    }
    this.logger.info('GraphReconciliationService stopped cleanly');
  }

  /**
   * Executes startup reconciliation sweep under dedicated advisory transaction lock (10064, 1).
   * Connection-pool safe: uses an interactive transaction so the lock is held on a single connection
   * and automatically released upon commit, rollback, or connection loss.
   */
  public async executeStartupReconciliation(): Promise<GraphReconciliationSweepResult> {
    const sweepPromise = this.runReconciliationSweep();
    this.activeSweepPromise = sweepPromise;
    try {
      return await sweepPromise;
    } finally {
      this.activeSweepPromise = null;
    }
  }

  private async runReconciliationSweep(): Promise<GraphReconciliationSweepResult> {
    const result: GraphReconciliationSweepResult = {
      locked: false,
      reconciledCount: 0,
      adoptedReceiptCount: 0,
      exhaustedRecoveredCount: 0,
      untrustedRecoveredCount: 0,
      presenceRecoveredCount: 0,
      ceilingReachedCount: 0,
      errors: [],
    };

    try {
      await this.prisma.$transaction(
        async (tx) => {
          // Step 0: Distributed Leader Election via Advisory Transaction Lock (10064, 1)
          const lockResult = await tx.$queryRaw<Array<{ acquired: boolean }>>`
            SELECT pg_try_advisory_xact_lock(${RECONCILIATION_LOCK_CLASS_ID}, ${RECONCILIATION_LOCK_OBJ_ID}) AS acquired;
          `;

          if (!lockResult[0]?.acquired) {
            this.logger.info(
              `Startup reconciliation skipped: another worker instance holds advisory lock (${RECONCILIATION_LOCK_CLASS_ID}, ${RECONCILIATION_LOCK_OBJ_ID})`,
            );
            return;
          }

          result.locked = true;
          this.logger.info(
            `Acquired startup reconciliation advisory lock (${RECONCILIATION_LOCK_CLASS_ID}, ${RECONCILIATION_LOCK_OBJ_ID}); evaluating candidate documents`,
          );

          // Step 1: Scan candidate documents in QUEUED, PROCESSING, or with pendingDispatch
          const candidates = await tx.$queryRaw<
            Array<{ id: string; workspaceId: string; metadata: any }>
          >`
            SELECT id, "workspaceId", metadata
            FROM "documents"
            WHERE (
              metadata->>'graphStatus' IN ('QUEUED', 'PROCESSING')
              OR metadata->'pendingDispatch' IS NOT NULL
            )
            ORDER BY updated_at ASC
            LIMIT ${BATCH_LIMIT};
          `;

          if (candidates.length === 0) {
            this.logger.info('Startup reconciliation: zero candidate documents found');
            return;
          }

          this.logger.info(
            `Startup reconciliation: scanning ${candidates.length} candidate documents`,
          );

          for (const candidate of candidates) {
            await this.reconcileCandidate(tx, candidate, result);
          }
        },
        {
          maxWait: 5000,
          timeout: 30000,
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        },
      );
    } catch (err: any) {
      const sanitized = sanitizeErrorMessage(err.message);
      result.errors.push(sanitized);
      this.logger.error(`Startup reconciliation sweep failed: ${sanitized}`);
    }

    return result;
  }

  /**
   * Reconciles a single candidate document according to the 6-Step Receipt-First Decision Sequence.
   */
  private async reconcileCandidate(
    tx: Prisma.TransactionClient,
    candidate: { id: string; workspaceId: string; metadata: any },
    result: GraphReconciliationSweepResult,
  ): Promise<void> {
    // Step 1: Read Authoritative PostgreSQL State under FOR NO KEY UPDATE
    const lockedRows = await tx.$queryRaw<
      Array<{ id: string; workspaceId: string; metadata: any }>
    >`
      SELECT id, "workspaceId", metadata
      FROM "documents"
      WHERE id = ${candidate.id} AND "workspaceId" = ${candidate.workspaceId}
      FOR NO KEY UPDATE;
    `;

    if (lockedRows.length === 0) return;
    const doc = lockedRows[0];
    const metadata = (doc.metadata || {}) as Record<string, any>;
    const extractionRunId = (metadata.extractionRunId ||
      metadata.pendingDispatch?.extractionRunId) as string | undefined;

    // Step 2: Does active extractionRunId exist?
    if (!extractionRunId) {
      const newRunId = crypto.randomUUID();
      const jobId = formatExtractionJobId(doc.id, newRunId);

      await this.queue.enqueue({
        documentId: doc.id,
        workspaceId: doc.workspaceId,
        extractionRunId: newRunId,
      });

      const pending: PendingDispatch = {
        jobId,
        extractionRunId: newRunId,
        enqueuedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        attempts: 1,
        lastAttemptAt: new Date().toISOString(),
        lastError: null,
      };

      await tx.$executeRaw`
        UPDATE "documents"
        SET metadata = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(metadata, '{graphStatus}', '"QUEUED"'),
              '{extractionRunId}', to_jsonb(${newRunId}::text)
            ),
            '{graphAttempts}', '1'::jsonb
          ),
          '{pendingDispatch}', to_jsonb(${JSON.stringify(pending)}::json)
        )
        WHERE id = ${doc.id} AND "workspaceId" = ${doc.workspaceId};
      `;
      result.reconciledCount++;
      return;
    }

    // Step 3: Does chunkManifestHash match current chunks?
    const chunks = await tx.$queryRaw<Array<{ id: string; chunkIndex: number; content: string }>>`
      SELECT id, "chunkIndex", content
      FROM "chunks"
      WHERE "documentId" = ${doc.id}
      ORDER BY "chunkIndex" ASC;
    `;

    let manifestHash = metadata.chunkManifestHash as string | undefined;
    if (chunks.length > 0) {
      const calculatedHash = computeChunkManifestHash(metadata.checksum || doc.id, chunks);
      if (manifestHash && manifestHash !== calculatedHash) {
        this.logger.warn(
          `Document ${doc.id} content manifest changed; invalidating checkpoint and restarting from chunk 0`,
        );
        manifestHash = calculatedHash;
        const newRunId = crypto.randomUUID();
        const jobId = formatExtractionJobId(doc.id, newRunId);

        await this.queue.enqueue({
          documentId: doc.id,
          workspaceId: doc.workspaceId,
          extractionRunId: newRunId,
        });

        const pendingDispatch: PendingDispatch = {
          extractionRunId: newRunId,
          jobId,
          enqueuedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          attempts: 0,
          lastAttemptAt: null,
          lastError: null,
        };

        await tx.$executeRaw`
          UPDATE "documents"
          SET metadata = jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  metadata - 'graphCheckpoint' - 'graphFinalizationReceipt',
                  '{graphStatus}', '"QUEUED"'
                ),
                '{extractionRunId}', to_jsonb(${newRunId}::text)
              ),
              '{chunkManifestHash}', to_jsonb(${manifestHash}::text)
            ),
            '{pendingDispatch}', ${JSON.stringify(pendingDispatch)}::jsonb
          )
          WHERE id = ${doc.id} AND "workspaceId" = ${doc.workspaceId};
        `;
        result.reconciledCount++;
        return;
      }
    }

    // Step 4 & 5: Absolute PostgreSQL Receipt Authority
    const receipt = metadata.graphFinalizationReceipt;
    if (receipt) {
      const isValidReceipt = validateFinalizationReceipt(receipt, extractionRunId, manifestHash);

      if (isValidReceipt) {
        this.logger.info(
          `Document ${doc.id} has authoritative terminal receipt (${receipt.terminalStatus}); adopting status and evicting redundant Redis jobs`,
        );

        // Evict redundant Redis job if present
        const jobId =
          metadata.pendingDispatch?.jobId || formatExtractionJobId(doc.id, extractionRunId);
        if (this.queue.getJob) {
          try {
            const job = await this.queue.getJob(jobId);
            if (job) {
              await job.remove().catch((e) => {
                this.logger.warn(
                  `Could not remove redundant job ${jobId} during receipt adoption: ${sanitizeErrorMessage(e.message)}`,
                );
              });
            }
          } catch (e: any) {
            // Fail-closed rule on Redis errors
            throw new Error(`Redis error while checking redundant job: ${e.message}`);
          }
        }

        // Adopt terminal status into PostgreSQL; clear pendingDispatch, leases, and tokens
        await tx.$executeRaw`
          UPDATE "documents"
          SET metadata = jsonb_set(
            jsonb_set(
              jsonb_set(
                metadata - 'pendingDispatch',
                '{graphStatus}', to_jsonb(${receipt.terminalStatus}::text)
              ),
              '{graphWorkerToken}', 'null'::jsonb
            ),
            '{graphLeaseExpiresAt}', 'null'::jsonb
          )
          WHERE id = ${doc.id} AND "workspaceId" = ${doc.workspaceId};
        `;

        result.adoptedReceiptCount++;
        result.reconciledCount++;
        return;
      } else {
        this.logger.warn(
          `Document ${doc.id} contains invalid or corrupt receipt for run ${extractionRunId}; receipt rejected, proceeding to BullMQ fallback`,
        );
      }
    }

    // Step 6: Consult Complete 6-State BullMQ Fallback Matrix
    const jobId = metadata.pendingDispatch?.jobId || formatExtractionJobId(doc.id, extractionRunId);
    let job: any = null;
    if (this.queue.getJob) {
      try {
        job = await this.queue.getJob(jobId);
      } catch (e: any) {
        throw new Error(`Redis error checking job ${jobId}: ${e.message}`);
      }
    }

    const currentAttempts = Number(metadata.graphAttempts || 1);

    // State 1: Missing Job in Redis
    if (!job) {
      this.logger.warn(
        `Job ${jobId} missing from Redis for document ${doc.id}; reconciling queue presence`,
      );

      // If pendingDispatch exists but enqueuedAt is null, confirm and enqueue
      if (metadata.pendingDispatch && metadata.pendingDispatch.enqueuedAt === null) {
        await this.queue.enqueue({
          documentId: doc.id,
          workspaceId: doc.workspaceId,
          extractionRunId,
        });

        await tx.$executeRaw`
          UPDATE "documents"
          SET metadata = jsonb_set(
            metadata,
            '{pendingDispatch,enqueuedAt}',
            to_jsonb(to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
          )
          WHERE id = ${doc.id} AND "workspaceId" = ${doc.workspaceId};
        `;
        result.presenceRecoveredCount++;
        result.reconciledCount++;
        return;
      }

      // Re-claim and re-enqueue if under ceiling
      if (currentAttempts < MAX_TOTAL_RUNS) {
        const nextAttempts = currentAttempts + 1;
        const newRunId = crypto.randomUUID();
        const newJobId = formatExtractionJobId(doc.id, newRunId);

        await this.queue.enqueue({
          documentId: doc.id,
          workspaceId: doc.workspaceId,
          extractionRunId: newRunId,
        });

        const pending: PendingDispatch = {
          jobId: newJobId,
          extractionRunId: newRunId,
          enqueuedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          attempts: 1,
          lastAttemptAt: new Date().toISOString(),
          lastError: null,
        };

        await tx.$executeRaw`
          UPDATE "documents"
          SET metadata = jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(metadata, '{graphStatus}', '"QUEUED"'),
                '{extractionRunId}', to_jsonb(${newRunId}::text)
              ),
              '{graphAttempts}', to_jsonb(${nextAttempts}::int)
            ),
            '{pendingDispatch}', to_jsonb(${JSON.stringify(pending)}::json)
          )
          WHERE id = ${doc.id} AND "workspaceId" = ${doc.workspaceId};
        `;
        result.presenceRecoveredCount++;
        result.reconciledCount++;
      } else {
        // Ceiling reached
        this.logger.warn(
          `Document ${doc.id} reached recovery ceiling (${currentAttempts} runs); marking FAILED_RETRYABLE`,
        );
        await tx.$executeRaw`
          UPDATE "documents"
          SET metadata = jsonb_set(
            jsonb_set(
              metadata - 'pendingDispatch',
              '{graphStatus}', '"FAILED_RETRYABLE"'
            ),
            '{lastError}', '"Recovery ceiling exhausted (5 runs / 15 processor attempts). Awaiting user intervention."'
          )
          WHERE id = ${doc.id} AND "workspaceId" = ${doc.workspaceId};
        `;
        result.ceilingReachedCount++;
        result.reconciledCount++;
      }
      return;
    }

    let state: string;
    try {
      state = await job.getState();
    } catch (e: any) {
      throw new Error(`Redis error getting state for job ${jobId}: ${e.message}`);
    }

    switch (state) {
      // State 2: Waiting in BullMQ
      case 'waiting': {
        if (job.data?.extractionRunId === extractionRunId) {
          this.logger.info(`Job ${jobId} is healthy in BullMQ waiting set; skipping`);
          return;
        }
        this.logger.warn(
          `Job ${jobId} in waiting set is stale (runId mismatch); removing and re-enqueueing`,
        );
        await job.remove().catch(() => {});
        await this.queue.enqueue({
          documentId: doc.id,
          workspaceId: doc.workspaceId,
          extractionRunId,
        });
        result.reconciledCount++;
        return;
      }

      // State 3: Delayed in BullMQ (Native backoff or same-run contention delay)
      case 'delayed': {
        this.logger.info(`Job ${jobId} is in BullMQ delayed set; retaining native retry backoff`);
        return;
      }

      // State 4: Active in BullMQ
      case 'active': {
        const heartbeatAt = metadata.graphHeartbeatAt
          ? new Date(metadata.graphHeartbeatAt).getTime()
          : 0;
        const isHeartbeatFresh = Date.now() - heartbeatAt < STALE_HEARTBEAT_THRESHOLD_MS;
        if (isHeartbeatFresh) {
          this.logger.info(`Job ${jobId} has active worker with fresh heartbeat (< 5m); skipping`);
          return;
        }

        this.logger.warn(
          `Job ${jobId} is active but heartbeat is stale (> 5m); treating as crashed worker`,
        );
        await this.handleExhaustedOrStalledJob(tx, doc, job, currentAttempts, result);
        return;
      }

      // State 5: Completed in BullMQ without valid PostgreSQL receipt (Untrusted Split-Brain)
      case 'completed': {
        this.logger.warn(
          `Job ${jobId} marked completed in BullMQ but PostgreSQL lacks valid receipt; treating as UNTRUSTED split-brain`,
        );
        await job.remove().catch(() => {});

        if (currentAttempts < MAX_TOTAL_RUNS) {
          const nextAttempts = currentAttempts + 1;
          const newRunId = crypto.randomUUID();
          const newJobId = formatExtractionJobId(doc.id, newRunId);

          await this.queue.enqueue({
            documentId: doc.id,
            workspaceId: doc.workspaceId,
            extractionRunId: newRunId,
          });

          const pending: PendingDispatch = {
            jobId: newJobId,
            extractionRunId: newRunId,
            enqueuedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            attempts: 1,
            lastAttemptAt: new Date().toISOString(),
            lastError: null,
          };

          await tx.$executeRaw`
            UPDATE "documents"
            SET metadata = jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(metadata, '{graphStatus}', '"QUEUED"'),
                  '{extractionRunId}', to_jsonb(${newRunId}::text)
                ),
                '{graphAttempts}', to_jsonb(${nextAttempts}::int)
              ),
              '{pendingDispatch}', to_jsonb(${JSON.stringify(pending)}::json)
            )
            WHERE id = ${doc.id} AND "workspaceId" = ${doc.workspaceId};
          `;
          result.untrustedRecoveredCount++;
          result.reconciledCount++;
        } else {
          this.logger.warn(
            `Document ${doc.id} reached recovery ceiling (${currentAttempts} runs); marking FAILED_RETRYABLE`,
          );
          await tx.$executeRaw`
            UPDATE "documents"
            SET metadata = jsonb_set(
              jsonb_set(
                metadata - 'pendingDispatch',
                '{graphStatus}', '"FAILED_RETRYABLE"'
              ),
              '{lastError}', '"Recovery ceiling exhausted (5 runs / 15 processor attempts). Awaiting user intervention."'
            )
            WHERE id = ${doc.id} AND "workspaceId" = ${doc.workspaceId};
          `;
          result.ceilingReachedCount++;
          result.reconciledCount++;
        }
        return;
      }

      // State 6: Failed in BullMQ
      case 'failed': {
        const attemptsMade = Number(job.attemptsMade || 0);
        if (attemptsMade < BULLMQ_ATTEMPTS_PER_RUN) {
          this.logger.info(
            `Job ${jobId} failed with ${attemptsMade}/${BULLMQ_ATTEMPTS_PER_RUN} attempts; retaining BullMQ retry backoff`,
          );
          return;
        }

        // Infrastructure Retry Exhaustion!
        this.logger.warn(
          `Job ${jobId} exhausted all ${attemptsMade} BullMQ retries without receipt; recovering under fresh runId`,
        );
        await this.handleExhaustedOrStalledJob(tx, doc, job, currentAttempts, result);
        return;
      }

      default: {
        this.logger.info(`Job ${jobId} is in unhandled BullMQ state '${state}'; skipping`);
        return;
      }
    }
  }

  /**
   * Helper to recover exhausted failed jobs or stale active jobs up to MAX_TOTAL_RUNS ceiling.
   */
  private async handleExhaustedOrStalledJob(
    tx: Prisma.TransactionClient,
    doc: { id: string; workspaceId: string; metadata: any },
    job: any,
    currentAttempts: number,
    result: GraphReconciliationSweepResult,
  ): Promise<void> {
    await job.remove().catch(() => {});

    if (currentAttempts < MAX_TOTAL_RUNS) {
      const nextAttempts = currentAttempts + 1;
      const newRunId = crypto.randomUUID();
      const newJobId = formatExtractionJobId(doc.id, newRunId);

      // Re-enqueue with 10s delay (§6.4.2 & §6.4.5)
      await this.queue.enqueue(
        {
          documentId: doc.id,
          workspaceId: doc.workspaceId,
          extractionRunId: newRunId,
        },
        { delay: 10000 },
      );

      const pending: PendingDispatch = {
        jobId: newJobId,
        extractionRunId: newRunId,
        enqueuedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        attempts: 1,
        lastAttemptAt: new Date().toISOString(),
        lastError: null,
      };

      await tx.$executeRaw`
        UPDATE "documents"
        SET metadata = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(metadata, '{graphStatus}', '"QUEUED"'),
              '{extractionRunId}', to_jsonb(${newRunId}::text)
            ),
            '{graphAttempts}', to_jsonb(${nextAttempts}::int)
          ),
          '{pendingDispatch}', to_jsonb(${JSON.stringify(pending)}::json)
        )
        WHERE id = ${doc.id} AND "workspaceId" = ${doc.workspaceId};
      `;
      result.exhaustedRecoveredCount++;
      result.reconciledCount++;
    } else {
      this.logger.warn(
        `Document ${doc.id} exhausted recovery ceiling (${currentAttempts} runs / ${MAX_TOTAL_PROCESSOR_ATTEMPTS} attempts); marking FAILED_RETRYABLE`,
      );
      await tx.$executeRaw`
        UPDATE "documents"
        SET metadata = jsonb_set(
          jsonb_set(
            metadata - 'pendingDispatch',
            '{graphStatus}', '"FAILED_RETRYABLE"'
          ),
          '{lastError}', '"Infrastructure retry ceiling exhausted (5 runs / 15 processor attempts). Awaiting user intervention."'
        )
        WHERE id = ${doc.id} AND "workspaceId" = ${doc.workspaceId};
      `;
      result.ceilingReachedCount++;
      result.reconciledCount++;
    }
  }
}
