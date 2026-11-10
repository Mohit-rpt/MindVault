/**
 * MindVault — Knowledge Graph: Extraction Error Classifier (§6.4.4, §6.9, Task 6.4.4)
 *
 * Provides deterministic classification of runtime errors during knowledge graph extraction
 * into TRANSIENT, PERMANENT, FENCED, and DEFERRED categories.
 *
 * Guarantees that transient infrastructure faults bubble to BullMQ for exact exponential retries (2s, 4s),
 * permanent schema/content failures finalize with durable receipts without wasting retries, and
 * fenced/deferred jobs never trigger accidental finalization.
 */

import { ExtractionFencedError } from './extraction-fenced.error.js';
import type { ExtractionErrorType } from '@mindvault/shared';

export type { ExtractionErrorType };

/**
 * Thrown when an external infrastructure or transient failure occurs
 * (e.g., Ollama/Gemini timeout, HTTP 429 rate limit, network drop, PostgreSQL deadlock).
 * Bubbles up to BullMQ to execute configured retries (2s, 4s).
 */
export class ExtractionTransientError extends Error {
  public readonly code = 'EXTRACTION_TRANSIENT';
  public readonly isTransient = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ExtractionTransientError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a permanent, non-retryable failure occurs on document chunk content
 * (e.g., Zod schema validation rejection, corrupt unparseable text, fatal document not found).
 * Finalizes document state in PostgreSQL with a terminal receipt without burning BullMQ retries.
 */
export class ExtractionPermanentError extends Error {
  public readonly code = 'EXTRACTION_PERMANENT';
  public readonly isPermanent = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ExtractionPermanentError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ExtractionErrorClassifier {
  /**
   * Deterministically classifies an unknown error into one of the four blueprint categories:
   * - FENCED: Worker lease expired or run superseded (Task 6.4.3). Must halt immediately without finalization.
   * - DEFERRED: Cooperative worker shutdown or same-run delay (Task 6.4.2). Must defer via BullMQ.
   * - TRANSIENT: Recoverable infrastructure fault (429, timeout, network, deadlock). Must bubble to BullMQ retries.
   * - PERMANENT: Content/schema corruption. Must record failure and finalize without BullMQ retries.
   */
  public static classify(error: unknown): ExtractionErrorType {
    if (!error) {
      return 'TRANSIENT';
    }

    const err = error as Record<string, any>;
    const name = typeof err.name === 'string' ? err.name : '';
    const message = typeof err.message === 'string' ? err.message : String(error);
    const code = typeof err.code === 'string' ? err.code : '';
    const status =
      typeof err.status === 'number'
        ? err.status
        : typeof err.statusCode === 'number'
          ? err.statusCode
          : undefined;

    // 1. FENCED ERRORS (Task 6.4.3)
    if (
      error instanceof ExtractionFencedError ||
      name === 'ExtractionFencedError' ||
      code === 'EXTRACTION_FENCED' ||
      message.includes('Worker fenced') ||
      message.includes('Pre-commit lease validation failed') ||
      message.includes('Extraction run superseded')
    ) {
      return 'FENCED';
    }

    // 2. DEFERRED ERRORS (Task 6.4.2)
    if (
      name === 'WaitingError' ||
      name === 'DelayedError' ||
      code === 'WAITING_ERROR' ||
      code === 'DELAYED_ERROR' ||
      message.includes('bullmq:waiting') ||
      message.includes('bullmq:delayed')
    ) {
      return 'DEFERRED';
    }

    // 3. EXPLICIT CATEGORY OVERRIDES
    if (
      error instanceof ExtractionTransientError ||
      err.isTransient === true ||
      code === 'EXTRACTION_TRANSIENT'
    ) {
      return 'TRANSIENT';
    }

    if (
      error instanceof ExtractionPermanentError ||
      err.isPermanent === true ||
      code === 'EXTRACTION_PERMANENT' ||
      name === 'UnrecoverableError' ||
      code === 'bullmq:unrecoverable'
    ) {
      return 'PERMANENT';
    }

    // 4. PERMANENT SCHEMA / PARSE / INTEGRITY FAILURES
    if (
      name === 'ZodError' ||
      name === 'ValidationError' ||
      (name === 'SyntaxError' && message.includes('JSON')) ||
      message.includes('Unexpected token') ||
      message.includes('Document not found') ||
      message.includes('Workspace mismatch') ||
      message.includes('schema validation failed')
    ) {
      return 'PERMANENT';
    }

    // 5. TRANSIENT INFRASTRUCTURE & NETWORK FAULTS
    // A. HTTP Status Codes
    if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
      return 'TRANSIENT';
    }

    // B. Known Network / Socket Error Codes
    const transientCodes = new Set([
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'EPIPE',
      'ENOTFOUND',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_SOCKET',
      'P2024', // Prisma: Connection pool timeout
      'P2034', // Prisma: Transaction conflict / deadlock
      '40P01', // PostgreSQL: Deadlock detected
      '57014', // PostgreSQL: Query canceled / Statement timeout
      '08006', // PostgreSQL: Connection failure
      '08001', // PostgreSQL: Unable to establish connection
      '08004', // PostgreSQL: Server rejected connection
      '53300', // PostgreSQL: Too many connections
    ]);

    if (transientCodes.has(code)) {
      return 'TRANSIENT';
    }

    // C. Timeout and Abort signals (non-fenced / non-shutdown)
    if (name === 'AbortError' || message.includes('timed out') || message.includes('timeout')) {
      return 'TRANSIENT';
    }

    // D. Message matching for transient external service errors
    const lowerMsg = message.toLowerCase();
    if (
      lowerMsg.includes('429') ||
      lowerMsg.includes('rate limit') ||
      lowerMsg.includes('too many requests') ||
      lowerMsg.includes('resource_exhausted') ||
      lowerMsg.includes('fetch failed') ||
      lowerMsg.includes('socket hang up') ||
      lowerMsg.includes('connection reset') ||
      lowerMsg.includes('connection refused') ||
      lowerMsg.includes('connection terminated unexpectedly') ||
      lowerMsg.includes('deadlock detected') ||
      lowerMsg.includes('service unavailable') ||
      lowerMsg.includes('gateway timeout') ||
      lowerMsg.includes('bad gateway')
    ) {
      return 'TRANSIENT';
    }

    // 6. DEFAULT FOR UNKNOWN ERRORS
    // Under Blueprint v4.5.6, unexpected runtime errors during model inference/HTTP requests
    // must default to TRANSIENT so BullMQ provides configured retries (2s, 4s) rather than
    // prematurely permanently failing a document due to an unknown transient glitch.
    return 'TRANSIENT';
  }
}
