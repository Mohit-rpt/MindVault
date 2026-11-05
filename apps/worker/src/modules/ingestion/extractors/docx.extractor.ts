import type { ExtractionResult } from '@mindvault/shared';

export async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  // 1. Validate DOCX zip magic bytes (0x50 0x4B 0x03 0x04)
  if (
    buffer.length < 4 ||
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b ||
    buffer[2] !== 0x03 ||
    buffer[3] !== 0x04
  ) {
    throw new Error('Invalid DOCX: Missing zip PK header signature');
  }

  const mammothModule: any = await import('mammoth');
  const mammoth = mammothModule.default || mammothModule;

  let result: any;
  try {
    result = await mammoth.extractRawText({ buffer });
  } catch (err: any) {
    throw new Error(`Corrupted or malformed DOCX file: ${err.message || 'Extractor failed'}`);
  }

  const extractedText = result.value || '';
  const warnings: string[] = [];

  if (result.messages && Array.isArray(result.messages)) {
    for (const msg of result.messages) {
      if (msg.message) {
        warnings.push(msg.message);
      }
    }
  }

  return {
    extractedText,
    metadata: {
      format: 'docx',
    },
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
