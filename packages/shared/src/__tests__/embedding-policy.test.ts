import { describe, it, expect } from 'vitest';
import {
  EmbeddingModelPolicy,
  APPROVED_EMBEDDING_MODELS,
} from '../embedding-policy.js';

describe('EmbeddingModelPolicy — Authoritative Model Compatibility Rules', () => {
  describe('resolveFilterPolicy', () => {
    it('defaults to Gemini-compatible retrieval when modelName is undefined', () => {
      const policy = EmbeddingModelPolicy.resolveFilterPolicy();
      expect(policy.targetModel).toBe(APPROVED_EMBEDDING_MODELS.GEMINI_PRIMARY);
      expect(policy.allowNullModel).toBe(false);
      expect(policy.isRecognized).toBe(true);
    });

    it('defaults to Gemini-compatible retrieval when modelName is empty or whitespace', () => {
      const policyNull = EmbeddingModelPolicy.resolveFilterPolicy(null);
      const policyEmpty = EmbeddingModelPolicy.resolveFilterPolicy('   ');

      expect(policyNull.targetModel).toBe('gemini-embedding-2');
      expect(policyNull.allowNullModel).toBe(false);
      expect(policyNull.isRecognized).toBe(true);

      expect(policyEmpty.targetModel).toBe('gemini-embedding-2');
      expect(policyEmpty.allowNullModel).toBe(false);
      expect(policyEmpty.isRecognized).toBe(true);
    });

    it('resolves explicit Ollama model (nomic-embed-text) with null legacy allowance', () => {
      const policy = EmbeddingModelPolicy.resolveFilterPolicy('nomic-embed-text');
      expect(policy.targetModel).toBe('nomic-embed-text');
      expect(policy.allowNullModel).toBe(true);
      expect(policy.isRecognized).toBe(true);
    });

    it('resolves approved Gemini model (gemini-embedding-2) with strict isolation (no nulls)', () => {
      const policy = EmbeddingModelPolicy.resolveFilterPolicy('gemini-embedding-2');
      expect(policy.targetModel).toBe('gemini-embedding-2');
      expect(policy.allowNullModel).toBe(false);
      expect(policy.isRecognized).toBe(true);
    });

    it('marks unapproved or unknown models as unrecognized and disallows nulls', () => {
      const unknownPolicy = EmbeddingModelPolicy.resolveFilterPolicy('text-embedding-3-small');
      expect(unknownPolicy.targetModel).toBe('text-embedding-3-small');
      expect(unknownPolicy.allowNullModel).toBe(false);
      expect(unknownPolicy.isRecognized).toBe(false);

      const oldGeminiPolicy = EmbeddingModelPolicy.resolveFilterPolicy('gemini-embedding-001');
      expect(oldGeminiPolicy.targetModel).toBe('gemini-embedding-001');
      expect(oldGeminiPolicy.allowNullModel).toBe(false);
      expect(oldGeminiPolicy.isRecognized).toBe(false);
    });
  });

  describe('isDocumentCompatible', () => {
    describe('Default / Gemini queries', () => {
      it('matches documents explicitly tagged with gemini-embedding-2', () => {
        expect(EmbeddingModelPolicy.isDocumentCompatible('gemini-embedding-2', 'gemini-embedding-2')).toBe(true);
        expect(EmbeddingModelPolicy.isDocumentCompatible(undefined, 'gemini-embedding-2')).toBe(true);
      });

      it('strictly rejects documents with null or undefined embeddingModel', () => {
        expect(EmbeddingModelPolicy.isDocumentCompatible('gemini-embedding-2', null)).toBe(false);
        expect(EmbeddingModelPolicy.isDocumentCompatible('gemini-embedding-2', undefined)).toBe(false);
        expect(EmbeddingModelPolicy.isDocumentCompatible('gemini-embedding-2', '')).toBe(false);
        expect(EmbeddingModelPolicy.isDocumentCompatible(undefined, null)).toBe(false);
        expect(EmbeddingModelPolicy.isDocumentCompatible(undefined, undefined)).toBe(false);
      });

      it('strictly rejects Ollama documents for Gemini queries', () => {
        expect(EmbeddingModelPolicy.isDocumentCompatible('gemini-embedding-2', 'nomic-embed-text')).toBe(false);
        expect(EmbeddingModelPolicy.isDocumentCompatible(undefined, 'nomic-embed-text')).toBe(false);
      });

      it('strictly rejects other Gemini model documents unless declared compatible', () => {
        expect(EmbeddingModelPolicy.isDocumentCompatible('gemini-embedding-2', 'gemini-embedding-001')).toBe(false);
      });
    });

    describe('Explicit Ollama queries', () => {
      it('matches documents explicitly tagged with nomic-embed-text', () => {
        expect(EmbeddingModelPolicy.isDocumentCompatible('nomic-embed-text', 'nomic-embed-text')).toBe(true);
      });

      it('matches legacy documents with null or undefined embeddingModel', () => {
        expect(EmbeddingModelPolicy.isDocumentCompatible('nomic-embed-text', null)).toBe(true);
        expect(EmbeddingModelPolicy.isDocumentCompatible('nomic-embed-text', undefined)).toBe(true);
        expect(EmbeddingModelPolicy.isDocumentCompatible('nomic-embed-text', '')).toBe(true);
      });

      it('strictly rejects Gemini documents for Ollama queries', () => {
        expect(EmbeddingModelPolicy.isDocumentCompatible('nomic-embed-text', 'gemini-embedding-2')).toBe(false);
      });

      it('strictly rejects arbitrary unknown model documents for Ollama queries', () => {
        expect(EmbeddingModelPolicy.isDocumentCompatible('nomic-embed-text', 'custom-bert-v1')).toBe(false);
      });
    });

    describe('Unknown / Unapproved model queries', () => {
      it('never matches any document when the query model is unrecognized', () => {
        expect(EmbeddingModelPolicy.isDocumentCompatible('unknown-model', 'unknown-model')).toBe(false);
        expect(EmbeddingModelPolicy.isDocumentCompatible('unknown-model', null)).toBe(false);
        expect(EmbeddingModelPolicy.isDocumentCompatible('unknown-model', 'nomic-embed-text')).toBe(false);
        expect(EmbeddingModelPolicy.isDocumentCompatible('unknown-model', 'gemini-embedding-2')).toBe(false);
      });
    });
  });
});
