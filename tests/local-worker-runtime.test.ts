import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateGeminiEnvironment } from '../apps/worker/src/lib/gemini-validator.js';
import {
  WorkerHeartbeatService,
  WORKER_HEARTBEAT_REDIS_KEY,
} from '../apps/worker/src/services/worker-heartbeat.service.js';
import { DocumentIngestionPipeline } from '../apps/worker/src/modules/ingestion/pipeline.js';
import { detectPgvectorExtension } from '../scripts/verify-worker-preflight.js';

describe('MindVault — Local Windows Worker Runtime & Ingestion Tests', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // =========================================================================
  // 1. Google Gemini Preflight Validation Tests
  // =========================================================================
  describe('Gemini Environment Validator', () => {
    it('returns ready=true and status=READY when API key is configured', () => {
      const result = validateGeminiEnvironment({
        apiKey: 'AIzaSyD-valid-mock-gemini-key-12345678',
        model: 'gemini-embedding-2',
      });

      expect(result.ready).toBe(true);
      expect(result.status).toBe('READY');
      expect(result.maskedKey).toContain('AIza...');
      expect(result.maskedKey).toContain('length 38');
      expect(result.missingRequirements).toHaveLength(0);
    });

    it('returns ready=false and status=MISSING_API_KEY when key is missing', () => {
      const result = validateGeminiEnvironment({
        apiKey: '',
        model: 'gemini-embedding-2',
      });

      expect(result.ready).toBe(false);
      expect(result.status).toBe('MISSING_API_KEY');
      expect(result.missingRequirements).toContain('GEMINI_API_KEY');
      expect(result.remediation).toContain('Add GEMINI_API_KEY to your .env file');
    });

    it('rejects unapproved embedding model with INVALID_MODEL', () => {
      const result = validateGeminiEnvironment({
        apiKey: 'AIzaSyD-valid-mock-gemini-key-12345678',
        model: 'unsupported-model-v99',
      });

      expect(result.ready).toBe(false);
      expect(result.status).toBe('INVALID_MODEL');
      expect(result.remediation).toContain('gemini-embedding-2');
    });
  });

  // =========================================================================
  // 2. Worker Heartbeat Service Tests
  // =========================================================================
  describe('Worker Heartbeat Service', () => {
    it('emits heartbeat payload with host telemetry to Redis and records job activity', async () => {
      const mockRedisSet = vi.fn().mockResolvedValue('OK');
      const mockRedisQuit = vi.fn().mockResolvedValue('OK');

      const heartbeatService = new WorkerHeartbeatService(
        'rediss://default:token@bright-fish-115122.upstash.io:6379',
        1,
        'production',
        'win-test-worker-01',
      );

      // Inject mock redis client
      (heartbeatService as any).redisClient = {
        set: mockRedisSet,
        quit: mockRedisQuit,
        disconnect: vi.fn(),
        on: vi.fn(),
      };

      // Emit heartbeat
      await heartbeatService.emitHeartbeat();

      expect(mockRedisSet).toHaveBeenCalledTimes(1);
      const [key, rawJson, mode, ttl] = mockRedisSet.mock.calls[0];
      expect(key).toBe(WORKER_HEARTBEAT_REDIS_KEY);
      expect(mode).toBe('EX');
      expect(ttl).toBe(35);

      const payload = JSON.parse(rawJson);
      expect(payload.workerId).toBe('win-test-worker-01');
      expect(payload.status).toBe('online');
      expect(payload.concurrency).toBe(1);
      expect(payload.system).toBeDefined();
      expect(payload.system.memory.rssMb).toBeGreaterThan(0);
      expect(payload.lastJobId).toBeNull();

      // Record job activity and emit again
      heartbeatService.recordJobActivity('job-abc-123', 'doc-xyz-789');
      await heartbeatService.emitHeartbeat();

      const secondPayload = JSON.parse(mockRedisSet.mock.calls[1][1]);
      expect(secondPayload.lastJobId).toBe('job-abc-123');
      expect(secondPayload.lastDocId).toBe('doc-xyz-789');

      // Stop service
      (heartbeatService as any).isRunning = true;
      await heartbeatService.stop();
      expect(mockRedisQuit).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. Cloud-to-Local Hybrid Document Storage Fallback Tests
  // =========================================================================
  describe('Hybrid Document Storage Fallback in IngestionPipeline', () => {
    it('reconstructs local document from database rawContentBase64 when file is not on local disk', async () => {
      const textContent = 'This is a test document uploaded via Cloud API into PostgreSQL base64.';
      const base64Data = Buffer.from(textContent, 'utf-8').toString('base64');

      const mockDoc = {
        id: 'doc-uuid-1234',
        workspaceId: 'ws-uuid-5678',
        filename: 'cloud-upload.txt',
        mimeType: 'text/plain',
        extension: '.txt',
        storageKey: 'workspaces/ws-uuid-5678/documents/cloud-upload.txt',
        checksum: 'checksum-test-123',
        metadata: {
          rawContentBase64: base64Data,
        },
      };

      const mockStorage = {
        exists: vi.fn().mockResolvedValue(false), // NOT on local disk yet
        read: vi.fn().mockResolvedValue(Buffer.from(textContent, 'utf-8')),
        save: vi.fn().mockResolvedValue(undefined),
      };

      const mockDb = {
        findDocumentById: vi.fn().mockResolvedValue(mockDoc),
        updateDocument: vi.fn().mockResolvedValue(mockDoc),
        createDocumentChunks: vi.fn().mockResolvedValue(undefined),
      };

      const mockEmbedding = {
        generateEmbeddings: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
        getDimension: vi.fn().mockReturnValue(3),
      };

      const pipeline = new DocumentIngestionPipeline(
        mockStorage as any,
        mockEmbedding as any,
        mockDb as any,
      );

      await pipeline.processDocument({
        documentId: 'doc-uuid-1234',
        workspaceId: 'ws-uuid-5678',
      });

      // Verification:
      // 1. Storage existence checked
      expect(mockStorage.exists).toHaveBeenCalledWith(mockDoc.storageKey);
      // 2. Reconstructed buffer saved to local disk cache
      expect(mockStorage.save).toHaveBeenCalledWith(mockDoc.storageKey, expect.any(Buffer));
      // 3. Document marked COMPLETED
      expect(mockDb.updateDocument).toHaveBeenCalledWith(
        'doc-uuid-1234',
        expect.objectContaining({
          status: 'COMPLETED',
        }),
      );
    });

    it('reads directly from disk when document already exists locally', async () => {
      const textContent = 'Local file content already cached.';
      const mockDoc = {
        id: 'doc-uuid-5678',
        workspaceId: 'ws-uuid-9999',
        filename: 'cached-file.txt',
        mimeType: 'text/plain',
        extension: '.txt',
        storageKey: 'workspaces/ws-uuid-9999/documents/cached-file.txt',
        checksum: 'checksum-test-456',
        metadata: {},
      };

      const mockStorage = {
        exists: vi.fn().mockResolvedValue(true), // Already on disk
        read: vi.fn().mockResolvedValue(Buffer.from(textContent, 'utf-8')),
        save: vi.fn().mockResolvedValue(undefined),
      };

      const mockDb = {
        findDocumentById: vi.fn().mockResolvedValue(mockDoc),
        updateDocument: vi.fn().mockResolvedValue(mockDoc),
        createDocumentChunks: vi.fn().mockResolvedValue(undefined),
      };

      const mockEmbedding = {
        generateEmbeddings: vi.fn().mockResolvedValue([[0.4, 0.5, 0.6]]),
        getDimension: vi.fn().mockReturnValue(3),
      };

      const pipeline = new DocumentIngestionPipeline(
        mockStorage as any,
        mockEmbedding as any,
        mockDb as any,
      );

      await pipeline.processDocument({
        documentId: 'doc-uuid-5678',
        workspaceId: 'ws-uuid-9999',
      });

      expect(mockStorage.exists).toHaveBeenCalledWith(mockDoc.storageKey);
      expect(mockStorage.read).toHaveBeenCalledWith(mockDoc.storageKey);
      expect(mockStorage.save).not.toHaveBeenCalled();
      expect(mockDb.updateDocument).toHaveBeenCalledWith(
        'doc-uuid-5678',
        expect.objectContaining({
          status: 'COMPLETED',
        }),
      );
    });
  });

  // =========================================================================
  // 4. Preflight pgvector Extension Detection Tests
  // =========================================================================
  describe('Preflight pgvector Extension Detection', () => {
    it('detects pgvector when registered under standard PostgreSQL extension name "vector"', async () => {
      const mockPrisma = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ extname: 'vector', extversion: '0.8.7' }]),
      };

      const result = await detectPgvectorExtension(mockPrisma as any);

      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("WHERE extname IN ('vector', 'pgvector')"),
      );
      expect(result.installed).toBe(true);
      expect(result.version).toBe('0.8.7');
      expect(result.extensionName).toBe('vector');
    });

    it('detects pgvector when registered under alias "pgvector"', async () => {
      const mockPrisma = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ extname: 'pgvector', extversion: '0.8.0' }]),
      };

      const result = await detectPgvectorExtension(mockPrisma as any);

      expect(result.installed).toBe(true);
      expect(result.version).toBe('0.8.0');
      expect(result.extensionName).toBe('pgvector');
    });

    it('returns installed=false when pgvector extension is absent from pg_extension table', async () => {
      const mockPrisma = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      };

      const result = await detectPgvectorExtension(mockPrisma as any);

      expect(result.installed).toBe(false);
      expect(result.version).toBeUndefined();
    });
  });
});
