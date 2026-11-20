/**
 * MindVault — Phase 1B.2: Core Gemini Text Generation Provider
 *
 * Implements Google Gemini text generation and streaming using the official @google/genai SDK.
 * Integrates seamlessly with MindVault's RAG, GraphRAG, and conversational memory SSE pipelines.
 *
 * Invariants:
 * 1. Strict contract adherence: implements LLMProvider from @mindvault/shared.
 * 2. Unified SDK usage: powered by official @google/genai SDK (^2.32.0).
 * 3. SSE streaming integrity: preserves 1:1 token chunk delivery, ordering, and clean termination.
 * 4. System prompt isolation: routes system prompt through config.systemInstruction to prevent prompt override.
 * 5. Safe cancellation: links AbortSignal to both SDK config and stream generator loops.
 * 6. Stream interruption protection: NEVER retries a generation after partial output has reached the client.
 * 7. Bounded retries: uses exponential backoff and jitter for transient pre-stream errors (429, 503).
 * 8. Credential hygiene: masks API keys in all logs, health checks, and error envelopes.
 */

import { GoogleGenAI, type PartUnion } from '@google/genai';
import type {
  LLMProvider,
  LLMProviderInfo,
  LLMGenerateOptions,
  LLMGenerateResult,
  LLMStreamChunk,
} from '../types.js';
import {
  GeminiEmbeddingError,
  GeminiAuthenticationError,
  GeminiPermissionError,
  GeminiQuotaExhaustedError,
  GeminiServiceUnavailableError,
  GeminiInvalidRequestError,
  maskGeminiApiKey,
} from './gemini-embedding.provider.js';

export {
  GeminiEmbeddingError,
  GeminiAuthenticationError,
  GeminiPermissionError,
  GeminiQuotaExhaustedError,
  GeminiServiceUnavailableError,
  GeminiInvalidRequestError,
  maskGeminiApiKey,
};

export interface GeminiGenerationConfig {
  /**
   * Google Gemini API key. Defaults to process.env.GEMINI_API_KEY.
   */
  apiKey?: string;

  /**
   * Primary Gemini generation model identifier.
   * Defaults to process.env.GEMINI_GENERATION_MODEL || process.env.GEMINI_MODEL || 'gemini-3.5-flash'.
   */
  modelName?: string;

  /**
   * Request timeout in milliseconds (default 60,000ms).
   */
  timeoutMs?: number;

  /**
   * Maximum retry attempts for transient pre-stream errors (default 3).
   */
  maxRetries?: number;

  /**
   * Initial backoff delay in milliseconds (default 500ms).
   */
  initialRetryDelayMs?: number;

  /**
   * Maximum backoff delay in milliseconds (default 5000ms).
   */
  maxRetryDelayMs?: number;

  /**
   * Default temperature if unspecified in call options (default 0.2).
   */
  defaultTemperature?: number;

  /**
   * Default max output tokens if unspecified in call options (default 1024).
   */
  defaultMaxOutputTokens?: number;

  /**
   * Optional custom client instance for dependency injection and mocking in tests.
   */
  client?: GoogleGenAI;
}

export class GeminiGenerationProvider implements LLMProvider {
  public readonly providerName = 'gemini';
  public readonly modelName: string;

  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly initialRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly defaultTemperature: number;
  private readonly defaultMaxOutputTokens: number;
  private readonly client: GoogleGenAI;

  constructor(config?: GeminiGenerationConfig) {
    const rawModel =
      config?.modelName !== undefined
        ? config.modelName
        : process.env.GEMINI_GENERATION_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    if (typeof rawModel !== 'string' || rawModel.trim().length === 0) {
      throw new GeminiInvalidRequestError('Model name must be a non-empty string.');
    }

    this.modelName = rawModel.trim();

    const rawKey = config?.apiKey || process.env.GEMINI_API_KEY || '';
    this.apiKey = rawKey.trim();

    this.timeoutMs =
      config?.timeoutMs ??
      (process.env.LLM_REQUEST_TIMEOUT ? parseInt(process.env.LLM_REQUEST_TIMEOUT, 10) : 60000);

    this.maxRetries = config?.maxRetries ?? 3;
    this.initialRetryDelayMs = config?.initialRetryDelayMs ?? 500;
    this.maxRetryDelayMs = config?.maxRetryDelayMs ?? 5000;
    this.defaultTemperature =
      config?.defaultTemperature ??
      (process.env.LLM_TEMPERATURE ? parseFloat(process.env.LLM_TEMPERATURE) : 0.2);
    this.defaultMaxOutputTokens =
      config?.defaultMaxOutputTokens ??
      (process.env.LLM_MAX_OUTPUT_TOKENS ? parseInt(process.env.LLM_MAX_OUTPUT_TOKENS, 10) : 1024);

    if (config?.client) {
      this.client = config.client;
    } else {
      this.client = new GoogleGenAI({
        apiKey: this.apiKey,
      });
    }
  }

  /**
   * Returns provider metadata and model context capacity
   */
  public async getModelInfo(): Promise<LLMProviderInfo> {
    return {
      providerName: this.providerName,
      model: this.modelName,
      maxContextTokens: 1048576, // 1M tokens context capacity for Gemini 3.5/3.8 Flash
    };
  }

  /**
   * Lightweight configuration and credential check
   */
  public async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    if (!this.apiKey) {
      return {
        ok: false,
        message: 'GEMINI_API_KEY is not configured in environment (.env).',
      };
    }
    return { ok: true };
  }

  /**
   * Builds multimodal contents payload for the SDK
   */
  private buildContents(prompt: string, options?: LLMGenerateOptions): PartUnion[] {
    const parts: PartUnion[] = [];

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

  /**
   * Returns prioritized list of candidate models for graceful fallback
   */
  private getCandidateModels(): string[] {
    const fallbackList = process.env.GEMINI_FALLBACK_MODELS
      ? process.env.GEMINI_FALLBACK_MODELS.split(',').map((m) => m.trim())
      : ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
    const list = [this.modelName, ...fallbackList];
    return Array.from(new Set(list));
  }

  /**
   * Non-streaming text generation with bounded retries and model fallbacks
   */
  public async generate(prompt: string, options?: LLMGenerateOptions): Promise<LLMGenerateResult> {
    if (!this.apiKey && !this.client) {
      throw new GeminiAuthenticationError(
        'GEMINI_API_KEY is missing. Please configure GEMINI_API_KEY in .env.',
      );
    }

    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new GeminiInvalidRequestError('Input prompt must be a non-empty string.');
    }

    if (options?.signal?.aborted) {
      throw new Error('CLIENT_ABORTED');
    }

    const startTime = performance.now();
    const contents = this.buildContents(prompt, options);
    const candidates = this.getCandidateModels();

    let lastError: unknown = null;

    for (const model of candidates) {
      if (options?.signal?.aborted) {
        throw new Error('CLIENT_ABORTED');
      }

      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        if (options?.signal?.aborted) {
          throw new Error('CLIENT_ABORTED');
        }

        const controller = new AbortController();
        const effectiveTimeout = options?.timeoutMs ?? this.timeoutMs;
        const timeoutHandle = setTimeout(() => controller.abort(), effectiveTimeout);

        const onCallerAbort = () => controller.abort();
        if (options?.signal) {
          options.signal.addEventListener('abort', onCallerAbort, { once: true });
        }

        try {
          const response = (await this.client.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: options?.systemPrompt,
              temperature: options?.temperature ?? this.defaultTemperature,
              maxOutputTokens: options?.maxTokens ?? this.defaultMaxOutputTokens,
              stopSequences: options?.stopSequences,
              abortSignal: controller.signal,
            },
          })) as unknown as {
            text?: string;
            usageMetadata?: {
              promptTokenCount?: number;
              candidatesTokenCount?: number;
            };
            candidates?: Array<{ finishReason?: string }>;
          };

          clearTimeout(timeoutHandle);
          if (options?.signal) {
            options.signal.removeEventListener('abort', onCallerAbort);
          }

          const durationMs = Math.round(performance.now() - startTime);

          return {
            text: response.text ?? '',
            promptTokens: response.usageMetadata?.promptTokenCount,
            outputTokens: response.usageMetadata?.candidatesTokenCount,
            durationMs,
            finishReason: (response.candidates?.[0]?.finishReason || 'stop').toLowerCase(),
          };
        } catch (err: unknown) {
          clearTimeout(timeoutHandle);
          if (options?.signal) {
            options.signal.removeEventListener('abort', onCallerAbort);
          }

          if (options?.signal?.aborted) {
            throw new Error('CLIENT_ABORTED');
          }

          const classified = this.classifyError(err);
          lastError = classified;

          // Non-retryable client errors: fail immediately without retrying or switching models
          if (!classified.isRetryable) {
            throw classified;
          }

          // If retryable and attempts remain, backoff and retry same model
          if (attempt < this.maxRetries) {
            const exponentialDelay = Math.min(
              this.maxRetryDelayMs,
              this.initialRetryDelayMs * Math.pow(2, attempt - 1),
            );
            const jitter = 0.8 + Math.random() * 0.4;
            const delayMs = Math.round(exponentialDelay * jitter);

            // Cancellable retry delay (FINDING-3)
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, delayMs);
              const onAbortDelay = () => {
                clearTimeout(timer);
                resolve();
              };
              if (options?.signal) {
                options.signal.addEventListener('abort', onAbortDelay, { once: true });
              }
            });

            if (options?.signal?.aborted) {
              throw new Error('CLIENT_ABORTED');
            }
          }
        }
      }
    }

    throw lastError ?? new Error(`Gemini generation failed on model '${this.modelName}'.`);
  }

  /**
   * Incremental Server-Sent Events (SSE) compatible streaming generation
   */
  public async *generateStream(
    prompt: string,
    options?: LLMGenerateOptions,
  ): AsyncIterable<LLMStreamChunk> {
    if (!this.apiKey && !this.client) {
      throw new GeminiAuthenticationError(
        'GEMINI_API_KEY is missing. Please configure GEMINI_API_KEY in .env.',
      );
    }

    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new GeminiInvalidRequestError('Input prompt must be a non-empty string.');
    }

    // 1. Immediate pre-flight cancellation check
    if (options?.signal?.aborted) {
      return;
    }

    // 2. Master stream controller and state tracking
    const controller = new AbortController();
    let isStreamActive = true;

    // Caller cancellation listener: propagates caller abort to internal SDK controller (FINDING-1)
    const onCallerAbort = () => {
      if (isStreamActive) {
        controller.abort();
      }
    };

    if (options?.signal) {
      options.signal.addEventListener('abort', onCallerAbort, { once: true });
    }

    // Connection timeout handle
    const effectiveTimeout = options?.timeoutMs ?? this.timeoutMs;
    let timeoutHandle: NodeJS.Timeout | null = setTimeout(() => {
      if (isStreamActive) {
        controller.abort();
      }
    }, effectiveTimeout);

    let hasYieldedAnyChunk = false;
    let selectedModel = this.modelName;

    try {
      const contents = this.buildContents(prompt, options);
      const candidates = this.getCandidateModels();

      let stream: AsyncIterable<{
        text?: string;
        candidates?: Array<{ finishReason?: string }>;
      }> | null = null;
      let lastError: unknown = null;

      // Phase 1: Establish stream connection with model fallback & bounded pre-stream retries
      for (const model of candidates) {
        if (controller.signal.aborted || options?.signal?.aborted) {
          return;
        }

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
          if (controller.signal.aborted || options?.signal?.aborted) {
            return;
          }

          try {
            const responseStream = (await this.client.models.generateContentStream({
              model,
              contents,
              config: {
                systemInstruction: options?.systemPrompt,
                temperature: options?.temperature ?? this.defaultTemperature,
                maxOutputTokens: options?.maxTokens ?? this.defaultMaxOutputTokens,
                stopSequences: options?.stopSequences,
                abortSignal: controller.signal,
              },
            })) as unknown as AsyncIterable<{
              text?: string;
              candidates?: Array<{ finishReason?: string }>;
            }>;

            // Connection established: clear pre-stream connection timeout
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
              timeoutHandle = null;
            }

            stream = responseStream;
            selectedModel = model;
            break;
          } catch (err: unknown) {
            if (controller.signal.aborted || options?.signal?.aborted) {
              return;
            }

            const classified = this.classifyError(err);
            lastError = classified;

            if (!classified.isRetryable) {
              throw classified;
            }

            if (attempt < this.maxRetries) {
              const exponentialDelay = Math.min(
                this.maxRetryDelayMs,
                this.initialRetryDelayMs * Math.pow(2, attempt - 1),
              );
              const jitter = 0.8 + Math.random() * 0.4;
              const delayMs = Math.round(exponentialDelay * jitter);

              // Cancellable retry delay (FINDING-3)
              await new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, delayMs);
                const onAbortDelay = () => {
                  clearTimeout(timer);
                  resolve();
                };
                if (options?.signal) {
                  options.signal.addEventListener('abort', onAbortDelay, { once: true });
                }
                controller.signal.addEventListener('abort', onAbortDelay, { once: true });
              });

              if (controller.signal.aborted || options?.signal?.aborted) {
                return;
              }
            }
          }
        }

        if (stream) {
          break;
        }
      }

      if (controller.signal.aborted || options?.signal?.aborted) {
        return;
      }

      if (!stream) {
        throw lastError ?? new Error(`All Gemini candidate models were unavailable for streaming.`);
      }

      // Phase 2: Stream consumption with strict non-retry on partial emission
      // NOTICE: onCallerAbort remains actively attached so controller.abort() triggers
      // on the underlying SDK request if client cancels during token streaming!
      let finishReason = 'stop';

      for await (const chunk of stream) {
        if (controller.signal.aborted || options?.signal?.aborted) {
          return;
        }

        if (chunk.candidates?.[0]?.finishReason) {
          finishReason = chunk.candidates[0].finishReason.toLowerCase();
        }

        if (chunk.text && chunk.text.length > 0) {
          hasYieldedAnyChunk = true;
          yield {
            text: chunk.text,
            isFinished: false,
          };
        }
      }

      if (controller.signal.aborted || options?.signal?.aborted) {
        return;
      }

      // Mark stream as cleanly completed before yielding final completion chunk
      isStreamActive = false;

      // Exactly one completion event emitted upon clean termination
      yield {
        text: '',
        isFinished: true,
        finishReason,
      };
    } catch (err: unknown) {
      if (controller.signal.aborted || options?.signal?.aborted) {
        return;
      }

      // Stream interruption safety invariant:
      // If chunks have already reached the caller, DO NOT retry. Throw immediately to prevent
      // duplicate partial text delivery and race conditions in SSE stream state.
      const classified = this.classifyError(err);
      if (hasYieldedAnyChunk) {
        throw new Error(
          `Gemini stream interrupted mid-generation on ${selectedModel} (partial output delivered): ${classified.message}`,
        );
      }
      throw classified;
    } finally {
      // Generator-scoped finally block:
      // Guarantees cleanup regardless of normal completion, break, return, or uncaught exception
      isStreamActive = false;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      if (options?.signal) {
        options.signal.removeEventListener('abort', onCallerAbort);
      }
    }
  }

  /**
   * Proactively sanitizes error messages to prevent leakage of credentials, tokens, or headers (FINDING-4)
   */
  private sanitizeErrorMessage(rawMessage: string): string {
    let sanitized = String(rawMessage || 'Unknown error');

    if (this.apiKey && this.apiKey.length > 0) {
      sanitized = sanitized.replaceAll(this.apiKey, maskGeminiApiKey(this.apiKey));
    }

    // Redact standard Google API key patterns: AIza...
    sanitized = sanitized.replace(/AIza[0-9A-Za-z-_]{35}/g, 'AIza...[REDACTED]');

    // Redact query parameter credentials: ?key=..., &api_key=..., &token=...
    sanitized = sanitized.replace(
      /([?&](?:key|api_key|token|access_token|secret)=)[^&\s]+/gi,
      '$1[REDACTED]',
    );

    // Redact authorization headers
    sanitized = sanitized.replace(
      /((?:Bearer|Basic)\s+|key=)[A-Za-z0-9_.-]{10,}/gi,
      '$1[REDACTED]',
    );

    return sanitized;
  }

  /**
   * Translates arbitrary upstream exceptions into typed, sanitized GeminiEmbeddingError hierarchy
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
        error,
      );
    }

    // 401 / Authentication
    if (
      status === 401 ||
      msg.includes('API_KEY_INVALID') ||
      msg.includes('API key not valid') ||
      msg.includes('unauthenticated')
    ) {
      return new GeminiAuthenticationError(
        `Gemini API authentication failed: API key is invalid or revoked. (Key: ${maskGeminiApiKey(this.apiKey)})`,
        error,
      );
    }

    // 403 / Permission
    if (
      status === 403 ||
      msg.includes('PERMISSION_DENIED') ||
      msg.includes('permission') ||
      msg.includes('access not configured')
    ) {
      return new GeminiPermissionError(
        'Gemini API permission denied: Generative Language API is not enabled for this project.',
        error,
      );
    }

    // 429 / Rate limit / Quota
    if (
      status === 429 ||
      msg.includes('RESOURCE_EXHAUSTED') ||
      msg.includes('rate limit') ||
      msg.includes('quota')
    ) {
      return new GeminiQuotaExhaustedError(
        `Gemini API rate limit or quota exceeded for model '${this.modelName}'.`,
        error,
      );
    }

    // 400 / Bad request
    if (status === 400 || msg.includes('INVALID_ARGUMENT')) {
      return new GeminiInvalidRequestError(
        `Gemini API rejected request with invalid argument: ${msg.slice(0, 200)}`,
        error,
      );
    }

    // 5xx / Transient Server Errors
    if (status >= 500 && status < 600) {
      return new GeminiServiceUnavailableError(
        `Gemini API upstream service error (HTTP ${status}): ${msg.slice(0, 200)}`,
        status,
        error,
      );
    }

    // General network / fetch failure
    if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
      return new GeminiServiceUnavailableError(
        `Gemini API network connectivity failure: ${msg.slice(0, 200)}`,
        503,
        error,
      );
    }

    return new GeminiEmbeddingError(`Gemini generation failed: ${msg.slice(0, 250)}`, {
      code: 'UNEXPECTED_ERROR',
      isRetryable: false,
      cause: error,
    });
  }
}
