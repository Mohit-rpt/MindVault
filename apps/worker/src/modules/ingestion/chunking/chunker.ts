import type { ChunkItem, ChunkingOptions, ExtractedPage } from '@mindvault/shared';

export interface ChunkingConfig {
  targetTokens: number;
  maxTokens: number;
  overlapTokens: number;
}

export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  targetTokens: 700,
  maxTokens: 900,
  overlapTokens: 120,
};

/**
 * Standard token estimation heuristic: 1 token ~= 4 characters / ~0.75 words.
 */
export function estimateTokenCount(text: string): number {
  if (!text || text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

interface StructuralUnit {
  text: string;
  tokens: number;
  heading?: string;
}

/**
 * Intelligent, structure-aware chunking engine.
 * Splits documents along heading -> paragraph -> sentence boundaries.
 * Preserves heading context and applies a smooth token overlap.
 */
export function chunkDocument(
  text: string,
  options?: ChunkingOptions,
  pages?: ExtractedPage[],
): ChunkItem[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const config: ChunkingConfig = {
    targetTokens: options?.targetTokens ?? DEFAULT_CHUNKING_CONFIG.targetTokens,
    maxTokens: options?.maxTokens ?? DEFAULT_CHUNKING_CONFIG.maxTokens,
    overlapTokens: options?.overlapTokens ?? DEFAULT_CHUNKING_CONFIG.overlapTokens,
  };

  // 1. Break text into structural units (heading-aware and paragraph-aware)
  const units = decomposeIntoUnits(text, config.maxTokens);
  if (units.length === 0) return [];

  // 2. Assemble units into chunks adhering to targetTokens and maxTokens
  const rawChunks: Array<{
    content: string;
    tokenCount: number;
    heading?: string;
  }> = [];

  let currentText = '';
  let currentTokens = 0;
  let currentHeading: string | undefined = undefined;

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];

    if (!currentHeading && unit.heading) {
      currentHeading = unit.heading;
    }

    const projectedTokens = currentTokens + unit.tokens + (currentText.length > 0 ? 1 : 0);

    // If adding unit exceeds targetTokens and current chunk already has content,
    // or if adding unit would exceed maxTokens
    if (
      currentText.length > 0 &&
      (projectedTokens > config.targetTokens || projectedTokens > config.maxTokens)
    ) {
      rawChunks.push({
        content: currentText.trim(),
        tokenCount: currentTokens,
        heading: currentHeading,
      });

      // Compute overlap text from tail of currentText
      const overlapText = extractOverlapTail(currentText, config.overlapTokens);
      const overlapTokens = estimateTokenCount(overlapText);

      // Start new chunk with overlap
      currentText = overlapText ? `${overlapText}\n\n${unit.text}` : unit.text;
      currentTokens = overlapTokens + unit.tokens;
      currentHeading = unit.heading || currentHeading;
    } else {
      if (currentText.length > 0) {
        currentText += `\n\n${unit.text}`;
      } else {
        currentText = unit.text;
      }
      currentTokens = estimateTokenCount(currentText);
      if (unit.heading) {
        currentHeading = unit.heading;
      }
    }
  }

  // Push remaining content
  if (currentText.trim().length > 0) {
    rawChunks.push({
      content: currentText.trim(),
      tokenCount: estimateTokenCount(currentText.trim()),
      heading: currentHeading,
    });
  }

  // 3. Attach page ranges, character offsets, and metadata
  let runningCharOffset = 0;
  return rawChunks.map((chunk, idx) => {
    let pageStart: number | null = null;
    let pageEnd: number | null = null;

    if (pages && pages.length > 0) {
      const matchedPages: number[] = [];
      const sample = chunk.content.slice(0, Math.min(100, chunk.content.length));
      for (const p of pages) {
        if (p.text.includes(sample)) {
          matchedPages.push(p.pageNumber);
        }
      }
      if (matchedPages.length > 0) {
        pageStart = Math.min(...matchedPages);
        pageEnd = Math.max(...matchedPages);
      } else {
        pageStart = pages[0].pageNumber;
        pageEnd = pages[pages.length - 1].pageNumber;
      }
    }

    const startChar = text.indexOf(chunk.content, runningCharOffset);
    const resolvedStartChar = startChar !== -1 ? startChar : runningCharOffset;
    const endChar = resolvedStartChar + chunk.content.length;
    runningCharOffset = resolvedStartChar;

    return {
      chunkIndex: idx,
      totalChunks: rawChunks.length,
      content: chunk.content,
      tokenCount: chunk.tokenCount,
      startChar: resolvedStartChar,
      endChar,
      heading: chunk.heading,
      section: chunk.heading,
      pageStart,
      pageEnd,
      metadata: {
        heading: chunk.heading,
        sectionTitle: chunk.heading,
        estimatedTokens: chunk.tokenCount,
        totalChunks: rawChunks.length,
        pageNumber: pageStart ?? (pages && pages.length > 0 ? pages[0].pageNumber : undefined),
      },
    };
  });
}

/**
 * Decomposes text into discrete units (sections -> paragraphs -> sentences if needed).
 */
function decomposeIntoUnits(text: string, maxTokens: number): StructuralUnit[] {
  const units: StructuralUnit[] = [];
  const lines = text.split('\n');

  let currentHeading: string | undefined = undefined;
  let currentParagraph = '';

  const flushParagraph = () => {
    if (currentParagraph.trim().length === 0) return;

    const trimmed = currentParagraph.trim();
    const tokens = estimateTokenCount(trimmed);

    // If single paragraph exceeds maxTokens, split by sentences
    if (tokens > maxTokens) {
      const sentenceUnits = splitBySentences(trimmed, maxTokens, currentHeading);
      units.push(...sentenceUnits);
    } else {
      units.push({
        text: trimmed,
        tokens,
        heading: currentHeading,
      });
    }
    currentParagraph = '';
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6}\s+.*)$/);
    if (headingMatch) {
      flushParagraph();
      currentHeading = headingMatch[1].replace(/^#+\s*/, '').trim();
      units.push({
        text: line.trim(),
        tokens: estimateTokenCount(line.trim()),
        heading: currentHeading,
      });
      continue;
    }

    // Blank line indicates paragraph boundary
    if (line.trim().length === 0) {
      flushParagraph();
    } else {
      if (currentParagraph.length > 0) {
        currentParagraph += `\n${line}`;
      } else {
        currentParagraph = line;
      }
    }
  }

  flushParagraph();
  return units;
}

/**
 * Splits oversized paragraphs along sentence boundaries (.!?)
 */
function splitBySentences(
  paragraph: string,
  maxTokens: number,
  heading?: string,
): StructuralUnit[] {
  // Regex splits on sentence endings followed by whitespace
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const units: StructuralUnit[] = [];

  let acc = '';
  let accTokens = 0;

  for (const sentence of sentences) {
    const sTokens = estimateTokenCount(sentence);

    // If a single sentence exceeds maxTokens (e.g. run-on without punctuation)
    if (sTokens > maxTokens) {
      if (acc.trim().length > 0) {
        units.push({
          text: acc.trim(),
          tokens: accTokens,
          heading,
        });
        acc = '';
        accTokens = 0;
      }

      // Fallback word splitting
      const words = sentence.split(/\s+/);
      let wordAcc = '';
      for (const word of words) {
        const testText = wordAcc.length > 0 ? `${wordAcc} ${word}` : word;
        if (estimateTokenCount(testText) > maxTokens && wordAcc.length > 0) {
          units.push({
            text: wordAcc.trim(),
            tokens: estimateTokenCount(wordAcc),
            heading,
          });
          wordAcc = word;
        } else {
          wordAcc = testText;
        }
      }
      if (wordAcc.trim().length > 0) {
        units.push({
          text: wordAcc.trim(),
          tokens: estimateTokenCount(wordAcc),
          heading,
        });
      }
      continue;
    }

    if (accTokens + sTokens > maxTokens && acc.length > 0) {
      units.push({
        text: acc.trim(),
        tokens: accTokens,
        heading,
      });
      acc = sentence;
      accTokens = sTokens;
    } else {
      acc = acc.length > 0 ? `${acc} ${sentence}` : sentence;
      accTokens = estimateTokenCount(acc);
    }
  }

  if (acc.trim().length > 0) {
    units.push({
      text: acc.trim(),
      tokens: accTokens,
      heading,
    });
  }

  return units;
}

/**
 * Extracts trailing text up to overlapTokens length for continuous context.
 */
function extractOverlapTail(text: string, overlapTokens: number): string {
  if (overlapTokens <= 0 || !text) return '';

  const maxChars = overlapTokens * 4;
  if (text.length <= maxChars) {
    return text;
  }

  // Slice tail from maxChars
  const tail = text.slice(text.length - maxChars);
  // Find clean word or sentence boundary in the tail
  const firstSpace = tail.indexOf(' ');
  if (firstSpace !== -1 && firstSpace < tail.length / 2) {
    return tail.slice(firstSpace + 1).trim();
  }
  return tail.trim();
}

export { chunkDocument as chunkDocumentText };
