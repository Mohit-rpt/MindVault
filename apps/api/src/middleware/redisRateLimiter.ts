import { Request, Response, NextFunction } from 'express';
import rateLimit, { type Store, type Options, type ClientRateLimitInfo } from 'express-rate-limit';
import { env } from '../config/env.js';
import { getRedisHealthClient } from '../routes/health.js';
import { AppError } from './errorHandler.js';

export interface RedisRateLimiterOptions {
  prefix: string;
  windowMs: number;
  max: number;
  failClosed?: boolean;
  message?: string;
  keyGenerator?: (req: Request) => string;
}

/**
 * Distributed Redis-backed Rate Limit Store (§NET-01, §ARC-02)
 * Atomic Lua script (incr + pexpire + pttl) guarantees race-free enforcement across replicas.
 * Supports configurable failClosed behavior.
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
      } catch {
        if (this.failClosed) {
          throw new AppError(
            503,
            'SERVICE_UNAVAILABLE',
            'Security rate limiting service is currently unavailable. Please try again shortly.',
          );
        }
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

export function sendRateLimitExceededResponse(
  res: Response,
  windowMs: number,
  customMessage?: string,
) {
  const retryAfterSeconds = Math.ceil(windowMs / 1000);
  res.setHeader('Retry-After', retryAfterSeconds);
  res.status(429).json({
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: customMessage || 'Too many requests. Please try again later.',
    },
    meta: {
      retryAfter: retryAfterSeconds,
      timestamp: new Date().toISOString(),
    },
  });
}

export function createRedisRateLimiter(options: RedisRateLimiterOptions) {
  const store = new RedisRateLimitStore(
    options.prefix,
    undefined,
    options.failClosed ?? env.RATE_LIMIT_FAIL_CLOSED,
  );

  return rateLimit({
    windowMs: options.windowMs,
    max: env.NODE_ENV === 'test' ? 1000 : options.max,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    keyGenerator: (req: Request) => {
      if (options.keyGenerator) {
        return options.keyGenerator(req);
      }
      const user = (req as any).user;
      const workspaceId = (req as any).workspaceId || req.headers['x-workspace-id'];
      if (user?.id) {
        return `${user.id}:${workspaceId || 'global'}`;
      }
      return req.ip || 'anonymous';
    },
    handler: (_req: Request, res: Response, _next: NextFunction) => {
      sendRateLimitExceededResponse(res, options.windowMs, options.message);
    },
  });
}

// Pre-configured rate limiters

export const distributedAuthRateLimiter = createRedisRateLimiter({
  prefix: 'auth',
  windowMs: 15 * 60 * 1000, // 15 mins
  max: 15,
  failClosed: true,
  message: 'Too many authentication attempts. Please try again in a few minutes.',
  keyGenerator: (req: Request) => {
    const email = req.body?.email ? String(req.body.email).toLowerCase().trim() : '';
    return `${req.ip || 'anon'}:${email}`;
  },
});

export const distributedUploadRateLimiter = createRedisRateLimiter({
  prefix: 'upload',
  windowMs: 60 * 1000, // 1 min
  max: 10, // 10 uploads/min per user/workspace
  failClosed: true,
  message: 'Upload rate limit exceeded. Please wait a minute before uploading additional documents.',
  keyGenerator: (req: Request) => {
    const user = (req as any).user;
    const ws = (req as any).workspaceId || req.headers['x-workspace-id'] || 'default';
    return `${user?.id || req.ip}:${ws}`;
  },
});

export const distributedChatRateLimiter = createRedisRateLimiter({
  prefix: 'chat',
  windowMs: 60 * 1000, // 1 min
  max: 20, // 20 requests/min per user
  failClosed: true,
  message: 'Chat request rate limit exceeded. Please wait a moment before sending another message.',
  keyGenerator: (req: Request) => {
    const user = (req as any).user;
    return user?.id || req.ip || 'anon';
  },
});

export const distributedSearchRateLimiter = createRedisRateLimiter({
  prefix: 'search',
  windowMs: 60 * 1000, // 1 min
  max: 30, // 30 vector searches/min per user
  failClosed: false,
  message: 'Search query rate limit exceeded. Please wait a moment before searching again.',
  keyGenerator: (req: Request) => {
    const user = (req as any).user;
    return user?.id || req.ip || 'anon';
  },
});
