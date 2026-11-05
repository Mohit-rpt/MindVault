import type { ExtractionResult } from '@mindvault/shared';

export async function extractText(buffer: Buffer): Promise<ExtractionResult> {
  // Check for binary/null bytes to prevent parsing binary executables as text
  const checkSample = buffer.subarray(0, Math.min(buffer.length, 1024));
  let nullByteCount = 0;
  for (let i = 0; i < checkSample.length; i++) {
    if (checkSample[i] === 0x00) nullByteCount++;
  }
  if (nullByteCount > 2) {
    throw new Error('Invalid text file: Detected binary data or null bytes');
  }

  let text = buffer.toString('utf-8');
  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  return {
    extractedText: text,
    pageCount: 1,
    metadata: {
      format: 'txt',
      byteLength: buffer.length,
    },
  };
}
