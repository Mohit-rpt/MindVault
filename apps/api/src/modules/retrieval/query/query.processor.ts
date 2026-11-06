/**
 * MindVault — Retrieval Engine: Query Processor
 *
 * Responsibilities:
 * - Validates input query constraints (type, length, content)
 * - Normalizes Unicode (NFKC) and collapses irregular whitespace
 * - Strips unprintable control characters while preserving query semantics
 * - Extracts quoted phrases and search terms for keyword query execution
 * - Estimates token consumption for budget calculations
 * - Preserves immutable original query alongside normalized outputs
 */

export interface ProcessedQuery {
  /** The immutable raw query supplied by the user/client */
  rawQuery: string;
  /** Normalized Unicode (NFKC) string with collapsed whitespace */
  normalizedQuery: string;
  /** Sanitized query string safe for PostgreSQL websearch_to_tsquery or plain search */
  keywordQuery: string;
  /** Extracted individual alphanumeric tokens */
  terms: string[];
  /** Quoted phrases extracted from the query (e.g. "machine learning") */
  exactPhrases: string[];
  /** Estimated token count */
  tokenEstimate: number;
  /** Total characters in normalized form */
  characterCount: number;
}

export interface QueryValidationResult {
  isValid: boolean;
  error?: string;
}

export class QueryProcessor {
  private static readonly MIN_QUERY_LENGTH = 1;
  private static readonly MAX_QUERY_LENGTH = 1000;

  /**
   * Validates raw query string against system length and content constraints.
   */
  public static validate(rawQuery: unknown): QueryValidationResult {
    if (typeof rawQuery !== 'string') {
      return { isValid: false, error: 'Query must be a string' };
    }

    const trimmed = rawQuery.trim();
    if (trimmed.length < this.MIN_QUERY_LENGTH) {
      return { isValid: false, error: 'Query cannot be empty' };
    }

    if (rawQuery.length > this.MAX_QUERY_LENGTH) {
      return {
        isValid: false,
        error: `Query length (${rawQuery.length}) exceeds maximum allowed (${this.MAX_QUERY_LENGTH})`,
      };
    }

    return { isValid: true };
  }

  /**
   * Processes a raw search query into normalized, structured query representations.
   */
  public static process(rawQuery: string): ProcessedQuery {
    const validation = this.validate(rawQuery);
    if (!validation.isValid) {
      throw new Error(validation.error || 'Invalid query');
    }

    // 1. Unicode NFKC normalization
    let normalized = rawQuery.normalize('NFKC');

    // 2. Strip unprintable/control characters (keeping basic space/newlines)
    // eslint-disable-next-line no-control-regex
    normalized = normalized.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');

    // 3. Normalize single & double quotation marks to standard ASCII quotes
    normalized = normalized.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');

    // 4. Collapse consecutive whitespace characters to single spaces
    normalized = normalized.replace(/\s+/g, ' ').trim();

    // 5. Extract quoted phrases: e.g. "supervised learning"
    const exactPhrases: string[] = [];
    const phraseRegex = /"([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = phraseRegex.exec(normalized)) !== null) {
      const phrase = match[1].trim();
      if (phrase.length > 0) {
        exactPhrases.push(phrase);
      }
    }

    // 6. Extract individual alphanumeric terms (without quotes/punctuation)
    const terms = normalized
      .toLowerCase()
      .replace(/[^a-z0-9_\-\s]/gi, ' ')
      .split(/\s+/)
      .filter((term) => term.length > 1);

    // 7. Produce keyword query: strip unsafe tsquery symbols if quotes are unbalanced
    let keywordQuery = normalized;
    const quoteCount = (keywordQuery.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      // Unbalanced quotes: remove them to avoid syntax issues in websearch_to_tsquery
      keywordQuery = keywordQuery.replace(/"/g, '');
    }

    // 8. Token estimation (~4 characters per token heuristic or word count * 1.3)
    const wordCount = normalized.split(/\s+/).length;
    const charEstimate = Math.ceil(normalized.length / 4);
    const tokenEstimate = Math.max(1, Math.round((wordCount * 1.3 + charEstimate) / 2));

    return {
      rawQuery,
      normalizedQuery: normalized,
      keywordQuery,
      terms: Array.from(new Set(terms)),
      exactPhrases,
      tokenEstimate,
      characterCount: normalized.length,
    };
  }
}
