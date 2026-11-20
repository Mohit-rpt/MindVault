/**
 * MindVault — Phase 1B.1: Core Gemini Embedding Provider
 *
 * Implements Google's official Gemini Embedding API using @google/genai SDK.
 *
 * Invariants:
 * 1. Strict 768-dimensional vector output matching MindVault's PostgreSQL pgvector schema.
 * 2. Defense-in-depth numerical validation (rejection of NaN, Infinity, -Infinity, zero-norm vectors).
 * 3. Unit-norm enforcement within documented floating-point tolerance with precision re-normalization.
 * 4. Deterministic 1:1 input/output batch ordering with boundary-safe slicing.
 * 5. Bounded retries with exponential backoff and jitter for transient errors (429, 503).
 * 6. Immediate fail-fast for permanent client errors (401, 403, 400).
 * 7. Zero secret leakage: API keys and sensitive payloads are sanitized in all error envelopes.
 */

import { GoogleGenAI } from '@google/genai';
import type { EmbeddingProvider } from '../types.js';

export interface GeminiEmbeddingConfig {
  /**
   * Google Gemini API key. Defaults to process.env.GEMINI_API_KEY.
   */
  apiKey?: string;

  /**
   * Target Gemini embedding model identifier.
   * Defaults to process.env.GEMINI_EMBEDDING_MODEL or 'gemini-embedding-2'.
   */
  modelName?: string;

  /**
   * Strictly 768 dimensions for MindVault vector(768) schema compatibility.
   */
  dimension?: number;

  /**
   * Maximum texts per batch request sent to Gemini API (max 100, default 32).
   */
  maxBatchSize?: number;

  /**
   * Request timeout in milliseconds (default 30,000ms).
   */
  timeoutMs?: number;

  /**
   * Maximum number of retry attempts for transient errors (default 3).
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
   * Permissible deviation from unit norm (|norm - 1.0|) before rejecting vector (default 1e-4).
   */
  unitNormTolerance?: number;

  /**
   * Optional custom client instance for dependency injection and mocking in tests.
   */
  client?: GoogleGenAI;
}

/**
 * Custom error hierarchy for structured, sanitized error handling
 */
export class GeminiEmbeddingError extends Error {
  public readonly isRetryable: boolean;
  public readonly statusCode?: number;
  public readonly code: string;

  constructor(
    message: string,
    options: { code: string; isRetryable: boolean; statusCode?: number; cause?: unknown },
  ) {
    super(message);
    this.name = 'GeminiEmbeddingError';
    this.code = options.code;
    this.isRetryable = options.isRetryable;
    this.statusCode = options.statusCode;
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

export class GeminiAuthenticationError extends GeminiEmbeddingError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: 'AUTHENTICATION_FAILED', isRetryable: false, statusCode: 401, cause });
    this.name = 'GeminiAuthenticationError';
  }
}

export class GeminiPermissionError extends GeminiEmbeddingError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: 'PERMISSION_DENIED', isRetryable: false, statusCode: 403, cause });
    this.name = 'GeminiPermissionError';
  }
}

export class GeminiQuotaExhaustedError extends GeminiEmbeddingError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: 'QUOTA_EXHAUSTED', isRetryable: true, statusCode: 429, cause });
    this.name = 'GeminiQuotaExhaustedError';
  }
}

export class GeminiServiceUnavailableError extends GeminiEmbeddingError {
  constructor(message: string, statusCode = 503, cause?: unknown) {
    super(message, { code: 'SERVICE_UNAVAILABLE', isRetryable: true, statusCode, cause });
    this.name = 'GeminiServiceUnavailableError';
  }
}

export class GeminiInvalidRequestError extends GeminiEmbeddingError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: 'INVALID_REQUEST', isRetryable: false, statusCode: 400, cause });
    this.name = 'GeminiInvalidRequestError';
  }
}

export class GeminiVectorIntegrityError extends GeminiEmbeddingError {
  constructor(message: string) {
    super(message, { code: 'VECTOR_INTEGRITY_VIOLATION', isRetryable: false });
    this.name = 'GeminiVectorIntegrityError';
  }
}

/**
 * Safely masks API keys for logging or error reporting
 */
export function maskGeminiApiKey(apiKey?: string | null): string {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    return '[NOT CONFIGURED]';
  }
  const clean = apiKey.trim();
  if (clean.length <= 8) {
    return '***[REDACTED SHORT KEY]***';
  }
  return `${clean.slice(0, 4)}...${clean.slice(-4)} (length ${clean.length})`;
}

/**
 * Validates and normalizes vector output.
 * Ensures:
 * 1. Exactly targetDimension elements.
 * 2. All elements are finite numbers (no NaN, Infinity, -Infinity).
 * 3. Euclidean norm is non-zero and within unit-norm tolerance (|norm - 1.0| <= tolerance).
 * 4. Applies precision re-normalization (v / norm) to preserve exact unit length for pgvector cosine indexing.
 */
export function validateAndNormalizeVector(
  vector: unknown,
  targetDimension = 768,
  tolerance = 1e-4,
): number[] {
  if (!Array.isArray(vector)) {
    throw new GeminiVectorIntegrityError(
      `Malformed embedding response: expected array, received ${typeof vector}`,
    );
  }

  if (vector.length !== targetDimension) {
    throw new GeminiVectorIntegrityError(
      `Embedding dimension mismatch: expected ${targetDimension}, received ${vector.length}. Matryoshka outputDimensionality must be enforced.`,
    );
  }

  let sumSquares = 0;
  for (let i = 0; i < targetDimension; i++) {
    const val = vector[i];
    if (typeof val !== 'number' || !Number.isFinite(val) || Number.isNaN(val)) {
      throw new GeminiVectorIntegrityError(
        `Vector element at index ${i} is not a finite number: ${String(val)}`,
      );
    }
    sumSquares += val * val;
  }

  const norm = Math.sqrt(sumSquares);
  if (norm < 1e-7 || !Number.isFinite(norm)) {
    throw new GeminiVectorIntegrityError(
      `Degenerate vector magnitude: norm is ${norm}, expected unit norm ~1.0`,
    );
  }

  const normDelta = Math.abs(norm - 1.0);
  if (normDelta > tolerance) {
    throw new GeminiVectorIntegrityError(
      `Vector unit-norm violation: calculated Euclidean norm is ${norm.toFixed(6)}, which deviates from 1.0 by ${normDelta.toFixed(6)} (allowed tolerance: ${tolerance})`,
    );
  }

  // If already at IEEE-754 unit precision, preserve exact elements without division drift
  if (normDelta <= 1e-12) {
    return vector as number[];
  }

  // Precision re-normalization: normalize by exact norm to eliminate floating-point drift
  const normalized = new Array<number>(targetDimension);
  for (let i = 0; i < targetDimension; i++) {
    normalized[i] = (vector[i] as number) / norm;
  }

  return normalized;
}

/**
 * Production Gemini Embedding Provider implementing MindVault's shared EmbeddingProvider interface.
 */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  public readonly providerName = 'gemini';
  public readonly modelName: string;
  public readonly dimension: number;

  private readonly apiKey: string;
  private readonly maxBatchSize: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly initialRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly unitNormTolerance: number;
  private readonly client: GoogleGenAI;

  constructor(config?: GeminiEmbeddingConfig) {
    const resolvedDimension = config?.dimension ?? 768;
    if (resolvedDimension !== 768) {
      throw new Error(
        `EmbeddingDimensionViolation (§MOD-01): MindVault pgvector schema strictly mandates 768 dimensions. Received unsupported dimension: ${resolvedDimension}.`,
      );
    }
    this.dimension = resolvedDimension;

    this.modelName =
      config?.modelName || process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';

    const rawKey = config?.apiKey || process.env.GEMINI_API_KEY || '';
    this.apiKey = rawKey.trim();

    this.maxBatchSize = Math.min(Math.max(config?.maxBatchSize ?? 32, 1), 100);
    this.timeoutMs = config?.timeoutMs ?? 30000;
    this.maxRetries = config?.maxRetries ?? 3;
    this.initialRetryDelayMs = config?.initialRetryDelayMs ?? 500;
    this.maxRetryDelayMs = config?.maxRetryDelayMs ?? 5000;
    this.unitNormTolerance = config?.unitNormTolerance ?? 1e-4;

    if (config?.client) {
      this.client = config.client;
    } else {
      if (!this.apiKey) {
        throw new GeminiAuthenticationError(
          `GEMINI_API_KEY is not configured. Provider cannot initialize without valid API credentials. Masked key: ${maskGeminiApiKey(this.apiKey)}`,
        );
      }
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
    }
  }

  /**
   * Compatibility getter for legacy callers
   */
  public getDimensions(): number {
    return this.dimension;
  }

  /**
   * Generates a single 768-dimensional embedding vector for query or chunk text.
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new GeminiInvalidRequestError('Input text must be a non-empty string.');
    }

    const results = await this.generateEmbeddings([text]);
    if (!results || results.length === 0 || !results[0]) {
      throw new GeminiVectorIntegrityError(
        'Failed to generate embedding: provider returned empty result.',
      );
    }
    return results[0];
  }

  /**
   * Compatibility alias for embedText
   */
  public async embedText(text: string): Promise<number[]> {
    return this.generateEmbedding(text);
  }

  /**
   * Generates embeddings for a batch of texts with safe chunking, 1:1 order preservation,
   * bounded retries, and defense-in-depth numerical validation.
   */
  public async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!Array.isArray(texts)) {
      throw new GeminiInvalidRequestError('Input texts must be an array of strings.');
    }

    if (texts.length === 0) {
      return [];
    }

    // Validate that all items are non-empty strings
    for (let i = 0; i < texts.length; i++) {
      if (typeof texts[i] !== 'string' || texts[i].trim().length === 0) {
        throw new GeminiInvalidRequestError(`Input text at index ${i} must be a non-empty string.`);
      }
    }

    const allEmbeddings: number[][] = [];

    // Process sequentially in batches to respect rate limits and bounded concurrency
    for (let offset = 0; offset < texts.length; offset += this.maxBatchSize) {
      const batchSlice = texts.slice(offset, offset + this.maxBatchSize);
      const batchVectors = await this.executeBatchWithRetry(batchSlice);

      if (batchVectors.length !== batchSlice.length) {
        throw new GeminiVectorIntegrityError(
          `Batch integrity violation: requested ${batchSlice.length} embeddings, but received ${batchVectors.length} from model '${this.modelName}'.`,
        );
      }

      allEmbeddings.push(...batchVectors);
    }

    return allEmbeddings;
  }

  /**
   * Compatibility alias for embedBatch
   */
  public async embedBatch(texts: string[]): Promise<number[][]> {
    return this.generateEmbeddings(texts);
  }

  /**
   * Executes a single batch of texts against the Gemini API with bounded retries and exponential backoff
   */
  private async executeBatchWithRetry(texts: string[]): Promise<number[][]> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.callGeminiEmbedApi(texts);
      } catch (err: unknown) {
        const classified = this.classifyError(err);
        lastError = classified;

        // Permanent non-retryable failures: fail immediately
        if (!classified.isRetryable || attempt >= this.maxRetries) {
          throw classified;
        }

        // Exponential backoff with jitter: delay = min(maxDelay, initialDelay * 2^(attempt-1)) * (0.8 + 0.4 * rand)
        const exponentialDelay = Math.min(
          this.maxRetryDelayMs,
          this.initialRetryDelayMs * Math.pow(2, attempt - 1),
        );
        const jitter = 0.8 + Math.random() * 0.4;
        const delayMs = Math.round(exponentialDelay * jitter);

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError;
  }

  /**
   * Dispatches the API request to GoogleGenAI models.embedContent
   */
  private async callGeminiEmbedApi(texts: string[]): Promise<number[][]> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = (await this.client.models.embedContent({
        model: this.modelName,
        contents: texts.length === 1 ? texts[0] : (texts as any),
        config: {
          outputDimensionality: this.dimension,
          abortSignal: controller.signal,
        },
      })) as unknown as {
        embeddings?: Array<{ values?: number[] } | number[]>;
        embedding?: { values?: number[] };
        values?: number[][];
      };

      clearTimeout(timeoutHandle);

      // Handle both single-result and batch-result response structures from @google/genai
      const rawVectors: unknown[] = [];
      if (Array.isArray(response.embeddings)) {
        for (const item of response.embeddings) {
          rawVectors.push(
            item && typeof item === 'object' && 'values' in item ? item.values : item,
          );
        }
      } else if (response.embedding?.values) {
        rawVectors.push(response.embedding.values);
      } else if (Array.isArray(response.values)) {
        rawVectors.push(response.values);
      }

      if (rawVectors.length === 0) {
        throw new GeminiVectorIntegrityError(
          `Gemini API returned response with missing or empty embeddings for model '${this.modelName}'.`,
        );
      }

      if (rawVectors.length !== texts.length) {
        throw new GeminiVectorIntegrityError(
          `Gemini API returned ${rawVectors.length} vectors for ${texts.length} input texts.`,
        );
      }

      return rawVectors.map((vec) =>
        validateAndNormalizeVector(vec, this.dimension, this.unitNormTolerance),
      );
    } catch (err: unknown) {
      clearTimeout(timeoutHandle);
      throw err;
    }
  }

  /**
   * Translates arbitrary exceptions and upstream HTTP errors into typed, sanitized GeminiEmbeddingError instances
   */
  private classifyError(error: unknown): GeminiEmbeddingError {
    if (error instanceof GeminiEmbeddingError) {
      return error;
    }

    const err = error as Record<string, unknown> | null | undefined;
    const msg = String(err?.message || error || 'Unknown error');
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
        `Gemini API authentication failed: Provided API key is invalid or revoked. (Key: ${maskGeminiApiKey(this.apiKey)})`,
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
        'Gemini API permission denied: Generative Language API is not enabled or lacks permissions for this project.',
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
        `Gemini API rate limit or quota exceeded for model '${this.modelName}'. Check API quota in Google AI Studio or GCP Console.`,
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

    // Fallback: Default to non-retryable invalid request or internal error
    return new GeminiEmbeddingError(`Gemini embedding operation failed: ${msg.slice(0, 250)}`, {
      code: 'UNEXPECTED_ERROR',
      isRetryable: false,
      cause: error,
    });
  }
}
