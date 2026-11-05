import type { ExtractionResult } from '@mindvault/shared';
import { extractPdf } from './pdf.extractor.js';
import { extractDocx } from './docx.extractor.js';
import { extractText } from './text.extractor.js';
import { extractMarkdown } from './markdown.extractor.js';

export async function extractDocument(
  buffer: Buffer,
  extension: string,
  mimeType?: string,
): Promise<ExtractionResult> {
  if (!buffer || buffer.length === 0) {
    throw new Error('Cannot extract empty document: 0 bytes received');
  }

  const normalizedExt = extension.replace(/^\./, '').toLowerCase().trim();
  const normalizedMime = (mimeType || '').toLowerCase().trim();

  if (normalizedExt === 'pdf' || normalizedMime === 'application/pdf') {
    return extractPdf(buffer);
  }

  if (
    normalizedExt === 'docx' ||
    normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return extractDocx(buffer);
  }

  if (
    normalizedExt === 'md' ||
    normalizedExt === 'markdown' ||
    normalizedMime === 'text/markdown' ||
    normalizedMime === 'text/x-markdown'
  ) {
    return extractMarkdown(buffer);
  }

  if (
    normalizedExt === 'txt' ||
    normalizedMime === 'text/plain' ||
    normalizedMime.startsWith('text/')
  ) {
    return extractText(buffer);
  }

  throw new Error(
    `Unsupported document format: extension '.${normalizedExt}', MIME type '${normalizedMime}'. Supported formats: PDF, DOCX, TXT, MD.`,
  );
}

export { extractPdf, extractDocx, extractText, extractMarkdown };
