import { describe, it, expect } from 'vitest';
import { chunkDocumentText, estimateTokenCount } from './chunker.js';

describe('Document Chunker (Phase 2)', () => {
  describe('estimateTokenCount', () => {
    it('should approximate tokens based on character count with word boundary adjustment', () => {
      const shortText = 'MindVault RAG';
      const tokenCount = estimateTokenCount(shortText);
      expect(tokenCount).toBeGreaterThanOrEqual(2);
      expect(tokenCount).toBeLessThanOrEqual(5);

      expect(estimateTokenCount('')).toBe(0);
    });
  });

  describe('chunkDocumentText', () => {
    it('should return a single chunk if text fits within target token bounds', () => {
      const text =
        '# Introduction\n\nMindVault is a multi-tenant personal knowledge operating system.';
      const chunks = chunkDocumentText(text, {
        targetTokens: 700,
        maxTokens: 900,
        overlapTokens: 120,
      });

      expect(chunks).toHaveLength(1);
      expect(chunks[0].chunkIndex).toBe(0);
      expect(chunks[0].totalChunks).toBe(1);
      expect(chunks[0].content).toContain('MindVault is a multi-tenant');
      expect(chunks[0].metadata?.sectionTitle).toBe('Introduction');
      expect(chunks[0].startChar).toBe(0);
      expect(chunks[0].endChar).toBe(text.length);
    });

    it('should split larger text across multiple chunks with section context', () => {
      // Create a document with two distinct sections each having multiple paragraphs
      const section1Paragraphs = Array.from(
        { length: 15 },
        (_, i) =>
          `Section 1 Paragraph ${i + 1}: Vector embeddings allow semantic retrieval over high-dimensional vector spaces. PostgreSQL with pgvector provides robust cosine distance indexing for fast search.`,
      ).join('\n\n');

      const section2Paragraphs = Array.from(
        { length: 15 },
        (_, i) =>
          `Section 2 Paragraph ${i + 1}: Background workers powered by Redis and BullMQ manage document extraction, normalization, and chunk generation asynchronously.`,
      ).join('\n\n');

      const fullText = `# Section 1: Vector Storage\n\n${section1Paragraphs}\n\n# Section 2: Worker Architecture\n\n${section2Paragraphs}`;

      const chunks = chunkDocumentText(fullText, {
        targetTokens: 200,
        maxTokens: 300,
        overlapTokens: 40,
      });

      expect(chunks.length).toBeGreaterThan(2);

      // Verify chunk index sequence is continuous
      chunks.forEach((chunk, index) => {
        expect(chunk.chunkIndex).toBe(index);
        expect(chunk.totalChunks).toBe(chunks.length);
        expect(chunk.tokenCount).toBeLessThanOrEqual(320); // within bounds with overlap tolerance
        expect(chunk.content.length).toBeGreaterThan(0);
      });

      // Verify first chunk captures Section 1 heading
      expect(chunks[0].metadata?.sectionTitle).toBe('Section 1: Vector Storage');

      // Verify a later chunk captures Section 2 heading
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.metadata?.sectionTitle).toBe('Section 2: Worker Architecture');
    });

    it('should split extremely long sentences without paragraphs gracefully', () => {
      // 2000-word run-on sentence without punctuation or line breaks
      const longWord = 'knowledge '.repeat(1500);
      const chunks = chunkDocumentText(longWord, {
        targetTokens: 200,
        maxTokens: 300,
        overlapTokens: 30,
      });

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.tokenCount).toBeLessThanOrEqual(350);
      });
    });

    it('should correctly attach page numbers when provided', () => {
      const text = 'Page 1 content\n\nPage 2 content';
      const pages = [
        { pageNumber: 1, text: 'Page 1 content' },
        { pageNumber: 2, text: 'Page 2 content' },
      ];

      const chunks = chunkDocumentText(
        text,
        { targetTokens: 100, maxTokens: 200, overlapTokens: 20 },
        pages,
      );
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].metadata?.pageNumber).toBe(1);
    });

    it('should return an empty array for empty string', () => {
      const chunks = chunkDocumentText('   ', {
        targetTokens: 700,
        maxTokens: 900,
        overlapTokens: 120,
      });
      expect(chunks).toEqual([]);
    });
  });
});
