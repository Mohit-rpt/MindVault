/**
 * MindVault — Knowledge Graph: Deterministic Entity Normalizer
 *
 * Implements canonical name and alias normalization for graph resolution.
 * Preserves essential technical punctuation (C++, C#, Node.js, .NET, TCP/IP)
 * while ensuring case-insensitivity, unicode normalization, and whitespace cleanup.
 */

export class EntityNormalizer {
  /**
   * Normalizes an entity or alias name for deterministic indexing and lookup.
   */
  public static normalize(name: string): string {
    if (!name || typeof name !== 'string') {
      return '';
    }

    // 1. Unicode Compatibility Decomposition and Composition (NFKC)
    let normalized = name.normalize('NFKC').trim();

    // 2. Strip outer quotation marks, braces, or bracket wrappers
    normalized = normalized.replace(/^["'`«»“„[(]+|["'`«»”\])]+$/g, '').trim();

    // 3. Lowercase conversion
    normalized = normalized.toLowerCase();

    // 4. Collapse all internal whitespace sequences (tabs, non-breaking spaces) to single space
    normalized = normalized.replace(/[\s\u00A0\u200B]+/g, ' ');

    // 5. Strip leading English articles ("the ", "a ", "an ") when preceding multi-word terms
    //    e.g. "The V8 Engine" -> "v8 engine", "An Algorithm" -> "algorithm"
    if (/^(the|a|an)\s+/i.test(normalized) && normalized.split(' ').length > 1) {
      normalized = normalized.replace(/^(the|a|an)\s+/i, '');
    }

    // 6. Retain letters, digits, whitespace, and critical technical punctuation:
    //    - '+' preserved for C++
    //    - '#' preserved for C#, F#
    //    - '.' preserved for Node.js, .NET, Vue.js, v1.0
    //    - '/' preserved for TCP/IP, CI/CD, A/B Testing
    //    - '-' and '_' preserved for hyphenated and snake_case technical identifiers
    normalized = normalized.replace(/[^\p{L}\p{N}\s+#./\-_]/gu, '');

    // 7. Final whitespace consolidation and trim
    return normalized.replace(/\s+/g, ' ').trim();
  }

  /**
   * Normalizes a relation type into an uppercase standard token.
   * e.g. "uses" -> "USES", "part of" -> "PART_OF", "depends-on" -> "DEPENDS_ON"
   */
  public static normalizeRelationType(relationType: string): string {
    if (!relationType || typeof relationType !== 'string') {
      return 'RELATED_TO';
    }

    const trimmed = relationType.trim().toUpperCase();
    const token = trimmed.replace(/[\s\-_]+/g, '_').replace(/[^A-Z0-9_]/g, '');
    return token.length > 0 ? token : 'RELATED_TO';
  }
}
