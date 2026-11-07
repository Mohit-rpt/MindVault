/**
 * MindVault — Knowledge Graph: Deterministic Entity & Relation Normalizer
 *
 * Implements canonical name, alias, and relation type normalization for graph resolution.
 * Preserves essential technical punctuation (C++, C#, Node.js, .NET, TCP/IP)
 * while ensuring case-insensitivity, unicode normalization, whitespace cleanup,
 * possessive trimming, edge punctuation cleaning, and relation synonym canonicalization.
 */

export interface DisambiguatedTerm {
  stem: string;
  alias?: string;
}

export class EntityNormalizer {
  /**
   * Curated dictionary of relation type synonyms mapped to canonical schema vocabulary.
   */
  private static readonly RELATION_SYNONYMS: Readonly<Record<string, string>> = Object.freeze({
    // Dependencies
    DEPENDS_UPON: 'DEPENDS_ON',
    REQUIRES: 'DEPENDS_ON',
    RELIANT_ON: 'DEPENDS_ON',
    RELIES_ON: 'DEPENDS_ON',

    // Usage & Utilization
    UTILIZES: 'USES',
    UTILIZING: 'USES',
    LEVERAGES: 'USES',
    EMPLOYING: 'USES',
    CONSUMES: 'USES',
    CALLS: 'USES',

    // Composition / Membership
    IS_PART_OF: 'PART_OF',
    COMPONENT_OF: 'PART_OF',
    BELONGS_TO: 'PART_OF',
    MEMBER_OF: 'PART_OF',
    INCLUDED_IN: 'PART_OF',
    SUBSET_OF: 'PART_OF',

    // Implementation & Architecture
    REALIZES: 'IMPLEMENTS',
    IMPLEMENTED_BY: 'IMPLEMENTED_IN',
    BUILT_WITH: 'IMPLEMENTED_IN',
    WRITTEN_IN: 'IMPLEMENTED_IN',
    BUILT_ON: 'IMPLEMENTED_IN',

    // Connectivity & Interfacing
    COMMUNICATES_WITH: 'CONNECTS_TO',
    INTERFACES_WITH: 'CONNECTS_TO',
    TALKS_TO: 'CONNECTS_TO',
    EXCHANGES_WITH: 'CONNECTS_TO',
    INTEGRATES_WITH: 'CONNECTS_TO',

    // Production & Creation
    MANUFACTURES: 'PRODUCES',
    GENERATES: 'PRODUCES',
    BUILDS: 'PRODUCES',
    CREATES: 'PRODUCES',
    AUTHORS: 'PRODUCES',

    // Storage & Persistence
    PERSISTS: 'STORES',
    HOUSES: 'STORES',
    SAVES: 'STORES',

    // Employment & Affiliation
    EMPLOYED_BY: 'WORKS_FOR',
    AFFILIATED_WITH: 'WORKS_FOR',

    // Location
    BASED_IN: 'LOCATED_IN',
    HEADQUARTERED_IN: 'LOCATED_IN',
    SITUATED_IN: 'LOCATED_IN',
  });

  /**
   * Set of symmetric relations where directionality (A -> B vs B -> A) is equivalent.
   */
  public static readonly SYMMETRIC_RELATIONS: ReadonlySet<string> = new Set([
    'CONNECTS_TO',
    'SIMILAR_TO',
    'PEER_OF',
    'INTERACTS_WITH',
    'RELATED_TO',
    'EQUIVALENT_TO',
  ]);

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

    // 4. Collapse all internal whitespace sequences (tabs, non-breaking spaces, zero-width spaces) to single space
    normalized = normalized.replace(/[\s\u00A0\u200B\uFEFF]+/g, ' ');

    // 5. Strip leading English articles ("the ", "a ", "an ") when preceding multi-word terms
    //    e.g. "The V8 Engine" -> "v8 engine", "An Algorithm" -> "algorithm"
    if (/^(the|a|an)\s+/i.test(normalized) && normalized.split(' ').length > 1) {
      normalized = normalized.replace(/^(the|a|an)\s+/i, '');
    }

    // 6. Strip trailing English possessive suffixes ('s, ’s, or trailing ' after s)
    //    e.g. "Google's" -> "google", "Kubernetes'" -> "kubernetes"
    normalized = normalized
      .replace(/['’]s$/i, '')
      .replace(/s['’]$/i, 's')
      .trim();

    // 7. Retain letters, digits, whitespace, and critical technical punctuation:
    //    - '+' preserved for C++
    //    - '#' preserved for C#, F#
    //    - '.' preserved for Node.js, .NET, Vue.js, v1.0
    //    - '/' preserved for TCP/IP, CI/CD, A/B Testing
    //    - '-' and '_' preserved for hyphenated and snake_case technical identifiers
    normalized = normalized.replace(/[^\p{L}\p{N}\s+#./\-_]/gu, '');

    // 8. Clean trailing/leading non-semantic punctuation:
    //    - Strip trailing periods (e.g. "PostgreSQL." -> "postgresql") while preserving ".NET" and "Node.js"
    //    - Strip leading/trailing hyphens, underscores, or slashes (e.g. "- Docker" -> "docker", "REST/" -> "rest")
    normalized = normalized.replace(/[./\-_]+$/, '').replace(/^[/\-_]+/, '');

    // 9. Final whitespace consolidation and trim
    return normalized.replace(/\s+/g, ' ').trim();
  }

  /**
   * Disambiguates an extracted entity string that includes parenthetical context or abbreviation.
   * e.g. "PostgreSQL (RDBMS)" -> { stem: "PostgreSQL", alias: "RDBMS" }
   * e.g. "Amazon Web Services (AWS)" -> { stem: "Amazon Web Services", alias: "AWS" }
   * e.g. "Node.js" -> { stem: "Node.js" }
   */
  public static extractDisambiguation(name: string): DisambiguatedTerm {
    if (!name || typeof name !== 'string') {
      return { stem: '' };
    }

    const trimmed = name.trim();
    const match = trimmed.match(/^(.+?)\s*\(([^)]+)\)$/);
    if (match && match[1] && match[2]) {
      const stem = match[1].trim();
      const alias = match[2].trim();
      if (stem.length > 0 && alias.length > 0) {
        return { stem, alias };
      }
    }

    return { stem: trimmed };
  }

  /**
   * Normalizes a relation type into an uppercase standard token with synonym canonicalization.
   * e.g. "uses" -> "USES", "part of" -> "PART_OF", "depends-upon" -> "DEPENDS_ON"
   */
  public static normalizeRelationType(relationType: string): string {
    if (!relationType || typeof relationType !== 'string') {
      return 'RELATED_TO';
    }

    const trimmed = relationType.trim().toUpperCase();
    const token = trimmed.replace(/[\s\-_]+/g, '_').replace(/[^A-Z0-9_]/g, '');
    if (!token) {
      return 'RELATED_TO';
    }

    // Check canonical synonym dictionary
    return this.RELATION_SYNONYMS[token] ?? token;
  }
}
