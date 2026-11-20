import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateWorkerEnv } from '../env.js';
import { isLocalRedis, getSafeRedisEndpoint, getDocumentQueueName, toBullQueueName } from '@mindvault/shared';
import { WorkerService } from '../../worker.js';

describe('Phase 2 P0: Cloud Worker Decoupling & Local Safety Guard Suite', () => {
  const baseValidProdEnv = {
    NODE_ENV: 'production',
    REDIS_URL: 'rediss://default:prod_redis_token_secure_99@prod-db.upstash.io:6379',
    DATABASE_URL: 'postgresql://neondb_owner:npg_secret@ep-cool-db.us-east-2.aws.neon.tech/neondb?sslmode=require',
    GEMINI_API_KEY: 'AIzaSyD-prod-gemini-key-1234567890abcdef',
    WORKER_CONCURRENCY: '1',
    WORKER_TYPE: 'cloud',
  };

  const baseValidDevEnv = {
    NODE_ENV: 'development',
    REDIS_URL: 'redis://localhost:6379',
    WORKER_CONCURRENCY: '1',
    WORKER_TYPE: 'local',
  };

  describe('1. Endpoint Locality Classifier (isLocalRedis & getSafeRedisEndpoint)', () => {
    it('classifies localhost and 127.0.0.1 as local endpoints', () => {
      expect(isLocalRedis('redis://localhost:6379')).toBe(true);
      expect(isLocalRedis('redis://127.0.0.1:6379')).toBe(true);
      expect(isLocalRedis('redis://[::1]:6379')).toBe(true);
      expect(isLocalRedis('redis://0.0.0.0:6379')).toBe(true);
      expect(isLocalRedis('')).toBe(true); // default dev fallback is local
    });

    it('classifies any TLS rediss:// endpoint as remote/cloud', () => {
      expect(isLocalRedis('rediss://localhost:6379')).toBe(false);
      expect(isLocalRedis('rediss://default:token@cool-lion-1234.upstash.io:6379')).toBe(false);
    });

    it('classifies non-local hostnames and external IPs as remote', () => {
      expect(isLocalRedis('redis://192.168.1.150:6379')).toBe(false);
      expect(isLocalRedis('redis://production.internal:6379')).toBe(false);
      expect(isLocalRedis('redis://redis.my-company.com:6379')).toBe(false);
    });

    it('sanitizes safe endpoint without leaking credentials', () => {
      const endpoint = getSafeRedisEndpoint('rediss://default:super_secret_pw@us1-cool-lion-123.upstash.io:6379');
      expect(endpoint.host).toBe('us1-cool-lion-123.upstash.io');
      expect(endpoint.port).toBe(6379);
      expect(endpoint.isTls).toBe(true);
      expect(JSON.stringify(endpoint)).not.toContain('super_secret_pw');
    });
  });

  describe('2. Local Worker Safety Guard (§P0)', () => {
    it('blocks development startup when REDIS_URL points to remote Upstash without override', () => {
      const result = validateWorkerEnv({
        ...baseValidDevEnv,
        REDIS_URL: 'rediss://default:pwd@remote-db.upstash.io:6379',
        DEV_ALLOW_REMOTE_REDIS: 'false',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes('REDIS_URL'));
        expect(issue).toBeDefined();
        expect(issue?.message).toContain('CRITICAL SECURITY GUARD: Worker in development mode attempted to connect to remote/cloud Redis');
        expect(issue?.message).toContain('DEV_ALLOW_REMOTE_REDIS=true');
      }
    });

    it('blocks development startup when REDIS_URL points to remote IP without override', () => {
      const result = validateWorkerEnv({
        ...baseValidDevEnv,
        REDIS_URL: 'redis://10.0.0.55:6379',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes('REDIS_URL'));
        expect(issue?.message).toContain('CRITICAL SECURITY GUARD');
      }
    });

    it('permits development startup with remote Redis when DEV_ALLOW_REMOTE_REDIS=true', () => {
      const result = validateWorkerEnv({
        ...baseValidDevEnv,
        REDIS_URL: 'rediss://default:pwd@remote-db.upstash.io:6379',
        DEV_ALLOW_REMOTE_REDIS: 'true',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.DEV_ALLOW_REMOTE_REDIS).toBe(true);
        expect(result.data.REDIS_URL).toBe('rediss://default:pwd@remote-db.upstash.io:6379');
      }
    });

    it('permits development startup with local Redis without any flags', () => {
      const result = validateWorkerEnv({
        ...baseValidDevEnv,
        REDIS_URL: 'redis://127.0.0.1:6379',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.REDIS_URL).toBe('redis://127.0.0.1:6379');
      }
    });

    it('defaults REDIS_URL to localhost:6379 in development mode when omitted', () => {
      const { REDIS_URL, ...devEnvWithoutRedis } = baseValidDevEnv;
      const result = validateWorkerEnv(devEnvWithoutRedis);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.REDIS_URL).toBe('redis://localhost:6379');
      }
    });
  });

  describe('3. Production Mode Validation & Secret Enforcement', () => {
    it('rejects production startup when REDIS_URL is missing', () => {
      const { REDIS_URL, ...prodWithoutRedis } = baseValidProdEnv;
      const result = validateWorkerEnv(prodWithoutRedis);

      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes('REDIS_URL'));
        expect(issue?.message).toContain('REDIS_URL is required in production and must start with rediss://');
      }
    });

    it('rejects production startup when REDIS_URL uses plain redis:// without TLS', () => {
      const result = validateWorkerEnv({
        ...baseValidProdEnv,
        REDIS_URL: 'redis://prod-redis.internal:6379',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes('REDIS_URL'));
        expect(issue?.message).toContain('must start with rediss:// (native TLS)');
      }
    });

    it('rejects production startup when GEMINI_API_KEY is missing and Gemini provider is active', () => {
      const { GEMINI_API_KEY, ...prodWithoutKey } = baseValidProdEnv;
      const result = validateWorkerEnv(prodWithoutKey);

      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes('GEMINI_API_KEY'));
        expect(issue?.message).toContain('GEMINI_API_KEY is required in production');
      }
    });

    it('accepts valid production configuration with TLS Redis and Gemini key', () => {
      const result = validateWorkerEnv(baseValidProdEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.NODE_ENV).toBe('production');
        expect(result.data.WORKER_TYPE).toBe('cloud');
        expect(result.data.WORKER_CONCURRENCY).toBe(1);
      }
    });
  });

  describe('4. WorkerService Runtime Safety Guard & Queue Isolation', () => {
    it('throws runtime error when start() is called with remote Redis in development without flag', async () => {
      const originalEnv = process.env.NODE_ENV;
      const originalRedis = process.env.REDIS_URL;
      const originalAllow = process.env.DEV_ALLOW_REMOTE_REDIS;

      process.env.NODE_ENV = 'development';
      process.env.REDIS_URL = 'rediss://remote-danger.upstash.io:6379';
      delete process.env.DEV_ALLOW_REMOTE_REDIS;

      try {
        const mockPipeline = { processDocument: vi.fn() } as any;
        const mockGraphWorker = {
          start: vi.fn().mockResolvedValue(undefined),
          stop: vi.fn().mockResolvedValue(undefined),
          registerWorkspace: vi.fn().mockResolvedValue(undefined),
          unregisterWorkspace: vi.fn().mockResolvedValue(undefined),
        } as any;
        const mockRecovery = { start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) } as any;
        const mockRecon = {
          executeStartupReconciliation: vi.fn().mockResolvedValue({ scannedCount: 0, finalizedCount: 0 }),
          start: vi.fn(),
          stop: vi.fn().mockResolvedValue(undefined),
        } as any;
        const mockHeartbeat = {
          start: vi.fn().mockResolvedValue(undefined),
          stop: vi.fn().mockResolvedValue(undefined),
          recordJobActivity: vi.fn(),
        } as any;

        const worker = new WorkerService(
          mockPipeline,
          mockGraphWorker,
          mockRecovery,
          mockRecon,
          mockHeartbeat,
        );

        await expect(worker.start()).rejects.toThrow('CRITICAL SECURITY GUARD: Worker startup blocked.');
        expect(worker.getActiveStatus()).toBe(false);
      } finally {
        process.env.NODE_ENV = originalEnv;
        if (originalRedis !== undefined) process.env.REDIS_URL = originalRedis;
        else delete process.env.REDIS_URL;
        if (originalAllow !== undefined) process.env.DEV_ALLOW_REMOTE_REDIS = originalAllow;
        else delete process.env.DEV_ALLOW_REMOTE_REDIS;
      }
    });

    it('isolates queue registration based on WORKER_TYPE', async () => {
      const originalWorkerType = process.env.WORKER_TYPE;

      // WORKER_TYPE=local should strictly register the local capability queue
      process.env.WORKER_TYPE = 'local';
      try {
        const localQueueName = getDocumentQueueName('ws-test-iso', 'local');
        const cloudQueueName = getDocumentQueueName('ws-test-iso', 'cloud');

        expect(localQueueName).toBe('document-processing:ws-test-iso:local');
        expect(cloudQueueName).toBe('document-processing:ws-test-iso:cloud');
        expect(toBullQueueName(localQueueName)).not.toBe(toBullQueueName(cloudQueueName));
      } finally {
        if (originalWorkerType !== undefined) process.env.WORKER_TYPE = originalWorkerType;
        else delete process.env.WORKER_TYPE;
      }
    });

    it('gracefully drains in-flight services on stop()', async () => {
      const mockPipeline = { processDocument: vi.fn() } as any;
      const mockGraphWorker = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        registerWorkspace: vi.fn().mockResolvedValue(undefined),
      } as any;
      const mockRecovery = { start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) } as any;
      const mockRecon = {
        executeStartupReconciliation: vi.fn().mockResolvedValue({ scannedCount: 0, finalizedCount: 0 }),
        start: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
      } as any;
      const mockHeartbeat = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      } as any;

      const worker = new WorkerService(
        mockPipeline,
        mockGraphWorker,
        mockRecovery,
        mockRecon,
        mockHeartbeat,
      );

      // Start in test mode
      await worker.start({ workspaceIds: ['ws-graceful-test'] });
      expect(worker.getActiveStatus()).toBe(true);

      // Gracefully stop
      await worker.stop();
      expect(worker.getActiveStatus()).toBe(false);
      expect(mockRecon.stop).toHaveBeenCalled();
      expect(mockGraphWorker.stop).toHaveBeenCalled();
      expect(mockRecovery.stop).toHaveBeenCalled();
      expect(mockHeartbeat.stop).toHaveBeenCalled();
    });
  });
});
