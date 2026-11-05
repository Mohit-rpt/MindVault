import type { ExtractionResult, ExtractedPage } from '@mindvault/shared';

export async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  // 1. Inspect file signature / magic bytes
  if (buffer.length < 5 || buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
    throw new Error('Invalid PDF: Missing %PDF header file signature');
  }

  // Import pdf-parse dynamically to handle diverse ESM/CJS runtime boundaries
  const pdfModule: any = await import('pdf-parse');
  const pdfParse = pdfModule.default || pdfModule;

  let data: any;
  try {
    data = await pdfParse(buffer);
  } catch (err: any) {
    throw new Error(`Corrupted or unreadable PDF: ${err.message || 'Parser error'}`);
  }

  const rawText = data.text || '';
  const pageCount = data.numpages || 1;
  const warnings: string[] = [];

  // Scanned / Image-only detection
  if (rawText.trim().length < 10 && pageCount > 0) {
    warnings.push('Scanned or image-only PDF detected. OCR is not supported in Phase 2.');
  }

  // Split on form-feed (\f) to preserve page-level boundaries where emitted by pdf-parse
  const rawPages = rawText.split('\f');
  const pages: ExtractedPage[] = [];

  if (rawPages.length > 1) {
    rawPages.forEach((pText: string, idx: number) => {
      if (pText.trim().length > 0) {
        pages.push({
          pageNumber: idx + 1,
          text: pText,
        });
      }
    });
  } else if (rawText.trim().length > 0) {
    pages.push({
      pageNumber: 1,
      text: rawText,
    });
  }

  const metadata: Record<string, unknown> = {
    title: data.info?.Title || undefined,
    author: data.info?.Author || undefined,
    creator: data.info?.Creator || undefined,
    producer: data.info?.Producer || undefined,
    creationDate: data.info?.CreationDate || undefined,
  };

  return {
    extractedText: rawText,
    pageCount,
    pages: pages.length > 0 ? pages : undefined,
    metadata,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
