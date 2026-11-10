import type { ExtractionResult, ExtractedPage } from '@mindvault/shared';

export async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  // 1. Inspect file signature / magic bytes
  if (buffer.length < 5 || buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
    throw new Error('Invalid PDF: Missing %PDF header file signature');
  }

  // Import pdf-parse dynamically to handle diverse ESM/CJS runtime boundaries
  const pdfModule: any = await import('pdf-parse');

  let rawText = '';
  let pageCount = 1;
  const pages: ExtractedPage[] = [];
  let metadata: Record<string, unknown> = {};

  try {
    if (typeof pdfModule.PDFParse === 'function') {
      // pdf-parse v2.x class API
      const parser = new pdfModule.PDFParse({ data: buffer });
      try {
        const textResult = await parser.getText();
        const infoResult = await parser.getInfo().catch(() => ({}));

        rawText = textResult.text || '';
        pageCount = textResult.total || (textResult.pages ? textResult.pages.length : 1);

        if (textResult.pages && textResult.pages.length > 0) {
          for (const page of textResult.pages) {
            if (page.text && page.text.trim().length > 0) {
              pages.push({
                pageNumber: page.num,
                text: page.text,
              });
            }
          }
        }

        const info = infoResult.info || {};
        metadata = {
          title: info.Title || undefined,
          author: info.Author || undefined,
          creator: info.Creator || undefined,
          producer: info.Producer || undefined,
          creationDate: info.CreationDate || undefined,
        };
      } finally {
        await parser.destroy().catch(() => {});
      }
    } else if (typeof (pdfModule.default || pdfModule) === 'function') {
      // pdf-parse v1.x fallback callable function API
      const parseFn = pdfModule.default || pdfModule;
      const data = await parseFn(buffer);

      rawText = data.text || '';
      pageCount = data.numpages || 1;

      const rawPages = rawText.split('\f');
      if (rawPages.length > 1) {
        rawPages.forEach((pText: string, idx: number) => {
          if (pText.trim().length > 0) {
            pages.push({ pageNumber: idx + 1, text: pText });
          }
        });
      }

      metadata = {
        title: data.info?.Title || undefined,
        author: data.info?.Author || undefined,
        creator: data.info?.Creator || undefined,
        producer: data.info?.Producer || undefined,
        creationDate: data.info?.CreationDate || undefined,
      };
    } else {
      throw new Error(
        'Unsupported pdf-parse export structure: neither PDFParse class nor callable function found',
      );
    }
  } catch (err: any) {
    throw new Error(`Corrupted or unreadable PDF: ${err.message || 'Parser error'}`);
  }

  // Ensure fallback page mapping if multi-page parser yielded text but empty pages array
  if (pages.length === 0 && rawText.trim().length > 0) {
    pages.push({
      pageNumber: 1,
      text: rawText,
    });
  }

  // Calculate clean substantive text across extracted pages, avoiding synthetic pagination footers
  const substantiveText = pages
    .map((p) => p.text)
    .join('\n\n')
    .trim();
  const effectiveText =
    substantiveText.length > 0
      ? substantiveText
      : rawText.replace(/--\s*\d+\s*of\s*\d+\s*--/g, '').trim();

  const finalExtractedText = substantiveText.length > 0 ? substantiveText : rawText;

  const warnings: string[] = [];

  // Scanned / Image-only detection
  if (effectiveText.length < 10 && pageCount > 0) {
    warnings.push('Scanned or image-only PDF detected. OCR is not supported in Phase 2.');
  }

  return {
    extractedText: finalExtractedText,
    pageCount,
    pages: pages.length > 0 ? pages : undefined,
    metadata,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
