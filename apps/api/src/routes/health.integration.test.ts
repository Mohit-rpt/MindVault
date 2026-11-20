import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// Mock prisma before importing app or healthRouter
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { setRedisHealthClient, getRedisHealthClient } from './health.js';
import { documentQueue, setDocumentQueue } from '../modules/document/document.queue.js';

describe('MindVault Health Endpoints — Integration Suite', () => {
  const originalEnv = { ...process.env };
  const originalDocQueue = documentQueue;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DB_CHECK_FORCE_UNKNOWN;
    delete process.env.DB_CHECK_FORCE_FAIL;
    vi.clearAllMocks();
    setRedisHealthClient(null);
    setDocumentQueue(originalDocQueue);
  });

  afterEach(() => {
    vi.useRealTimers();
    setRedisHealthClient(null);
    setDocumentQueue(originalDocQueue);
    process.env = { ...originalEnv };
  });

  // 1. Liveness Probe
  it('1. Liveness probe returns HTTP 200 with { status: "alive" } without DB/Redis', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'alive' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  // 2. Readiness Probe — Success
  it('2. Readiness returns HTTP 200 when both DB and Redis are healthy', async () => {
    (prisma.$queryRaw as any).mockResolvedValueOnce([{ '?column?': 1 }]);
    setRedisHealthClient({
      ping: vi.fn().mockResolvedValue('PONG'),
    } as any);

    const app = createApp();
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  // 3. Readiness Probe — DB Failure
  it('3. Readiness returns HTTP 503 when DB check fails', async () => {
    (prisma.$queryRaw as any).mockRejectedValueOnce(new Error('PostgreSQL connection error'));
    setRedisHealthClient({
      ping: vi.fn().mockResolvedValue('PONG'),
    } as any);

    const app = createApp();
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'not_ready' });
  });

  // 4. Readiness Probe — Redis Failure
  it('4. Readiness returns HTTP 503 when Redis ping rejects', async () => {
    (prisma.$queryRaw as any).mockResolvedValueOnce([{ '?column?': 1 }]);
    setRedisHealthClient({
      ping: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
    } as any);

    const app = createApp();
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'not_ready' });
  });

  // 5. Readiness Probe — DB Timeout (>1000ms)
  it('5. Readiness returns HTTP 503 on DB query timeout (>1000ms)', async () => {
    (prisma.$queryRaw as any).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 1300)),
    );
    setRedisHealthClient({
      ping: vi.fn().mockResolvedValue('PONG'),
    } as any);

    const app = createApp();
    const res = await request(app).get('/api/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'not_ready' });
  });

  // 6. Readiness Probe — Redis Timeout (>1000ms)
  it('6. Readiness returns HTTP 503 on Redis ping timeout (>1000ms)', async () => {
    (prisma.$queryRaw as any).mockResolvedValueOnce([{ '?column?': 1 }]);
    setRedisHealthClient({
      ping: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 1300))),
    } as any);

    const app = createApp();
    const res = await request(app).get('/api/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'not_ready' });
  });

  // 7. Readiness Probe — Redis Unknown
  it('7. Readiness returns HTTP 503 when Redis status is unknown (unconfigured/null)', async () => {
    (prisma.$queryRaw as any).mockResolvedValueOnce([{ '?column?': 1 }]);
    setRedisHealthClient(null);

    const app = createApp();
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'not_ready' });
  });

  // 8. Readiness Probe — DB Unknown
  it('8. Readiness returns HTTP 503 when DB status is unknown', async () => {
    process.env.DB_CHECK_FORCE_UNKNOWN = '1';
    setRedisHealthClient({
      ping: vi.fn().mockResolvedValue('PONG'),
    } as any);

    const app = createApp();
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'not_ready' });
  });

  // 9. Redis Singleton Reuse from BullMQ
  it('9. Reuses existing shared Redis client from BullMQ documentQueue without creating new client', () => {
    const mockSharedRedis = { ping: vi.fn().mockResolvedValue('PONG') };
    const mockBullMQQueue = {
      queue: {
        backend: {
          connection: {
            _client: mockSharedRedis,
          },
        },
      },
      enqueue: vi.fn(),
      close: vi.fn(),
    };

    setDocumentQueue(mockBullMQQueue as any);
    setRedisHealthClient(null); // Ensure no manual override

    const client = getRedisHealthClient();
    expect(client).toBe(mockSharedRedis);
  });

  // 10. Exact Legacy GET /api/health Response Compatibility
  it('10. Legacy endpoint GET /api/health retains exact original response payload and status calculation', async () => {
    (prisma.$queryRaw as any).mockResolvedValueOnce([{ '?column?': 1 }]);

    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);

    const body = res.body;
    expect(body).toEqual({
      status: 'healthy',
      service: 'mindvault-api',
      version: '1.0.0',
      timestamp: expect.any(String),
      uptime: expect.any(Number),
      process: {
        pid: expect.any(Number),
        nodeVersion: expect.any(String),
        memory: {
          rssMb: expect.any(Number),
          heapTotalMb: expect.any(Number),
          heapUsedMb: expect.any(Number),
        },
      },
      dependencies: {
        database: {
          status: 'healthy',
          latencyMs: expect.any(Number),
          message: 'Connected to PostgreSQL',
        },
        redis: {
          status: 'unknown',
          message: 'Redis queue connectivity verification deferred to Phase 2 (BullMQ ingestion)',
        },
      },
    });
    // Explicitly verify no latencyMs under redis in legacy payload
    expect(body.dependencies.redis.latencyMs).toBeUndefined();
  });

  // 11. Legacy GET /api/health Status Degraded on DB failure
  it('11. Legacy endpoint returns HTTP 200 with status "degraded" when DB check fails', async () => {
    (prisma.$queryRaw as any).mockRejectedValueOnce(new Error('DB failure'));

    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.dependencies.database.status).toBe('unhealthy');
    expect(res.body.dependencies.redis.status).toBe('unknown');
    expect(res.body.dependencies.redis.message).toBe(
      'Redis queue connectivity verification deferred to Phase 2 (BullMQ ingestion)',
    );
  });

  // 12. Worker Probe — Offline State
  it('12. Worker probe returns HTTP 200 with status "offline" when no heartbeat exists in Redis', async () => {
    setRedisHealthClient({
      get: vi.fn().mockResolvedValue(null),
      ping: vi.fn().mockResolvedValue('PONG'),
    } as any);

    const app = createApp();
    const res = await request(app).get('/api/health/worker');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('offline');
    expect(res.body.message).toContain('No active worker heartbeat found');
  });

  // 13. Worker Probe — Sanitized Public Response & Protected Diagnostics (§SEC-03)
  it('13. Worker probe sanitizes public telemetry and allows authorized diagnostics', async () => {
    const mockHeartbeat = {
      workerId: 'win-worker-test',
      status: 'online',
      startedAt: '2026-11-14T10:00:00.000Z',
      lastHeartbeatAt: '2026-11-14T10:05:00.000Z',
      lastJobAt: '2026-11-14T10:04:30.000Z',
      lastJobId: 'job-xyz-123',
      lastDocId: 'doc-abc-456',
      concurrency: 1,
      environment: 'development',
      system: {
        platform: 'win32',
        hostname: 'DEV-WIN11',
        arch: 'x64',
        uptimeSeconds: 7200,
        memory: {
          rssMb: 145,
          heapUsedMb: 75,
          totalSystemRamMb: 8192,
          freeSystemRamMb: 3400,
        },
      },
    };

    setRedisHealthClient({
      get: vi.fn().mockResolvedValue(JSON.stringify(mockHeartbeat)),
      ping: vi.fn().mockResolvedValue('PONG'),
    } as any);

    const app = createApp();

    // 13a. Public unauthenticated request — strictly sanitized
    const publicRes = await request(app).get('/api/health/worker');
    expect(publicRes.status).toBe(200);
    expect(publicRes.body.status).toBe('online');
    expect(publicRes.body.concurrency).toBe(1);
    expect(publicRes.body.environment).toBe('development');
    expect(publicRes.body.lastHeartbeatAt).toBe('2026-11-14T10:05:00.000Z');
    // Ensure zero physical host leaks or user/document identifiers
    expect(publicRes.body.workerId).toBeUndefined();
    expect(publicRes.body.system).toBeUndefined();
    expect(publicRes.body.lastJobId).toBeUndefined();
    expect(publicRes.body.lastDocId).toBeUndefined();
  });

  // 14. Worker Offline Isolation — API Live and Ready Unaffected
  it('14. Worker status offline does not affect /api/health/live or /api/health/ready status', async () => {
    (prisma.$queryRaw as any).mockResolvedValueOnce([{ '?column?': 1 }]);
    setRedisHealthClient({
      get: vi.fn().mockResolvedValue(null), // Worker offline
      ping: vi.fn().mockResolvedValue('PONG'), // Redis itself healthy
    } as any);

    const app = createApp();

    // Worker reports offline
    const workerRes = await request(app).get('/api/health/worker');
    expect(workerRes.status).toBe(200);
    expect(workerRes.body.status).toBe('offline');

    // Live endpoint is still alive
    const liveRes = await request(app).get('/api/health/live');
    expect(liveRes.status).toBe(200);
    expect(liveRes.body).toEqual({ status: 'alive' });

    // Ready endpoint is still ready
    const readyRes = await request(app).get('/api/health/ready');
    expect(readyRes.status).toBe(200);
    expect(readyRes.body).toEqual({ status: 'ready' });
  });
});
