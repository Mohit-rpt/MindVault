import { describe, it, expect } from 'vitest';
import { MockEmbeddingProvider } from './mock.provider.js';
import { createEmbeddingProvider } from './index.js';

describe('Embedding Providers (Phase 2)', () => {
  describe('MockEmbeddingProvider', () => {
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

  describe('createEmbeddingProvider Factory', () => {
    it('should return MockEmbeddingProvider when provider is mock', () => {
      const provider = createEmbeddingProvider({
        provider: 'mock',
        dimension: 768,
      });

      expect((provider as any).providerName).toBe('mock');
      expect(provider.dimension).toBe(768);
    });

    it('should return OllamaEmbeddingProvider when provider is ollama', () => {
      const provider = createEmbeddingProvider({
        provider: 'ollama',
        dimension: 768,
        baseUrl: 'http://127.0.0.1:11434',
        model: 'nomic-embed-text',
      });

      expect((provider as any).providerName).toBe('ollama');
      expect(provider.dimension).toBe(768);
      expect(provider.modelName).toBe('nomic-embed-text');
    });
  });
});
