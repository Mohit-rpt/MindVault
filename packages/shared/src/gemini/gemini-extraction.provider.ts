/**
 * MindVault — Knowledge Graph: Google Gemini Extraction Provider (Phase 1B.3)
 *
 * Implements structured, evidence-grounded knowledge graph extraction using the official
 * @google/genai SDK with responseMimeType='application/json', Zod schema enforcement,
 * cancellable retry backoff, bounded model failover, and secret-safe error sanitization.
 */

import { GoogleGenAI } from '@google/genai';
import { KnowledgeExtractionResponseSchema, type KnowledgeExtractionResponse } from '../types.js';
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionUserPrompt } from './gemini-extraction.prompt.js';
import {
  GeminiEmbeddingError,
  GeminiAuthenticationError,
  GeminiPermissionError,
  GeminiQuotaExhaustedError,
  GeminiServiceUnavailableError,
  GeminiInvalidRequestError,
  maskGeminiApiKey,
} from './gemini-generation.provider.js';

/**
 * Generic base error alias for Gemini extraction and generation errors.
 * Preserves 100% backward compatibility with GeminiEmbeddingError instanceof checks.
 */
export const GeminiError = GeminiEmbeddingError;
export type GeminiError = GeminiEmbeddingError;

export {
  GeminiEmbeddingError,
  GeminiAuthenticationError,
  GeminiPermissionError,
  GeminiQuotaExhaustedError,
  GeminiServiceUnavailableError,
  GeminiInvalidRequestError,
  maskGeminiApiKey,
};

export class GeminiNotFoundError extends GeminiEmbeddingError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: 'NOT_FOUND', isRetryable: false, statusCode: 404, cause });
    this.name = 'GeminiNotFoundError';
  }
}


export class GeminiExtractionSchemaError extends GeminiEmbeddingError {
  public readonly rawPayload?: string;

  constructor(message: string, rawPayload?: string, cause?: unknown) {
    super(message, {
      code: 'SCHEMA_VALIDATION_FAILED',
      isRetryable: false,
      statusCode: 422,
      cause,
    });
    this.name = 'GeminiExtractionSchemaError';
    this.rawPayload = rawPayload;
  }
}

export interface ExtractionContext {
  documentTitle?: string;
  sectionHeading?: string;
  pageNumber?: number;
  workspaceId?: string;
  abortSignal?: AbortSignal;
}

export interface IKnowledgeExtractionProvider {
  readonly providerName: string;
  readonly modelName?: string;
  extract(chunkText: string, context?: ExtractionContext): Promise<KnowledgeExtractionResponse>;
  healthCheck(): Promise<{ ok: boolean; message?: string }>;
}

export interface GeminiExtractionConfig {
  /**
   * Gemini API Key. Defaults to process.env.GEMINI_API_KEY.
   */
  apiKey?: string;

  /**
   * Model identifier to use. Defaults to process.env.GEMINI_EXTRACTION_MODEL
   * or process.env.GEMINI_MODEL or 'gemini-2.5-flash'.
   */
  modelName?: string;

  /**
   * Request timeout in milliseconds (default: 60000).
   */
  timeoutMs?: number;

  /**
   * Maximum retry attempts for transient failures per candidate model (default: 3).
   */
  maxRetries?: number;

  /**
   * Maximum total API request attempts across all candidate models and retries.
   * If not explicitly specified, defaults to maxRetries * 2 if maxRetries is provided, or 4.
   */
  maxTotalAttempts?: number;

  /**
   * Initial exponential backoff delay in milliseconds (default: 500).
   */
  initialRetryDelayMs?: number;

  /**
   * Maximum backoff delay in milliseconds (default: 5000).
   */
  maxRetryDelayMs?: number;

  /**
   * Temperature for deterministic JSON extraction (default: 0.1).
   */
  temperature?: number;

  /**
   * Maximum output tokens (default: 4096).
   */
  maxOutputTokens?: number;

  /**
   * Optional injected GoogleGenAI client for testing and dependency injection.
   */
  client?: GoogleGenAI;
}

export class GeminiExtractionProvider implements IKnowledgeExtractionProvider {
  public readonly providerName = 'gemini';
  public readonly modelName: string;

  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  public readonly maxTotalAttempts: number;
  private readonly initialRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly temperature: number;
  private readonly maxOutputTokens: number;
  private readonly client: GoogleGenAI;

  constructor(config?: GeminiExtractionConfig) {
    const rawModel =
      config?.modelName !== undefined
        ? config.modelName
        : process.env.GEMINI_EXTRACTION_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    if (typeof rawModel !== 'string' || rawModel.trim().length === 0) {
      throw new GeminiInvalidRequestError('Model name must be a non-empty string.');
    }

    this.modelName = rawModel.trim();

    const rawKey = config?.apiKey || process.env.GEMINI_API_KEY || '';
    this.apiKey = rawKey.trim();

    this.timeoutMs =
      config?.timeoutMs ||
      parseInt(
        process.env.GEMINI_EXTRACTION_TIMEOUT_MS || process.env.LLM_REQUEST_TIMEOUT || '60000',
        10,
      );

    this.maxRetries = Math.max(1, config?.maxRetries ?? 3);
    this.maxTotalAttempts = Math.max(
      1,
      config?.maxTotalAttempts ??
        (config?.maxRetries !== undefined ? config.maxRetries * 2 : 4),
    );
    this.initialRetryDelayMs = Math.max(1, config?.initialRetryDelayMs ?? 500);
    this.maxRetryDelayMs = Math.max(this.initialRetryDelayMs, config?.maxRetryDelayMs ?? 5000);
    this.temperature = config?.temperature ?? 0.1;
    this.maxOutputTokens = config?.maxOutputTokens ?? 4096;

    this.client =
      config?.client ||
      new GoogleGenAI({
        apiKey: this.apiKey || 'placeholder-for-tests',
      });
  }

  /**
   * Resolves prioritized candidate models for graceful fallback without duplicate attempts.
   * Explicitly configured model is always primary (first attempt).
   */
  public getCandidateModels(): string[] {
    const defaultCandidates = process.env.GEMINI_FALLBACK_MODELS
      ? process.env.GEMINI_FALLBACK_MODELS.split(',').map((m) => m.trim())
      : ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
    return Array.from(new Set([this.modelName, ...defaultCandidates]));
  }

  /**
   * Proactively sanitizes error messages to prevent leakage of credentials, auth headers,
   * query parameters, and embedded HTTP/HTTPS basic credentials.
   */
  public sanitizeErrorMessage(rawMessage: string): string {
    let sanitized = String(rawMessage || 'Unknown error');

    if (this.apiKey && this.apiKey.length > 0) {
      sanitized = sanitized.replaceAll(this.apiKey, maskGeminiApiKey(this.apiKey));
    }

    // Redact standard Google API key patterns: AIza...
    sanitized = sanitized.replace(/AIza[0-9A-Za-z-_]{35}/g, 'AIza...[REDACTED]');

    // Redact query parameter credentials: ?key=..., &token=...
    sanitized = sanitized.replace(
      /([?&](?:key|api_key|token|access_token|secret)=)[^&\s]+/gi,
      '$1[REDACTED]',
    );

    // Redact authorization headers
    sanitized = sanitized.replace(
      /((?:Bearer|Basic)\s+|key=)[A-Za-z0-9_.-]{10,}/gi,
      '$1[REDACTED]',
    );

    // Redact HTTP/HTTPS embedded basic auth credentials
    sanitized = sanitized.replace(
      /(https?:\/\/)([^/\s:@]+)(?::([^/\s@]+))?(@)/gi,
      (_match, protocol, user, pass, at) => {
        if (pass !== undefined) {
          return `${protocol}${user}:[REDACTED]${at}`;
        }
        return `${protocol}[REDACTED]${at}`;
      },
    );

    return sanitized;
  }


  /**
   * Translates arbitrary upstream exceptions into typed Gemini error hierarchy
   */
  private classifyError(error: unknown): GeminiEmbeddingError {
    if (error instanceof GeminiEmbeddingError) {
      return error;
    }

    const err = error as Record<string, unknown> | null | undefined;
    const rawMsg = String(err?.message || error || 'Unknown error');
    const msg = this.sanitizeErrorMessage(rawMsg);
    const status = Number(err?.status || err?.statusCode || err?.code || 0);

    // Timeout
    if (err?.name === 'AbortError' || msg.includes('aborted') || msg.includes('timeout')) {
      return new GeminiServiceUnavailableError(
        `Gemini API request timed out after ${this.timeoutMs}ms.`,
        504,
      );
    }

    // 401 Unauthorized
    if (
      status === 401 ||
      msg.includes('API_KEY_INVALID') ||
      msg.includes('UNAUTHENTICATED') ||
      msg.includes('401')
    ) {
      return new GeminiAuthenticationError(`Gemini authentication failed (401): ${msg}`);
    }

    // 403 Forbidden / Permission Denied
    if (
      status === 403 ||
      msg.includes('PERMISSION_DENIED') ||
      msg.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') ||
      msg.includes('403')
    ) {
      return new GeminiPermissionError(`Gemini permission denied (403): ${msg}`);
    }

    // 404 Not Found
    if (status === 404 || msg.includes('NOT_FOUND') || msg.includes('404')) {
      return new GeminiNotFoundError(`Gemini resource or model not found (404): ${msg}`);
    }

    // 429 Quota / Rate Limit
    if (
      status === 429 ||
      msg.includes('RESOURCE_EXHAUSTED') ||
      msg.includes('quota') ||
      msg.includes('429')
    ) {
      return new GeminiQuotaExhaustedError(`Gemini quota exhausted (429): ${msg}`);
    }

    // 5xx Server Errors
    if (
      status >= 500 ||
      msg.includes('INTERNAL') ||
      msg.includes('UNAVAILABLE') ||
      msg.includes('500') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('504')
    ) {
      return new GeminiServiceUnavailableError(
        `Gemini service unavailable (${status || 503}): ${msg}`,
        status >= 500 ? status : 503,
      );
    }

    // 400 Bad Request
    if (
      status === 400 ||
      msg.includes('INVALID_ARGUMENT') ||
      msg.includes('bad request') ||
      msg.includes('400')
    ) {
      return new GeminiInvalidRequestError(`Gemini invalid request (400): ${msg}`);
    }

    return new GeminiEmbeddingError(`Gemini extraction failed: ${msg}`, {
      code: 'EXTRACTION_FAILED',
      isRetryable: false,
      statusCode: status || 500,
    });
  }

  /**
   * Executes structured knowledge extraction on a text chunk
   */
  public async extract(
    chunkText: string,
    context?: ExtractionContext,
  ): Promise<KnowledgeExtractionResponse> {
    if (!this.apiKey && !this.client) {
      throw new GeminiAuthenticationError(
        'GEMINI_API_KEY is not configured in environment. Configure GEMINI_API_KEY to use Gemini extraction.',
      );
    }

    if (typeof chunkText !== 'string') {
      throw new GeminiInvalidRequestError('Chunk text must be a string.');
    }

    // Handle empty chunk gracefully without hitting network
    if (chunkText.trim().length === 0) {
      return {
        version: '1.0',
        entities: [],
        relations: [],
      };
    }

    // Pre-flight cancellation check
    if (context?.abortSignal?.aborted) {
      throw new Error('CLIENT_ABORTED');
    }

    const prompt = buildExtractionUserPrompt(chunkText, context);
    const candidates = this.getCandidateModels();
    let totalAttempts = 0;
    let lastError: unknown = null;

    candidateLoop: for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
      const model = candidates[cIdx];
      const hasMoreCandidates = cIdx < candidates.length - 1;

      if (context?.abortSignal?.aborted) {
        throw new Error('CLIENT_ABORTED');
      }

      if (totalAttempts >= this.maxTotalAttempts) {
        break candidateLoop;
      }

      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        if (context?.abortSignal?.aborted) {
          throw new Error('CLIENT_ABORTED');
        }

        if (totalAttempts >= this.maxTotalAttempts) {
          break candidateLoop;
        }

        totalAttempts++;

        const controller = new AbortController();
        const effectiveTimeout = this.timeoutMs;
        const timeoutHandle = setTimeout(() => {
          controller.abort();
        }, effectiveTimeout);

        const onCallerAbort = () => controller.abort();
        if (context?.abortSignal) {
          context.abortSignal.addEventListener('abort', onCallerAbort, { once: true });
        }

        try {
          const response = await this.client.models.generateContent({
            model,
            contents: prompt,
            config: {
              systemInstruction: EXTRACTION_SYSTEM_PROMPT,
              responseMimeType: 'application/json',
              temperature: this.temperature,
              maxOutputTokens: this.maxOutputTokens,
              abortSignal: controller.signal,
            },
          });

          clearTimeout(timeoutHandle);
          if (context?.abortSignal) {
            context.abortSignal.removeEventListener('abort', onCallerAbort);
          }

          const rawText = response.text?.trim();
          if (!rawText || rawText.length === 0) {
            throw new GeminiExtractionSchemaError(
              'Gemini returned an empty text payload for knowledge extraction',
              '',
            );
          }

          return this.parseAndValidate(rawText);
        } catch (err: unknown) {
          clearTimeout(timeoutHandle);
          if (context?.abortSignal) {
            context.abortSignal.removeEventListener('abort', onCallerAbort);
          }

          if (context?.abortSignal?.aborted) {
            throw new Error('CLIENT_ABORTED');
          }

          const classified = this.classifyError(err);
          lastError = classified;

          // 1. Model Not Found (HTTP 404): Failover to next candidate model without retrying current model
          if (classified instanceof GeminiNotFoundError) {
            if (hasMoreCandidates && totalAttempts < this.maxTotalAttempts) {
              continue candidateLoop;
            }
            throw classified;
          }

          // 2. Permanent non-retryable client errors (401, 403, 400, Schema 422): Fail fast immediately
          if (!classified.isRetryable) {
            throw classified;
          }

          // 3. Retryable transient errors (429, 503): Retry same model if attempts and budget remain
          const canRetrySameModel =
            attempt < this.maxRetries && totalAttempts < this.maxTotalAttempts;
          if (canRetrySameModel) {
            const exponentialDelay = Math.min(
              this.maxRetryDelayMs,
              this.initialRetryDelayMs * Math.pow(2, attempt - 1),
            );
            const jitter = 0.8 + Math.random() * 0.4;
            const delayMs = Math.round(exponentialDelay * jitter);

            // Cancellable retry delay
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, delayMs);
              const onAbortDelay = () => {
                clearTimeout(timer);
                resolve();
              };
              if (context?.abortSignal) {
                context.abortSignal.addEventListener('abort', onAbortDelay, { once: true });
              }
            });

            if (context?.abortSignal?.aborted) {
              throw new Error('CLIENT_ABORTED');
            }

            continue;
          }

          // If current model exhausted its retries, check if candidate fallback is possible
          if (hasMoreCandidates && totalAttempts < this.maxTotalAttempts) {
            continue candidateLoop;
          }

          throw classified;
        }
      }
    }

    throw lastError ?? new Error(`Gemini graph extraction failed on model '${this.modelName}'.`);
  }

  /**
   * Parses and validates raw model text against KnowledgeExtractionResponseSchema
   */
  public parseAndValidate(rawText: string): KnowledgeExtractionResponse {
    let cleanText = rawText.trim();
    const jsonMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      cleanText = jsonMatch[1].trim();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleanText);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new GeminiExtractionSchemaError(
        `Failed to parse Gemini output as JSON: ${this.sanitizeErrorMessage(errMsg)}`,
        cleanText,
      );
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new GeminiExtractionSchemaError(
        'Gemini extraction failed schema validation: output is not an object',
        cleanText,
      );
    }

    const obj = parsed as Record<string, unknown>;

    // Normalize entityType: map type -> entityType if entityType is missing
    if (Array.isArray(obj.entities)) {
      for (const ent of obj.entities) {
        if (ent && typeof ent === 'object') {
          const e = ent as Record<string, unknown>;
          if (!e.entityType && e.type) {
            e.entityType = e.type;
          }
        }
      }
    }

    // Filter out invalid relations (empty endpoints, self-loops, empty evidence)
    if (Array.isArray(obj.relations)) {
      obj.relations = obj.relations.filter((rel: unknown) => {
        if (!rel || typeof rel !== 'object') return false;
        const r = rel as Record<string, unknown>;
        const source = typeof r.sourceEntity === 'string' ? r.sourceEntity.trim() : '';
        const target = typeof r.targetEntity === 'string' ? r.targetEntity.trim() : '';
        const evidence = typeof r.evidence === 'string' ? r.evidence.trim() : '';

        // Endpoints must be non-empty and cannot form self-loops
        if (!source || !target || source.toLowerCase() === target.toLowerCase()) {
          return false;
        }

        // Evidence text must be non-empty
        if (!evidence || evidence.length === 0) {
          return false;
        }

        return true;
      });
    }

    const validation = KnowledgeExtractionResponseSchema.safeParse(obj);
    if (!validation.success) {
      throw new GeminiExtractionSchemaError(
        `Gemini extraction failed schema validation: ${JSON.stringify(validation.error.format())}`,
        cleanText,
      );
    }

    return validation.data;
  }

  /**
   * Health check for configuration verification
   */
  public async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    if (!this.apiKey && !this.client) {
      return { ok: false, message: 'GEMINI_API_KEY is not configured.' };
    }
    return {
      ok: true,
      message: `Gemini extraction configured with model ${this.modelName}`,
    };
  }

  /**
   * Model information metadata
   */
  public async getModelInfo(): Promise<{
    providerName: string;
    model: string;
    maxContextTokens: number;
  }> {
    return {
      providerName: this.providerName,
      model: this.modelName,
      maxContextTokens: 1048576,
    };
  }
}
