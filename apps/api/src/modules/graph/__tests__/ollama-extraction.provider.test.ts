import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaExtractionProvider } from '../providers/ollama-extraction.provider.js';
import { createExtractionProvider } from '../providers/provider.factory.js';

describe('Phase 6.1: OllamaExtractionProvider Configuration & Health Tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('configures extraction model with precedence: options > OLLAMA_EXTRACTION_MODEL > OLLAMA_GENERATION_MODEL > default', () => {
    // 1. Default fallback
    delete process.env.OLLAMA_EXTRACTION_MODEL;
    delete process.env.OLLAMA_GENERATION_MODEL;
    const p1 = new OllamaExtractionProvider();
    expect(p1.modelName).toBe('qwen3:0.6b');

    // 2. Generation model fallback
    process.env.OLLAMA_GENERATION_MODEL = 'qwen3:1.7b';
    const p2 = new OllamaExtractionProvider();
    expect(p2.modelName).toBe('qwen3:1.7b');

    // 3. Extraction-specific model overrides generation model
    process.env.OLLAMA_EXTRACTION_MODEL = 'qwen3:0.6b';
    const p3 = new OllamaExtractionProvider();
    expect(p3.modelName).toBe('qwen3:0.6b');

    // 4. Constructor options take top precedence
    const p4 = new OllamaExtractionProvider({ modelName: 'qwen3:1.7b' });
    expect(p4.modelName).toBe('qwen3:1.7b');
  });

  it('configures thinking control with default false and supports boolean think parameter', () => {
    // Default is false
    delete process.env.OLLAMA_EXTRACTION_THINK;
    const p1 = new OllamaExtractionProvider();
    expect(p1.think).toBe(false);

    // Environment override to true
    process.env.OLLAMA_EXTRACTION_THINK = 'true';
    const p2 = new OllamaExtractionProvider();
    expect(p2.think).toBe(true);

    // Constructor option override
    const p3 = new OllamaExtractionProvider({ think: false });
    expect(p3.think).toBe(false);
  });

  it('configures temperature with default 0.0', () => {
    delete process.env.OLLAMA_EXTRACTION_TEMPERATURE;
    const p1 = new OllamaExtractionProvider();
    expect(p1.temperature).toBe(0.0);

    process.env.OLLAMA_EXTRACTION_TEMPERATURE = '0.2';
    const p2 = new OllamaExtractionProvider();
    expect(p2.temperature).toBe(0.2);

    const p3 = new OllamaExtractionProvider({ temperature: 0.5 });
    expect(p3.temperature).toBe(0.5);
  });

  it('configures extraction timeout without modifying global LLM_REQUEST_TIMEOUT', () => {
    process.env.LLM_REQUEST_TIMEOUT = '180000'; // global generation timeout
    delete process.env.OLLAMA_EXTRACTION_TIMEOUT_MS;

    // Falls back to LLM_REQUEST_TIMEOUT if extraction timeout not set
    const p1 = new OllamaExtractionProvider();
    expect(p1.timeoutMs).toBe(180000);

    // Specific extraction timeout takes precedence
    process.env.OLLAMA_EXTRACTION_TIMEOUT_MS = '45000';
    const p2 = new OllamaExtractionProvider();
    expect(p2.timeoutMs).toBe(45000);
    // Global variable is untouched
    expect(process.env.LLM_REQUEST_TIMEOUT).toBe('180000');
  });

  it('passes think parameter in JSON payload to Ollama /api/generate', async () => {
    const provider = new OllamaExtractionProvider({
      modelName: 'qwen3:0.6b',
      think: false,
      temperature: 0.0,
      timeoutMs: 5000,
    });

    let capturedPayload: any = null;
    global.fetch = vi.fn().mockImplementation(async (_url, options) => {
      capturedPayload = JSON.parse(options.body as string);
      return {
        ok: true,
        json: async () => ({
          response: JSON.stringify({
            version: '1.0',
            entities: [
              { name: 'PostgreSQL', entityType: 'TECHNOLOGY', aliases: [], confidence: 0.9 },
            ],
            relations: [],
          }),
        }),
      };
    }) as any;

    const result = await provider.extract('PostgreSQL is a database.');
    expect(result.entities).toHaveLength(1);
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.model).toBe('qwen3:0.6b');
    expect(capturedPayload.think).toBe(false);
    expect(capturedPayload.options.temperature).toBe(0.0);
  });

  it('never silently falls back to MockExtractionProvider in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => createExtractionProvider('mock')).toThrow(
      /MockExtractionProvider cannot be used in production environment/,
    );
    expect(() => createExtractionProvider('invalid-provider' as any)).toThrow(
      /Unsupported graph extraction provider/,
    );
  });
});
