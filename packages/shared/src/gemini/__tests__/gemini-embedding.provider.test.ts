/**
 * MindVault — Phase 1B.1: GeminiEmbeddingProvider Unit Tests
 *
 * Exhaustive test coverage verifying:
 * 1. Successful single embedding.
 * 2. Successful batch embedding.
 * 3. Correct 768-dimensional output.
 * 4. Unit-norm validation and auto-renormalization.
 * 5. Invalid dimensions rejection.
 * 6. NaN and Infinity rejection.
 * 7. Empty response rejection.
 * 8. Input/output ordering preservation.
 * 9. Batch boundary conditions (1 item, exact batch size, batch size + 1).
 * 10. Partial batch failures / count mismatch rejection.
 * 11. HTTP 429 retry behavior and quota error on exhaustion.
 * 12. HTTP 5xx retry behavior and transient recovery.
 * 13. Authentication failure (immediate fail-fast without retry).
 * 14. Timeout handling (AbortError).
 * 15. Retry exhaustion after maxRetries.
 * 16. API key masking in error messages.
 * 17. Concurrency / sequential batch slicing.
 * 18. Empty input handling.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GeminiEmbeddingProvider,
  GeminiAuthenticationError,
  GeminiPermissionError,
  GeminiQuotaExhaustedError,
  GeminiServiceUnavailableError,
  GeminiInvalidRequestError,
  GeminiVectorIntegrityError,
  maskGeminiApiKey,
  validateAndNormalizeVector,
} from '../gemini-embedding.provider.js';

/**
 * Generates a deterministic unit-normalized vector of exact dimension
 */
function createSyntheticUnitVector(seed: number, dimension = 768): number[] {
  const vec = new Array<number>(dimension);
  let sumSq = 0;
  for (let i = 0; i < dimension; i++) {
    const val = Math.sin(seed * 1000 + i);
    vec[i] = val;
    sumSq += val * val;
  }
  const norm = Math.sqrt(sumSq);
  return vec.map((v) => v / norm);
}

describe('GeminiEmbeddingProvider (Phase 1B.1)', () => {
  const dummyApiKey = 'AIzaSyD-1234567890abcdef1234567890abcdef12';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Successful single embedding', () => {
    it('generates a 768d unit-norm embedding for a single text', async () => {
      const mockVector = createSyntheticUnitVector(1);
      const mockEmbedContent = vi.fn().mockResolvedValue({
        embeddings: [{ values: mockVector }],
      });
      const mockClient: any = {
        models: { embedContent: mockEmbedContent },
      };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const vector = await provider.generateEmbedding('MindVault knowledge ingestion');

      expect(mockEmbedContent).toHaveBeenCalledTimes(1);
      expect(mockEmbedContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-embedding-2',
          contents: 'MindVault knowledge ingestion',
          config: expect.objectContaining({ outputDimensionality: 768 }),
        }),
      );
      expect(vector).toHaveLength(768);
      expect(vector).toEqual(mockVector);
    });

    it('supports embedText alias for single embedding', async () => {
      const mockVector = createSyntheticUnitVector(2);
      const mockClient: any = {
        models: {
          embedContent: vi.fn().mockResolvedValue({
            embeddings: [{ values: mockVector }],
          }),
        },
      };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const vector = await provider.embedText('Compatibility alias check');
      expect(vector).toHaveLength(768);
      expect(provider.getDimensions()).toBe(768);
    });
  });

  describe('2. Successful batch embedding', () => {
    it('generates embeddings for multiple texts preserving array length', async () => {
      const texts = ['Text Alpha', 'Text Beta', 'Text Gamma'];
      const v1 = createSyntheticUnitVector(10);
      const v2 = createSyntheticUnitVector(20);
      const v3 = createSyntheticUnitVector(30);

      const mockEmbedContent = vi.fn().mockResolvedValue({
        embeddings: [{ values: v1 }, { values: v2 }, { values: v3 }],
      });
      const mockClient: any = { models: { embedContent: mockEmbedContent } };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const results = await provider.generateEmbeddings(texts);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual(v1);
      expect(results[1]).toEqual(v2);
      expect(results[2]).toEqual(v3);
    });

    it('supports embedBatch compatibility alias', async () => {
      const v = createSyntheticUnitVector(5);
      const mockClient: any = {
        models: {
          embedContent: vi.fn().mockResolvedValue({
            embeddings: [{ values: v }],
          }),
        },
      };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const results = await provider.embedBatch(['Testing embedBatch']);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(v);
    });
  });

  describe('3. Correct 768-dimensional output', () => {
    it('strictly mandates 768 dimensions upon instantiation', () => {
      expect(() => {
        new GeminiEmbeddingProvider({
          apiKey: dummyApiKey,
          dimension: 1536 as any,
        });
      }).toThrow(/EmbeddingDimensionViolation/);
    });

    it('strictly outputs exactly 768 elements per vector', async () => {
      const v = createSyntheticUnitVector(77);
      const mockClient: any = {
        models: {
          embedContent: vi.fn().mockResolvedValue({
            embeddings: [{ values: v }],
          }),
        },
      };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const result = await provider.generateEmbedding('Dimension verification');
      expect(result).toHaveLength(768);
    });
  });

  describe('4. Unit-norm validation & auto-renormalization', () => {
    it('validates Euclidean norm is within unit-norm tolerance and renormalizes', () => {
      const rawVector = createSyntheticUnitVector(42);
      // Introduce microscopic floating point noise (0.00002) within tolerance
      const noisyVector = rawVector.map((val) => val * 1.00002);
      const noisyNorm = Math.sqrt(noisyVector.reduce((acc, v) => acc + v * v, 0));
      expect(Math.abs(noisyNorm - 1.0)).toBeGreaterThan(0);
      expect(Math.abs(noisyNorm - 1.0)).toBeLessThan(1e-4);

      const normalized = validateAndNormalizeVector(noisyVector, 768, 1e-4);
      const finalNorm = Math.sqrt(normalized.reduce((acc, v) => acc + v * v, 0));
      expect(finalNorm).toBeCloseTo(1.0, 9);
    });

    it('rejects vectors whose norm deviates significantly from 1.0', () => {
      const unnormalized = new Array(768).fill(1.0); // Norm is sqrt(768) ≈ 27.7
      expect(() => {
        validateAndNormalizeVector(unnormalized, 768, 1e-4);
      }).toThrow(GeminiVectorIntegrityError);
    });

    it('rejects zero and near-zero degenerate vectors', () => {
      const zeroVector = new Array(768).fill(0);
      expect(() => {
        validateAndNormalizeVector(zeroVector, 768, 1e-4);
      }).toThrow(/Degenerate vector magnitude/);
    });
  });

  describe('5. Invalid dimensions rejection', () => {
    it('rejects API responses returning vectors shorter than 768 (e.g. 512)', async () => {
      const truncated = createSyntheticUnitVector(1, 512);
      const mockClient: any = {
        models: {
          embedContent: vi.fn().mockResolvedValue({
            embeddings: [{ values: truncated }],
          }),
        },
      };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      await expect(provider.generateEmbedding('Test')).rejects.toThrow(
        /Embedding dimension mismatch: expected 768, received 512/,
      );
    });

    it('rejects API responses returning vectors longer than 768 (e.g. 1536)', async () => {
      const oversized = createSyntheticUnitVector(1, 1536);
      const mockClient: any = {
        models: {
          embedContent: vi.fn().mockResolvedValue({
            embeddings: [{ values: oversized }],
          }),
        },
      };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      await expect(provider.generateEmbedding('Test')).rejects.toThrow(
        /Embedding dimension mismatch: expected 768, received 1536/,
      );
    });
  });

  describe('6. NaN and Infinity rejection', () => {
    it('rejects vectors containing NaN', () => {
      const vec = createSyntheticUnitVector(1);
      vec[100] = NaN;
      expect(() => validateAndNormalizeVector(vec, 768)).toThrow(
        /Vector element at index 100 is not a finite number: NaN/,
      );
    });

    it('rejects vectors containing Infinity', () => {
      const vec = createSyntheticUnitVector(1);
      vec[250] = Infinity;
      expect(() => validateAndNormalizeVector(vec, 768)).toThrow(
        /Vector element at index 250 is not a finite number: Infinity/,
      );
    });

    it('rejects vectors containing -Infinity', () => {
      const vec = createSyntheticUnitVector(1);
      vec[500] = -Infinity;
      expect(() => validateAndNormalizeVector(vec, 768)).toThrow(
        /Vector element at index 500 is not a finite number: -Infinity/,
      );
    });

    it('rejects non-array responses', () => {
      expect(() => validateAndNormalizeVector('not an array' as any, 768)).toThrow(
        /Malformed embedding response: expected array/,
      );
    });
  });

  describe('7. Empty response rejection', () => {
    it('rejects API responses with missing embeddings array', async () => {
      const mockClient: any = {
        models: {
          embedContent: vi.fn().mockResolvedValue({}),
        },
      };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      await expect(provider.generateEmbedding('Test')).rejects.toThrow(
        /Gemini API returned response with missing or empty embeddings/,
      );
    });

    it('rejects API responses with empty embeddings array', async () => {
      const mockClient: any = {
        models: {
          embedContent: vi.fn().mockResolvedValue({ embeddings: [] }),
        },
      };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      await expect(provider.generateEmbedding('Test')).rejects.toThrow(
        /Gemini API returned response with missing or empty embeddings/,
      );
    });
  });

  describe('8. Input/output ordering preservation', () => {
    it('strictly preserves 1:1 positional correspondence in batch requests', async () => {
      const texts = ['First text', 'Second text', 'Third text', 'Fourth text'];
      const v0 = createSyntheticUnitVector(100);
      const v1 = createSyntheticUnitVector(200);
      const v2 = createSyntheticUnitVector(300);
      const v3 = createSyntheticUnitVector(400);

      const mockClient: any = {
        models: {
          embedContent: vi.fn().mockResolvedValue({
            embeddings: [{ values: v0 }, { values: v1 }, { values: v2 }, { values: v3 }],
          }),
        },
      };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const results = await provider.generateEmbeddings(texts);

      expect(results[0]).toEqual(v0);
      expect(results[1]).toEqual(v1);
      expect(results[2]).toEqual(v2);
      expect(results[3]).toEqual(v3);
    });
  });

  describe('9. Batch boundary conditions', () => {
    it('handles exactly 1 item in batch', async () => {
      const v = createSyntheticUnitVector(1);
      const mockClient: any = {
        models: {
          embedContent: vi.fn().mockResolvedValue({
            embeddings: [{ values: v }],
          }),
        },
      };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxBatchSize: 2,
      });

      const results = await provider.generateEmbeddings(['Only item']);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(v);
    });

    it('handles exact batch size boundary (2 items with maxBatchSize=2 in 1 request)', async () => {
      const v1 = createSyntheticUnitVector(1);
      const v2 = createSyntheticUnitVector(2);
      const mockEmbedContent = vi.fn().mockResolvedValue({
        embeddings: [{ values: v1 }, { values: v2 }],
      });
      const mockClient: any = { models: { embedContent: mockEmbedContent } };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxBatchSize: 2,
      });

      const results = await provider.generateEmbeddings(['A', 'B']);
      expect(results).toHaveLength(2);
      expect(mockEmbedContent).toHaveBeenCalledTimes(1);
    });

    it('handles batch size + 1 boundary (3 items with maxBatchSize=2 across 2 requests)', async () => {
      const v1 = createSyntheticUnitVector(1);
      const v2 = createSyntheticUnitVector(2);
      const v3 = createSyntheticUnitVector(3);

      const mockEmbedContent = vi
        .fn()
        .mockResolvedValueOnce({
          embeddings: [{ values: v1 }, { values: v2 }],
        })
        .mockResolvedValueOnce({
          embeddings: [{ values: v3 }],
        });

      const mockClient: any = { models: { embedContent: mockEmbedContent } };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxBatchSize: 2,
      });

      const results = await provider.generateEmbeddings(['A', 'B', 'C']);
      expect(results).toHaveLength(3);
      expect(mockEmbedContent).toHaveBeenCalledTimes(2);
      expect(results[0]).toEqual(v1);
      expect(results[1]).toEqual(v2);
      expect(results[2]).toEqual(v3);
    });
  });

  describe('10. Partial batch failures / count mismatch rejection', () => {
    it('fails fast when API returns fewer embeddings than requested texts', async () => {
      const v1 = createSyntheticUnitVector(1);
      const mockClient: any = {
        models: {
          embedContent: vi.fn().mockResolvedValue({
            // Requested 2 texts, but only 1 embedding returned
            embeddings: [{ values: v1 }],
          }),
        },
      };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxRetries: 1,
      });

      await expect(provider.generateEmbeddings(['A', 'B'])).rejects.toThrow(
        /Gemini API returned 1 vectors for 2 input texts/,
      );
    });
  });

  describe('11. HTTP 429 retry behavior', () => {
    it('retries on HTTP 429 and succeeds on subsequent attempt', async () => {
      const v = createSyntheticUnitVector(1);
      const rateLimitError = {
        status: 429,
        message: 'RESOURCE_EXHAUSTED: Rate limit exceeded for free tier',
      };

      const mockEmbedContent = vi
        .fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({
          embeddings: [{ values: v }],
        });

      const mockClient: any = { models: { embedContent: mockEmbedContent } };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        initialRetryDelayMs: 10,
        maxRetryDelayMs: 50,
      });

      const result = await provider.generateEmbedding('Testing rate limit recovery');
      expect(mockEmbedContent).toHaveBeenCalledTimes(2);
      expect(result).toEqual(v);
    });

    it('throws GeminiQuotaExhaustedError when 429 persists through all retries', async () => {
      const rateLimitError = {
        status: 429,
        message: 'RESOURCE_EXHAUSTED: Rate limit exceeded',
      };

      const mockEmbedContent = vi.fn().mockRejectedValue(rateLimitError);
      const mockClient: any = { models: { embedContent: mockEmbedContent } };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxRetries: 2,
        initialRetryDelayMs: 5,
        maxRetryDelayMs: 10,
      });

      await expect(provider.generateEmbedding('Exhaustion test')).rejects.toThrow(
        GeminiQuotaExhaustedError,
      );
      expect(mockEmbedContent).toHaveBeenCalledTimes(2);
    });
  });

  describe('12. HTTP 5xx retry behavior', () => {
    it('retries on HTTP 503 and succeeds on subsequent attempt', async () => {
      const v = createSyntheticUnitVector(42);
      const serverError = {
        status: 503,
        message: 'The model is overloaded. Please try again later.',
      };

      const mockEmbedContent = vi
        .fn()
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({
          embeddings: [{ values: v }],
        });

      const mockClient: any = { models: { embedContent: mockEmbedContent } };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        initialRetryDelayMs: 10,
        maxRetryDelayMs: 50,
      });

      const result = await provider.generateEmbedding('Service recovery check');
      expect(mockEmbedContent).toHaveBeenCalledTimes(2);
      expect(result).toEqual(v);
    });

    it('retries on network fetch failures and classifies as GeminiServiceUnavailableError', async () => {
      const fetchError = new Error('fetch failed: connect ECONNREFUSED 142.250.190.42:443');
      const mockEmbedContent = vi.fn().mockRejectedValue(fetchError);
      const mockClient: any = { models: { embedContent: mockEmbedContent } };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxRetries: 2,
        initialRetryDelayMs: 5,
        maxRetryDelayMs: 10,
      });

      await expect(provider.generateEmbedding('Network fail')).rejects.toThrow(
        GeminiServiceUnavailableError,
      );
      expect(mockEmbedContent).toHaveBeenCalledTimes(2);
    });
  });

  describe('13. Authentication failure', () => {
    it('fails fast immediately on HTTP 401 without retrying', async () => {
      const authError = {
        status: 401,
        message: 'API_KEY_INVALID: API key not valid. Please pass a valid API key.',
      };

      const mockEmbedContent = vi.fn().mockRejectedValue(authError);
      const mockClient: any = { models: { embedContent: mockEmbedContent } };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxRetries: 3,
      });

      await expect(provider.generateEmbedding('Auth test')).rejects.toThrow(
        GeminiAuthenticationError,
      );
      // Non-retryable: must have been called exactly once!
      expect(mockEmbedContent).toHaveBeenCalledTimes(1);
    });

    it('fails fast immediately on HTTP 403 Permission Denied without retrying', async () => {
      const permError = {
        status: 403,
        message: 'PERMISSION_DENIED: Generative Language API is not enabled.',
      };

      const mockEmbedContent = vi.fn().mockRejectedValue(permError);
      const mockClient: any = { models: { embedContent: mockEmbedContent } };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxRetries: 3,
      });

      await expect(provider.generateEmbedding('Permission test')).rejects.toThrow(
        GeminiPermissionError,
      );
      expect(mockEmbedContent).toHaveBeenCalledTimes(1);
    });

    it('throws GeminiAuthenticationError if apiKey is missing upon client initialization', () => {
      const originalKey = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;

      expect(() => {
        new GeminiEmbeddingProvider({ apiKey: '' });
      }).toThrow(GeminiAuthenticationError);

      if (originalKey) {
        process.env.GEMINI_API_KEY = originalKey;
      }
    });
  });

  describe('14. Timeout handling', () => {
    it('classifies AbortError as GeminiServiceUnavailableError with timeout message', async () => {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';

      const mockEmbedContent = vi.fn().mockRejectedValue(abortError);
      const mockClient: any = { models: { embedContent: mockEmbedContent } };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        timeoutMs: 1000,
        maxRetries: 1,
      });

      await expect(provider.generateEmbedding('Timeout test')).rejects.toThrow(
        /Gemini API request timed out after 1000ms/,
      );
    });
  });

  describe('15. Retry exhaustion', () => {
    it('honors maxRetries and stops attempting once limit is reached', async () => {
      const serverError = { status: 500, message: 'Internal Server Error' };
      const mockEmbedContent = vi.fn().mockRejectedValue(serverError);
      const mockClient: any = { models: { embedContent: mockEmbedContent } };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxRetries: 3,
        initialRetryDelayMs: 5,
        maxRetryDelayMs: 15,
      });

      await expect(provider.generateEmbedding('Retry limit check')).rejects.toThrow(
        GeminiServiceUnavailableError,
      );
      expect(mockEmbedContent).toHaveBeenCalledTimes(3);
    });
  });

  describe('16. API key masking in error messages', () => {
    it('masks long API keys safely preserving only 4 prefix and 4 suffix chars with length', () => {
      const key = 'AIzaSyD-1234567890abcdef1234567890abcdef12';
      const masked = maskGeminiApiKey(key);
      expect(masked).toBe('AIza...ef12 (length 42)');
      expect(masked).not.toContain('1234567890abcdef');
    });

    it('ensures authentication error messages mask the API key', async () => {
      const authError = { status: 401, message: 'API_KEY_INVALID' };
      const mockClient: any = { models: { embedContent: vi.fn().mockRejectedValue(authError) } };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxRetries: 1,
      });

      try {
        await provider.generateEmbedding('Test masking');
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('AIza...ef12 (length 42)');
        expect(err.message).not.toContain('1234567890abcdef');
      }
    });
  });

  describe('17. Concurrency / sequential batch slicing', () => {
    it('slices 5 inputs into chunks of maxBatchSize 2 sequentially', async () => {
      const v = createSyntheticUnitVector(1);
      const callArgs: any[] = [];
      const mockEmbedContent = vi.fn().mockImplementation((args) => {
        callArgs.push(args.contents);
        const count = Array.isArray(args.contents) ? args.contents.length : 1;
        return Promise.resolve({
          embeddings: new Array(count).fill(null).map(() => ({ values: v })),
        });
      });

      const mockClient: any = { models: { embedContent: mockEmbedContent } };

      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxBatchSize: 2,
      });

      const results = await provider.generateEmbeddings(['1', '2', '3', '4', '5']);
      expect(results).toHaveLength(5);
      expect(mockEmbedContent).toHaveBeenCalledTimes(3);
      expect(callArgs[0]).toEqual(['1', '2']);
      expect(callArgs[1]).toEqual(['3', '4']);
      expect(callArgs[2]).toEqual('5'); // Single item converted to string
    });
  });

  describe('18. Empty input handling', () => {
    it('returns empty array when input texts array is empty', async () => {
      const mockClient: any = { models: { embedContent: vi.fn() } };
      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const results = await provider.generateEmbeddings([]);
      expect(results).toEqual([]);
      expect(mockClient.models.embedContent).not.toHaveBeenCalled();
    });

    it('rejects empty string in generateEmbedding', async () => {
      const mockClient: any = { models: { embedContent: vi.fn() } };
      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      await expect(provider.generateEmbedding('')).rejects.toThrow(GeminiInvalidRequestError);
      await expect(provider.generateEmbedding('   ')).rejects.toThrow(GeminiInvalidRequestError);
    });

    it('rejects batch containing empty or whitespace-only strings', async () => {
      const mockClient: any = { models: { embedContent: vi.fn() } };
      const provider = new GeminiEmbeddingProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      await expect(
        provider.generateEmbeddings(['Valid text', '', 'Another valid']),
      ).rejects.toThrow(/Input text at index 1 must be a non-empty string/);
    });
  });
});
