import { Router, Request, Response } from 'express';
import {
  type HealthCheckResponse,
  sanitizeErrorMessage,
  getSafeRedisEndpoint,
} from '@mindvault/shared';
import type { Redis } from 'ioredis';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { documentQueue } from '../modules/document/document.queue.js';
import { graphExtractionQueue } from '../modules/graph/queue/graph-extraction.queue.js';

export const healthRouter: Router = Router();

// Test override client if explicitly injected
let testRedisClient: Redis | null = null;

/**
 * Reuses the existing shared Redis client from the API's BullMQ queues.
 * Does not instantiate `new Redis()` or introduce a second connection.
 */
export function getRedisHealthClient(): Redis | null {
  if (testRedisClient !== null) {
    return testRedisClient;
  }
  // Reuse existing BullMQ Queue connection from documentQueue or graphExtractionQueue
  const docBullQueue = (documentQueue as any)?.queue;
  const docClient = docBullQueue?.backend?.connection?._client ?? docBullQueue?.client;
  if (docClient) {
    return docClient as Redis;
  }

  const graphBullQueue = (graphExtractionQueue as any)?.queue;
  const graphClient = graphBullQueue?.backend?.connection?._client ?? graphBullQueue?.client;
  if (graphClient) {
    return graphClient as Redis;
  }

  return null;
}

/**
 * Test helper to allow injecting/resetting a mock client without creating connections.
 */
export function setRedisHealthClient(client: Redis | null): void {
  testRedisClient = client;
}

// Helper to probe PostgreSQL with a 1 s timeout.
async function performDbCheck() {
  let dbStatus: 'healthy' | 'unhealthy' | 'unknown' = 'unknown';
  let dbLatencyMs: number | undefined;
  let dbMessage = 'PostgreSQL check in progress';

  if (env.NODE_ENV === 'test') {
    if (process.env.DB_CHECK_FORCE_UNKNOWN === '1') {
      return {
        dbStatus: 'unknown' as const,
        dbLatencyMs: undefined,
        dbMessage: 'PostgreSQL connection status unknown',
      };
    }
    if (process.env.DB_CHECK_FORCE_FAIL === '1') {
      return {
        dbStatus: 'unhealthy' as const,
        dbLatencyMs: undefined,
        dbMessage: 'Forced DB failure (test)',
      };
    }
  }

  let timeoutId: NodeJS.Timeout | undefined;
  try {
    const dbStart = performance.now();
    let timerSettled = false;
    const queryPromise = prisma.$queryRaw`SELECT 1`.catch((err: any) => {
      // Safely handle late rejection without unhandled promise warnings
      if (timerSettled) return null;
      throw err;
    });
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        timerSettled = true;
        reject(new Error('PostgreSQL connection timeout (1000ms)'));
      }, 1000);
    });

    await Promise.race([queryPromise, timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);
    dbLatencyMs = Math.round(performance.now() - dbStart);
    dbStatus = 'healthy';
    dbMessage = 'Connected to PostgreSQL';
  } catch (err) {
    dbStatus = 'unhealthy';
    dbMessage = err instanceof Error ? err.message : 'Database connectivity check failed';
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  return { dbStatus, dbLatencyMs, dbMessage };
}

// Helper to probe Redis with a 1 s timeout using the shared BullMQ Redis client.
async function performRedisCheck() {
  let redisStatus: 'healthy' | 'unhealthy' | 'unknown' = 'unknown';
  let redisLatencyMs: number | undefined;
  let redisMessage = 'Redis check in progress';

  let timeoutId: NodeJS.Timeout | undefined;
  try {
    const client = getRedisHealthClient();
    if (!client) {
      redisStatus = 'unknown';
      redisMessage = 'Redis client uninitialized or unconfigured';
    } else {
      const redisStart = performance.now();
      let timerSettled = false;
      const pingPromise = client.ping().catch((err: any) => {
        // Safely handle late rejection without unhandled promise warnings
        if (timerSettled) return null;
        throw err;
      });
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          timerSettled = true;
          reject(new Error('Redis connection timeout (1000ms)'));
        }, 1000);
      });

      await Promise.race([pingPromise, timeoutPromise]);
      if (timeoutId) clearTimeout(timeoutId);
      redisLatencyMs = Math.round(performance.now() - redisStart);
      const endpoint = getSafeRedisEndpoint(env.REDIS_URL);
      redisStatus = 'healthy';
      redisMessage = `Connected to Redis (${endpoint.host}:${endpoint.port}${endpoint.isTls ? ' [TLS]' : ''})`;
    }
  } catch (err: any) {
    redisStatus = 'unhealthy';
    redisMessage = sanitizeErrorMessage(err?.message || 'Redis connectivity check failed');
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  return { redisStatus, redisLatencyMs, redisMessage };
}

// Liveness probe – always returns 200.
healthRouter.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'alive' });
});

// Readiness probe – checks DB and Redis, returns 200 when both are healthy.
healthRouter.get('/ready', async (_req: Request, res: Response) => {
  const [{ dbStatus }, { redisStatus }] = await Promise.all([
    performDbCheck(),
    performRedisCheck(),
  ]);
  const overallHealthy = dbStatus === 'healthy' && redisStatus === 'healthy';
  if (overallHealthy) {
    res.status(200).json({ status: 'ready' });
  } else {
    res.status(503).json({ status: 'not_ready' });
  }
});

// Legacy health endpoint – preserves exact previous response behavior and status calculation.
healthRouter.get('/', async (_req: Request, res: Response) => {
  const memory = process.memoryUsage();
  const { dbStatus, dbLatencyMs, dbMessage } = await performDbCheck();

  const healthPayload: HealthCheckResponse & {
    process: {
      pid: number;
      nodeVersion: string;
      memory: {
        rssMb: number;
        heapTotalMb: number;
        heapUsedMb: number;
      };
    };
  } = {
    status: dbStatus === 'healthy' ? 'healthy' : 'degraded',
    service: 'mindvault-api',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      memory: {
        rssMb: Math.round((memory.rss / 1024 / 1024) * 100) / 100,
        heapTotalMb: Math.round((memory.heapTotal / 1024 / 1024) * 100) / 100,
        heapUsedMb: Math.round((memory.heapUsed / 1024 / 1024) * 100) / 100,
      },
    },
    dependencies: {
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
        message: dbMessage,
      },
      redis: {
        status: 'unknown',
        message: 'Redis queue connectivity verification deferred to Phase 2 (BullMQ ingestion)',
      },
    },
  };

  res.status(200).json(healthPayload);
});

// Worker observability probe – inspects background worker heartbeat in Redis without affecting API readiness
healthRouter.get('/worker', async (_req: Request, res: Response) => {
  try {
    const client = getRedisHealthClient();
    if (!client) {
      res.status(200).json({
        status: 'unknown',
        message: 'Redis client uninitialized or unconfigured',
      });
      return;
    }

    const raw = await client.get('mindvault:worker:heartbeat');
    if (!raw) {
      res.status(200).json({
        status: 'offline',
        message:
          'No active worker heartbeat found. Worker is offline; queued jobs remain durable in Upstash Redis.',
      });
      return;
    }

    const data = JSON.parse(raw);
    res.status(200).json({
      status: data.status || 'online',
      workerId: data.workerId,
      lastHeartbeatAt: data.lastHeartbeatAt,
      lastJobAt: data.lastJobAt,
      lastJobId: data.lastJobId,
      lastDocId: data.lastDocId,
      concurrency: data.concurrency,
      environment: data.environment,
      system: data.system,
    });
  } catch (err: any) {
    res.status(200).json({
      status: 'unknown',
      message: `Failed to inspect worker heartbeat: ${sanitizeErrorMessage(err.message)}`,
    });
  }
});

// Companion observability probe – inspects local companion heartbeat in Redis
healthRouter.get('/companion', async (_req: Request, res: Response) => {
  try {
    const client = getRedisHealthClient();
    if (!client) {
      res.status(200).json({
        status: 'unknown',
        message: 'Redis client uninitialized or unconfigured',
      });
      return;
    }

    const raw = await client.get('mindvault:companion:heartbeat');
    if (!raw) {
      res.status(200).json({
        status: 'offline',
        message: 'No active companion heartbeat found. Local companion is offline.',
      });
      return;
    }

    const data = JSON.parse(raw);
    res.status(200).json({
      status: 'online',
      deviceId: data.deviceId,
      deviceName: data.deviceName,
      companionStatus: data.companionStatus,
      workerState: data.workerState,
      uptimeSeconds: data.uptimeSeconds,
      idleCountdownSeconds: data.idleCountdownSeconds,
      activeJobsCount: data.activeJobsCount,
      system: data.system,
    });
  } catch (err: any) {
    res.status(200).json({
      status: 'unknown',
      message: `Failed to inspect companion heartbeat: ${sanitizeErrorMessage(err.message)}`,
    });
  }
});
