import { Router, Request, Response } from 'express';
import { HealthCheckResponse } from '@mindvault/shared';

export const healthRouter: Router = Router();

healthRouter.get('/', (_req: Request, res: Response) => {
  const memory = process.memoryUsage();

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
    status: 'healthy',
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
        status: 'unknown',
        message: 'PostgreSQL connection verification deferred to Phase 1 (schema initialization)',
      },
      redis: {
        status: 'unknown',
        message: 'Redis queue connectivity verification deferred to Phase 2 (BullMQ ingestion)',
      },
    },
  };

  res.status(200).json(healthPayload);
});
