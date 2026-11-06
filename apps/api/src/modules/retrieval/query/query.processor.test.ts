import { describe, it, expect } from 'vitest';
import { QueryProcessor } from './query.processor.js';

describe('QueryProcessor', () => {
  describe('validate', () => {
    it('should validate valid queries', () => {
      const res = QueryProcessor.validate('What is backpropagation in deep neural networks?');
      expect(res.isValid).toBe(true);
      expect(res.error).toBeUndefined();
    });

    it('should reject non-string input', () => {
      expect(QueryProcessor.validate(null).isValid).toBe(false);
      expect(QueryProcessor.validate(123).isValid).toBe(false);
      expect(QueryProcessor.validate({}).isValid).toBe(false);
    });

    it('should reject empty or whitespace-only queries', () => {
      expect(QueryProcessor.validate('').isValid).toBe(false);
      expect(QueryProcessor.validate('   ').isValid).toBe(false);
    });

    it('should reject queries exceeding 1000 characters', () => {
      const longQuery = 'a'.repeat(1001);
      const res = QueryProcessor.validate(longQuery);
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('exceeds maximum');
    });
  });

  describe('process', () => {
    it('should normalize Unicode NFKC and collapse multiple spaces', () => {
      const input = '  What   is   RAG   \u00A0  technology?  ';
      const processed = QueryProcessor.process(input);
      expect(processed.rawQuery).toBe(input);
      expect(processed.normalizedQuery).toBe('What is RAG technology?');
      expect(processed.characterCount).toBe(23);
    });

    it('should strip unprintable control characters', () => {
      const input = 'Hello\u0000World\u0007\u001F!';
      const processed = QueryProcessor.process(input);
      expect(processed.normalizedQuery).toBe('HelloWorld!');
    });

    it('should normalize smart quotes to ASCII quotes and extract exact phrases', () => {
      const input = 'Find “machine learning” and ‘gradient descent’';
      const processed = QueryProcessor.process(input);
      expect(processed.normalizedQuery).toBe('Find "machine learning" and \'gradient descent\'');
      expect(processed.exactPhrases).toContain('machine learning');
    });

    it('should extract distinct query terms', () => {
      const input = 'Neural networks deep neural networks';
      const processed = QueryProcessor.process(input);
      expect(processed.terms).toContain('neural');
      expect(processed.terms).toContain('networks');
      expect(processed.terms).toContain('deep');
      // Set deduplication check
      expect(processed.terms.filter((t) => t === 'neural').length).toBe(1);
    });

    it('should sanitize unbalanced quotes in keywordQuery', () => {
      const input = 'Find "unbalanced quote in query';
      const processed = QueryProcessor.process(input);
      expect(processed.keywordQuery).toBe('Find unbalanced quote in query');
    });

    it('should calculate non-zero token estimate', () => {
      const input = 'Explain the difference between supervised and unsupervised learning';
      const processed = QueryProcessor.process(input);
      expect(processed.tokenEstimate).toBeGreaterThan(5);
    });
  });
});
