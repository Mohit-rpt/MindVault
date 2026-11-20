import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuotaService } from '../quota.service.js';
import { prisma } from '../../lib/prisma.js';

describe('Sprint 4: Resource Governance & Quota Service Suite', () => {
  let mockRedis: any;
  let quotaService: QuotaService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      incrby: vi.fn().mockResolvedValue(1),
      decrby: vi.fn().mockResolvedValue(0),
      expire: vi.fn().mockResolvedValue(1),
      incr: vi.fn().mockResolvedValue(1),
    };
    quotaService = new QuotaService(mockRedis);
  });

  describe('Upload Quota Reservations', () => {
    it('rejects uploads exceeding maximum single file size limit', async () => {
      const oversizedBytes = 15 * 1024 * 1024; // 15MB > 10MB limit
      await expect(
        quotaService.reserveUploadQuota('ws-test', oversizedBytes),
      ).rejects.toThrow(/File exceeds maximum permitted upload size/);
    });

    it('successfully reserves quota when workspace usage is within limits', async () => {
      vi.spyOn(prisma.document, 'aggregate').mockResolvedValueOnce({
        _count: { id: 5 },
        _sum: { sizeBytes: 5000000n },
      } as any);

      const reservation = await quotaService.reserveUploadQuota('ws-test', 2000000);
      expect(reservation.workspaceId).toBe('ws-test');
      expect(reservation.fileSizeBytes).toBe(2000000);
      expect(mockRedis.incrby).toHaveBeenCalledWith('mindvault:quota:reserve:docs:ws-test', 1);
      expect(mockRedis.incrby).toHaveBeenCalledWith('mindvault:quota:reserve:bytes:ws-test', 2000000);

      // Verify release clears Redis reservation
      await reservation.release();
      expect(mockRedis.decrby).toHaveBeenCalledWith('mindvault:quota:reserve:docs:ws-test', 1);
      expect(mockRedis.decrby).toHaveBeenCalledWith('mindvault:quota:reserve:bytes:ws-test', 2000000);
    });

    it('rejects upload when projected document count exceeds workspace limit', async () => {
      vi.spyOn(prisma.document, 'aggregate').mockResolvedValueOnce({
        _count: { id: 100 }, // Max limit is 100
        _sum: { sizeBytes: 1000000n },
      } as any);

      await expect(quotaService.reserveUploadQuota('ws-test', 1000)).rejects.toThrow(
        /Workspace document limit exceeded/,
      );
    });

    it('rejects upload when projected storage bytes exceed workspace limit', async () => {
      vi.spyOn(prisma.document, 'aggregate').mockResolvedValueOnce({
        _count: { id: 10 },
        _sum: { sizeBytes: 104857600n }, // 100MB max limit
      } as any);

      await expect(quotaService.reserveUploadQuota('ws-test', 500000)).rejects.toThrow(
        /Workspace storage limit exceeded/,
      );
    });

    it('accounts for active in-flight Redis reservations under concurrency', async () => {
      vi.spyOn(prisma.document, 'aggregate').mockResolvedValueOnce({
        _count: { id: 98 },
        _sum: { sizeBytes: 1000000n },
      } as any);

      // Another upload is in-flight (1 in Redis)
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key.includes('docs')) return '2';
        return '0';
      });

      // 98 in DB + 2 in flight = 100. Adding 1 = 101 > 100 limit!
      await expect(quotaService.reserveUploadQuota('ws-test', 1000)).rejects.toThrow(
        /Workspace document limit exceeded/,
      );
    });
  });

  describe('Daily AI Chat Message Quota', () => {
    it('tracks chat queries in Redis sliding counter', async () => {
      mockRedis.incr.mockResolvedValueOnce(1);
      await expect(quotaService.checkChatQuota('usr-123')).resolves.not.toThrow();
      expect(mockRedis.expire).toHaveBeenCalled();
    });

    it('rejects chat request when user exceeds daily message quota', async () => {
      mockRedis.incr.mockResolvedValueOnce(501); // Exceeds 500 max
      await expect(quotaService.checkChatQuota('usr-123')).rejects.toThrow(
        /Daily AI chat quota exceeded/,
      );
    });
  });
});
