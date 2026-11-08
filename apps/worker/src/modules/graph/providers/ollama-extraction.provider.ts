/**
 * MindVault — Knowledge Graph: Ollama Extraction Provider
 *
 * Invokes local Ollama models with format='json' and parses structured extraction output.
 */

import type {
  IKnowledgeExtractionProvider,
  ExtractionContext,
} from './extraction-provider.interface.js';
import {
  KnowledgeExtractionResponseSchema,
  type KnowledgeExtractionResponse,
} from '@mindvault/shared';
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionUserPrompt,
} from '../prompts/extraction.prompt.js';

export interface OllamaExtractionOptions {
  baseUrl?: string;
  modelName?: string;
  think?: boolean;
  temperature?: number;
  timeoutMs?: number;
}

export class OllamaExtractionProvider implements IKnowledgeExtractionProvider {
  public readonly providerName = 'ollama';
  public readonly baseUrl: string;
  public readonly modelName: string;
  public readonly think: boolean;
  public readonly temperature: number;
  public readonly timeoutMs: number;

  constructor(options?: OllamaExtractionOptions) {
    this.baseUrl = (
      options?.baseUrl ||
      process.env.OLLAMA_BASE_URL ||
      'http://localhost:11434'
    ).replace(/\/$/, '');
    this.modelName =
      options?.modelName ||
      process.env.OLLAMA_EXTRACTION_MODEL ||
      process.env.OLLAMA_GENERATION_MODEL ||
      'qwen3:0.6b';
    this.think =
      options?.think !== undefined ? options.think : process.env.OLLAMA_EXTRACTION_THINK === 'true';
    this.temperature =
      options?.temperature !== undefined
        ? options.temperature
        : parseFloat(process.env.OLLAMA_EXTRACTION_TEMPERATURE || '0.0');
    this.timeoutMs =
      options?.timeoutMs ||
      parseInt(
        process.env.OLLAMA_EXTRACTION_TIMEOUT_MS || process.env.LLM_REQUEST_TIMEOUT || '60000',
        10,
      );
  }

  public async extract(
    chunkText: string,
    context?: ExtractionContext,
  ): Promise<KnowledgeExtractionResponse> {
    const prompt = buildExtractionUserPrompt(chunkText, context);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model: this.modelName,
          prompt,
          system: EXTRACTION_SYSTEM_PROMPT,
          format: 'json',
          stream: false,
          think: this.think,
          options: {
            temperature: this.temperature,
            top_p: 0.9,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Ollama extraction failed with HTTP ${response.status}: ${response.statusText}`,
        );
      }

      const data = (await response.json()) as { response: string };
      const rawText = data.response?.trim();

      if (!rawText) {
        throw new Error('Ollama returned empty response for extraction');
      }

      return this.parseAndValidate(rawText);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Ollama extraction timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  public async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        return { ok: false, message: `Ollama returned HTTP ${response.status}` };
      }
      return { ok: true, message: `Ollama active at ${this.baseUrl}` };
    } catch (err: any) {
      return { ok: false, message: err.message };
    }
  }

  private parseAndValidate(rawText: string): KnowledgeExtractionResponse {
    let cleanText = rawText;
    const jsonMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      cleanText = jsonMatch[1];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleanText);
    } catch (err: any) {
      throw new Error(`Failed to parse Ollama output as JSON: ${err.message}`);
    }

    const validation = KnowledgeExtractionResponseSchema.safeParse(parsed);
    if (!validation.success) {
      throw new Error(
        `Ollama extraction failed schema validation: ${JSON.stringify(validation.error.format())}`,
      );
    }

    return validation.data;
  }
}
