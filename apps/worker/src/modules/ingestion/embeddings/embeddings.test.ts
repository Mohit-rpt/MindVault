import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockEmbeddingProvider } from './mock.provider.js';
import {
  createEmbeddingProvider,
  workerEmbeddingProviderRegistry,
  WorkerEmbeddingProviderRegistry,
  BUILTIN_EMBEDDING_PROVIDERS,
  UnsupportedEmbeddingProviderError,
  DuplicateEmbeddingProviderError,
  InvalidEmbeddingProviderError,
  GeminiEmbeddingProvider,
} from './index.js';
import { DocumentIngestionPipeline, type IngestionDatabaseService } from '../pipeline.js';
import type {
  DocumentStorageProvider,
  EmbeddingProvider,
  ProcessDocumentJobPayload,
} from '@mindvault/shared';

describe('Embedding Providers & Registry (Phase 1B.4.4)', () => {
  describe('MockEmbeddingProvider (Unit Tests)', () => {
    const provider = new MockEmbeddingProvider(768);

    it('should generate deterministic embeddings with exact dimension 768', async () => {
      const text = 'MindVault vector search';
      const vector = await provider.embedText(text);

      expect(vector).toHaveLength(768);
      expect(provider.getDimensions()).toBe(768);

      // Determinism check: identical text yields identical vector
      const vector2 = await provider.embedText(text);
      expect(vector).toEqual(vector2);

      // Distinctness check: different text yields different vector
      const vector3 = await provider.embedText('Different text query');
      expect(vector).not.toEqual(vector3);
    });

    it('should produce L2 unit-normalized vectors (norm ~= 1.0)', async () => {
      const vector = await provider.embedText('Testing vector normalization');
      const sumOfSquares = vector.reduce((acc, val) => acc + val * val, 0);
      const l2Norm = Math.sqrt(sumOfSquares);

      expect(l2Norm).toBeCloseTo(1.0, 4);
    });

    it('should generate batch embeddings preserving array size and order', async () => {
      const inputs = ['Input A', 'Input B', 'Input C'];
      const batchVectors = await provider.embedBatch(inputs);

      expect(batchVectors).toHaveLength(3);
      batchVectors.forEach((v) => {
        expect(v).toHaveLength(768);
      });

      // Confirm each batch vector equals single embedText output
      const singleVectorB = await provider.embedText('Input B');
      expect(batchVectors[1]).toEqual(singleVectorB);
    });

    it('should return empty array for empty batch', async () => {
      const batch = await provider.embedBatch([]);
      expect(batch).toEqual([]);
    });
  });

  describe('createEmbeddingProvider Factory & Selection', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
      workerEmbeddingProviderRegistry.reset();
    });

    it('should return MockEmbeddingProvider when provider is mock', () => {
      const provider = createEmbeddingProvider({
        provider: 'mock',
        dimension: 768,
      });

      expect((provider as any).providerName).toBe('mock');
      expect(provider.dimension).toBe(768);
    });

    it('should reject removed provider "ollama" with UnsupportedEmbeddingProviderError', () => {
      expect(() => createEmbeddingProvider('ollama' as any)).toThrow(
        UnsupportedEmbeddingProviderError,
      );
      expect(() =>
        createEmbeddingProvider({
          provider: 'ollama' as any,
          dimension: 768,
        }),
      ).toThrow(UnsupportedEmbeddingProviderError);
    });

    it('should accept string identifier "gemini" and return GeminiEmbeddingProvider', () => {
      const provider = createEmbeddingProvider('gemini');
      expect(provider).toBeInstanceOf(GeminiEmbeddingProvider);
      expect(provider.dimension).toBe(768);
      expect(provider.modelName).toBe('gemini-embedding-2');
    });

    it('should accept options { provider: "gemini" } and instantiate GeminiEmbeddingProvider', () => {
      const provider = createEmbeddingProvider({
        provider: 'gemini',
        modelName: 'gemini-embedding-custom',
        dimension: 768,
      });
      expect(provider).toBeInstanceOf(GeminiEmbeddingProvider);
      expect(provider.dimension).toBe(768);
      expect(provider.modelName).toBe('gemini-embedding-custom');
    });

    it('should reject unsupported embedding providers with UnsupportedEmbeddingProviderError', () => {
      expect(() => createEmbeddingProvider('openai' as any)).toThrow(
        UnsupportedEmbeddingProviderError,
      );
      expect(() =>
        createEmbeddingProvider({ provider: 'unsupported' as any }),
      ).toThrow(UnsupportedEmbeddingProviderError);
    });

    it('should reject non-768 dimensions (§MOD-01)', () => {
      expect(() =>
        createEmbeddingProvider({
          provider: 'mock',
          dimension: 1536,
        }),
      ).toThrow(/EmbeddingDimensionViolation/);

      expect(() =>
        createEmbeddingProvider({
          provider: 'gemini',
          dimension: 1024,
        }),
      ).toThrow(/EmbeddingDimensionViolation/);
    });

    it('should prohibit mock provider in production environment', () => {
      process.env.NODE_ENV = 'production';
      expect(() => createEmbeddingProvider('mock')).toThrow(
        /MockEmbeddingProvider cannot be used in production environment/,
      );
    });

    it('should resolve provider from process.env.EMBEDDING_PROVIDER when called with no arguments', () => {
      process.env.EMBEDDING_PROVIDER = 'gemini';
      const provider = createEmbeddingProvider();
      expect(provider).toBeInstanceOf(GeminiEmbeddingProvider);
      expect(provider.modelName).toBe('gemini-embedding-2');
    });

    it('should default to Gemini in production environment when EMBEDDING_PROVIDER is unset', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.EMBEDDING_PROVIDER;
      const provider = createEmbeddingProvider();
      expect(provider).toBeInstanceOf(GeminiEmbeddingProvider);
      expect(provider.dimension).toBe(768);
    });

    it('should default to Mock in test environment when EMBEDDING_PROVIDER is unset', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.EMBEDDING_PROVIDER;
      const provider = createEmbeddingProvider();
      expect(provider).toBeInstanceOf(MockEmbeddingProvider);
      expect(provider.dimension).toBe(768);
    });
  });

  describe('WorkerEmbeddingProviderRegistry Architecture', () => {
    let registry: WorkerEmbeddingProviderRegistry;

    beforeEach(() => {
      registry = new WorkerEmbeddingProviderRegistry();
    });

    it('should register canonical providers by default', () => {
      expect(registry.has(BUILTIN_EMBEDDING_PROVIDERS.GEMINI)).toBe(true);
      expect(registry.has(BUILTIN_EMBEDDING_PROVIDERS.MOCK)).toBe(true);
      expect(registry.has('ollama')).toBe(false);

      const registered = registry.getRegisteredIds();
      expect(registered).toEqual(['gemini', 'mock']);
    });

    it('should provide descriptors for registered providers', () => {
      const geminiDesc = registry.getDescriptor('gemini');
      expect(geminiDesc).toBeDefined();
      expect(geminiDesc?.providerName).toBe('Google Gemini');
      expect(geminiDesc?.defaultModel).toBe('gemini-embedding-2');

      const mockDesc = registry.getDescriptor('mock');
      expect(mockDesc).toBeDefined();
      expect(mockDesc?.providerName).toBe('Deterministic Mock');
      expect(mockDesc?.dimension).toBe(768);
    });

    it('should prevent duplicate registration without override: true', () => {
      expect(() => {
        registry.register('gemini', () => new MockEmbeddingProvider());
      }).toThrow(DuplicateEmbeddingProviderError);
    });

    it('should allow replacement registration when override: true is specified', () => {
      const mockInstance = new MockEmbeddingProvider('custom-mock', 768);
      registry.register('gemini', () => mockInstance, { override: true });

      const resolved = registry.resolve('gemini');
      expect(resolved).toBe(mockInstance);
      expect(resolved.modelName).toBe('custom-mock');
    });

    it('should reject invalid or non-function factories', () => {
      expect(() => {
        registry.register('invalid', null as any);
      }).toThrow(InvalidEmbeddingProviderError);
    });

    it('should reject empty or whitespace provider IDs', () => {
      expect(() => {
        registry.register('   ', () => new MockEmbeddingProvider());
      }).toThrow(InvalidEmbeddingProviderError);
    });

    it('should unregister a provider cleanly', () => {
      expect(registry.has('mock')).toBe(true);
      expect(registry.unregister('mock')).toBe(true);
      expect(registry.has('mock')).toBe(false);
      expect(registry.getDescriptor('mock')).toBeUndefined();
    });

    it('should reset back to default builtin registrations', () => {
      registry.unregister('gemini');
      expect(registry.has('gemini')).toBe(false);

      registry.reset();
      expect(registry.has('gemini')).toBe(true);
      expect(registry.getRegisteredIds()).toEqual(['gemini', 'mock']);
    });

    it('should fail closed when resolving an unsupported provider ID', () => {
      expect(() => registry.resolve('cohere')).toThrow(UnsupportedEmbeddingProviderError);
      try {
        registry.resolve('cohere');
      } catch (err: any) {
        expect(err.providerId).toBe('cohere');
        expect(err.availableProviders).toEqual(['gemini', 'mock']);
      }
    });

    it('should fail closed if factory returns an object missing valid modelName', () => {
      registry.register(
        'broken-model',
        () =>
          ({
            modelName: '',
            dimension: 768,
            generateEmbedding: vi.fn(),
            generateEmbeddings: vi.fn(),
          }) as any,
      );

      expect(() => registry.resolve('broken-model')).toThrow(InvalidEmbeddingProviderError);
    });

    it('should fail closed if factory returns an object with non-768 dimension', () => {
      registry.register(
        'broken-dim',
        () =>
          ({
            modelName: 'valid-model',
            dimension: 512,
            generateEmbedding: vi.fn(),
            generateEmbeddings: vi.fn(),
          }) as any,
      );

      expect(() => registry.resolve('broken-dim')).toThrow(/EmbeddingDimensionViolation/);
    });

    it('should fail closed if factory returns an object missing generateEmbedding methods', () => {
      registry.register(
        'missing-methods',
        () =>
          ({
            modelName: 'valid-model',
            dimension: 768,
          }) as any,
      );

      expect(() => registry.resolve('missing-methods')).toThrow(InvalidEmbeddingProviderError);
    });
  });

  describe('Ingestion Pipeline Model Identity Propagation & Integrity', () => {
    let mockStorage: DocumentStorageProvider;
    let mockDb: IngestionDatabaseService;
    const documentId = 'doc-model-prop-test-001';
    const workspaceId = 'ws-model-prop-test-002';
    const sampleText = 'MindVault mixed-model retrieval ensures embedding space isolation.';

    const payload: ProcessDocumentJobPayload = {
      documentId,
      workspaceId,
      userId: 'usr-test-123',
    };

    beforeEach(() => {
      mockStorage = {
        read: vi.fn().mockResolvedValue(Buffer.from(sampleText)),
        save: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(true),
      };

      mockDb = {
        findDocumentById: vi.fn().mockResolvedValue({
          id: documentId,
          workspaceId,
          storageKey: 'test/key.txt',
          mimeType: 'text/plain',
          extension: 'txt',
          checksum: 'sha256-checksum-123',
          metadata: { existingMeta: 'preserved' },
        }),
        updateDocument: vi.fn().mockImplementation(async (_id, data) => data),
        createDocumentChunks: vi.fn().mockResolvedValue(undefined),
      };
    });

    it('should accurately persist Gemini model identity and 768 dimensions when Gemini is configured', async () => {
      const geminiProvider: EmbeddingProvider = {
        modelName: 'gemini-embedding-2',
        dimension: 768,
        generateEmbedding: vi.fn().mockResolvedValue(new Array(768).fill(0.01)),
        generateEmbeddings: vi.fn().mockImplementation(async (texts: string[]) => {
          return texts.map(() => new Array(768).fill(0.02));
        }),
      };

      const pipeline = new DocumentIngestionPipeline(mockStorage, geminiProvider, mockDb);
      await pipeline.processDocument(payload);

      // Verify createDocumentChunks received vectors with exact 768 length
      expect(mockDb.createDocumentChunks).toHaveBeenCalledTimes(1);
      const createdChunks = (mockDb.createDocumentChunks as any).mock.calls[0][0];
      expect(createdChunks.length).toBeGreaterThan(0);
      createdChunks.forEach((chk: any) => {
        expect(chk.embedding).toHaveLength(768);
        expect(chk.embedding[0]).toBe(0.02);
      });

      // Verify updateDocument recorded modelName: 'gemini-embedding-2' and dimension: 768
      const updateCalls = (mockDb.updateDocument as any).mock.calls;
      const completedCall = updateCalls.find((call: any[]) => call[1].status === 'COMPLETED');
      expect(completedCall).toBeDefined();
      expect(completedCall[1].embeddingModel).toBe('gemini-embedding-2');
      expect(completedCall[1].embeddingDimension).toBe(768);
    });

    it('should accurately persist custom provider model identity when configured', async () => {
      const customProvider: EmbeddingProvider = {
        modelName: 'custom-embed-text',
        dimension: 768,
        generateEmbedding: vi.fn().mockResolvedValue(new Array(768).fill(0.05)),
        generateEmbeddings: vi.fn().mockImplementation(async (texts: string[]) => {
          return texts.map(() => new Array(768).fill(0.05));
        }),
      };

      const pipeline = new DocumentIngestionPipeline(mockStorage, customProvider, mockDb);
      await pipeline.processDocument(payload);

      const updateCalls = (mockDb.updateDocument as any).mock.calls;
      const completedCall = updateCalls.find((call: any[]) => call[1].status === 'COMPLETED');
      expect(completedCall).toBeDefined();
      expect(completedCall[1].embeddingModel).toBe('custom-embed-text');
      expect(completedCall[1].embeddingDimension).toBe(768);
    });

    it('should fail closed and not record embeddingModel when embedding generation throws', async () => {
      const failingProvider: EmbeddingProvider = {
        modelName: 'gemini-embedding-2',
        dimension: 768,
        generateEmbedding: vi.fn().mockRejectedValue(new Error('Rate limit exceeded (429)')),
        generateEmbeddings: vi.fn().mockRejectedValue(new Error('Rate limit exceeded (429)')),
      };

      const pipeline = new DocumentIngestionPipeline(mockStorage, failingProvider, mockDb);

      await expect(pipeline.processDocument(payload)).rejects.toThrow('Rate limit exceeded (429)');

      // Verify no chunks were created
      expect(mockDb.createDocumentChunks).not.toHaveBeenCalled();

      // Verify document was marked as FAILED and never marked COMPLETED
      const updateCalls = (mockDb.updateDocument as any).mock.calls;
      const completedCall = updateCalls.find((call: any[]) => call[1].status === 'COMPLETED');
      expect(completedCall).toBeUndefined();

      const failedCall = updateCalls.find((call: any[]) => call[1].status === 'FAILED');
      expect(failedCall).toBeDefined();
      expect(failedCall[1].errorMessage).toContain('Rate limit exceeded (429)');
      expect(failedCall[1].embeddingModel).toBeUndefined();
    });
  });
});
