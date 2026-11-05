import type { ExtractionResult } from '@mindvault/shared';

export async function extractMarkdown(buffer: Buffer): Promise<ExtractionResult> {
  let text = buffer.toString('utf-8');

  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const metadata: Record<string, unknown> = {
    format: 'markdown',
  };

  // Extract YAML frontmatter if present (between leading --- and ---)
  const frontmatterMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (frontmatterMatch) {
    const rawFrontmatter = frontmatterMatch[1];
    text = text.slice(frontmatterMatch[0].length);

    // Simple line-based frontmatter parser
    const lines = rawFrontmatter.split(/\r?\n/);
    const frontmatterObj: Record<string, string> = {};
    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const val = line
          .slice(colonIdx + 1)
          .trim()
          .replace(/^['"](.*)['"]$/, '$1');
        frontmatterObj[key] = val;
      }
    }
    metadata.frontmatter = frontmatterObj;
    if (frontmatterObj.title) metadata.title = frontmatterObj.title;
    if (frontmatterObj.author) metadata.author = frontmatterObj.author;
  }

  return {
    extractedText: text,
    pageCount: 1,
    metadata,
  };
}
