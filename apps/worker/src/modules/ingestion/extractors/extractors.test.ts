import { describe, it, expect } from 'vitest';
import { extractDocument, extractText, extractMarkdown, extractPdf, extractDocx } from './index.js';

describe('Document Extractors (Phase 2)', () => {
  describe('extractText', () => {
    it('should extract plain text with line breaks preserved', async () => {
      const content = 'Line 1: MindVault Architecture\nLine 2: Vector Search & Ingestion';
      const buffer = Buffer.from(content, 'utf-8');
      const result = await extractText(buffer);

      expect(result.extractedText).toBe(content);
      expect(result.pageCount).toBe(1);
      expect(result.metadata?.format).toBe('txt');
    });

    it('should strip UTF-8 BOM if present', async () => {
      const content = 'MindVault with BOM';
      const bomBuffer = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(content, 'utf-8'),
      ]);
      const result = await extractText(bomBuffer);

      expect(result.extractedText).toBe(content);
      expect(result.extractedText.charCodeAt(0)).not.toBe(0xfeff);
    });

    it('should reject binary files disguised as text (null byte check)', async () => {
      const binaryBuffer = Buffer.from([
        0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x00, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64,
      ]);
      await expect(extractText(binaryBuffer)).rejects.toThrow(/binary data or null bytes/);
    });
  });

  describe('extractMarkdown', () => {
    it('should extract markdown content and parse YAML frontmatter metadata', async () => {
      const mdContent = `---
title: MindVault Blueprint
author: System Architect
---

# MindVault System

MindVault transforms personal documents into actionable vector knowledge.

## Features
- Multi-tenant workspace isolation
- Structure-aware chunking
`;
      const buffer = Buffer.from(mdContent, 'utf-8');
      const result = await extractMarkdown(buffer);

      expect(result.metadata?.title).toBe('MindVault Blueprint');
      expect(result.metadata?.author).toBe('System Architect');

      // Verify frontmatter block is stripped from extracted body text
      expect(result.extractedText).not.toContain('title: MindVault Blueprint');
      expect(result.extractedText).toContain('# MindVault System');
      expect(result.extractedText).toContain('## Features');
    });

    it('should extract standard markdown without frontmatter', async () => {
      const mdContent = '# Simple Note\n\nDirect content without frontmatter.';
      const buffer = Buffer.from(mdContent, 'utf-8');
      const result = await extractMarkdown(buffer);

      expect(result.extractedText).toContain('# Simple Note');
      expect(result.metadata?.title).toBeUndefined();
    });
  });

  describe('extractPdf', () => {
    function createTestPdf(pages: string[]): Buffer {
      const contentObjs = pages.map((text, idx) => {
        const stream = `BT /F1 12 Tf 72 712 Td (${text}) Tj ET`;
        return `${5 + idx} 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`;
      });
      const pageKids = pages.map(
        (_, idx) =>
          `${3 + idx} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + idx} 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >> endobj`,
      );
      const kidsArray = pages.map((_, idx) => `${3 + idx} 0 R`).join(' ');

      const pdf = [
        '%PDF-1.4',
        '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
        `2 0 obj << /Type /Pages /Kids [${kidsArray}] /Count ${pages.length} >> endobj`,
        ...pageKids,
        ...contentObjs,
        'xref',
        `0 ${5 + pages.length * 2}`,
        'trailer << /Root 1 0 R >>',
        'startxref',
        '500',
        '%%EOF',
      ].join('\n');
      return Buffer.from(pdf, 'utf-8');
    }

    it('should reject files without %PDF magic bytes', async () => {
      const invalidPdfBuffer = Buffer.from('This is not a PDF file');
      await expect(extractPdf(invalidPdfBuffer)).rejects.toThrow(
        /Invalid PDF: Missing %PDF header/,
      );
    });

    it('should extract text and page metadata from a valid single-page PDF', async () => {
      const pdfBuffer = createTestPdf(['MindVault Architecture and Vector Indexing']);
      const result = await extractPdf(pdfBuffer);

      expect(result.pageCount).toBe(1);
      expect(result.extractedText).toContain('MindVault Architecture and Vector Indexing');
      expect(result.pages).toBeDefined();
      expect(result.pages).toHaveLength(1);
      expect(result.pages![0].pageNumber).toBe(1);
      expect(result.pages![0].text).toContain('MindVault Architecture');
      expect(result.warnings).toBeUndefined();
    }, 15000);

    it('should extract per-page text objects from a multi-page PDF', async () => {
      const pdfBuffer = createTestPdf([
        'Page 1: Distributed Sharding and Raft',
        'Page 2: Cryptographic Key Lifecycle',
      ]);
      const result = await extractPdf(pdfBuffer);

      expect(result.pageCount).toBe(2);
      expect(result.pages).toHaveLength(2);
      expect(result.pages![0].pageNumber).toBe(1);
      expect(result.pages![0].text).toContain('Page 1: Distributed Sharding');
      expect(result.pages![1].pageNumber).toBe(2);
      expect(result.pages![1].text).toContain('Page 2: Cryptographic Key Lifecycle');
    }, 15000);

    it('should handle special characters and symbols correctly in PDF extraction', async () => {
      const text = 'Directive: JWT_TTL=15m & MAX_POOL=20 [S1] © 2026';
      const pdfBuffer = createTestPdf([text]);
      const result = await extractPdf(pdfBuffer);

      expect(result.extractedText).toContain('Directive: JWT_TTL=15m');
      expect(result.pageCount).toBe(1);
    });

    it('should reject corrupted or malformed PDF with descriptive error', async () => {
      const malformed = Buffer.from('%PDF-1.4 completely corrupted binary content');
      await expect(extractPdf(malformed)).rejects.toThrow(/Corrupted or unreadable PDF/);
    });

    it('should flag scanned or image-only PDF with warning when text is less than 10 characters', async () => {
      const minimalTextPdf = createTestPdf(['Hi']);
      const result = await extractPdf(minimalTextPdf);

      expect(result.warnings).toBeDefined();
      expect(result.warnings![0]).toContain('Scanned or image-only PDF detected');
    });
  });

  describe('extractDocx', () => {
    it('should reject files without ZIP/PK magic bytes', async () => {
      const invalidDocxBuffer = Buffer.from('Not a zip or docx file');
      await expect(extractDocx(invalidDocxBuffer)).rejects.toThrow(
        /Invalid DOCX: Missing zip PK header signature/,
      );
    });
  });

  describe('extractDocument Dispatcher', () => {
    it('should route text files to TextExtractor', async () => {
      const buffer = Buffer.from('Test content', 'utf-8');
      const res = await extractDocument(buffer, 'txt', 'text/plain');
      expect(res.extractedText).toBe('Test content');
    });

    it('should route markdown files to MarkdownExtractor', async () => {
      const buffer = Buffer.from('# Header\nContent', 'utf-8');
      const res = await extractDocument(buffer, 'md', 'text/markdown');
      expect(res.extractedText).toContain('# Header');
    });

    it('should reject unsupported file types', async () => {
      const buffer = Buffer.from('Binary data');
      await expect(extractDocument(buffer, 'mp3', 'audio/mpeg')).rejects.toThrow(
        /Unsupported document format/,
      );
    });
  });
});
