import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockLLMProvider } from './mock.provider.js';
import { GeminiProvider } from './gemini.provider.js';
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

  describe('GeminiProvider Integration & Defaults', () => {
    it('should instantiate GeminiProvider when explicitly requested', () => {
      process.env.GEMINI_API_KEY = 'AIzaSyD-mock-test-key-12345';
      const provider = LLMProviderFactory.getProvider('gemini');
      expect(provider).toBeInstanceOf(GeminiProvider);
      expect(provider.providerName).toBe('gemini');
    });

    it('should reject Ollama provider requests with descriptive error', () => {
      expect(() => LLMProviderFactory.getProvider('ollama')).toThrow(
        /Unsupported LLM provider: "ollama"/,
      );
    });

    it('should reject arbitrary unsupported providers', () => {
      expect(() => LLMProviderFactory.getProvider('openai')).toThrow(
        /Unsupported LLM provider: "openai"/,
      );
    });
  });

  describe('LLMProviderFactory', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      process.env = { ...originalEnv };
      LLMProviderFactory.resetProvider();
    });

    afterEach(() => {
      process.env = { ...originalEnv };
      LLMProviderFactory.resetProvider();
    });

    it('should default to MockLLMProvider in test environment', () => {
      const provider = LLMProviderFactory.getProvider();
      expect(provider.providerName).toBe('mock');
    });

    it('should default to GeminiProvider in production/development environment when LLM_PROVIDER is unset', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.LLM_PROVIDER;
      process.env.GEMINI_API_KEY = 'AIzaSyD-mock-test-key-12345';

      const provider = LLMProviderFactory.getProvider();
      expect(provider).toBeInstanceOf(GeminiProvider);
      expect(provider.providerName).toBe('gemini');
    });

    it('should never silently fallback to Ollama', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.LLM_PROVIDER;
      process.env.GEMINI_API_KEY = 'AIzaSyD-mock-test-key-12345';

      const provider = LLMProviderFactory.getProvider();
      expect(provider.providerName).not.toBe('ollama');
      expect(provider.providerName).toBe('gemini');
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
