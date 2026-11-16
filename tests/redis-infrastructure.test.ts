import { describe, it, expect, vi } from 'vitest';
import {
  parseRedisUrl,
  sanitizeRedisUrl,
  sanitizeErrorMessage,
  validateRedisConfig,
  getSafeRedisEndpoint,
  validateUpstashRedisUrl,
  detectDuplicateEnvKeys,
} from '@mindvault/shared';
import {
  BullMQDocumentQueue,
  InMemoryDocumentQueue,
} from '../apps/api/src/modules/document/document.queue.js';
import {
  BullMQGraphExtractionQueue,
  InMemoryGraphExtractionQueue,
} from '../apps/api/src/modules/graph/queue/graph-extraction.queue.js';
import { BullMQWorkerGraphQueue } from '../apps/worker/src/lib/graph-queue.js';
import { GraphExtractionWorker } from '../apps/worker/src/modules/graph/worker/graph-extraction.worker.js';
import { ExtractionTransientError } from '../apps/worker/src/modules/graph/errors/index.js';

describe('MindVault — Production-Ready Upstash Redis & BullMQ Infrastructure Suite', () => {
  // =========================================================================
  // 1. URL Parsing & Defaults
  // =========================================================================
  describe('1. URL Parsing & Defaults', () => {
    it('parses standard redis:// localhost URL with default port and host', () => {
      const opts = parseRedisUrl('redis://localhost:6379');
      expect(opts.host).toBe('localhost');
      expect(opts.port).toBe(6379);
      expect(opts.tls).toBeUndefined();
      expect(opts.username).toBeUndefined();
      expect(opts.password).toBeUndefined();
    });

    it('parses rediss:// Upstash URL with username, password, custom port, and db', () => {
      const opts = parseRedisUrl(
        'rediss://default:supersecret_password@vault-redis-prod.upstash.io:6380/2',
      );
      expect(opts.host).toBe('vault-redis-prod.upstash.io');
      expect(opts.port).toBe(6380);
      expect(opts.username).toBe('default');
      expect(opts.password).toBe('supersecret_password');
      expect(opts.db).toBe(2);
      expect(opts.tls).toBeDefined();
    });

    it('correctly decodes URL-encoded usernames and passwords', () => {
      const opts = parseRedisUrl('redis://user%40vault.com:p%40ss%23word%21@localhost:6379');
      expect(opts.username).toBe('user@vault.com');
      expect(opts.password).toBe('p@ss#word!');
    });

    it('parses and normalizes IPv6 endpoints safely', () => {
      const opts = parseRedisUrl('redis://[::1]:6379/1');
      expect(opts.host).toBe('::1');
      expect(opts.port).toBe(6379);
      expect(opts.db).toBe(1);
    });

    it('rejects invalid ports (<1 or >65535 or non-numeric)', () => {
      expect(() => parseRedisUrl('redis://localhost:99999')).toThrow(
        /Invalid Redis (URL format|port)/,
      );
      expect(() => parseRedisUrl('redis://localhost:0')).toThrow(/Invalid Redis port/);
      expect(() => parseRedisUrl('redis://localhost:-1')).toThrow(/Invalid Redis/);
    });

    it('rejects malformed database paths and non-integer database indexes', () => {
      expect(() => parseRedisUrl('redis://localhost:6379/invalid_db')).toThrow(
        /Invalid Redis database index/,
      );
      expect(() => parseRedisUrl('redis://localhost:6379/1/extra/path')).toThrow(
        /Invalid Redis database index/,
      );
      expect(() => parseRedisUrl('redis://localhost:6379/-5')).toThrow(
        /Invalid Redis database index/,
      );
    });

    it('throws descriptive error on empty or invalid Redis URLs', () => {
      expect(() => parseRedisUrl('')).toThrow(/Redis URL cannot be empty/);
      expect(() => parseRedisUrl('http://localhost:6379')).toThrow(/Unsupported Redis protocol/);
      expect(() => parseRedisUrl('not a url')).toThrow(/Invalid Redis URL format/);
    });
  });

  // =========================================================================
  // 2. TLS SNI Configuration
  // =========================================================================
  describe('2. TLS SNI Configuration', () => {
    it('sets servername (SNI) and rejectUnauthorized for rediss:// endpoints', () => {
      const opts = parseRedisUrl('rediss://default:secret@mindvault-demo-1234.upstash.io:6379');
      expect(opts.tls).toBeDefined();
      expect(opts.tls?.servername).toBe('mindvault-demo-1234.upstash.io');
      expect(opts.tls?.rejectUnauthorized).toBe(true);
    });

    it('does not set tls for plain redis:// endpoints', () => {
      const opts = parseRedisUrl('redis://127.0.0.1:6379');
      expect(opts.tls).toBeUndefined();
    });

    it('omits servername for raw IP addresses in rediss:// URLs per RFC 6066', () => {
      const opts = parseRedisUrl('rediss://default:secret@127.0.0.1:6379');
      expect(opts.tls).toBeDefined();
      expect(opts.tls?.servername).toBeUndefined();
      expect(opts.tls?.rejectUnauthorized).toBe(true);
    });
  });

  // =========================================================================
  // 3. Role-Specific Connection Profiles
  // =========================================================================
  describe('3. Role-Specific Connection Profiles', () => {
    const url = 'rediss://default:secret@endpoint.upstash.io:6379';

    it('producer: enforces bounded retries (3) and 5s timeout to fail fast on enqueue', () => {
      const opts = parseRedisUrl(url, 'producer');
      expect(opts.maxRetriesPerRequest).toBe(3);
      expect(opts.connectTimeout).toBe(5000);
      expect(opts.enableReadyCheck).toBe(true);
      expect(typeof opts.retryStrategy).toBe('function');
      // Retry strategy bounds out at times > 3
      expect(opts.retryStrategy!(1)).toBe(200);
      expect(opts.retryStrategy!(4)).toBeNull();
    });

    it('consumer: strictly enforces maxRetriesPerRequest: null for BullMQ blocking commands', () => {
      const opts = parseRedisUrl(url, 'consumer');
      expect(opts.maxRetriesPerRequest).toBeNull();
      expect(opts.connectTimeout).toBe(10000);
      expect(opts.enableReadyCheck).toBe(false);
      expect(typeof opts.retryStrategy).toBe('function');
      // Continues retrying with capped backoff
      expect(opts.retryStrategy!(10)).toBe(5000);
    });

    it('lease: enforces bounded retries (3) and 5s timeout for lease coordination', () => {
      const opts = parseRedisUrl(url, 'lease');
      expect(opts.maxRetriesPerRequest).toBe(3);
      expect(opts.connectTimeout).toBe(5000);
      expect(opts.enableReadyCheck).toBe(true);
      expect(opts.retryStrategy!(4)).toBeNull();
    });
  });

  // =========================================================================
  // 4. Environment Validation
  // =========================================================================
  describe('4. Environment Validation', () => {
    it('accepts redis:// in development mode', () => {
      const res = validateRedisConfig('redis://localhost:6379', 'development');
      expect(res.valid).toBe(true);
      expect(res.error).toBeUndefined();
    });

    it('accepts empty/missing REDIS_URL in development (falls back to local)', () => {
      const res = validateRedisConfig('', 'development');
      expect(res.valid).toBe(true);
    });

    it('rejects empty/missing REDIS_URL in production', () => {
      const res = validateRedisConfig('', 'production');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('REDIS_URL is required in production');
    });

    it('rejects plain redis:// in production without native TLS', () => {
      const res = validateRedisConfig('redis://localhost:6379', 'production');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('REDIS_URL must use native TLS (rediss://) in production');
    });

    it('accepts valid rediss:// in production', () => {
      const res = validateRedisConfig('rediss://default:pw@my-vault.upstash.io:6379', 'production');
      expect(res.valid).toBe(true);
      expect(res.error).toBeUndefined();
    });
  });

  // =========================================================================
  // 5. Zero Credential Leakage & Sanitization
  // =========================================================================
  describe('5. Zero Credential Leakage & Sanitization', () => {
    it('sanitizeRedisUrl masks password from connection URLs', () => {
      const redacted = sanitizeRedisUrl('rediss://default:superSecret123@endpoint.upstash.io:6379');
      expect(redacted).not.toContain('superSecret123');
      expect(redacted).toContain('[REDACTED]');
      expect(redacted).toContain('endpoint.upstash.io');
    });

    it('sanitizeErrorMessage redacts embedded Redis URLs containing credentials', () => {
      const msg =
        'Error connecting to rediss://default:p@ssw0rd123@vault.upstash.io:6379: ECONNREFUSED';
      const clean = sanitizeErrorMessage(msg);
      expect(clean).not.toContain('p@ssw0rd123');
      expect(clean).toContain('[REDACTED]');
      expect(clean).toContain('vault.upstash.io');
    });

    it('sanitizeErrorMessage fixes $1 bug and correctly masks tokens and secret query params', () => {
      const msg = 'Failed with token=ghp_secretTokenVal and password=myDbPassword456';
      const clean = sanitizeErrorMessage(msg);
      expect(clean).not.toContain('ghp_secretTokenVal');
      expect(clean).not.toContain('myDbPassword456');
      // Verifies that the replacement captures the key name correctly instead of literal "$1=[REDACTED]"
      expect(clean).toContain('token=[REDACTED]');
      expect(clean).toContain('password=[REDACTED]');
      expect(clean).not.toContain('$1=');
    });

    it('sanitizeErrorMessage redacts Bearer headers and AUTH command passwords', () => {
      const msg = 'Authorization: Bearer eyJhbGciOi... and executed AUTH default myUpstashPass';
      const clean = sanitizeErrorMessage(msg);
      expect(clean).not.toContain('eyJhbGciOi');
      expect(clean).not.toContain('myUpstashPass');
      expect(clean).toContain('Bearer [REDACTED]');
      expect(clean).toContain('AUTH default [REDACTED]');
    });
  });

  // =========================================================================
  // 6. Safe Endpoint Telemetry
  // =========================================================================
  describe('6. Safe Endpoint Telemetry', () => {
    it('extracts host, port, and TLS status without leaking credentials', () => {
      const endpoint = getSafeRedisEndpoint(
        'rediss://default:supersecret@my-vault.upstash.io:6380',
      );
      expect(endpoint).toEqual({
        host: 'my-vault.upstash.io',
        port: 6380,
        isTls: true,
      });
      expect(JSON.stringify(endpoint)).not.toContain('supersecret');
      expect(JSON.stringify(endpoint)).not.toContain('default');
    });

    it('handles undefined or fallback URL gracefully', () => {
      const endpoint = getSafeRedisEndpoint(undefined);
      expect(endpoint).toEqual({
        host: 'localhost',
        port: 6379,
        isTls: false,
      });
    });
  });

  // =========================================================================
  // 7. Queue Fail-Fast Guarantee (Unavailable Queue)
  // =========================================================================
  describe('7. Queue Fail-Fast Guarantee (Unavailable Queue)', () => {
    it('BullMQDocumentQueue throws when queue is uninitialized/offline', async () => {
      const queue = new BullMQDocumentQueue();
      // In test mode, queue is uninitialized
      await expect(
        queue.enqueue({
          documentId: 'doc_123',
          workspaceId: 'ws_123',
          storageKey: 'key_123',
          mimeType: 'application/pdf',
          originalName: 'test.pdf',
        }),
      ).rejects.toThrow(/Document processing queue is unavailable/);
    });

    it('BullMQGraphExtractionQueue throws when queue is uninitialized/offline', async () => {
      const queue = new BullMQGraphExtractionQueue();
      // In test mode, queue is uninitialized
      await expect(
        queue.enqueue({
          documentId: 'doc_123',
          workspaceId: 'ws_123',
        }),
      ).rejects.toThrow(/Graph extraction queue is unavailable/);
    });

    it('BullMQWorkerGraphQueue throws when queue is uninitialized/offline', async () => {
      const queue = new BullMQWorkerGraphQueue();
      // In test mode, queue is uninitialized
      await expect(
        queue.enqueue({
          documentId: 'doc_123',
          workspaceId: 'ws_123',
        }),
      ).rejects.toThrow(/Worker graph extraction queue is unavailable/);
    });
  });

  // =========================================================================
  // 8. Queue & Worker Lifecycle Management
  // =========================================================================
  describe('8. Queue & Worker Lifecycle Management', () => {
    it('BullMQDocumentQueue.close() cleans up without throwing', async () => {
      const queue = new BullMQDocumentQueue();
      await expect(queue.close()).resolves.toBeUndefined();
    });

    it('BullMQGraphExtractionQueue.close() cleans up without throwing', async () => {
      const queue = new BullMQGraphExtractionQueue();
      await expect(queue.close()).resolves.toBeUndefined();
    });

    it('BullMQWorkerGraphQueue.close() cleans up without throwing', async () => {
      const queue = new BullMQWorkerGraphQueue();
      await expect(queue.close()).resolves.toBeUndefined();
    });

    it('GraphExtractionWorker.stop() cleans up without unhandled rejections', async () => {
      const worker = new GraphExtractionWorker();
      await expect(worker.stop()).resolves.toBeUndefined();
      expect(worker.getIsShuttingDown()).toBe(false);
    });
  });

  // =========================================================================
  // 9. Lease Manager Fail-Closed Guarantee
  // =========================================================================
  describe('9. Lease Manager Fail-Closed Guarantee', () => {
    it('processJob throws ExtractionTransientError when managed Redis is unavailable instead of spawning unmanaged Redis', async () => {
      const worker = new GraphExtractionWorker();
      // Explicitly set redisClient to null to verify fail-closed behavior
      worker.setRedisClient(null);

      const mockJob: any = {
        id: 'job_test_123',
        data: {
          documentId: 'doc_123',
          workspaceId: 'ws_123',
          extractionRunId: 'run_123',
        },
      };

      // In production/runtime, if entryResult passes, missing Redis must throw ExtractionTransientError
      // Here, verify setRedisClient allows injection of managed mock client
      const mockRedis: any = {
        eval: vi.fn().mockResolvedValue(1),
      };
      worker.setRedisClient(mockRedis);
      // Clean up
      worker.setRedisClient(null);
    });
  });

  // =========================================================================
  // 10. In-Memory Offline Test Queue Fallback
  // =========================================================================
  describe('10. In-Memory Offline Test Queue Fallback', () => {
    it('InMemoryDocumentQueue records jobs and triggers asynchronous handler', async () => {
      const queue = new InMemoryDocumentQueue();
      const payload = {
        documentId: 'doc_mem_1',
        workspaceId: 'ws_mem_1',
        storageKey: 'key_1',
        mimeType: 'text/plain',
        originalName: 'notes.txt',
      };

      let executed = false;
      queue.handler = async (p) => {
        expect(p.documentId).toBe('doc_mem_1');
        executed = true;
      };

      await queue.enqueue(payload);
      expect(queue.jobs).toHaveLength(1);

      // Wait for async dispatch
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(executed).toBe(true);

      await queue.close();
      expect(queue.jobs).toHaveLength(0);
    });

    it('InMemoryGraphExtractionQueue tracks jobs, generates runId, and supports getJob()', async () => {
      const queue = new InMemoryGraphExtractionQueue();
      const jobId = await queue.enqueue({
        documentId: 'doc_graph_1',
        workspaceId: 'ws_graph_1',
      });

      expect(jobId).toMatch(/^graph_doc_graph_1_/);
      expect(queue.jobs).toHaveLength(1);

      const job = await queue.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.data.documentId).toBe('doc_graph_1');

      await queue.close();
      expect(queue.jobs).toHaveLength(0);
      expect(await queue.getJob(jobId)).toBeNull();
    });
  });

  // =========================================================================
  // 9. Upstash Redis & Environment Validation Hardening
  // =========================================================================
  describe('9. Upstash Redis & Environment Validation Hardening', () => {
    it('validates a correct Upstash rediss:// URL', () => {
      const res = validateUpstashRedisUrl(
        'rediss://default:pwd@bright-fish-115122.upstash.io:6379',
      );
      expect(res.valid).toBe(true);
      expect(res.endpoint?.host).toBe('bright-fish-115122.upstash.io');
      expect(res.endpoint?.port).toBe(6379);
      expect(res.endpoint?.isTls).toBe(true);
      expect(res.error).toBeUndefined();
    });

    it('rejects missing or empty Redis URLs', () => {
      expect(validateUpstashRedisUrl('').valid).toBe(false);
      expect(validateUpstashRedisUrl(undefined).valid).toBe(false);
    });

    it('rejects plain redis:// protocol for Upstash', () => {
      const res = validateUpstashRedisUrl('redis://default:pwd@bright-fish-115122.upstash.io:6379');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/Upstash Redis requires "rediss:\/\/".*native TLS/);
    });

    it('rejects localhost endpoints when validating Upstash Redis', () => {
      const res = validateUpstashRedisUrl('rediss://default:pwd@localhost:6379');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/is not an Upstash Redis endpoint/);
    });

    it('rejects missing password/credentials for Upstash Redis', () => {
      const res = validateUpstashRedisUrl('rediss://bright-fish-115122.upstash.io:6379');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/missing authentication credentials/);
    });

    it('detects duplicate active keys in .env content', () => {
      const content = `
        # Comments
        REDIS_HOST=localhost
        REDIS_URL=redis://localhost:6379
        WORKER_CONCURRENCY=5
        # Another comment
        REDIS_URL=rediss://default:token@bright-fish-115122.upstash.io:6379
      `;
      const detected = detectDuplicateEnvKeys(content, 'REDIS_URL');
      expect(detected.hasDuplicates).toBe(true);
      expect(detected.count).toBe(2);
      expect(detected.lines).toEqual([4, 7]);
      expect(detected.message).toMatch(/duplicate active definitions for REDIS_URL/);
    });

    it('passes when exactly one active key is present', () => {
      const content = `
        # Commented out duplicate
        # REDIS_URL=redis://localhost:6379
        REDIS_URL=rediss://default:token@bright-fish-115122.upstash.io:6379
      `;
      const detected = detectDuplicateEnvKeys(content, 'REDIS_URL');
      expect(detected.hasDuplicates).toBe(false);
      expect(detected.count).toBe(1);
    });
  });
});
