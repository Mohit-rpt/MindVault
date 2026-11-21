import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RedisRateLimitStore,
  createRedisRateLimiter,
  sendRateLimitExceededResponse,
} from '../redisRateLimiter.js';
import { setApiRedisClient } from '../../lib/redis.js';
import { AppError } from '../errorHandler.js';

describe('Sprint 4: Distributed Redis Rate Limiter Suite', () => {
  let mockRedis: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = {
      eval: vi.fn(),
      decr: vi.fn(),
      del: vi.fn(),
    };
  });

  describe('RedisRateLimitStore with Atomic Lua Scripts', () => {
    it('increments counter atomically and calculates reset time via Redis Lua script', async () => {
      mockRedis.eval.mockResolvedValueOnce([1, 55000]); // [current=1, ttl=55000ms]
      const store = new RedisRateLimitStore('test', mockRedis, true);
      store.init({ windowMs: 60000 } as any);

      const res = await store.increment('client-ip-1');
      expect(res.totalHits).toBe(1);
      expect(res.resetTime).toBeInstanceOf(Date);
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    });

    it('throws 503 SERVICE_UNAVAILABLE when failClosed is true and Redis errors', async () => {
      mockRedis.eval.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const store = new RedisRateLimitStore('test', mockRedis, true);
      store.init({ windowMs: 60000 } as any);

      await expect(store.increment('client-ip-2')).rejects.toThrow(AppError);
      try {
        await store.increment('client-ip-2');
      } catch (err: any) {
        expect(err.statusCode).toBe(503);
        expect(err.code).toBe('SERVICE_UNAVAILABLE');
      }
    });

    it('degrades gracefully to memory fallback when failClosed is false and Redis errors', async () => {
      mockRedis.eval.mockRejectedValueOnce(new Error('Redis Timeout'));
      const store = new RedisRateLimitStore('test', mockRedis, false);
      store.init({ windowMs: 60000 } as any);

      const res1 = await store.increment('client-ip-3');
      expect(res1.totalHits).toBe(1);

      mockRedis.eval.mockRejectedValueOnce(new Error('Redis Timeout'));
      const res2 = await store.increment('client-ip-3');
      expect(res2.totalHits).toBe(2);
    });

    it('receives and uses dedicated API Redis client when redisOverride is not passed', async () => {
      const mockSharedRedis = {
        eval: vi.fn().mockResolvedValueOnce([1, 45000]),
      };
      setApiRedisClient(mockSharedRedis as any);

      // Pass undefined for redisOverride
      const store = new RedisRateLimitStore('shared_test', undefined, true);
      store.init({ windowMs: 60000 } as any);

      const res = await store.increment('client-shared-1');
      expect(res.totalHits).toBe(1);
      expect(mockSharedRedis.eval).toHaveBeenCalledTimes(1);

      setApiRedisClient(undefined);
    });

    it('prefers redisOverride over dedicated API Redis client', async () => {
      const mockSharedRedis = {
        eval: vi.fn().mockResolvedValueOnce([1, 45000]),
      };
      setApiRedisClient(mockSharedRedis as any);

      mockRedis.eval.mockResolvedValueOnce([1, 50000]);
      // Pass mockRedis explicitly as redisOverride
      const store = new RedisRateLimitStore('override_test', mockRedis, true);
      store.init({ windowMs: 60000 } as any);

      const res = await store.increment('client-override-1');
      expect(res.totalHits).toBe(1);
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
      expect(mockSharedRedis.eval).not.toHaveBeenCalled();

      setApiRedisClient(undefined);
    });

    it('throws 503 SERVICE_UNAVAILABLE when failClosed is true and redisOverride is disconnected', async () => {
      const store = new RedisRateLimitStore('disconnected_test', 'disconnected', true);
      store.init({ windowMs: 60000 } as any);

      await expect(store.increment('client-fail-1')).rejects.toThrow(AppError);
    });
  });

  describe('createRedisRateLimiter Middleware Factory', () => {
    it('sets Retry-After header and returns standardized JSON on rate limit exceeded', () => {
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        setHeader: vi.fn(),
      };

      // Invoke error response handler directly
      sendRateLimitExceededResponse(res, 30000, 'Custom rate limit hit');

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 30);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Custom rate limit hit',
          },
          meta: expect.objectContaining({
            retryAfter: 30,
          }),
        }),
      );
    });
  });
});
