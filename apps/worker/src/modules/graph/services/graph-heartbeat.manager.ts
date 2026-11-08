/**
 * MindVault — Worker: Dual-Lease Graph Heartbeat & Fencing Manager
 *
 * Implements single-flight dual Redis/PostgreSQL lease extension,
 * fail-closed fencing detection, and race-safe shutdown deferral coordination.
 */

import type { Redis } from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import {
  LUA_RENEW_LEASE_SCRIPT,
  LUA_RELEASE_LEASE_SCRIPT,
} from '@mindvault/shared';
import { Logger } from '../../../utils/logger.js';

export type HeartbeatLifecycleState =
  | 'ACTIVE'
  | 'PREPARING_DEFERRAL'
  | 'DEFERRED'
  | 'TERMINATED';

export interface HeartbeatManagerOptions {
  documentId: string;
  extractionRunId: string;
  workerToken: string;
  leaseGeneration?: number;
  redisClient: Redis;
  prisma: PrismaClient;
  intervalMs?: number;
  leaseTtlSeconds?: number;
  onFenced?: () => void;
}

export class GraphHeartbeatManager {
  private readonly logger: Logger;
  private readonly documentId: string;
  private readonly extractionRunId: string;
  private readonly workerToken: string;
  private readonly leaseGeneration?: number;
  private readonly redisClient: Redis;
  private readonly prisma: PrismaClient;
  private readonly intervalMs: number;
  private readonly leaseTtlSeconds: number;
  private readonly onFenced?: () => void;

  private state: HeartbeatLifecycleState = 'ACTIVE';
  private timer: NodeJS.Timeout | null = null;
  private isRenewing = false;
  private activeRenewalPromise: Promise<boolean> | null = null;
  private isFenced = false;

  constructor(options: HeartbeatManagerOptions) {
    this.documentId = options.documentId;
    this.extractionRunId = options.extractionRunId;
    this.workerToken = options.workerToken;
    this.leaseGeneration = options.leaseGeneration;
    this.redisClient = options.redisClient;
    this.prisma = options.prisma;
    this.intervalMs = options.intervalMs ?? 15000;
    this.leaseTtlSeconds = options.leaseTtlSeconds ?? 60;
    this.onFenced = options.onFenced;
    this.logger = new Logger(`HeartbeatManager:${this.documentId}`);
  }

  public start(): void {
    if (this.state !== 'ACTIVE' || this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.renewSingleFlight();
    }, this.intervalMs);
  }

  public getState(): HeartbeatLifecycleState {
    return this.state;
  }

  public isWorkerFenced(): boolean {
    return this.isFenced;
  }

  /**
   * Executes dual-lease renewal under a single-flight mutex.
   * If a renewal is already in-flight, returns the active promise.
   */
  public async renewSingleFlight(): Promise<boolean> {
    if (this.state !== 'ACTIVE' || this.isFenced) {
      return false;
    }

    if (this.isRenewing && this.activeRenewalPromise) {
      return this.activeRenewalPromise;
    }

    this.isRenewing = true;
    this.activeRenewalPromise = this.executeDualRenewal()
      .finally(() => {
        this.isRenewing = false;
        this.activeRenewalPromise = null;
      });

    return this.activeRenewalPromise;
  }

  /**
   * Dual-lease renewal:
   * 1. Renew Redis in-memory cluster lease via Lua script.
   * 2. If Redis succeeds, renew PostgreSQL durable lease via atomic CAS.
   * If either store returns 0 (or fails), fail-closed: worker is fenced.
   */
  private async executeDualRenewal(): Promise<boolean> {
    const redisKey = `mindvault:graph:lease:${this.documentId}`;

    // Step 1: Redis Lease Renewal
    try {
      const redisResult = await this.redisClient.eval(
        LUA_RENEW_LEASE_SCRIPT,
        1,
        redisKey,
        this.workerToken,
        this.leaseTtlSeconds.toString(),
      );

      if (redisResult !== 1) {
        this.logger.warn('Redis lease extension failed (lease lost or expired); fencing worker');
        this.triggerFencing();
        return false;
      }
    } catch (err: any) {
      this.logger.warn(`Redis lease extension error: ${err.message}; fencing worker`);
      this.triggerFencing();
      return false;
    }

    // Double-check state before touching DB: ensure deferral did not start concurrently
    if (this.state !== 'ACTIVE') {
      return false;
    }

    // Step 2: PostgreSQL Durable Lease Renewal (Timezone-safe UTC query)
    try {
      const rowsUpdated = this.leaseGeneration !== undefined
        ? await this.prisma.$executeRaw`
            UPDATE "Document"
            SET metadata = jsonb_set(
              jsonb_set(
                metadata,
                '{graphHeartbeatAt}',
                to_jsonb(to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
              ),
              '{graphLeaseExpiresAt}',
              to_jsonb(to_char((clock_timestamp() + INTERVAL '60 seconds') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
            )
            WHERE id = ${this.documentId}
              AND metadata->>'extractionRunId' = ${this.extractionRunId}
              AND metadata->>'graphWorkerToken' = ${this.workerToken}
              AND (metadata->>'graphLeaseGeneration')::bigint = ${this.leaseGeneration}::bigint
              AND metadata->>'graphStatus' = 'PROCESSING'
              AND (metadata->>'graphLeaseExpiresAt')::timestamptz > clock_timestamp();
          `
        : await this.prisma.$executeRaw`
            UPDATE "Document"
            SET metadata = jsonb_set(
              jsonb_set(
                metadata,
                '{graphHeartbeatAt}',
                to_jsonb(to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
              ),
              '{graphLeaseExpiresAt}',
              to_jsonb(to_char((clock_timestamp() + INTERVAL '60 seconds') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
            )
            WHERE id = ${this.documentId}
              AND metadata->>'extractionRunId' = ${this.extractionRunId}
              AND metadata->>'graphWorkerToken' = ${this.workerToken}
              AND metadata->>'graphStatus' = 'PROCESSING'
              AND (metadata->>'graphLeaseExpiresAt')::timestamptz > clock_timestamp();
          `;

      if (rowsUpdated === 0) {
        this.logger.warn('PostgreSQL lease extension CAS returned 0 rows (run superseded or expired); fencing worker');
        // Release Redis lease immediately to prevent zombie lock retention
        await this.releaseRedisLeaseSilently();
        this.triggerFencing();
        return false;
      }

      this.logger.debug('Successfully renewed dual Redis and PostgreSQL leases');
      return true;
    } catch (err: any) {
      this.logger.warn(`PostgreSQL lease extension error: ${err.message}; fencing worker`);
      await this.releaseRedisLeaseSilently();
      this.triggerFencing();
      return false;
    }
  }

  /**
   * Prepares for intentional shutdown deferral.
   * 1. Halts renewal timer.
   * 2. Sets state to PREPARING_DEFERRAL to prevent any future renewal queries from running.
   * 3. Awaits any in-flight renewal query to guarantee zero overlapping DB operations.
   */
  public async prepareDeferral(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.state = 'PREPARING_DEFERRAL';

    if (this.activeRenewalPromise) {
      this.logger.debug('Awaiting in-flight heartbeat renewal before proceeding with deferral...');
      try {
        await this.activeRenewalPromise;
      } catch {
        // Ignored; in-flight renewal error already handled
      }
    }
  }

  /**
   * Marks deferral complete and releases the Redis cluster lease.
   */
  public async markDeferred(): Promise<void> {
    this.state = 'DEFERRED';
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.releaseRedisLeaseSilently();
  }

  /**
   * Terminates heartbeat manager upon normal completion or permanent failure.
   */
  public async terminate(): Promise<void> {
    this.state = 'TERMINATED';
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.releaseRedisLeaseSilently();
  }

  private triggerFencing(): void {
    this.isFenced = true;
    this.state = 'TERMINATED';
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.onFenced) {
      try {
        this.onFenced();
      } catch (e: any) {
        this.logger.error(`Error in onFenced callback: ${e.message}`);
      }
    }
  }

  private async releaseRedisLeaseSilently(): Promise<void> {
    try {
      const redisKey = `mindvault:graph:lease:${this.documentId}`;
      await this.redisClient.eval(
        LUA_RELEASE_LEASE_SCRIPT,
        1,
        redisKey,
        this.workerToken,
      );
    } catch (e: any) {
      this.logger.debug(`Silently ignored Redis lease release error: ${e.message}`);
    }
  }
}
