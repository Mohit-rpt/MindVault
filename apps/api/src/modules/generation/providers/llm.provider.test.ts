import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockLLMProvider } from './mock.provider.js';
import { OllamaProvider } from './ollama.provider.js';
import { LLMProviderFactory } from './provider.factory.js';

describe('LLM Provider Subsystem', () => {
  beforeEach(() => {
    LLMProviderFactory.resetProvider();
  });

  afterEach(() => {
    LLMProviderFactory.resetProvider();
    vi.restoreAllMocks();
  });

  describe('MockLLMProvider', () => {
    it('should generate deterministic grounded response when evidence is present', async () => {
      const provider = new MockLLMProvider();
      const result = await provider.generate(
        'QUESTION: test\n<evidence>\n--- SOURCE [S1] ---\nContent\n</evidence>',
      );

      expect(result.text).toContain('[S1]');
      expect(result.finishReason).toBe('stop');
      expect(result.durationMs).toBeGreaterThan(0);
    });

    it('should return insufficient evidence response when prompt lacks evidence', async () => {
      const provider = new MockLLMProvider();
      const result = await provider.generate(
        'QUESTION: test\n<evidence>\nNO EVIDENCE AVAILABLE\n</evidence>',
      );

      expect(result.text.toLowerCase()).toContain('insufficient evidence');
    });

    it('should support configurable custom response override', async () => {
      const provider = new MockLLMProvider();
      provider.setSimulatedResponse('Custom overridden answer [S1].');
      const result = await provider.generate('Any prompt');

      expect(result.text).toBe('Custom overridden answer [S1].');
    });

    it('should stream chunks incrementally with finish flags', async () => {
      const provider = new MockLLMProvider();
      provider.setSimulatedResponse('Hello world [S1].');

      const chunks: string[] = [];
      let finalChunkReceived = false;

      for await (const chunk of provider.generateStream('prompt')) {
        chunks.push(chunk.text);
        if (chunk.isFinished) {
          finalChunkReceived = true;
          expect(chunk.finishReason).toBe('stop');
        }
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.join('')).toBe('Hello world [S1].');
      expect(finalChunkReceived).toBe(true);
    });

    it('should handle simulated failure gracefully', async () => {
      const provider = new MockLLMProvider();
      provider.setSimulatedFailure(true, 'GPU Out of Memory');

      await expect(provider.generate('prompt')).rejects.toThrow('GPU Out of Memory');
      const health = await provider.healthCheck();
      expect(health.ok).toBe(false);
      expect(health.message).toBe('GPU Out of Memory');
    });
  });

  describe('OllamaProvider', () => {
    it('should initialize with configured base URL and model', async () => {
      const provider = new OllamaProvider({
        baseUrl: 'http://127.0.0.1:11434',
        modelName: 'qwen3:0.6b',
      });

      expect(provider.providerName).toBe('ollama');
      expect(provider.modelName).toBe('qwen3:0.6b');
      const info = await provider.getModelInfo();
      expect(info.model).toBe('qwen3:0.6b');
    });

    it('should parse non-streaming Ollama responses correctly', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: 'Supervised learning inference [S1].',
          prompt_eval_count: 50,
          eval_count: 20,
          done_reason: 'stop',
        }),
      });
      global.fetch = mockFetch;

      const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434' });
      const res = await provider.generate('test prompt');

      expect(res.text).toBe('Supervised learning inference [S1].');
      expect(res.promptTokens).toBe(50);
      expect(res.outputTokens).toBe(20);
      expect(res.finishReason).toBe('stop');
    });

    it('should stream NDJSON chunks and parse buffer across line breaks', async () => {
      const ndjson = [
        JSON.stringify({ response: 'Supervised', done: false }) + '\n',
        JSON.stringify({ response: ' learning', done: false }) + '\n',
        JSON.stringify({ response: ' [S1]', done: true, done_reason: 'stop' }) + '\n',
      ];

      let chunkIdx = 0;
      const mockStream = {
        getReader: () => ({
          read: async () => {
            if (chunkIdx < ndjson.length) {
              const val = new TextEncoder().encode(ndjson[chunkIdx++]);
              return { done: false, value: val };
            }
            return { done: true, value: undefined };
          },
          releaseLock: vi.fn(),
        }),
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: mockStream,
      });

      const provider = new OllamaProvider();
      const chunks: string[] = [];

      for await (const c of provider.generateStream('prompt')) {
        chunks.push(c.text);
      }

      expect(chunks.join('')).toBe('Supervised learning [S1]');
    });
  });

  describe('LLMProviderFactory', () => {
    it('should default to MockLLMProvider in test environment', () => {
      const provider = LLMProviderFactory.getProvider();
      expect(provider.providerName).toBe('mock');
    });

    it('should allow setting and resetting custom providers', () => {
      const custom = new MockLLMProvider({ modelName: 'custom-test-model' });
      LLMProviderFactory.setProvider(custom);
      expect(LLMProviderFactory.getProvider().modelName).toBe('custom-test-model');

      LLMProviderFactory.resetProvider();
      expect(LLMProviderFactory.getProvider().modelName).toBe('mock-qwen-768');
    });
  });
});
