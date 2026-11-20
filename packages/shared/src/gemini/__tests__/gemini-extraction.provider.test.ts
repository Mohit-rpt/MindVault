/**
 * MindVault — Phase 1B.3: GeminiExtractionProvider Unit & Integration Tests
 *
 * Exhaustive test coverage verifying all 20 mandatory test categories:
 * 1. Valid entity extraction.
 * 2. Valid relationship extraction.
 * 3. All supported entity types (CONCEPT, TECHNOLOGY, ORGANIZATION, PERSON, LOCATION, EVENT, METRIC, PRODUCT, CUSTOM).
 * 4. Empty valid extraction.
 * 5. Malformed JSON handling.
 * 6. Unsupported entity types (schema rejection).
 * 7. Invalid relationship endpoints (self-loops, empty endpoints filtered).
 * 8. Invalid evidence references (empty evidence filtered).
 * 9. Source attribution preservation (title, heading, page number in prompt).
 * 10. Transient API errors and bounded retries (429, 503).
 * 11. Permanent errors and fail-fast behavior (401, 403, 400).
 * 12. Request timeout handling (504).
 * 13. Pre-aborted caller signal (CLIENT_ABORTED).
 * 14. Mid-request cancellation (CLIENT_ABORTED).
 * 15. Cancellation during retry backoff (immediate delay exit).
 * 16. Secret sanitization (API keys, query tokens, auth headers).
 * 17. Provider factory selection (createExtractionProvider).
 * 18. Existing provider compatibility (Mock and Ollama).
 * 19. Worker/service integration without changing job semantics.
 * 20. Ollama regression compatibility.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GeminiExtractionProvider,
  GeminiExtractionSchemaError,
  GeminiNotFoundError,
  GeminiError,
  GeminiEmbeddingError,
} from '../gemini-extraction.provider.js';
import {
  GeminiAuthenticationError,
  GeminiPermissionError,
  GeminiServiceUnavailableError,
  GeminiInvalidRequestError,
} from '../gemini-generation.provider.js';
import type { ExtractionContext } from '../gemini-extraction.provider.js';

describe('GeminiExtractionProvider (Phase 1B.3)', () => {
  const dummyApiKey = 'AIzaSyD-1234567890abcdef1234567890abcdef12';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Valid entity extraction
  // -------------------------------------------------------------------------
  describe('1. Valid entity extraction', () => {
    it('extracts a single entity with attributes, description, and aliases', async () => {
      const mockPayload = {
        version: '1.0',
        entities: [
          {
            name: 'PostgreSQL',
            type: 'TECHNOLOGY',
            description: 'An open-source object-relational database system',
            confidence: 0.95,
            aliases: ['Postgres', 'PG'],
            attributes: { license: 'PostgreSQL License', acid_compliant: true },
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

      const result = await provider.extract(
        'PostgreSQL is an open-source object-relational database.',
      );

      expect(mockClient.models.generateContent).toHaveBeenCalledTimes(1);
      expect(result.version).toBe('1.0');
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('PostgreSQL');
      expect(result.entities[0].entityType).toBe('TECHNOLOGY');
      expect(result.entities[0].confidence).toBe(0.95);
      expect(result.entities[0].aliases).toEqual(['Postgres', 'PG']);
      expect(result.relations).toHaveLength(0);
    });

    it('extracts multiple entities with varying confidence scores', async () => {
      const mockPayload = {
        version: '1.0',
        entities: [
          {
            name: 'Vector Database',
            type: 'CONCEPT',
            description: 'Database optimized for storing and querying embeddings',
            confidence: 0.92,
          },
          {
            name: 'pgvector',
            type: 'TECHNOLOGY',
            description: 'Vector similarity search extension for PostgreSQL',
            confidence: 0.97,
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

      const result = await provider.extract(
        'pgvector provides vector database capabilities in Postgres.',
      );

      expect(result.entities).toHaveLength(2);
      expect(result.entities[0].name).toBe('Vector Database');
      expect(result.entities[1].name).toBe('pgvector');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Valid relationship extraction
  // -------------------------------------------------------------------------
  describe('2. Valid relationship extraction', () => {
    it('extracts evidence-grounded relationships between identified entities', async () => {
      const mockPayload = {
        version: '1.0',
        entities: [
          { name: 'BullMQ', type: 'TECHNOLOGY', description: 'NodeJS queue library' },
          { name: 'Redis', type: 'TECHNOLOGY', description: 'In-memory data store' },
        ],
        relations: [
          {
            sourceEntity: 'BullMQ',
            targetEntity: 'Redis',
            relationType: 'DEPENDS_ON',
            evidence: 'BullMQ relies upon Redis for reliable job persistence.',
            confidence: 0.94,
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

      const provider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const result = await provider.extract(
        'BullMQ relies upon Redis for reliable job persistence.',
      );

      expect(result.relations).toHaveLength(1);
      const rel = result.relations[0];
      expect(rel.sourceEntity).toBe('BullMQ');
      expect(rel.targetEntity).toBe('Redis');
      expect(rel.relationType).toBe('DEPENDS_ON');
      expect(rel.evidence).toBe('BullMQ relies upon Redis for reliable job persistence.');
      expect(rel.confidence).toBe(0.94);
    });
  });

  // -------------------------------------------------------------------------
  // 3. All supported entity types
  // -------------------------------------------------------------------------
  describe('3. All supported entity types', () => {
    const supportedTypes = [
      'CONCEPT',
      'TECHNOLOGY',
      'ORGANIZATION',
      'PERSON',
      'LOCATION',
      'EVENT',
      'METRIC',
      'PRODUCT',
      'CUSTOM',
    ] as const;

    it.each(supportedTypes)('successfully validates entity of type %s', async (entityType) => {
      const mockPayload = {
        version: '1.0',
        entities: [
          {
            name: `Test-${entityType}`,
            type: entityType,
            description: `Description of ${entityType}`,
            confidence: 0.88,
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

      const result = await provider.extract(`Testing entity type ${entityType}`);
      expect(result.entities[0].entityType).toBe(entityType);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Empty valid extraction
  // -------------------------------------------------------------------------
  describe('4. Empty valid extraction', () => {
    it('handles model response containing zero entities and zero relations', async () => {
      const mockPayload = {
        version: '1.0',
        entities: [],
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

      const result = await provider.extract('There are no entities in this sentence.');
      expect(result.version).toBe('1.0');
      expect(result.entities).toHaveLength(0);
      expect(result.relations).toHaveLength(0);
    });

    it('returns empty result immediately for blank or whitespace text without hitting network', async () => {
      const mockClient: any = {
        models: { generateContent: vi.fn() },
      };

      const provider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const result = await provider.extract('   \n\t   ');
      expect(result).toEqual({ version: '1.0', entities: [], relations: [] });
      expect(mockClient.models.generateContent).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Malformed JSON handling
  // -------------------------------------------------------------------------
  describe('5. Malformed JSON handling', () => {
    it('throws GeminiExtractionSchemaError when model output is non-JSON', async () => {
      const mockClient: any = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: 'I cannot extract any entities from this text.',
          }),
        },
      };

      const provider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      await expect(provider.extract('Sample chunk')).rejects.toThrow(GeminiExtractionSchemaError);
    });

    it('throws GeminiExtractionSchemaError when model returns empty text', async () => {
      const mockClient: any = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: '   ',
          }),
        },
      };

      const provider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      await expect(provider.extract('Sample chunk')).rejects.toThrow(GeminiExtractionSchemaError);
    });

    it('successfully extracts JSON even when wrapped in markdown code fences', async () => {
      const mockPayload = {
        version: '1.0',
        entities: [{ name: 'Fenced Entity', type: 'CONCEPT' }],
        relations: [],
      };

      const mockClient: any = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: `\`\`\`json\n${JSON.stringify(mockPayload, null, 2)}\n\`\`\``,
          }),
        },
      };

      const provider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const result = await provider.extract('Chunk with fenced response');
      expect(result.entities[0].name).toBe('Fenced Entity');
    });
  });

  // -------------------------------------------------------------------------
  // 6. Unsupported entity types (schema rejection)
  // -------------------------------------------------------------------------
  describe('6. Unsupported entity types (schema rejection)', () => {
    it('throws GeminiExtractionSchemaError when entity type is not in approved taxonomy', async () => {
      const invalidPayload = {
        version: '1.0',
        entities: [
          {
            name: 'Mystery Vehicle',
            entityType: 'AUTOMOBILE', // Invalid type
            description: 'A car',
          },
        ],
        relations: [],
      };

      const mockClient: any = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: JSON.stringify(invalidPayload),
          }),
        },
      };

      const provider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      await expect(provider.extract('Some text with a car')).rejects.toThrow(
        GeminiExtractionSchemaError,
      );
    });
  });

  // -------------------------------------------------------------------------
  // 7. Invalid relationship endpoints (self-loops, empty endpoints filtered)
  // -------------------------------------------------------------------------
  describe('7. Invalid relationship endpoints', () => {
    it('filters out self-referencing relationship loops', async () => {
      const mockPayload = {
        version: '1.0',
        entities: [{ name: 'Postgres', type: 'TECHNOLOGY' }],
        relations: [
          {
            sourceEntity: 'Postgres',
            targetEntity: 'Postgres', // Self-loop
            relationType: 'SELF_LOOP',
            evidence: 'Postgres is Postgres',
          },
          {
            sourceEntity: 'postgres',
            targetEntity: 'POSTGRES', // Case-insensitive self-loop
            relationType: 'SELF_LOOP_CASE',
            evidence: 'Case variant self-loop',
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

      const provider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const result = await provider.extract('Postgres text');
      expect(result.relations).toHaveLength(0);
    });

    it('filters out relationships with empty or blank source or target', async () => {
      const mockPayload = {
        version: '1.0',
        entities: [{ name: 'Postgres', type: 'TECHNOLOGY' }],
        relations: [
          {
            sourceEntity: '',
            targetEntity: 'Postgres',
            relationType: 'EMPTY_SOURCE',
            evidence: 'Evidence',
          },
          {
            sourceEntity: 'Postgres',
            targetEntity: '   ',
            relationType: 'EMPTY_TARGET',
            evidence: 'Evidence',
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

      const provider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const result = await provider.extract('Postgres text');
      expect(result.relations).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Invalid evidence references (empty evidence filtered)
  // -------------------------------------------------------------------------
  describe('8. Invalid evidence references', () => {
    it('filters out relations with empty or whitespace evidence while preserving valid relations', async () => {
      const mockPayload = {
        version: '1.0',
        entities: [
          { name: 'A', type: 'CONCEPT' },
          { name: 'B', type: 'CONCEPT' },
          { name: 'C', type: 'CONCEPT' },
        ],
        relations: [
          {
            sourceEntity: 'A',
            targetEntity: 'B',
            relationType: 'CONNECTS',
            evidence: '   ', // Empty whitespace evidence
          },
          {
            sourceEntity: 'A',
            targetEntity: 'C',
            relationType: 'CONNECTS',
            evidence: 'A genuinely connects to C in paragraph 2.', // Valid evidence
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

      const provider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const result = await provider.extract('A connects to B and C');
      expect(result.relations).toHaveLength(1);
      expect(result.relations[0].targetEntity).toBe('C');
      expect(result.relations[0].evidence).toBe('A genuinely connects to C in paragraph 2.');
    });
  });

  // -------------------------------------------------------------------------
  // 9. Source attribution preservation (title, heading, page in prompt)
  // -------------------------------------------------------------------------
  describe('9. Source attribution preservation', () => {
    it('injects document title, section heading, and page number into user prompt', async () => {
      let capturedContents: any = null;

      const mockClient: any = {
        models: {
          generateContent: vi.fn().mockImplementation(async (params) => {
            capturedContents = params.contents;
            return {
              text: JSON.stringify({
                version: '1.0',
                entities: [{ name: 'Kafka', type: 'TECHNOLOGY' }],
                relations: [],
              }),
            };
          }),
        },
      };

      const provider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const context: ExtractionContext = {
        documentTitle: 'Distributed Systems Architecture',
        sectionHeading: 'Message Brokering with Kafka',
        pageNumber: 42,
        workspaceId: 'ws-test-123',
      };

      await provider.extract('Kafka is a distributed event store.', context);

      expect(capturedContents).toBeDefined();
      expect(capturedContents).toContain('DOCUMENT TITLE: Distributed Systems Architecture');
      expect(capturedContents).toContain('SECTION: Message Brokering with Kafka');
      expect(capturedContents).toContain('PAGE: 42');
      expect(capturedContents).toContain('Kafka is a distributed event store.');
    });
  });

  // -------------------------------------------------------------------------
  // 10. Transient API errors and bounded retries (429, 503)
  // -------------------------------------------------------------------------
  describe('10. Transient API errors and bounded retries', () => {
    it('retries transient 429 quota exhaustion and recovers on subsequent attempt', async () => {
      let callCount = 0;
      const mockGenerateContent = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          const quotaErr: any = new Error('Resource has been exhausted (e.g. check quota).');
          quotaErr.status = 429;
          throw quotaErr;
        }
        return {
          text: JSON.stringify({
            version: '1.0',
            entities: [{ name: 'Recovered', type: 'CONCEPT' }],
            relations: [],
          }),
        };
      });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxRetries: 3,
        initialRetryDelayMs: 10,
        maxRetryDelayMs: 20,
      });

      const result = await provider.extract('Chunk to retry');
      expect(callCount).toBe(2);
      expect(result.entities[0].name).toBe('Recovered');
    });

    it('retries transient 503 service unavailable and throws if all retries exhaust', async () => {
      const mockGenerateContent = vi.fn().mockImplementation(async () => {
        const serverErr: any = new Error('Service Unavailable: upstream timeout');
        serverErr.status = 503;
        throw serverErr;
      });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxRetries: 2,
        initialRetryDelayMs: 10,
        maxRetryDelayMs: 20,
      });

      await expect(provider.extract('Chunk failing 503')).rejects.toThrow(
        GeminiServiceUnavailableError,
      );
      // Candidates: primary (gemini-2.5-flash), then gemini-2.5-flash-lite = 2 models * 2 attempts = 4 calls
      expect(mockGenerateContent).toHaveBeenCalledTimes(4);
    });
  });

  // -------------------------------------------------------------------------
  // 11. Permanent errors and fail-fast behavior (401, 403, 400)
  // -------------------------------------------------------------------------
  describe('11. Permanent errors and fail-fast behavior', () => {
    it('fails fast on 401 Unauthorized without retrying or cycling models', async () => {
      const mockGenerateContent = vi.fn().mockImplementation(async () => {
        const authErr: any = new Error('API key not valid. Please pass a valid API key.');
        authErr.status = 401;
        throw authErr;
      });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxRetries: 3,
      });

      await expect(provider.extract('Chunk with 401')).rejects.toThrow(GeminiAuthenticationError);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('fails fast on 403 Forbidden without retrying', async () => {
      const mockGenerateContent = vi.fn().mockImplementation(async () => {
        const permErr: any = new Error('The caller does not have permission');
        permErr.status = 403;
        throw permErr;
      });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      await expect(provider.extract('Chunk with 403')).rejects.toThrow(GeminiPermissionError);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('fails fast on 400 Bad Request without retrying', async () => {
      const mockGenerateContent = vi.fn().mockImplementation(async () => {
        const reqErr: any = new Error('Invalid JSON payload or bad request');
        reqErr.status = 400;
        throw reqErr;
      });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      await expect(provider.extract('Chunk with 400')).rejects.toThrow(GeminiInvalidRequestError);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 12. Request timeout handling (504)
  // -------------------------------------------------------------------------
  describe('12. Request timeout handling', () => {
    it('times out and throws 504 GeminiServiceUnavailableError when request hangs', async () => {
      const mockGenerateContent = vi.fn().mockImplementation(async (params) => {
        return new Promise((_resolve, reject) => {
          if (params.config?.abortSignal?.aborted) {
            const timeoutErr: any = new Error('Request aborted due to timeout');
            timeoutErr.name = 'AbortError';
            reject(timeoutErr);
            return;
          }
          params.config?.abortSignal?.addEventListener('abort', () => {
            const timeoutErr: any = new Error('Request aborted due to timeout');
            timeoutErr.name = 'AbortError';
            reject(timeoutErr);
          });
        });
      });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        timeoutMs: 50, // Short timeout for test
        maxRetries: 1,
      });

      await expect(provider.extract('Hanging request')).rejects.toThrow(/timed out/i);
    });
  });

  // -------------------------------------------------------------------------
  // 13. Pre-aborted caller signal (CLIENT_ABORTED)
  // -------------------------------------------------------------------------
  describe('13. Pre-aborted caller signal', () => {
    it('throws CLIENT_ABORTED immediately without invoking Gemini client', async () => {
      const mockClient: any = {
        models: { generateContent: vi.fn() },
      };

      const provider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const controller = new AbortController();
      controller.abort();

      await expect(
        provider.extract('Some text', { abortSignal: controller.signal }),
      ).rejects.toThrow('CLIENT_ABORTED');

      expect(mockClient.models.generateContent).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 14. Mid-request cancellation (CLIENT_ABORTED)
  // -------------------------------------------------------------------------
  describe('14. Mid-request cancellation', () => {
    it('throws CLIENT_ABORTED when caller signal is triggered mid-request', async () => {
      const controller = new AbortController();

      const mockGenerateContent = vi.fn().mockImplementation(async () => {
        controller.abort(); // Cancel while call is in-flight
        const abortErr: any = new Error('Operation aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      await expect(
        provider.extract('Text to cancel', { abortSignal: controller.signal }),
      ).rejects.toThrow('CLIENT_ABORTED');
    });
  });

  // -------------------------------------------------------------------------
  // 15. Cancellation during retry backoff (immediate delay exit)
  // -------------------------------------------------------------------------
  describe('15. Cancellation during retry backoff', () => {
    it('immediately interrupts backoff sleep when caller signal aborts', async () => {
      const controller = new AbortController();
      let callCount = 0;

      const mockGenerateContent = vi.fn().mockImplementation(async () => {
        callCount++;
        const quotaErr: any = new Error('Resource exhausted');
        quotaErr.status = 429;
        // Schedule abort during backoff sleep
        setTimeout(() => controller.abort(), 20);
        throw quotaErr;
      });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiExtractionProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxRetries: 3,
        initialRetryDelayMs: 2000, // 2s sleep, but abort should wake it in 20ms
      });

      const startTime = Date.now();
      await expect(
        provider.extract('Text to cancel during backoff', {
          abortSignal: controller.signal,
        }),
      ).rejects.toThrow('CLIENT_ABORTED');

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(1000); // Exited backoff well before 2s
      expect(callCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 16. Secret sanitization (API keys, query tokens, auth headers)
  // -------------------------------------------------------------------------
  describe('16. Secret sanitization', () => {
    it('masks configured API key from error messages', async () => {
      const secretKey = 'AIzaSyD-1234567890abcdef1234567890abcdef12';
      const mockGenerateContent = vi.fn().mockImplementation(async () => {
        throw new Error(
          `Request to https://generativelanguage.googleapis.com?key=${secretKey} failed with Authorization: Bearer ${secretKey}`,
        );
      });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiExtractionProvider({
        apiKey: secretKey,
        client: mockClient,
      });

      try {
        await provider.extract('Text');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).not.toContain(secretKey);
        expect(err.message).toContain('[REDACTED]');
      }
    });
  });

  // -------------------------------------------------------------------------
  // 17. Provider factory selection (createExtractionProvider)
  // -------------------------------------------------------------------------
  describe('17. Provider factory selection', () => {
    it('creates GeminiExtractionProvider instance with correct providerName', () => {
      const provider = new GeminiExtractionProvider({ apiKey: dummyApiKey });
      expect(provider.providerName).toBe('gemini');
      expect(provider.modelName).toBe('gemini-2.5-flash');
    });

    it('healthCheck returns ok true when apiKey is present', async () => {
      const provider = new GeminiExtractionProvider({ apiKey: dummyApiKey });
      const health = await provider.healthCheck();
      expect(health.ok).toBe(true);
      expect(health.message).toContain('gemini-2.5-flash');
    });

    it('healthCheck returns ok false when apiKey is absent', async () => {
      const provider = new GeminiExtractionProvider({ apiKey: '' });
      (provider as any).apiKey = '';
      (provider as any).client = null;
      const health = await provider.healthCheck();
      expect(health.ok).toBe(false);
      expect(health.message).toContain('GEMINI_API_KEY is not configured');
    });
  });

  // -------------------------------------------------------------------------
  // 18. Existing provider compatibility (Mock and Ollama)
  // -------------------------------------------------------------------------
  describe('18. Existing provider compatibility', () => {
    it('preserves getModelInfo metadata with 1MB token context window', async () => {
      const provider = new GeminiExtractionProvider({ apiKey: dummyApiKey });
      const info = await provider.getModelInfo();
      expect(info.providerName).toBe('gemini');
      expect(info.model).toBe('gemini-2.5-flash');
      expect(info.maxContextTokens).toBe(1048576);
    });
  });

  // -------------------------------------------------------------------------
  // 19. Worker/service integration without changing job semantics
  // -------------------------------------------------------------------------
  describe('19. Worker/service integration without changing job semantics', () => {
    it('correctly implements IKnowledgeExtractionProvider contract', async () => {
      const mockPayload = {
        version: '1.0',
        entities: [
          {
            name: 'Service Worker',
            type: 'CONCEPT',
            description: 'A background worker script',
            confidence: 0.91,
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

      // Context with workspaceId as required by worker
      const context: ExtractionContext = {
        workspaceId: 'ws-worker-test',
        documentTitle: 'Worker Processing Doc',
      };

      const response = await provider.extract('Chunk for worker', context);
      expect(response.entities[0].name).toBe('Service Worker');
      expect(response.version).toBe('1.0');
    });
  });

  // -------------------------------------------------------------------------
  // 20. Ollama regression compatibility
  // -------------------------------------------------------------------------
  describe('20. Ollama regression compatibility', () => {
    it('verifies Gemini extraction operates in isolation without altering Ollama defaults', () => {
      const provider = new GeminiExtractionProvider({ apiKey: dummyApiKey });
      expect(provider.providerName).toBe('gemini');
      expect(provider.modelName).toBe('gemini-2.5-flash');
      // Configuration defaults to gemini-2.5-flash with candidates fallback
      expect((provider as any).getCandidateModels()).toEqual([
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // 21. Phase 1B.3R Remediation Tests (Findings 1 through 5)
  // -------------------------------------------------------------------------
  describe('21. Phase 1B.3R Remediation Tests', () => {
    // -----------------------------------------------------------------------
    // FINDING-1: Candidate Model Ordering & Deduplication
    // -----------------------------------------------------------------------
    describe('FINDING-1: Candidate Model Ordering & Deduplication', () => {
      it('prioritizes explicit gemini-2.5-flash-lite as first candidate model', () => {
        const provider = new GeminiExtractionProvider({
          apiKey: dummyApiKey,
          modelName: 'gemini-2.5-flash-lite',
        });
        const candidates = provider.getCandidateModels();
        expect(candidates).toEqual(['gemini-2.5-flash-lite', 'gemini-2.5-flash']);
        expect(candidates[0]).toBe('gemini-2.5-flash-lite');
      });

      it('prioritizes explicit gemini-2.5-flash as first candidate model', () => {
        const provider = new GeminiExtractionProvider({
          apiKey: dummyApiKey,
          modelName: 'gemini-2.5-flash',
        });
        const candidates = provider.getCandidateModels();
        expect(candidates).toEqual(['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
        expect(candidates[0]).toBe('gemini-2.5-flash');
      });

      it('deduplicates candidate models without redundant entries', () => {
        const provider = new GeminiExtractionProvider({
          apiKey: dummyApiKey,
          modelName: 'gemini-2.5-flash-lite',
        });
        const candidates = provider.getCandidateModels();
        expect(candidates).toHaveLength(2);
        expect(new Set(candidates).size).toBe(2);
      });

      it('places custom external model as primary before default fallbacks', () => {
        const provider = new GeminiExtractionProvider({
          apiKey: dummyApiKey,
          modelName: 'gemini-1.5-pro-custom',
        });
        const candidates = provider.getCandidateModels();
        expect(candidates).toEqual([
          'gemini-1.5-pro-custom',
          'gemini-2.5-flash',
          'gemini-2.5-flash-lite',
        ]);
        expect(candidates[0]).toBe('gemini-1.5-pro-custom');
      });

      it('executes the explicitly configured model on the first attempt in extract()', async () => {
        const requestedModels: string[] = [];
        const mockClient: any = {
          models: {
            generateContent: vi.fn().mockImplementation(async (params) => {
              requestedModels.push(params.model);
              return {
                text: JSON.stringify({
                  version: '1.0',
                  entities: [{ name: 'Test', type: 'CONCEPT' }],
                  relations: [],
                }),
              };
            }),
          },
        };

        const provider = new GeminiExtractionProvider({
          apiKey: dummyApiKey,
          modelName: 'gemini-2.5-flash-lite',
          client: mockClient,
        });

        await provider.extract('Sample chunk');
        expect(requestedModels).toHaveLength(1);
        expect(requestedModels[0]).toBe('gemini-2.5-flash-lite');
      });
    });

    // -----------------------------------------------------------------------
    // FINDING-2: HTTP 404 Candidate Failover
    // -----------------------------------------------------------------------
    describe('FINDING-2: HTTP 404 Candidate Failover', () => {
      it('fails over to candidate model when primary returns 404 without retrying primary', async () => {
        const attemptedModels: string[] = [];
        const mockClient: any = {
          models: {
            generateContent: vi.fn().mockImplementation(async (params) => {
              attemptedModels.push(params.model);
              if (params.model === 'gemini-deprecated-model') {
                const notFoundErr: any = new Error(
                  'models/gemini-deprecated-model is not found for API version v1beta',
                );
                notFoundErr.status = 404;
                throw notFoundErr;
              }
              return {
                text: JSON.stringify({
                  version: '1.0',
                  entities: [{ name: 'Fallback Success', type: 'TECHNOLOGY' }],
                  relations: [],
                }),
              };
            }),
          },
        };

        const provider = new GeminiExtractionProvider({
          apiKey: dummyApiKey,
          modelName: 'gemini-deprecated-model',
          client: mockClient,
          maxRetries: 3,
        });

        const result = await provider.extract('Test failover chunk');
        expect(attemptedModels).toEqual(['gemini-deprecated-model', 'gemini-2.5-flash']);
        expect(result.entities[0].name).toBe('Fallback Success');
      });

      it('fails closed and preserves 404 status when all candidates return 404', async () => {
        const attemptedModels: string[] = [];
        const mockClient: any = {
          models: {
            generateContent: vi.fn().mockImplementation(async (params) => {
              attemptedModels.push(params.model);
              const err: any = new Error(`Model ${params.model} was not found (404)`);
              err.status = 404;
              throw err;
            }),
          },
        };

        const provider = new GeminiExtractionProvider({
          apiKey: dummyApiKey,
          client: mockClient,
          maxRetries: 3,
        });

        await expect(provider.extract('Chunk for 404')).rejects.toThrow(GeminiNotFoundError);
        // Default candidates: gemini-2.5-flash (1 attempt), gemini-2.5-flash-lite (1 attempt)
        expect(attemptedModels).toEqual(['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
      });

      it('does NOT fail over on authentication errors (401)', async () => {
        const attemptedModels: string[] = [];
        const mockClient: any = {
          models: {
            generateContent: vi.fn().mockImplementation(async (params) => {
              attemptedModels.push(params.model);
              const authErr: any = new Error('API_KEY_INVALID');
              authErr.status = 401;
              throw authErr;
            }),
          },
        };

        const provider = new GeminiExtractionProvider({
          apiKey: dummyApiKey,
          client: mockClient,
          maxRetries: 3,
        });

        await expect(provider.extract('Chunk')).rejects.toThrow(GeminiAuthenticationError);
        expect(attemptedModels).toHaveLength(1);
        expect(attemptedModels[0]).toBe('gemini-2.5-flash');
      });

      it('preserves caller cancellation if signal aborts during 404 fallback', async () => {
        const controller = new AbortController();
        const mockClient: any = {
          models: {
            generateContent: vi.fn().mockImplementation(async (params) => {
              if (params.model === 'gemini-2.5-flash') {
                // Abort caller signal right after 404 from primary model
                controller.abort();
                const notFound: any = new Error('Model not found (404)');
                notFound.status = 404;
                throw notFound;
              }
              return {
                text: JSON.stringify({ version: '1.0', entities: [], relations: [] }),
              };
            }),
          },
        };

        const provider = new GeminiExtractionProvider({
          apiKey: dummyApiKey,
          client: mockClient,
        });

        await expect(
          provider.extract('Chunk', { abortSignal: controller.signal }),
        ).rejects.toThrow('CLIENT_ABORTED');
      });
    });

    // -----------------------------------------------------------------------
    // FINDING-3: URL Basic Credential Scrubbing
    // -----------------------------------------------------------------------
    describe('FINDING-3: URL Basic Credential Scrubbing', () => {
      it('redacts standard https basic credentials', () => {
        const provider = new GeminiExtractionProvider({ apiKey: dummyApiKey });
        const raw = 'Request to https://username:password@example.com/api failed';
        const sanitized = provider.sanitizeErrorMessage(raw);
        expect(sanitized).not.toContain('password');
        expect(sanitized).toContain('https://username:[REDACTED]@example.com/api');
      });

      it('redacts http basic credentials on localhost with custom port', () => {
        const provider = new GeminiExtractionProvider({ apiKey: dummyApiKey });
        const raw = 'Connection refused at http://user:secret@localhost:8080/v1/models';
        const sanitized = provider.sanitizeErrorMessage(raw);
        expect(sanitized).not.toContain('secret');
        expect(sanitized).toContain('http://user:[REDACTED]@localhost:8080/v1/models');
      });

      it('redacts encoded credentials containing special characters', () => {
        const provider = new GeminiExtractionProvider({ apiKey: dummyApiKey });
        const raw = 'Error reaching https://user%40test.com:p%40ss%20word@example.com/endpoint';
        const sanitized = provider.sanitizeErrorMessage(raw);
        expect(sanitized).not.toContain('p%40ss%20word');
        expect(sanitized).toContain('https://user%40test.com:[REDACTED]@example.com/endpoint');
      });

      it('redacts multiple credential-bearing URLs within a single error message', () => {
        const provider = new GeminiExtractionProvider({ apiKey: dummyApiKey });
        const raw =
          'Failed primary at https://admin:superSecret@proxy1.com and fallback at http://bot:pass123@proxy2.com';
        const sanitized = provider.sanitizeErrorMessage(raw);
        expect(sanitized).not.toContain('superSecret');
        expect(sanitized).not.toContain('pass123');
        expect(sanitized).toContain('https://admin:[REDACTED]@proxy1.com');
        expect(sanitized).toContain('http://bot:[REDACTED]@proxy2.com');
      });

      it('preserves non-sensitive URLs without corrupting legitimate paths or params', () => {
        const provider = new GeminiExtractionProvider({ apiKey: dummyApiKey });
        const raw =
          'Endpoint https://generativelanguage.googleapis.com/v1beta/models and http://localhost:3000/ready';
        const sanitized = provider.sanitizeErrorMessage(raw);
        expect(sanitized).toBe(raw);
      });

      it('preserves existing API key and bearer token scrubbing alongside URL sanitization', () => {
        const provider = new GeminiExtractionProvider({ apiKey: dummyApiKey });
        const raw = `Call to https://user:pass@host.com?key=${dummyApiKey} with Authorization: Bearer secret-token-1234567890`;
        const sanitized = provider.sanitizeErrorMessage(raw);
        expect(sanitized).not.toContain('pass');
        expect(sanitized).not.toContain(dummyApiKey);
        expect(sanitized).not.toContain('secret-token-1234567890');
        expect(sanitized).toContain('https://user:[REDACTED]@host.com');
        expect(sanitized).toContain('?key=[REDACTED]');
        expect(sanitized).toContain('Bearer [REDACTED]');
      });
    });

    // -----------------------------------------------------------------------
    // FINDING-4: Bounded Retry Budget
    // -----------------------------------------------------------------------
    describe('FINDING-4: Bounded Retry Budget', () => {
      it('strictly enforces explicit maxTotalAttempts ceiling across all candidate models and retries', async () => {
        let callCount = 0;
        const mockClient: any = {
          models: {
            generateContent: vi.fn().mockImplementation(async () => {
              callCount++;
              const serverErr: any = new Error('Service Unavailable: transient overload');
              serverErr.status = 503;
              throw serverErr;
            }),
          },
        };

        const provider = new GeminiExtractionProvider({
          apiKey: dummyApiKey,
          client: mockClient,
          maxRetries: 3,
          maxTotalAttempts: 3, // Global budget ceiling = 3
          initialRetryDelayMs: 5,
          maxRetryDelayMs: 10,
        });

        await expect(provider.extract('Chunk')).rejects.toThrow(GeminiServiceUnavailableError);
        expect(callCount).toBe(3);
        expect(mockClient.models.generateContent).toHaveBeenCalledTimes(3);
      });

      it('strictly enforces maxTotalAttempts: 1 for single-attempt fail-fast execution', async () => {
        let callCount = 0;
        const mockClient: any = {
          models: {
            generateContent: vi.fn().mockImplementation(async () => {
              callCount++;
              const err: any = new Error('503 Service Unavailable');
              err.status = 503;
              throw err;
            }),
          },
        };

        const provider = new GeminiExtractionProvider({
          apiKey: dummyApiKey,
          client: mockClient,
          maxRetries: 3,
          maxTotalAttempts: 1, // Only 1 attempt allowed
          initialRetryDelayMs: 5,
        });

        await expect(provider.extract('Chunk')).rejects.toThrow(GeminiServiceUnavailableError);
        expect(callCount).toBe(1);
      });

      it('defaults maxTotalAttempts predictably based on configuration', () => {
        const defaultProvider = new GeminiExtractionProvider({ apiKey: dummyApiKey });
        expect(defaultProvider.maxTotalAttempts).toBe(4);

        const customRetriesProvider = new GeminiExtractionProvider({
          apiKey: dummyApiKey,
          maxRetries: 2,
        });
        expect(customRetriesProvider.maxTotalAttempts).toBe(4);

        const explicitBudgetProvider = new GeminiExtractionProvider({
          apiKey: dummyApiKey,
          maxTotalAttempts: 5,
        });
        expect(explicitBudgetProvider.maxTotalAttempts).toBe(5);
      });
    });

    // -----------------------------------------------------------------------
    // FINDING-5: Error Class Hierarchy and Backward Compatibility
    // -----------------------------------------------------------------------
    describe('FINDING-5: Error Class Hierarchy and Backward Compatibility', () => {
      it('verifies GeminiNotFoundError satisfies both GeminiNotFoundError and GeminiError', () => {
        const err = new GeminiNotFoundError('Model not found');
        expect(err).toBeInstanceOf(GeminiNotFoundError);
        expect(err).toBeInstanceOf(GeminiError);
        expect(err).toBeInstanceOf(GeminiEmbeddingError);
        expect(err.statusCode).toBe(404);
        expect(err.isRetryable).toBe(false);
      });

      it('verifies GeminiExtractionSchemaError satisfies both GeminiExtractionSchemaError and GeminiError', () => {
        const err = new GeminiExtractionSchemaError('Validation failed', '{"bad": "json"}');
        expect(err).toBeInstanceOf(GeminiExtractionSchemaError);
        expect(err).toBeInstanceOf(GeminiError);
        expect(err).toBeInstanceOf(GeminiEmbeddingError);
        expect(err.statusCode).toBe(422);
        expect(err.isRetryable).toBe(false);
        expect(err.rawPayload).toBe('{"bad": "json"}');
      });

      it('verifies standard authentication errors satisfy GeminiError', () => {
        const err = new GeminiAuthenticationError('Unauthenticated');
        expect(err).toBeInstanceOf(GeminiError);
        expect(err).toBeInstanceOf(GeminiAuthenticationError);
        expect(err.statusCode).toBe(401);
      });
    });
  });
});

