import { Router, Request, Response } from 'express';
import { HealthCheckResponse } from '@mindvault/shared';
import { prisma } from '../lib/prisma.js';

export const healthRouter: Router = Router();

healthRouter.get('/', async (_req: Request, res: Response) => {
  const memory = process.memoryUsage();

  // Probe PostgreSQL if configured
  let dbStatus: 'healthy' | 'unhealthy' | 'unknown' = 'unknown';
  let dbLatencyMs: number | undefined;
  let dbMessage = 'PostgreSQL check in progress';

  try {
    const dbStart = performance.now();
    const queryPromise = prisma.$queryRaw`SELECT 1`;
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('PostgreSQL connection timeout (1000ms)')), 1000),
    );

    await Promise.race([queryPromise, timeoutPromise]);
    dbLatencyMs = Math.round(performance.now() - dbStart);
    dbStatus = 'healthy';
    dbMessage = 'Connected to PostgreSQL';
  } catch (err) {
    dbStatus = 'unhealthy';
    dbMessage = err instanceof Error ? err.message : 'Database connectivity check failed';
  }

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
