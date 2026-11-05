export function normalizeText(rawText: string): string {
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    return '';
  }

  // 1. Normalize Unicode to Canonical Decomposition followed by Canonical Composition (NFC)
  let text = rawText.normalize('NFC');

  // 2. Canonicalize line endings (\r\n and \r -> \n)
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 3. Remove non-printable control characters, but preserve tabs (\t) and newlines (\n)
  // Non-printable: \x00-\x08, \x0B, \x0C, \x0E-\x1F, \x7F
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 4. Replace non-breaking spaces (\u00A0) and zero-width spaces with regular spaces
  text = text.replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]/g, ' ');

  // 5. Trim trailing whitespace on each line while preserving indentation and headings
  const lines = text.split('\n');
  const cleanedLines = lines.map((line) => line.trimEnd());
  text = cleanedLines.join('\n');

  // 6. Collapse excessive blank lines (3 or more newlines become 2 newlines to preserve paragraphs)
  text = text.replace(/\n{3,}/g, '\n\n');

  // 7. Strip leading and trailing empty lines without stripping indentation on the first line
  text = text.replace(/^\n+/, '').replace(/\n+$/, '');

  return text;
}
