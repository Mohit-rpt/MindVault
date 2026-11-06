/**
 * MindVault — Generation Engine: Google Gemini LLM Provider
 *
 * Implements Google Gemini text generation and streaming using the official @google/genai SDK.
 * Supports multimodal reasoning (text + images) with sub-second streaming latency.
 * Features automatic model fallbacks for deprecated models (e.g. 2.5) and high-demand spikes (503).
 */

import { GoogleGenAI } from '@google/genai';
import type {
  LLMProvider,
  LLMProviderInfo,
  LLMGenerateOptions,
  LLMGenerateResult,
  LLMStreamChunk,
} from '@mindvault/shared';

export interface GeminiProviderOptions {
  apiKey?: string;
  modelName?: string;
}

export class GeminiProvider implements LLMProvider {
  public readonly providerName = 'gemini';
  public readonly modelName: string;
  private readonly client: GoogleGenAI;
  private readonly apiKey: string;

  constructor(options?: GeminiProviderOptions) {
    this.apiKey = options?.apiKey || process.env.GEMINI_API_KEY || '';
    const rawModel = options?.modelName || process.env.GEMINI_MODEL || 'gemini-3.5-flash';

    // Auto-migrate deprecated models (e.g., gemini-2.5-flash, gemini-2.0, gemini-1.5) to gemini-3.5-flash
    if (
      rawModel.includes('2.5') ||
      rawModel.includes('2.0') ||
      rawModel.includes('1.5')
    ) {
      this.modelName = 'gemini-3.5-flash';
    } else {
      this.modelName = rawModel;
    }

    if (!this.apiKey) {
      console.warn(
        '⚠️ GEMINI_API_KEY is not configured in .env. GeminiProvider will fail unless a key is set.',
      );
    }

    this.client = new GoogleGenAI({
      apiKey: this.apiKey,
    });
  }

  public async getModelInfo(): Promise<LLMProviderInfo> {
    return {
      providerName: this.providerName,
      model: this.modelName,
      maxContextTokens: 1048576, // 1M tokens context
    };
  }

  public async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    if (!this.apiKey) {
      return {
        ok: false,
        message: 'GEMINI_API_KEY is not configured in environment (.env).',
      };
    }
    return { ok: true };
  }

  private buildContents(prompt: string, options?: LLMGenerateOptions): any[] {
    const parts: any[] = [];

    // Support multimodal images (inline base64 image interpretation)
    if (options?.image?.data && options?.image?.mimeType) {
      parts.push({
        inlineData: {
          mimeType: options.image.mimeType,
          data: options.image.data,
        },
      });
    }

    parts.push(prompt);
    return parts;
  }

  private getCandidateModels(): string[] {
    const list = [this.modelName, 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
    // Deduplicate
    return Array.from(new Set(list));
  }

  public async generate(
    prompt: string,
    options?: LLMGenerateOptions,
  ): Promise<LLMGenerateResult> {
    if (!this.apiKey) {
      throw new Error(
        'GEMINI_API_KEY is missing. Please add GEMINI_API_KEY to your .env file.',
      );
    }

    const startTime = performance.now();
    const contents = this.buildContents(prompt, options);
    const candidates = this.getCandidateModels();

    let lastError: any = null;

    for (const model of candidates) {
      try {
        const response = await this.client.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: options?.systemPrompt,
            temperature: options?.temperature ?? 0.2,
            maxOutputTokens: options?.maxTokens ?? 1024,
            stopSequences: options?.stopSequences,
          },
        });

        const durationMs = Math.round(performance.now() - startTime);

        return {
          text: response.text || '',
          promptTokens: response.usageMetadata?.promptTokenCount,
          outputTokens: response.usageMetadata?.candidatesTokenCount,
          durationMs,
          finishReason: response.candidates?.[0]?.finishReason || 'stop',
        };
      } catch (err: any) {
        lastError = err;
        const msg = String(err.message || err);
        // If 404 (model not found/deprecated) or 503 (high demand), try fallback model
        if (msg.includes('404') || msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('NOT_FOUND')) {
          console.warn(`[GeminiProvider] Model ${model} encountered issue (${msg}). Retrying with fallback candidate...`);
          continue;
        }
        throw new Error(`Gemini generation failed: ${msg}`);
      }
    }

    throw new Error(`Gemini generation failed: ${lastError?.message || String(lastError)}`);
  }

  public async *generateStream(
    prompt: string,
    options?: LLMGenerateOptions,
  ): AsyncIterable<LLMStreamChunk> {
    if (!this.apiKey) {
      throw new Error(
        'GEMINI_API_KEY is missing. Please add GEMINI_API_KEY to your .env file.',
      );
    }

    const contents = this.buildContents(prompt, options);
    const candidates = this.getCandidateModels();

    let stream: any = null;
    let selectedModel = this.modelName;

    for (const model of candidates) {
      try {
        stream = await this.client.models.generateContentStream({
          model,
          contents,
          config: {
            systemInstruction: options?.systemPrompt,
            temperature: options?.temperature ?? 0.2,
            maxOutputTokens: options?.maxTokens ?? 1024,
            stopSequences: options?.stopSequences,
          },
        });
        selectedModel = model;
        break;
      } catch (err: any) {
        const msg = String(err.message || err);
        if (msg.includes('404') || msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('NOT_FOUND')) {
          console.warn(`[GeminiProvider] Model ${model} unavailable (${msg}). Retrying with fallback candidate...`);
          continue;
        }
        throw new Error(`Gemini stream failed: ${msg}`);
      }
    }

    if (!stream) {
      throw new Error('All Gemini candidate models were unavailable.');
    }

    try {
      for await (const chunk of stream) {
        if (chunk.text) {
          yield {
            text: chunk.text,
            isFinished: false,
          };
        }
      }

      yield {
        text: '',
        isFinished: true,
        finishReason: 'stop',
      };
    } catch (err: any) {
      throw new Error(`Gemini stream failed on ${selectedModel}: ${err.message || String(err)}`);
    }
  }
}
