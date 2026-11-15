import { Router } from 'express';
import rateLimit, { type Store, type Options, type ClientRateLimitInfo } from 'express-rate-limit';
import { companionController } from './companion.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authenticateDevice } from './companion.auth.js';
import { env } from '../../config/env.js';
import { getRedisHealthClient } from '../../routes/health.js';
import { AppError } from '../../middleware/errorHandler.js';

export const companionRouter: Router = Router();

/**
 * Distributed Redis-backed Rate Limit Store (§NET-01)
 * Shares rate-limit counters across all API replicas via Redis.
 * Transparently degrades to memory fallback if Redis is unavailable,
 * except when failClosed is enabled on security-sensitive endpoints.
 */
export class RedisRateLimitStore implements Store {
  public prefix: string;
  private windowMs: number = 60 * 1000;
  private memoryFallback = new Map<string, { totalHits: number; resetTime: Date }>();
  private redisOverride?: any;
  public failClosed: boolean;

  constructor(prefix: string, redisOverride?: any, failClosed = false) {
    this.prefix = `mindvault:rl:${prefix}:`;
    this.redisOverride = redisOverride;
    this.failClosed = failClosed;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private getRedis(): any {
    return this.redisOverride || getRedisHealthClient();
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const redis = this.getRedis();
    const redisKey = `${this.prefix}${key}`;
    const windowMs = this.windowMs;

    if (redis && typeof redis.eval === 'function') {
      try {
        const LUA_INCR = `
          local current = redis.call('incr', KEYS[1])
          if current == 1 then
            redis.call('pexpire', KEYS[1], ARGV[1])
          end
          local ttl = redis.call('pttl', KEYS[1])
          return { current, ttl }
        `;
        const res = (await redis.eval(LUA_INCR, 1, redisKey, String(windowMs))) as [number, number];
        const totalHits = Number(res[0]);
        const ttl = Number(res[1]) > 0 ? Number(res[1]) : windowMs;
        const resetTime = new Date(Date.now() + ttl);
        return { totalHits, resetTime };
      } catch (err: any) {
        if (this.failClosed) {
          throw new AppError(
            503,
            'SERVICE_UNAVAILABLE',
            'Security rate limiting service is currently unavailable. Please try again shortly.',
          );
        }
        // Fall back to in-memory on Redis error
      }
    } else if (this.failClosed) {
      if (
        env.NODE_ENV === 'production' ||
        this.redisOverride === 'disconnected' ||
        (this.redisOverride && typeof this.redisOverride.eval !== 'function')
      ) {
        throw new AppError(
          503,
          'SERVICE_UNAVAILABLE',
          'Security rate limiting service is currently unavailable. Please try again shortly.',
        );
      }
    }

    // In-memory fallback
    const now = Date.now();
    let entry = this.memoryFallback.get(key);
    if (!entry || entry.resetTime.getTime() <= now) {
      entry = { totalHits: 1, resetTime: new Date(now + windowMs) };
    } else {
      entry.totalHits += 1;
    }
    this.memoryFallback.set(key, entry);
    return entry;
  }

  async decrement(key: string): Promise<void> {
    const redis = this.getRedis();
    if (redis && typeof redis.decr === 'function') {
      try {
        await redis.decr(`${this.prefix}${key}`);
        return;
      } catch {
        // Fall back to memory
      }
    }
    const entry = this.memoryFallback.get(key);
    if (entry && entry.totalHits > 0) {
      entry.totalHits -= 1;
    }
  }

  async resetKey(key: string): Promise<void> {
    const redis = this.getRedis();
    if (redis && typeof redis.del === 'function') {
      try {
        await redis.del(`${this.prefix}${key}`);
        return;
      } catch {
        // Fall back to memory
      }
    }
    this.memoryFallback.delete(key);
  }
}

// Rate limiter for pairing code generation and device registration (§NET-01, P1 Fail-Closed)
export const companionPairingRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'test' ? 1000 : 15,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('pairing', undefined, true),
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many device pairing attempts. Please try again later.',
    },
    meta: { timestamp: new Date().toISOString() },
  },
});

// Rate limiter for high-frequency polling and heartbeats (§NET-01)
const companionPollingRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.NODE_ENV === 'test' ? 2000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('polling'),
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many companion polling requests. Please reduce polling interval.',
    },
    meta: { timestamp: new Date().toISOString() },
  },
});

// Rate limiter for device status & revocation (§NET-01)
const companionManagementRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.NODE_ENV === 'test' ? 1000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('mgmt'),
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many companion management requests.',
    },
    meta: { timestamp: new Date().toISOString() },
  },
});

// 1. One-time pairing code generation (authenticated user session required) (§SEC-01)
companionRouter.post('/pairing/code', companionPairingRateLimiter, authenticate, (req, res) => {
  companionController.createPairingCode(req, res);
});

// 2. Claim one-time pairing code to pair device (one-time code required) (§SEC-01)
companionRouter.post('/pairing/claim', companionPairingRateLimiter, (req, res) => {
  companionController.claimPairingCode(req, res);
});

// 3. Legacy device pairing / registration (user credentials required)
companionRouter.post('/device/register', companionPairingRateLimiter, authenticate, (req, res) => {
  companionController.register(req, res);
});

// 4. Device status check (device token required)
companionRouter.get('/device/status', companionManagementRateLimiter, authenticateDevice, (req, res) => {
  companionController.getStatus(req, res);
});

// 5. Device revocation (device token required)
companionRouter.post('/device/revoke', companionManagementRateLimiter, authenticateDevice, (req, res) => {
  companionController.revoke(req, res);
});

// 6. Pending job availability probe for local companion polling (device token required) (§ARC-01)
companionRouter.get('/jobs/status', companionPollingRateLimiter, authenticateDevice, (req, res) => {
  companionController.getJobStatus(req, res);
});

// 7. Heartbeat & telemetry from companion (device token required) (§NET-01)
companionRouter.post('/heartbeat', companionPollingRateLimiter, authenticateDevice, (req, res) => {
  companionController.recordHeartbeat(req, res);
});
