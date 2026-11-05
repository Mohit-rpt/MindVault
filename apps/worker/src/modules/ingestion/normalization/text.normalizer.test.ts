import { describe, it, expect } from 'vitest';
import { normalizeText } from './text.normalizer.js';

describe('Text Normalizer (Phase 2)', () => {
  it('should normalize Windows CRLF line endings to LF', () => {
    const input = 'First line\r\nSecond line\r\nThird line';
    const output = normalizeText(input);
    expect(output).toBe('First line\nSecond line\nThird line');
    expect(output).not.toContain('\r');
  });

  it('should strip non-printable ASCII control characters while keeping tabs and newlines', () => {
    const input = 'Clean text\x00 with \x08hidden\x1F control\x07 chars\tpreserved tab\nnew line';
    const output = normalizeText(input);
    expect(output).toBe('Clean text with hidden control chars\tpreserved tab\nnew line');
  });

  it('should perform Unicode NFC normalization', () => {
    // 'e\u0301' (e + combining acute accent) should normalize to '\u00e9' (é)
    const decomposed = 'caf\u0065\u0301';
    const precomposed = 'caf\u00e9';
    expect(decomposed.length).toBe(5);
    expect(precomposed.length).toBe(4);

    const normalized = normalizeText(decomposed);
    expect(normalized).toBe(precomposed);
    expect(normalized.length).toBe(4);
  });

  it('should collapse consecutive blank lines to a maximum of two newlines', () => {
    const input = 'Paragraph A\n\n\n\n\n\nParagraph B';
    const output = normalizeText(input);
    expect(output).toBe('Paragraph A\n\nParagraph B');
  });

  it('should trim trailing whitespace from lines without removing indentations', () => {
    const input = '  Indented line    \n    Second indent   \t  \nClean line';
    const output = normalizeText(input);
    expect(output).toBe('  Indented line\n    Second indent\nClean line');
  });

  it('should preserve markdown headings and list structures', () => {
    const input = `# Main Title\n\n## Section 1\n\n- Item 1\n- Item 2\n  - Sub-item A\n\n1. Numbered one\n2. Numbered two`;
    const output = normalizeText(input);
    expect(output).toContain('# Main Title');
    expect(output).toContain('## Section 1');
    expect(output).toContain('- Item 1');
    expect(output).toContain('  - Sub-item A');
    expect(output).toContain('1. Numbered one');
  });

  it('should return empty string for empty or whitespace-only inputs', () => {
    expect(normalizeText('')).toBe('');
    expect(normalizeText('    \n\t\r\n   ')).toBe('');
  });
});
