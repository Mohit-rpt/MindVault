/**
 * MindVault — Knowledge Graph: Gemini Extraction Provider & Worker Integration Tests
 *
 * Verifies that the Worker module correctly integrates GeminiExtractionProvider
 * with provider.factory.ts and GraphExtractionService.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiExtractionProvider } from '../providers/gemini-extraction.provider.js';
import { createExtractionProvider } from '../providers/provider.factory.js';
import { GraphExtractionService } from '../services/graph-extraction.service.js';

describe('Phase 1B.3: Worker GeminiExtractionProvider & Pipeline Integration', () => {
  const originalEnv = { ...process.env };
  const dummyApiKey = 'AIzaSyD-1234567890abcdef1234567890abcdef12';

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Worker factory provider resolution', () => {
    it('creates a GeminiExtractionProvider when requested in worker', () => {
      process.env.GEMINI_API_KEY = dummyApiKey;
      const provider = createExtractionProvider('gemini');
      expect(provider).toBeInstanceOf(GeminiExtractionProvider);
      expect(provider.providerName).toBe('gemini');
    });

    it('selects GeminiExtractionProvider when GRAPH_EXTRACTION_PROVIDER=gemini in worker', () => {
      process.env.GEMINI_API_KEY = dummyApiKey;
      process.env.GRAPH_EXTRACTION_PROVIDER = 'gemini';
      delete process.env.LLM_PROVIDER;

      const provider = createExtractionProvider();
      expect(provider).toBeInstanceOf(GeminiExtractionProvider);
    });

    it('strictly rejects Ollama as extraction provider in worker', () => {
      process.env.GRAPH_EXTRACTION_PROVIDER = 'ollama';
      expect(() => createExtractionProvider()).toThrow(
        /Unsupported graph extraction provider: "ollama"/,
      );
    });
  });

  describe('Worker GraphExtractionService integration with Gemini', () => {
    it('extractRaw executes seamlessly through GeminiExtractionProvider with mock client', async () => {
      const mockPayload = {
        version: '1.0',
        entities: [
          {
            name: 'BullMQ',
            entityType: 'TECHNOLOGY',
            description: 'Message queue library for Node.js',
            confidence: 0.95,
            aliases: [],
          },
          {
            name: 'Redis',
            entityType: 'TECHNOLOGY',
            description: 'In-memory key-value data store',
            confidence: 0.98,
            aliases: [],
          },
        ],
        relations: [
          {
            sourceEntity: 'BullMQ',
            targetEntity: 'Redis',
            relationType: 'DEPENDS_ON',
            evidence: 'BullMQ uses Redis for distributed state.',
            confidence: 0.93,
          },
        ],
      };

      const mockClient: any = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: JSON.stringify(mockPayload),
          }),
        },
      };

      const geminiProvider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const service = new GraphExtractionService({
        provider: geminiProvider,
      });

      const extraction = await service.extractRaw('BullMQ uses Redis for distributed state.', {
        workspaceId: 'ws-worker-123',
        documentTitle: 'Worker System Architecture',
        sectionHeading: 'Queue Ingestion',
      });

      expect(extraction.version).toBe('1.0');
      expect(extraction.entities).toHaveLength(2);
      expect(extraction.entities[0].name).toBe('BullMQ');
      expect(extraction.entities[1].name).toBe('Redis');
      expect(extraction.relations).toHaveLength(1);
      expect(extraction.relations[0].relationType).toBe('DEPENDS_ON');
    });

    it('healthCheck returns healthy configuration status', async () => {
      const provider = new GeminiExtractionProvider({ apiKey: dummyApiKey });
      const status = await provider.healthCheck();
      expect(status.ok).toBe(true);
      expect(status.message).toContain('gemini');
    });
  });
});
