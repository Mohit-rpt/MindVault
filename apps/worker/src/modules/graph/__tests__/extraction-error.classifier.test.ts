import { describe, it, expect } from 'vitest';
import {
  ExtractionErrorClassifier,
  ExtractionTransientError,
  ExtractionPermanentError,
  ExtractionFencedError,
} from '../errors/index.js';
import { WaitingError } from 'bullmq';

describe('Task 6.4.4: ExtractionErrorClassifier Unit Tests', () => {
  describe('TRANSIENT classification', () => {
    it('classifies HTTP 429 rate limit errors as TRANSIENT', () => {
      const errWithStatus = Object.assign(new Error('Rate limit exceeded'), { status: 429 });
      expect(ExtractionErrorClassifier.classify(errWithStatus)).toBe('TRANSIENT');

      const errWithStatusCode = Object.assign(new Error('Too many requests'), { statusCode: 429 });
      expect(ExtractionErrorClassifier.classify(errWithStatusCode)).toBe('TRANSIENT');

      const errWithMessage = new Error('Gemini API: RESOURCE_EXHAUSTED rate limit exceeded');
      expect(ExtractionErrorClassifier.classify(errWithMessage)).toBe('TRANSIENT');
    });

    it('classifies HTTP 5xx server errors as TRANSIENT', () => {
      expect(ExtractionErrorClassifier.classify(Object.assign(new Error('Internal Server Error'), { status: 500 }))).toBe('TRANSIENT');
      expect(ExtractionErrorClassifier.classify(Object.assign(new Error('Bad Gateway'), { status: 502 }))).toBe('TRANSIENT');
      expect(ExtractionErrorClassifier.classify(Object.assign(new Error('Service Unavailable'), { status: 503 }))).toBe('TRANSIENT');
      expect(ExtractionErrorClassifier.classify(Object.assign(new Error('Gateway Timeout'), { status: 504 }))).toBe('TRANSIENT');
    });

    it('classifies network socket and connection drop error codes as TRANSIENT', () => {
      const networkCodes = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ENOTFOUND'];
      for (const code of networkCodes) {
        const err = Object.assign(new Error(`Socket failure ${code}`), { code });
        expect(ExtractionErrorClassifier.classify(err)).toBe('TRANSIENT');
      }
    });

    it('classifies Undici and fetch failures as TRANSIENT', () => {
      const fetchErr = new TypeError('fetch failed');
      expect(ExtractionErrorClassifier.classify(fetchErr)).toBe('TRANSIENT');

      const undiciErr = Object.assign(new Error('Connection timed out'), { code: 'UND_ERR_CONNECT_TIMEOUT' });
      expect(ExtractionErrorClassifier.classify(undiciErr)).toBe('TRANSIENT');
    });

    it('classifies AbortError and request timeouts as TRANSIENT', () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      expect(ExtractionErrorClassifier.classify(abortErr)).toBe('TRANSIENT');

      const timeoutErr = new Error('Ollama extraction timed out after 30000ms');
      expect(ExtractionErrorClassifier.classify(timeoutErr)).toBe('TRANSIENT');
    });

    it('classifies PostgreSQL deadlocks (40P01) and pool timeouts as TRANSIENT', () => {
      const deadlockErr = Object.assign(new Error('deadlock detected'), { code: '40P01' });
      expect(ExtractionErrorClassifier.classify(deadlockErr)).toBe('TRANSIENT');

      const statementTimeoutErr = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
      expect(ExtractionErrorClassifier.classify(statementTimeoutErr)).toBe('TRANSIENT');

      const prismaPoolTimeout = Object.assign(new Error('Timed out fetching a new connection from the pool'), { code: 'P2024' });
      expect(ExtractionErrorClassifier.classify(prismaPoolTimeout)).toBe('TRANSIENT');
    });

    it('classifies ExtractionTransientError as TRANSIENT', () => {
      const transient = new ExtractionTransientError('Upstream Ollama is offline');
      expect(ExtractionErrorClassifier.classify(transient)).toBe('TRANSIENT');
      expect(transient.isTransient).toBe(true);
      expect(transient.code).toBe('EXTRACTION_TRANSIENT');
    });
  });

  describe('PERMANENT classification', () => {
    it('classifies Zod schema validation errors as PERMANENT', () => {
      const zodErr = new Error('Zod validation error');
      zodErr.name = 'ZodError';
      expect(ExtractionErrorClassifier.classify(zodErr)).toBe('PERMANENT');
    });

    it('classifies SyntaxError for malformed JSON as PERMANENT', () => {
      const syntaxErr = new SyntaxError('Unexpected token < in JSON at position 0');
      expect(ExtractionErrorClassifier.classify(syntaxErr)).toBe('PERMANENT');
    });

    it('classifies missing document and workspace mismatch as PERMANENT', () => {
      expect(ExtractionErrorClassifier.classify(new Error('Document not found in workspace ws-123'))).toBe('PERMANENT');
      expect(ExtractionErrorClassifier.classify(new Error('Workspace mismatch: doc belongs to ws-456'))).toBe('PERMANENT');
    });

    it('classifies ExtractionPermanentError as PERMANENT', () => {
      const perm = new ExtractionPermanentError('Invalid chunk content: unparseable binary data');
      expect(ExtractionErrorClassifier.classify(perm)).toBe('PERMANENT');
      expect(perm.isPermanent).toBe(true);
      expect(perm.code).toBe('EXTRACTION_PERMANENT');
    });

    it('classifies BullMQ UnrecoverableError as PERMANENT', () => {
      const unrecoverable = new Error('bullmq:unrecoverable');
      unrecoverable.name = 'UnrecoverableError';
      expect(ExtractionErrorClassifier.classify(unrecoverable)).toBe('PERMANENT');
    });
  });

  describe('FENCED classification', () => {
    it('classifies ExtractionFencedError and lease failure messages as FENCED', () => {
      const fenced = new ExtractionFencedError('Active extraction run superseded');
      expect(ExtractionErrorClassifier.classify(fenced)).toBe('FENCED');

      const errByMsg = new Error('Pre-commit lease validation failed: lease expired or ownership lost before commit');
      expect(ExtractionErrorClassifier.classify(errByMsg)).toBe('FENCED');

      const errByCode = Object.assign(new Error('Ownership mismatch'), { code: 'EXTRACTION_FENCED' });
      expect(ExtractionErrorClassifier.classify(errByCode)).toBe('FENCED');
    });
  });

  describe('DEFERRED classification', () => {
    it('classifies BullMQ WaitingError and DelayedError as DEFERRED', () => {
      const waiting = new WaitingError();
      expect(ExtractionErrorClassifier.classify(waiting)).toBe('DEFERRED');

      const delayed = new Error('bullmq:delayed');
      delayed.name = 'DelayedError';
      expect(ExtractionErrorClassifier.classify(delayed)).toBe('DEFERRED');
    });
  });

  describe('Unknown Errors and Cause Preservation', () => {
    it('classifies completely unknown errors as TRANSIENT by default to enable BullMQ retry opportunity', () => {
      const unknownErr = new Error('An unexpected mysterious runtime exception');
      expect(ExtractionErrorClassifier.classify(unknownErr)).toBe('TRANSIENT');

      expect(ExtractionErrorClassifier.classify(null)).toBe('TRANSIENT');
      expect(ExtractionErrorClassifier.classify('arbitrary string error')).toBe('TRANSIENT');
    });

    it('preserves underlying causes when wrapped in ExtractionTransientError or ExtractionPermanentError', () => {
      const original = new Error('Raw socket closed unexpectedly');
      const wrappedTransient = new ExtractionTransientError('Failed during model inference', { cause: original });
      expect(wrappedTransient.cause).toBe(original);
      expect(wrappedTransient.message).toBe('Failed during model inference');

      const schemaFail = new SyntaxError('Bad JSON');
      const wrappedPermanent = new ExtractionPermanentError('Permanent parsing failure', { cause: schemaFail });
      expect(wrappedPermanent.cause).toBe(schemaFail);
    });
  });
});
