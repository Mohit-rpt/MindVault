import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  EmbeddingProviderRegistry,
  embeddingProviderRegistry,
  MockEmbeddingProvider,
  DuplicateEmbeddingProviderError,
  UnsupportedEmbeddingProviderError,
  InvalidEmbeddingProviderError,
  BUILTIN_EMBEDDING_PROVIDERS,
} from '../embeddings/embedding-provider.registry.js';
import { EmbeddingService } from '../embeddings/embedding.service.js';
import {
  APPROVED_EMBEDDING_MODELS,
  GeminiEmbeddingProvider,
} from '@mindvault/shared';

describe('Phase 1B.4.3: Embedding Provider Registry Architecture (Stage 14.3)', () => {
  let registry: EmbeddingProviderRegistry;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    registry = new EmbeddingProviderRegistry();
    EmbeddingService.resetProvider();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    registry.reset();
    embeddingProviderRegistry.reset();
    EmbeddingService.resetProvider();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Registry Registration Tests
  // -------------------------------------------------------------------------
  describe('1. Registry Registration', () => {
    it('initializes with default built-in providers: gemini and mock', () => {
      const ids = registry.getRegisteredIds();
      expect(ids).toEqual(['gemini', 'mock']);
      expect(registry.has('ollama')).toBe(false);
      expect(registry.has('gemini')).toBe(true);
      expect(registry.has('mock')).toBe(true);
    });

    it('registers a valid custom provider successfully', () => {
      const customFactory = () => new MockEmbeddingProvider('custom-test-embed', 768);
      registry.register('custom', customFactory, {
        descriptor: {
          id: 'custom',
          providerName: 'Custom Provider',
          defaultModel: 'custom-test-embed',
          dimension: 768,
        },
      });

      expect(registry.has('custom')).toBe(true);
      expect(registry.getRegisteredIds()).toContain('custom');

      const descriptor = registry.getDescriptor('custom');
      expect(descriptor).toEqual({
        id: 'custom',
        providerName: 'Custom Provider',
        defaultModel: 'custom-test-embed',
        dimension: 768,
      });

      const resolved = registry.resolve('custom');
      expect(resolved.modelName).toBe('custom-test-embed');
      expect(resolved.dimension).toBe(768);
    });

    it('rejects duplicate registration without override: true', () => {
      expect(() => {
        registry.register('gemini', () => new MockEmbeddingProvider());
      }).toThrow(DuplicateEmbeddingProviderError);

      expect(() => {
        registry.register('gemini', () => new MockEmbeddingProvider());
      }).toThrow('Embedding provider "gemini" is already registered. To replace it, specify override: true.');
    });

    it('allows replacing existing provider when override: true is specified', () => {
      registry.register('gemini', () => new MockEmbeddingProvider('overridden-gemini', 768), {
        override: true,
      });

      const resolved = registry.resolve('gemini');
      expect(resolved.modelName).toBe('overridden-gemini');
    });

    it('rejects registration with invalid or non-function factory', () => {
      expect(() => {
        registry.register('invalid-factory', null as any);
      }).toThrow(InvalidEmbeddingProviderError);

      expect(() => {
        registry.register('invalid-factory', {} as any);
      }).toThrow('Provider factory must be an executable function');
    });

    it('rejects registration with empty, missing, or whitespace provider ID', () => {
      expect(() => {
        registry.register('', () => new MockEmbeddingProvider());
      }).toThrow(InvalidEmbeddingProviderError);

      expect(() => {
        registry.register('   ', () => new MockEmbeddingProvider());
      }).toThrow('Provider identifier must be a non-empty string');
    });

    it('normalizes provider IDs to lowercase and trims whitespace', () => {
      registry.register('  CUSTOM-MIXED-CASE  ', () => new MockEmbeddingProvider('test', 768));
      expect(registry.has('custom-mixed-case')).toBe(true);
      expect(registry.has('CUSTOM-MIXED-CASE')).toBe(true);
      expect(registry.getRegisteredIds()).toContain('custom-mixed-case');
    });

    it('unregisters an existing provider cleanly', () => {
      expect(registry.has('mock')).toBe(true);
      const unregistered = registry.unregister('mock');
      expect(unregistered).toBe(true);
      expect(registry.has('mock')).toBe(false);
      expect(registry.getRegisteredIds()).not.toContain('mock');
    });

    it('reset restores default registrations after modifications', () => {
      registry.unregister('gemini');
      expect(registry.getRegisteredIds()).toEqual(['mock']);

      registry.reset();
      expect(registry.getRegisteredIds()).toEqual(['gemini', 'mock']);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Provider Resolution Tests
  // -------------------------------------------------------------------------
  describe('2. Provider Resolution', () => {
    it('fails closed when resolving removed Ollama provider with UnsupportedEmbeddingProviderError', () => {
      expect(() => {
        registry.resolve('ollama');
      }).toThrow(UnsupportedEmbeddingProviderError);
    });

    it('resolves Gemini provider with canonical gemini-embedding-2 model and 768 dimensions', () => {
      const provider = registry.resolve(BUILTIN_EMBEDDING_PROVIDERS.GEMINI);
      expect(provider).toBeInstanceOf(GeminiEmbeddingProvider);
      expect(provider.modelName).toBe(APPROVED_EMBEDDING_MODELS.GEMINI_PRIMARY);
      expect(provider.dimension).toBe(768);
    });

    it('resolves Mock provider in test environment with mock-embed-768 and 768 dimensions', () => {
      const provider = registry.resolve(BUILTIN_EMBEDDING_PROVIDERS.MOCK);
      expect(provider).toBeInstanceOf(MockEmbeddingProvider);
      expect(provider.modelName).toBe(APPROVED_EMBEDDING_MODELS.MOCK_TEST);
      expect(provider.dimension).toBe(768);
    });

    it('fails closed when resolving an unsupported/unknown provider identifier', () => {
      expect(() => {
        registry.resolve('unsupported-cohere-v3');
      }).toThrow(UnsupportedEmbeddingProviderError);

      expect(() => {
        registry.resolve('unsupported-cohere-v3');
      }).toThrow('Unsupported embedding provider: "unsupported-cohere-v3". Approved providers: gemini, mock');
    });

    it('does not silently fall back to Mock or Gemini when an explicit unsupported provider is requested', () => {
      expect(() => registry.resolve('anthropic')).toThrow(UnsupportedEmbeddingProviderError);
      expect(() => registry.resolve('ollama')).toThrow(UnsupportedEmbeddingProviderError);
      expect(() => registry.resolve('vertex-ai-multimodal')).toThrow(UnsupportedEmbeddingProviderError);
    });

    it('resolves provider configured via EMBEDDING_PROVIDER environment variable', () => {
      delete process.env.EMBEDDING_PROVIDER;
      expect(registry.resolve().modelName).toBe(APPROVED_EMBEDDING_MODELS.MOCK_TEST); // in test mode

      process.env.EMBEDDING_PROVIDER = 'gemini';
      expect(registry.resolve().modelName).toBe(APPROVED_EMBEDDING_MODELS.GEMINI_PRIMARY);
    });

    it('fails closed if EMBEDDING_PROVIDER environment variable is an unsupported string', () => {
      process.env.EMBEDDING_PROVIDER = 'unsupported-cloud-provider';
      expect(() => {
        registry.resolve();
      }).toThrow(UnsupportedEmbeddingProviderError);
    });

    it('defaults to Gemini in production/development environment when EMBEDDING_PROVIDER is unset', () => {
      delete process.env.EMBEDDING_PROVIDER;
      process.env.GEMINI_API_KEY = 'AIzaSyD-test-dummy-api-key-for-unit-test';
      (process.env as any).NODE_ENV = 'development';

      const provider = registry.resolve();
      expect(provider).toBeInstanceOf(GeminiEmbeddingProvider);
      expect(provider.modelName).toBe('gemini-embedding-2');
    });

    it('strictly guards Mock provider: throws Error if resolved in production environment', () => {
      (process.env as any).NODE_ENV = 'production';
      expect(() => {
        registry.resolve('mock');
      }).toThrow('MockEmbeddingProvider cannot be used in production environment.');
    });

    it('fails resolution if factory returns an invalid non-object', () => {
      registry.register('broken-provider', () => null as any, { override: true });
      expect(() => {
        registry.resolve('broken-provider');
      }).toThrow('Factory returned null, undefined, or non-object instance');
    });

    it('fails resolution if factory returns provider with missing modelName', () => {
      registry.register(
        'missing-model',
        () =>
          ({
            dimension: 768,
            generateEmbedding: async () => [],
            generateEmbeddings: async () => [],
          }) as any,
        { override: true },
      );
      expect(() => {
        registry.resolve('missing-model');
      }).toThrow('Provider instance missing valid non-empty modelName string');
    });

    it('fails resolution if factory returns provider with dimension !== 768', () => {
      registry.register(
        'wrong-dim',
        () => new MockEmbeddingProvider('dim-1536-embed', 1536),
        { override: true },
      );
      expect(() => {
        registry.resolve('wrong-dim');
      }).toThrow('EmbeddingDimensionViolation (§MOD-01): MindVault pgvector schema strictly mandates 768 dimensions. Received unsupported dimension: 1536');
    });

    it('fails resolution if factory returns provider missing generateEmbedding methods', () => {
      registry.register(
        'missing-methods',
        () =>
          ({
            modelName: 'valid-model',
            dimension: 768,
          }) as any,
        { override: true },
      );
      expect(() => {
        registry.resolve('missing-methods');
      }).toThrow('Provider instance missing required generateEmbedding / generateEmbeddings methods');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Provider & Model Identity Isolation Tests
  // -------------------------------------------------------------------------
  describe('3. Provider & Model Identity Isolation', () => {
    it('ensures provider identity is distinct from model identity', () => {
      const gemini = registry.resolve('gemini');
      expect(gemini.modelName).toBe('gemini-embedding-2'); // Provider: gemini, Model: gemini-embedding-2

      const mock = registry.resolve('mock');
      expect(mock.modelName).toBe('mock-embed-768'); // Provider: mock, Model: mock-embed-768
    });

    it('resolving one provider never returns an instance of another provider', () => {
      const p1 = registry.resolve('gemini');
      const p2 = registry.resolve('mock');

      expect(p1).toBeInstanceOf(GeminiEmbeddingProvider);
      expect(p2).toBeInstanceOf(MockEmbeddingProvider);

      expect(p1.modelName).not.toBe(p2.modelName);
    });

    it('Gemini is activated by default in production when EMBEDDING_PROVIDER is unset', () => {
      delete process.env.EMBEDDING_PROVIDER;
      process.env.GEMINI_API_KEY = 'AIzaSyD-test-dummy-api-key-for-unit-test';
      (process.env as any).NODE_ENV = 'production';

      const defaultProvider = registry.resolve();
      expect(defaultProvider).toBeInstanceOf(GeminiEmbeddingProvider);
      expect(defaultProvider.modelName).toBe('gemini-embedding-2');
    });
  });

  // -------------------------------------------------------------------------
  // 4. EmbeddingService Integration & Invariant Tests
  // -------------------------------------------------------------------------
  describe('4. EmbeddingService Integration', () => {
    it('EmbeddingService delegates provider resolution to the registry', () => {
      EmbeddingService.resetProvider();
      const provider = EmbeddingService.getProvider();
      expect(provider).toBeInstanceOf(MockEmbeddingProvider); // NODE_ENV === 'test'
      expect(EmbeddingService.getModelName()).toBe('mock-embed-768');
    });

    it('EmbeddingService respects EMBEDDING_PROVIDER environment variable', () => {
      process.env.EMBEDDING_PROVIDER = 'gemini';
      EmbeddingService.resetProvider();

      const provider = EmbeddingService.getProvider();
      expect(provider).toBeInstanceOf(GeminiEmbeddingProvider);
      expect(EmbeddingService.getModelName()).toBe('gemini-embedding-2');
    });

    it('EmbeddingService generates query vector and preserves 1:1 vector/model coupling', async () => {
      EmbeddingService.resetProvider();

      const generated = await EmbeddingService.generateQueryVectorWithModel('Test query text');
      expect(generated.vector).toBeDefined();
      expect(generated.vector.length).toBe(768);
      expect(generated.modelName).toBe('mock-embed-768');
    });

    it('EmbeddingService.validateCompatibility accurately validates documents using EmbeddingModelPolicy', () => {
      // 1. Mock nomic model active
      EmbeddingService.setProvider(new MockEmbeddingProvider('nomic-embed-text', 768));
      const nomicValid = EmbeddingService.validateCompatibility([
        { embeddingModel: 'nomic-embed-text', embeddingDimension: 768 },
        { embeddingModel: null, embeddingDimension: 768 }, // Legacy NULL compatible with Ollama
      ]);
      expect(nomicValid.compatible).toBe(true);

      const nomicWithGeminiDoc = EmbeddingService.validateCompatibility([
        { embeddingModel: 'gemini-embedding-2', embeddingDimension: 768 },
      ]);
      expect(nomicWithGeminiDoc.compatible).toBe(false);
      expect(nomicWithGeminiDoc.reason).toContain('is incompatible with query model \'nomic-embed-text\'');

      // 2. Gemini Provider active
      EmbeddingService.setProvider(
        new GeminiEmbeddingProvider({ apiKey: 'AIzaSyD-dummy-test-key-12345678' }),
      );
      const geminiWithGeminiDoc = EmbeddingService.validateCompatibility([
        { embeddingModel: 'gemini-embedding-2', embeddingDimension: 768 },
      ]);
      expect(geminiWithGeminiDoc.compatible).toBe(true);

      const geminiWithNomicDoc = EmbeddingService.validateCompatibility([
        { embeddingModel: 'nomic-embed-text', embeddingDimension: 768 },
      ]);
      expect(geminiWithNomicDoc.compatible).toBe(false);
      expect(geminiWithNomicDoc.reason).toContain('is incompatible with query model \'gemini-embedding-2\'');

      const geminiWithLegacyNullDoc = EmbeddingService.validateCompatibility([
        { embeddingModel: null, embeddingDimension: 768 },
      ]);
      expect(geminiWithLegacyNullDoc.compatible).toBe(false);
      expect(geminiWithLegacyNullDoc.reason).toContain('is incompatible with query model \'gemini-embedding-2\'');

      // 3. Dimension mismatch rejection
      const dimMismatch = EmbeddingService.validateCompatibility([
        { embeddingModel: 'gemini-embedding-2', embeddingDimension: 1536 },
      ]);
      expect(dimMismatch.compatible).toBe(false);
      expect(dimMismatch.reason).toContain('Document embedded with dimension 1536 is incompatible');
    });

    it('EmbeddingService.setRegistry allows injecting an isolated test registry', () => {
      const customRegistry = new EmbeddingProviderRegistry();
      customRegistry.register(
        'mock',
        () => new MockEmbeddingProvider('custom-test-registry-model', 768),
        { override: true },
      );

      EmbeddingService.setRegistry(customRegistry);
      expect(EmbeddingService.getModelName()).toBe('custom-test-registry-model');

      // Restore default registry
      EmbeddingService.setRegistry(embeddingProviderRegistry);
      EmbeddingService.resetProvider();
      expect(EmbeddingService.getModelName()).toBe('mock-embed-768');
    });
  });
});
