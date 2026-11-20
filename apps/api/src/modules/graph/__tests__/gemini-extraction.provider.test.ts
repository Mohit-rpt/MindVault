/**
 * MindVault — Knowledge Graph: Gemini Extraction Provider & Factory API Integration Tests
 *
 * Verifies that the API module correctly re-exports and utilizes GeminiExtractionProvider
 * from @mindvault/shared, and that provider.factory.ts routes correctly.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiExtractionProvider } from '../providers/gemini-extraction.provider.js';
import { createExtractionProvider } from '../providers/provider.factory.js';

describe('Phase 1B.3: API GeminiExtractionProvider & Factory Integration', () => {
  const originalEnv = { ...process.env };
  const dummyApiKey = 'AIzaSyD-1234567890abcdef1234567890abcdef12';

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Factory provider resolution', () => {
    it('creates a GeminiExtractionProvider when explicitly requested', () => {
      process.env.GEMINI_API_KEY = dummyApiKey;
      const provider = createExtractionProvider('gemini');
      expect(provider).toBeInstanceOf(GeminiExtractionProvider);
      expect(provider.providerName).toBe('gemini');
    });

    it('selects GeminiExtractionProvider when GRAPH_EXTRACTION_PROVIDER is set to gemini', () => {
      process.env.GEMINI_API_KEY = dummyApiKey;
      process.env.GRAPH_EXTRACTION_PROVIDER = 'gemini';
      delete process.env.LLM_PROVIDER;

      const provider = createExtractionProvider();
      expect(provider).toBeInstanceOf(GeminiExtractionProvider);
      expect(provider.providerName).toBe('gemini');
    });

    it('strictly rejects Ollama extraction provider requests', () => {
      process.env.GRAPH_EXTRACTION_PROVIDER = 'ollama';
      expect(() => createExtractionProvider()).toThrow(
        /Unsupported graph extraction provider: "ollama"/,
      );
    });

    it('falls back to GeminiExtractionProvider when NODE_ENV is not test and no provider is specified', () => {
      delete process.env.GRAPH_EXTRACTION_PROVIDER;
      delete process.env.LLM_PROVIDER;
      process.env.NODE_ENV = 'development';
      process.env.GEMINI_API_KEY = dummyApiKey;

      const provider = createExtractionProvider();
      expect(provider).toBeInstanceOf(GeminiExtractionProvider);
      expect(provider.providerName).toBe('gemini');
    });

    it('throws error for unsupported provider type', () => {
      expect(() => createExtractionProvider('unknown-provider' as any)).toThrow(
        /Unsupported graph extraction provider: "unknown-provider"/,
      );
    });
  });

  describe('Re-exported GeminiExtractionProvider functionality', () => {
    it('instantiates and performs extraction using injected mock client', async () => {
      const mockPayload = {
        version: '1.0',
        entities: [
          {
            name: 'Fastify',
            entityType: 'TECHNOLOGY',
            description: 'Fast and low overhead web framework for Node.js',
            confidence: 0.96,
            aliases: [],
          },
        ],
        relations: [],
      };

      const mockClient: any = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: JSON.stringify(mockPayload),
          }),
        },
      };

      const provider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const response = await provider.extract('Fastify is a fast web framework.');
      expect(response.version).toBe('1.0');
      expect(response.entities).toHaveLength(1);
      expect(response.entities[0].name).toBe('Fastify');
      expect(response.entities[0].entityType).toBe('TECHNOLOGY');
    });

    it('reports healthy when GEMINI_API_KEY is configured', async () => {
      const provider = new GeminiExtractionProvider({ apiKey: dummyApiKey });
      const health = await provider.healthCheck();
      expect(health.ok).toBe(true);
      expect(health.message).toContain('gemini');
    });
  });
});
