/**
 * MindVault — Knowledge Graph: Google Gemini Extraction Provider
 *
 * Implements structured knowledge extraction using the official @google/genai SDK
 * with responseMimeType='application/json' and Zod schema validation.
 */

import { GoogleGenAI } from '@google/genai';
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

export interface GeminiExtractionOptions {
  apiKey?: string;
  modelName?: string;
  timeoutMs?: number;
}

export class GeminiExtractionProvider implements IKnowledgeExtractionProvider {
  public readonly providerName = 'gemini';
  public readonly modelName: string;
  private readonly client: GoogleGenAI;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(options?: GeminiExtractionOptions) {
    this.apiKey = options?.apiKey || process.env.GEMINI_API_KEY || '';
    const rawModel = options?.modelName || process.env.GEMINI_MODEL || 'gemini-3.5-flash';
    if (rawModel.includes('2.5') || rawModel.includes('2.0') || rawModel.includes('1.5')) {
      this.modelName = 'gemini-3.5-flash';
    } else {
      this.modelName = rawModel;
    }

    this.timeoutMs = options?.timeoutMs || parseInt(process.env.LLM_REQUEST_TIMEOUT || '60000', 10);
    this.client = new GoogleGenAI({
      apiKey: this.apiKey || 'placeholder-for-tests',
    });
  }

  public async extract(
    chunkText: string,
    context?: ExtractionContext,
  ): Promise<KnowledgeExtractionResponse> {
    if (!this.apiKey) {
      throw new Error(
        'GEMINI_API_KEY is not configured in environment. Configure GEMINI_API_KEY to use Gemini extraction.',
      );
    }

    const prompt = buildExtractionUserPrompt(chunkText, context);

    try {
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {
          systemInstruction: EXTRACTION_SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 2048,
          abortSignal: context?.abortSignal,
        },
      });

      const rawText = response.text?.trim();
      if (!rawText) {
        throw new Error('Gemini returned an empty response for knowledge extraction');
      }

      return this.parseAndValidate(rawText);
    } catch (err: any) {
      throw new Error(`Gemini extraction failed: ${err.message || String(err)}`);
    }
  }

  public async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    if (!this.apiKey) {
      return { ok: false, message: 'GEMINI_API_KEY is not configured.' };
    }
    return { ok: true, message: `Gemini extraction configured with model ${this.modelName}` };
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
      throw new Error(`Failed to parse Gemini output as JSON: ${err.message}`);
    }

    const validation = KnowledgeExtractionResponseSchema.safeParse(parsed);
    if (!validation.success) {
      throw new Error(
        `Gemini extraction failed schema validation: ${JSON.stringify(validation.error.format())}`,
      );
    }

    return validation.data;
  }
}
