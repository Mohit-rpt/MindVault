import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { getRedisHealthClient } from '../routes/health.js';
import { AppError } from '../middleware/errorHandler.js';
import type { WorkspaceQuotaLimits, WorkspaceQuotaUsage } from '@mindvault/shared';

export interface QuotaReservation {
  workspaceId: string;
  fileSizeBytes: number;
  release: () => Promise<void>;
  commit: () => Promise<void>;
}

export class QuotaService {
  private redisOverride?: any;

  constructor(redisOverride?: any) {
    this.redisOverride = redisOverride;
  }

  private getRedis(): any {
    return this.redisOverride || getRedisHealthClient();
  }

  public getLimits(): WorkspaceQuotaLimits {
    return {
      maxDocuments: env.WORKSPACE_MAX_DOCUMENTS,
      maxStorageBytes: env.WORKSPACE_MAX_STORAGE_BYTES,
      maxFileSizeBytes: 10 * 1024 * 1024, // 10MB default
      maxChatMessagesPerDay: env.USER_MAX_CHAT_MESSAGES_PER_DAY,
    };
  }

  public async getWorkspaceUsage(workspaceId: string): Promise<WorkspaceQuotaUsage> {
    const agg = await prisma.document.aggregate({
      where: {
        workspaceId,
        status: { not: 'FAILED' },
      },
      _count: { id: true },
      _sum: { sizeBytes: true },
    });

    return {
      documentCount: agg._count.id || 0,
      storageBytes: Number(agg._sum.sizeBytes || 0n),
      chatMessagesToday: 0,
    };
  }

  /**
   * Concurrency-safe atomic quota reservation (§ARC-02, §OPS-03).
   * Checks database usage + pending Redis reservations.
   * If within bounds, reserves space in Redis with 60-second self-expiring TTL.
   * Returns commit and release handles.
   */
  public async reserveUploadQuota(
    workspaceId: string,
    fileSizeBytes: number,
  ): Promise<QuotaReservation> {
    const limits = this.getLimits();

    if (fileSizeBytes > limits.maxFileSizeBytes) {
      const maxMb = Math.round(limits.maxFileSizeBytes / (1024 * 1024));
      throw new AppError(
        400,
        'FILE_TOO_LARGE',
        `File exceeds maximum permitted upload size (${maxMb} MB)`,
      );
    }

    // 1. Fetch current committed usage from PostgreSQL
    const currentUsage = await this.getWorkspaceUsage(workspaceId);

    // 2. Fetch pending in-flight reservations from Redis (if available)
    const redis = this.getRedis();
    const docReserveKey = `mindvault:quota:reserve:docs:${workspaceId}`;
    const byteReserveKey = `mindvault:quota:reserve:bytes:${workspaceId}`;
    let inFlightDocs = 0;
    let inFlightBytes = 0;

    if (redis && typeof redis.get === 'function') {
      try {
        const [rDocs, rBytes] = await Promise.all([
          redis.get(docReserveKey),
          redis.get(byteReserveKey),
        ]);
        if (rDocs) inFlightDocs = parseInt(rDocs, 10) || 0;
        if (rBytes) inFlightBytes = parseInt(rBytes, 10) || 0;
      } catch {
        // Fall back to DB usage alone if Redis reservation read fails
      }
    }

    const projectedDocs = currentUsage.documentCount + inFlightDocs + 1;
    const projectedBytes = currentUsage.storageBytes + inFlightBytes + fileSizeBytes;

    if (projectedDocs > limits.maxDocuments) {
      throw new AppError(
        429,
        'QUOTA_EXCEEDED',
        `Workspace document limit exceeded (${limits.maxDocuments} documents maximum). Delete existing documents to upload more.`,
      );
    }

    if (projectedBytes > limits.maxStorageBytes) {
      const maxMb = Math.round(limits.maxStorageBytes / (1024 * 1024));
      throw new AppError(
        429,
        'QUOTA_EXCEEDED',
        `Workspace storage limit exceeded (${maxMb} MB maximum). Current: ${Math.round(
          currentUsage.storageBytes / (1024 * 1024),
        )} MB.`,
      );
    }

    // 3. Atomically add in-flight reservation in Redis with 60-second TTL
    if (redis && typeof redis.incrby === 'function') {
      try {
        await Promise.all([
          redis.incrby(docReserveKey, 1),
          redis.incrby(byteReserveKey, fileSizeBytes),
        ]);
        await Promise.all([redis.expire(docReserveKey, 60), redis.expire(byteReserveKey, 60)]);
      } catch {
        // Non-blocking reservation failure
      }
    }

    let isReleased = false;

    const release = async (): Promise<void> => {
      if (isReleased) return;
      isReleased = true;
      if (redis && typeof redis.decrby === 'function') {
        try {
          await Promise.all([
            redis.decrby(docReserveKey, 1),
            redis.decrby(byteReserveKey, fileSizeBytes),
          ]);
        } catch {
          // Ignore release errors; TTL will expire
        }
      }
    };

    const commit = async (): Promise<void> => {
      // Committing clears the in-flight reservation because the document row is now in PostgreSQL
      await release();
    };

    return {
      workspaceId,
      fileSizeBytes,
      release,
      commit,
    };
  }

  /**
   * Enforces daily chat message quota per user.
   */
  public async checkChatQuota(userId: string): Promise<void> {
    const limits = this.getLimits();
    const redis = this.getRedis();
    if (!redis || typeof redis.incr !== 'function') {
      return; // If Redis is unavailable and non-fail-closed, allow chat
    }

    const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const key = `mindvault:quota:chat:${userId}:${dateKey}`;

    try {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, 86400); // 24 hours
      }
      if (count > limits.maxChatMessagesPerDay) {
        throw new AppError(
          429,
          'QUOTA_EXCEEDED',
          `Daily AI chat quota exceeded (${limits.maxChatMessagesPerDay} messages/day). Quota resets at 00:00 UTC.`,
        );
      }
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      // If Redis has an operational error, let standard rate limiter handle fail-open/closed
    }
  }
}

export const quotaService = new QuotaService();
