/**
 * MindVault — Phase 1B.2: GeminiGenerationProvider Unit & Integration Tests
 *
 * Exhaustive test coverage verifying all 21 mandatory test categories:
 * 1. Successful non-streaming generation.
 * 2. Successful streaming generation.
 * 3. Correct incremental token delivery.
 * 4. Correct chunk ordering.
 * 5. System instruction preservation.
 * 6. Conversation message mapping.
 * 7. RAG context preservation.
 * 8. GraphRAG context preservation.
 * 9. Maximum output token configuration.
 * 10. Context overflow / max tokens handling.
 * 11. Empty response handling.
 * 12. Authentication failures (401).
 * 13. HTTP 429 quota exhaustion and retry recovery.
 * 14. Transient 5xx behavior.
 * 15. Request timeout handling.
 * 16. Client cancellation (AbortSignal).
 * 17. Stream interruption.
 * 18. Prevention of duplicate completion events.
 * 19. Prevention of retries after partial output.
 * 20. API key and sensitive content masking.
 * 21. Ollama regression compatibility.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GeminiGenerationProvider,
  GeminiAuthenticationError,
  GeminiPermissionError,
  GeminiQuotaExhaustedError,
  GeminiServiceUnavailableError,
  GeminiInvalidRequestError,
} from '../gemini-generation.provider.js';
import type { LLMProvider } from '../../types.js';

describe('GeminiGenerationProvider (Phase 1B.2)', () => {
  const dummyApiKey = 'AIzaSyD-1234567890abcdef1234567890abcdef12';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Successful non-streaming generation', () => {
    it('generates a complete evidence-grounded response with usage metadata', async () => {
      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: 'Supervised learning inference grounded in document [S1].',
        usageMetadata: {
          promptTokenCount: 120,
          candidatesTokenCount: 18,
        },
        candidates: [{ finishReason: 'STOP' }],
      });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const result = await provider.generate('What is supervised learning?');

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(result.text).toBe('Supervised learning inference grounded in document [S1].');
      expect(result.promptTokens).toBe(120);
      expect(result.outputTokens).toBe(18);
      expect(result.finishReason).toBe('stop');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('2. Successful streaming generation', () => {
    it('streams tokens through AsyncIterable and yields finish chunk', async () => {
      const streamChunks = [
        { text: 'Supervised ' },
        { text: 'learning ' },
        { text: 'inference [S1].' },
      ];

      async function* mockStream() {
        for (const c of streamChunks) {
          yield c;
        }
      }

      const mockClient: any = {
        models: {
          generateContentStream: vi.fn().mockResolvedValue(mockStream()),
        },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const chunks: string[] = [];
      let completionEncountered = false;

      for await (const chunk of provider.generateStream('Explain RAG')) {
        if (!chunk.isFinished) {
          chunks.push(chunk.text);
        } else {
          completionEncountered = true;
          expect(chunk.finishReason).toBe('stop');
        }
      }

      expect(chunks.join('')).toBe('Supervised learning inference [S1].');
      expect(completionEncountered).toBe(true);
    });
  });

  describe('3. Correct incremental token delivery', () => {
    it('yields each token chunk incrementally as it arrives from the SDK', async () => {
      const tokens = ['MindVault ', 'is ', 'an ', 'AI-powered ', 'knowledge ', 'engine.'];

      async function* mockStream() {
        for (const t of tokens) {
          yield { text: t };
        }
      }

      const mockClient: any = {
        models: {
          generateContentStream: vi.fn().mockResolvedValue(mockStream()),
        },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const received: string[] = [];
      for await (const chunk of provider.generateStream('Query')) {
        if (!chunk.isFinished) {
          received.push(chunk.text);
        }
      }

      expect(received).toEqual(tokens);
      expect(received).toHaveLength(6);
    });
  });

  describe('4. Correct chunk ordering', () => {
    it('strictly preserves the sequence of chunks from the upstream model', async () => {
      const sequence = ['1', '2', '3', '4', '5'];
      async function* mockStream() {
        for (const num of sequence) {
          yield { text: num };
        }
      }

      const mockClient: any = {
        models: {
          generateContentStream: vi.fn().mockResolvedValue(mockStream()),
        },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const outputSequence: string[] = [];
      for await (const chunk of provider.generateStream('Count')) {
        if (chunk.text) {
          outputSequence.push(chunk.text);
        }
      }

      expect(outputSequence).toEqual(sequence);
    });
  });

  describe('5. System instruction preservation', () => {
    it('passes systemPrompt to config.systemInstruction without mixing into contents', async () => {
      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: 'Answer with pirate tone [S1].',
        candidates: [{ finishReason: 'STOP' }],
      });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const systemPrompt = 'You are a pirate AI assistant.';
      const userPrompt = 'Summarize quantum mechanics.';

      await provider.generate(userPrompt, { systemPrompt });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: [userPrompt],
          config: expect.objectContaining({
            systemInstruction: systemPrompt,
          }),
        }),
      );
    });
  });

  describe('6. Conversation message mapping', () => {
    it('handles multi-turn conversational prompts and history context safely', async () => {
      const multiTurnPrompt = [
        '<conversation_history>',
        'User: Hello',
        'Assistant: Hi! How can I help?',
        '</conversation_history>',
        'User: What did I just say?',
      ].join('\n');

      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: 'You just asked what you said.',
        candidates: [{ finishReason: 'STOP' }],
      });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const result = await provider.generate(multiTurnPrompt);
      expect(result.text).toBe('You just asked what you said.');
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: [multiTurnPrompt],
        }),
      );
    });
  });

  describe('7. RAG context preservation', () => {
    it('preserves evidence XML blocks and source tags without mutation', async () => {
      const ragPrompt = [
        'QUESTION: How does neural backpropagation work?',
        '<evidence>',
        '--- SOURCE [S1] (Title: Deep Learning.pdf, Page: 42) ---',
        'Backpropagation calculates gradients of loss with respect to weights using the chain rule.',
        '</evidence>',
      ].join('\n');

      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: 'Backpropagation computes loss gradients via chain rule [S1].',
        candidates: [{ finishReason: 'STOP' }],
      });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      await provider.generate(ragPrompt);

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: [ragPrompt],
        }),
      );
    });
  });

  describe('8. GraphRAG context preservation', () => {
    it('preserves knowledge graph relationships and entity facts in prompt', async () => {
      const graphRAGPrompt = [
        'QUESTION: Who founded MindVault?',
        '<knowledge_graph>',
        'Entity: Alice -> FOUNDED -> MindVault [G1]',
        'Entity: Alice -> ROLE -> Chief Architect [G2]',
        '</knowledge_graph>',
        '<evidence>',
        '--- SOURCE [S1] ---',
        'Alice founded MindVault in 2026.',
        '</evidence>',
      ].join('\n');

      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: 'Alice founded MindVault and acts as Chief Architect [G1, S1].',
        candidates: [{ finishReason: 'STOP' }],
      });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      await provider.generate(graphRAGPrompt);
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: [graphRAGPrompt],
        }),
      );
    });
  });

  describe('9. Maximum output token configuration', () => {
    it('correctly passes maxTokens and temperature to config', async () => {
      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: 'Short answer.',
        candidates: [{ finishReason: 'STOP' }],
      });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      await provider.generate('Prompt', {
        maxTokens: 512,
        temperature: 0.7,
      });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            maxOutputTokens: 512,
            temperature: 0.7,
          }),
        }),
      );
    });
  });

  describe('10. Context overflow / finishReason handling', () => {
    it('captures MAX_TOKENS finishReason accurately in non-streaming result', async () => {
      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: 'Truncated response due to output token limit...',
        candidates: [{ finishReason: 'MAX_TOKENS' }],
      });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const res = await provider.generate('Generate very long essay');
      expect(res.finishReason).toBe('max_tokens');
    });

    it('captures finishReason in final streaming chunk', async () => {
      async function* mockStream() {
        yield { text: 'Some text', candidates: [{ finishReason: 'MAX_TOKENS' }] };
      }

      const mockClient: any = {
        models: {
          generateContentStream: vi.fn().mockResolvedValue(mockStream()),
        },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      let finalReason = '';
      for await (const chunk of provider.generateStream('Generate')) {
        if (chunk.isFinished) {
          finalReason = chunk.finishReason || '';
        }
      }

      expect(finalReason).toBe('max_tokens');
    });
  });

  describe('11. Empty response handling', () => {
    it('handles empty response text without crashing', async () => {
      const mockGenerateContent = vi.fn().mockResolvedValue({
        text: '',
        candidates: [{ finishReason: 'STOP' }],
      });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const res = await provider.generate('Empty query');
      expect(res.text).toBe('');
      expect(res.finishReason).toBe('stop');
    });

    it('rejects empty string prompt before sending network request', async () => {
      const mockClient: any = { models: { generateContent: vi.fn() } };
      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      await expect(provider.generate('')).rejects.toThrow(GeminiInvalidRequestError);
      await expect(provider.generate('   ')).rejects.toThrow(GeminiInvalidRequestError);
      expect(mockClient.models.generateContent).not.toHaveBeenCalled();
    });
  });

  describe('12. Authentication failures (401)', () => {
    it('fails fast on 401 without retrying or switching models', async () => {
      const authError = {
        status: 401,
        message: 'API_KEY_INVALID: API key not valid.',
      };

      const mockGenerateContent = vi.fn().mockRejectedValue(authError);
      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxRetries: 3,
      });

      await expect(provider.generate('Test auth')).rejects.toThrow(GeminiAuthenticationError);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('fails fast on 403 Permission Denied without retrying', async () => {
      const permError = {
        status: 403,
        message: 'PERMISSION_DENIED: Generative Language API is not enabled.',
      };

      const mockGenerateContent = vi.fn().mockRejectedValue(permError);
      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxRetries: 3,
      });

      await expect(provider.generate('Test perm')).rejects.toThrow(GeminiPermissionError);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });
  });

  describe('13. HTTP 429 quota exhaustion and retry recovery', () => {
    it('retries on 429 and recovers when subsequent attempt succeeds', async () => {
      const rateLimitError = {
        status: 429,
        message: 'RESOURCE_EXHAUSTED: Rate limit exceeded.',
      };

      const mockGenerateContent = vi
        .fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({
          text: 'Success after retry [S1].',
          candidates: [{ finishReason: 'STOP' }],
        });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        initialRetryDelayMs: 5,
        maxRetryDelayMs: 15,
      });

      const result = await provider.generate('Retry test');
      expect(result.text).toBe('Success after retry [S1].');
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it('throws GeminiQuotaExhaustedError when 429 persists through retries and candidates', async () => {
      const rateLimitError = {
        status: 429,
        message: 'RESOURCE_EXHAUSTED: Rate limit exceeded.',
      };

      const mockGenerateContent = vi.fn().mockRejectedValue(rateLimitError);
      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxRetries: 2,
        initialRetryDelayMs: 2,
        maxRetryDelayMs: 5,
      });

      await expect(provider.generate('Exhaustion')).rejects.toThrow(GeminiQuotaExhaustedError);
    });

    it('interrupts retry backoff delay immediately when caller signal aborts during delay', async () => {
      const controller = new AbortController();
      let callCount = 0;
      const mockGenerateContent = vi.fn().mockImplementation(async () => {
        callCount++;
        throw { status: 429, message: 'RESOURCE_EXHAUSTED: Rate limit exceeded' };
      });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxRetries: 3,
        initialRetryDelayMs: 4000, // 4-second delay
        maxRetryDelayMs: 8000,
      });

      const startTime = Date.now();
      // Abort after 20ms while in the middle of backoff delay
      setTimeout(() => controller.abort(), 20);

      await expect(
        provider.generate('Test retry abort', { signal: controller.signal }),
      ).rejects.toThrow('CLIENT_ABORTED');

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(1000); // Must resolve immediately, not wait 4000ms
      expect(callCount).toBe(1);
    });

    it('strictly limits retries to maxRetries attempts across candidate models', async () => {
      const mockGenerateContent = vi.fn().mockRejectedValue({
        status: 429,
        message: 'Rate limit exceeded',
      });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxRetries: 2,
        initialRetryDelayMs: 1,
        maxRetryDelayMs: 3,
      });

      // 2 candidate models (gemini-2.5-flash, gemini-2.5-flash-lite) * 2 attempts = 4 total calls
      await expect(provider.generate('Rate limited')).rejects.toThrow(GeminiQuotaExhaustedError);
      expect(mockGenerateContent).toHaveBeenCalledTimes(4);
    });
  });

  describe('14. Transient 5xx behavior', () => {
    it('retries on 503 and succeeds on subsequent attempt', async () => {
      const serverError = {
        status: 503,
        message: 'The model is overloaded. Please try again later.',
      };

      const mockGenerateContent = vi
        .fn()
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({
          text: 'Overload recovered [S1].',
          candidates: [{ finishReason: 'STOP' }],
        });

      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        initialRetryDelayMs: 5,
        maxRetryDelayMs: 15,
      });

      const result = await provider.generate('503 check');
      expect(result.text).toBe('Overload recovered [S1].');
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });
  });

  describe('15. Request timeout handling', () => {
    it('classifies AbortError as 504 timeout error in non-streaming generation', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      const mockGenerateContent = vi.fn().mockRejectedValue(abortError);
      const mockClient: any = {
        models: { generateContent: mockGenerateContent },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        timeoutMs: 500,
        maxRetries: 1,
      });

      await expect(provider.generate('Timeout')).rejects.toThrow(GeminiServiceUnavailableError);
    });
  });

  describe('16. Client cancellation (AbortSignal)', () => {
    it('immediately throws CLIENT_ABORTED when signal is pre-aborted in generate()', async () => {
      const mockClient: any = { models: { generateContent: vi.fn() } };
      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const controller = new AbortController();
      controller.abort();

      await expect(provider.generate('Pre-aborted', { signal: controller.signal })).rejects.toThrow(
        'CLIENT_ABORTED',
      );
      expect(mockClient.models.generateContent).not.toHaveBeenCalled();
    });

    it('immediately returns empty generator when signal is pre-aborted in generateStream()', async () => {
      const mockClient: any = { models: { generateContentStream: vi.fn() } };
      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const controller = new AbortController();
      controller.abort();

      const stream = provider.generateStream('Pre-aborted stream', { signal: controller.signal });
      const chunks: any[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(0);
      expect(mockClient.models.generateContentStream).not.toHaveBeenCalled();
    });

    it('stops emitting tokens mid-stream when AbortSignal triggers', async () => {
      const controller = new AbortController();

      async function* mockStream() {
        yield { text: 'Chunk 1 ' };
        controller.abort(); // Abort after chunk 1
        yield { text: 'Chunk 2 ' };
        yield { text: 'Chunk 3 ' };
      }

      const mockClient: any = {
        models: {
          generateContentStream: vi.fn().mockResolvedValue(mockStream()),
        },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const received: string[] = [];
      for await (const chunk of provider.generateStream('Prompt', { signal: controller.signal })) {
        if (chunk.text) {
          received.push(chunk.text);
        }
      }

      expect(received).toEqual(['Chunk 1 ']);
    });

    it('propagates caller abort to internal SDK abortSignal during token streaming', async () => {
      const callerController = new AbortController();
      let capturedSdkAbortSignal: AbortSignal | undefined;

      const mockGenerateContentStream = vi.fn().mockImplementation(async (args: any) => {
        capturedSdkAbortSignal = args.config?.abortSignal;
        async function* mockStream() {
          yield { text: 'Chunk 1 ' };
          callerController.abort(); // Caller cancels after first chunk
          yield { text: 'Chunk 2 ' };
        }
        return mockStream();
      });

      const mockClient: any = {
        models: { generateContentStream: mockGenerateContentStream },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const received: string[] = [];
      for await (const chunk of provider.generateStream('Test internal abort propagation', {
        signal: callerController.signal,
      })) {
        if (chunk.text) received.push(chunk.text);
      }

      expect(received).toEqual(['Chunk 1 ']);
      expect(capturedSdkAbortSignal).toBeDefined();
      expect(capturedSdkAbortSignal?.aborted).toBe(true);
    });

    it('handles caller cancellation after stream completion without throwing spurious errors', async () => {
      const callerController = new AbortController();

      async function* mockStream() {
        yield { text: 'Complete text ' };
      }

      const mockClient: any = {
        models: {
          generateContentStream: vi.fn().mockResolvedValue(mockStream()),
        },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const chunks: any[] = [];
      for await (const chunk of provider.generateStream('Finished stream', {
        signal: callerController.signal,
      })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some((c) => c.isFinished)).toBe(true);

      // Caller cancels AFTER stream has finished cleanly
      expect(() => callerController.abort()).not.toThrow();
    });

    it('cleans up abort listener on caller signal after normal stream completion', async () => {
      const callerController = new AbortController();
      const addSpy = vi.spyOn(callerController.signal, 'addEventListener');
      const removeSpy = vi.spyOn(callerController.signal, 'removeEventListener');

      async function* mockStream() {
        yield { text: 'Normal text ' };
      }

      const mockClient: any = {
        models: {
          generateContentStream: vi.fn().mockResolvedValue(mockStream()),
        },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      for await (const _ of provider.generateStream('Normal query', {
        signal: callerController.signal,
      })) {
        // consume
      }

      expect(addSpy).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('cleans up abort listener on caller signal after stream error', async () => {
      const callerController = new AbortController();
      const removeSpy = vi.spyOn(callerController.signal, 'removeEventListener');

      const mockClient: any = {
        models: {
          generateContentStream: vi.fn().mockRejectedValue(new Error('Pre-stream failure')),
        },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxRetries: 1,
      });

      try {
        for await (const _ of provider.generateStream('Failing stream', {
          signal: callerController.signal,
        })) {
          // consume
        }
      } catch {
        // Expected error
      }

      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('does not leak event listeners across repeated streams on the same signal', async () => {
      const callerController = new AbortController();
      const removeSpy = vi.spyOn(callerController.signal, 'removeEventListener');

      async function* mockStream() {
        yield { text: 'Token ' };
      }

      const mockClient: any = {
        models: {
          generateContentStream: vi.fn().mockResolvedValue(mockStream()),
        },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      for (let i = 0; i < 5; i++) {
        for await (const _ of provider.generateStream(`Query ${i}`, {
          signal: callerController.signal,
        })) {
          // consume
        }
      }

      expect(removeSpy).toHaveBeenCalledTimes(5);
    });
  });

  describe('17. Stream interruption', () => {
    it('throws stream interrupted error when SDK stream breaks mid-generation', async () => {
      async function* mockBrokenStream() {
        yield { text: 'Starting text... ' };
        throw new Error('Socket closed abruptly by upstream proxy');
      }

      const mockClient: any = {
        models: {
          generateContentStream: vi.fn().mockResolvedValue(mockBrokenStream()),
        },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      const received: string[] = [];
      let thrownError: any = null;

      try {
        for await (const chunk of provider.generateStream('Stream query')) {
          if (chunk.text) {
            received.push(chunk.text);
          }
        }
      } catch (err: any) {
        thrownError = err;
      }

      expect(received).toEqual(['Starting text... ']);
      expect(thrownError).toBeDefined();
      expect(thrownError.message).toContain('Gemini stream interrupted mid-generation');
      expect(thrownError.message).toContain('partial output delivered');
    });
  });

  describe('18. Prevention of duplicate completion events', () => {
    it('yields isFinished: true exactly once across entire stream lifetime', async () => {
      async function* mockStream() {
        yield { text: 'Token 1 ' };
        yield { text: 'Token 2 ' };
      }

      const mockClient: any = {
        models: {
          generateContentStream: vi.fn().mockResolvedValue(mockStream()),
        },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
      });

      let finishEventCount = 0;
      for await (const chunk of provider.generateStream('Test duplicate done')) {
        if (chunk.isFinished) {
          finishEventCount++;
        }
      }

      expect(finishEventCount).toBe(1);
    });
  });

  describe('19. Prevention of retries after partial output', () => {
    it('strictly does NOT retry after partial output has been yielded to caller', async () => {
      let invocationCount = 0;
      const mockGenerateContentStream = vi.fn().mockImplementation(async () => {
        invocationCount++;
        async function* stream() {
          yield { text: 'First partial token delivered. ' };
          throw new Error('503 Service Unavailable');
        }
        return stream();
      });

      const mockClient: any = {
        models: { generateContentStream: mockGenerateContentStream },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxRetries: 3,
      });

      const chunks: string[] = [];
      let caughtError: any = null;

      try {
        for await (const chunk of provider.generateStream('Prompt')) {
          if (chunk.text) chunks.push(chunk.text);
        }
      } catch (err: any) {
        caughtError = err;
      }

      expect(chunks).toEqual(['First partial token delivered. ']);
      expect(caughtError).toBeDefined();
      // Crucial invariant: Must NOT have retried, must be called exactly 1 time!
      expect(invocationCount).toBe(1);
      expect(mockGenerateContentStream).toHaveBeenCalledTimes(1);
    });
  });

  describe('20. API key and sensitive content masking', () => {
    it('masks API key in error messages without leaking secret tokens', async () => {
      const authError = { status: 401, message: 'API_KEY_INVALID' };
      const mockClient: any = {
        models: { generateContent: vi.fn().mockRejectedValue(authError) },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxRetries: 1,
      });

      try {
        await provider.generate('Test secret leakage');
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('AIza...ef12 (length 42)');
        expect(err.message).not.toContain('1234567890abcdef');
      }
    });

    it('redacts Google API keys, query parameter credentials, and Bearer tokens in error messages', async () => {
      const leakyError = {
        status: 502,
        message:
          'Proxy gateway failed: https://proxy.gemini.internal/v1?key=AIzaSyD-1234567890abcdef1234567890abcdef12&token=sec_abc1234567890 with Authorization: Bearer secret-auth-token-12345678',
      };

      const mockClient: any = {
        models: { generateContent: vi.fn().mockRejectedValue(leakyError) },
      };

      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        client: mockClient,
        maxRetries: 1,
      });

      try {
        await provider.generate('Test secret sanitization');
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.message).not.toContain(dummyApiKey);
        expect(err.message).not.toContain('sec_abc1234567890');
        expect(err.message).not.toContain('secret-auth-token-12345678');
        expect(err.message).toContain('[REDACTED]');
      }
    });

    it('healthCheck returns masked warning when API key is missing', async () => {
      const provider = new GeminiGenerationProvider({ apiKey: '' });
      const health = await provider.healthCheck();
      expect(health.ok).toBe(false);
      expect(health.message).toContain('GEMINI_API_KEY is not configured');
    });
  });

  describe('20b. Model configuration integrity (FINDING-2)', () => {
    it('preserves explicit gemini-2.5-flash configuration without regex alteration', () => {
      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        modelName: 'gemini-2.5-flash',
      });
      expect(provider.modelName).toBe('gemini-2.5-flash');
    });

    it('preserves explicit gemini-2.0-flash configuration without regex alteration', () => {
      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
        modelName: 'gemini-2.0-flash',
      });
      expect(provider.modelName).toBe('gemini-2.0-flash');
    });

    it('defaults to gemini-2.5-flash when modelName is undefined', () => {
      const provider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
      });
      expect(provider.modelName).toBe('gemini-2.5-flash');
    });

    it('throws GeminiInvalidRequestError when modelName is empty string or whitespace', () => {
      expect(
        () =>
          new GeminiGenerationProvider({
            apiKey: dummyApiKey,
            modelName: '',
          }),
      ).toThrow(GeminiInvalidRequestError);

      expect(
        () =>
          new GeminiGenerationProvider({
            apiKey: dummyApiKey,
            modelName: '   ',
          }),
      ).toThrow(GeminiInvalidRequestError);
    });
  });

  describe('21. Ollama regression compatibility', () => {
    it('confirms GeminiGenerationProvider satisfies the exact LLMProvider interface contract', async () => {
      const provider: LLMProvider = new GeminiGenerationProvider({
        apiKey: dummyApiKey,
      });

      expect(provider.providerName).toBe('gemini');
      expect(provider.modelName).toBe('gemini-2.5-flash');
      expect(typeof provider.generate).toBe('function');
      expect(typeof provider.generateStream).toBe('function');
      expect(typeof provider.getModelInfo).toBe('function');
      expect(typeof provider.healthCheck).toBe('function');

      const info = await provider.getModelInfo();
      expect(info.providerName).toBe('gemini');
      expect(info.model).toBe('gemini-2.5-flash');
      expect(info.maxContextTokens).toBe(1048576);
    });
  });
});
