/**
 * MindVault — Conversation Engine: Entity Context & Focus Entity Tracking Service (Phase 6.7)
 *
 * Tracks, ranks, and resolves active knowledge entities across multi-turn dialogs:
 * 1. Focus Entity Extraction across user questions, assistant grounding, and graph metadata
 * 2. Exponential Recency Weighting & Salience Scoring
 * 3. Topic-Switch Isolation (purges/demotes stale entity context)
 * 4. Topic-Return Reactivation (restores earlier focus entity state)
 * 5. Pronoun & Elliptical Coreference Resolution (singular, plural, demonstrative, comparative)
 * 6. Bounded Entity Footprint (strict cap at 5 entities to prevent memory bloat)
 * 7. Tenant Isolation (strictly bounded to current workspace and session)
 */

import type { ChatMessageDto, FocusEntityItem, EntityContextState } from '@mindvault/shared';
import { EntityNormalizer } from '../../graph/normalizers/entity.normalizer.js';
import { compareStringsCodePoint } from '../../retrieval/context/context.assembler.js';

export interface ResolvePronounsResult {
  resolvedQuery: string;
  wasResolved: boolean;
  resolvedPronouns: Record<string, string>;
}

export class EntityContextService {
  private static readonly MAX_FOCUS_ENTITIES = 5;
  private static readonly RECENCY_DECAY = 0.75;

  public static readonly TOPIC_SWITCH_PATTERN =
    /\b(?:now[\s,]+let us|now[\s,]+let's|now[\s,]+let's\s+switch\s+to|let's\s+switch\s+to|switch\s+to|switching\s+to|switching topics|changing topic|on another note|by the way|unrelated question|moving on to|let's talk about|let's discuss)\b/i;

  public static readonly TOPIC_RETURN_PATTERN =
    /\b(?:going back to|back to|returning to|as for our earlier discussion about|in regards to the first topic|earlier topic)\b/i;

  public static readonly SINGULAR_PRONOUNS = /\b(it|its|this|that)\b/i;

  public static readonly PLURAL_PRONOUNS = /\b(they|them|these|those|their|both)\b/i;

  public static readonly DEMONSTRATIVE_NOUNS =
    /\b(?:that|this|the)\s+(?:database|system|framework|algorithm|approach|model|technique|method|tool|library|engine|architecture|concept|mechanism)\b/i;

  public static readonly ELLIPTICAL_STARTS =
    /^(?:give me|show me|tell me more|what about|how about|why|can you elaborate|give an example|another example|and what about|its limitations|advantages and disadvantages|how does it work)\b/i;

  /**
   * Extracts and tracks active focus entities across conversation turns.
   */
  public static extractFocusEntities(
    history: ChatMessageDto[],
    currentQuery?: string,
    summary?: string | null,
  ): EntityContextState {
    const candidateMap = new Map<string, FocusEntityItem>();

    // 1. Check for topic switch in current query
    const isTopicSwitch = currentQuery ? this.TOPIC_SWITCH_PATTERN.test(currentQuery) : false;

    // 2. Check for topic return in current query
    const isTopicReturn = currentQuery ? this.TOPIC_RETURN_PATTERN.test(currentQuery) : false;

    let targetReturnEntity: string | null = null;
    if (isTopicReturn && currentQuery) {
      const returnMatch = currentQuery.match(
        /\b(?:going back to|back to|returning to|as for our earlier discussion about)\s+(?:our\s+)?(?:first\s+|previous\s+)?(?:discussion\s+about\s+)?([a-zA-Z0-9_\-\s]+?)(?:,\s*|\.\s*|\?|$)(.*)/i,
      );
      if (returnMatch && returnMatch[1]) {
        targetReturnEntity = returnMatch[1].trim();
      }
    }

    // 3. Inspect recent history messages up to 10 messages (5 turns)
    const recentMessages = history.slice(-10);
    const totalMessages = recentMessages.length;

    for (let i = 0; i < totalMessages; i++) {
      const msg = recentMessages[i];
      const turnDistance = totalMessages - 1 - i;
      const turnDecay = Math.pow(this.RECENCY_DECAY, turnDistance);

      // A. Extract from previous metadata if stored
      const msgMeta = (msg.metadata || {}) as Record<string, unknown>;
      if (Array.isArray(msgMeta.focusEntities)) {
        for (const item of msgMeta.focusEntities as FocusEntityItem[]) {
          if (item && item.canonicalName) {
            this.upsertEntity(candidateMap, {
              name: item.name || item.canonicalName,
              canonicalName: item.canonicalName,
              entityType: item.entityType,
              entityId: item.entityId,
              salience: (item.salience ?? 0.8) * turnDecay,
              mentionCount: 1,
              lastTurnIndex: turnDistance,
              source: item.source || 'assistant_grounding',
            });
          }
        }
      }

      // B. User core subject extraction (highest intent signal)
      if (msg.role === 'USER') {
        const coreEntity = this.extractCoreEntityFromQuery(msg.content);
        if (coreEntity) {
          this.upsertEntity(candidateMap, {
            name: coreEntity,
            canonicalName: coreEntity,
            salience: 1.0 * turnDecay,
            mentionCount: 2,
            lastTurnIndex: turnDistance,
            source: 'user_query',
          });
        }
      }

      // C. Extract from message content
      const extractedNames = this.extractEntityNamesFromText(msg.content);
      for (const name of extractedNames) {
        this.upsertEntity(candidateMap, {
          name,
          canonicalName: name,
          salience: (msg.role === 'USER' ? 0.9 : 0.4) * turnDecay,
          mentionCount: 1,
          lastTurnIndex: turnDistance,
          source: msg.role === 'USER' ? 'user_query' : 'assistant_grounding',
        });
      }
    }

    // 4. Handle Topic Switch: if user switched topics, demote all previous entities
    if (isTopicSwitch && currentQuery) {
      const firstClause = currentQuery.split(/[.;\n]/)[0];
      const newTopicMatch = firstClause
        .replace(this.TOPIC_SWITCH_PATTERN, '')
        .replace(/^(?:talk about|discuss|explore|look at|consider|switch to)\s+/i, '')
        .replace(/[?!.]+$/, '')
        .trim();

      let newEntityName = this.extractCoreEntityFromQuery(newTopicMatch);
      if (!newEntityName && newTopicMatch.length >= 2) {
        newEntityName = newTopicMatch;
      }
      if (newEntityName) {
        // Demote all prior entities by 90%
        for (const entity of candidateMap.values()) {
          entity.salience = entity.salience * 0.1;
        }

        // Add newly switched entity with full 1.0 salience
        this.upsertEntity(candidateMap, {
          name: newEntityName,
          canonicalName: newEntityName,
          salience: 1.0,
          mentionCount: 1,
          lastTurnIndex: 0,
          source: 'user_query',
        });

        const sorted = this.sortEntities(Array.from(candidateMap.values()));
        return {
          primaryEntity: sorted[0],
          secondaryEntities: sorted.slice(1, this.MAX_FOCUS_ENTITIES),
          activeTopic: newEntityName,
          topicSwitched: true,
          topicReturned: false,
        };
      }
    }

    // 5. Handle Topic Return: reactivate matching entity
    if (isTopicReturn && targetReturnEntity) {
      const normalizedTarget = EntityNormalizer.normalize(targetReturnEntity);
      let foundEntity: FocusEntityItem | null = null;

      for (const entity of candidateMap.values()) {
        if (
          EntityNormalizer.normalize(entity.canonicalName) === normalizedTarget ||
          entity.canonicalName.toLowerCase().includes(targetReturnEntity.toLowerCase()) ||
          targetReturnEntity.toLowerCase().includes(entity.canonicalName.toLowerCase())
        ) {
          foundEntity = entity;
          break;
        }
      }

      if (foundEntity) {
        foundEntity.salience = 1.0;
        foundEntity.lastTurnIndex = 0;
        foundEntity.mentionCount += 1;
      } else {
        foundEntity = {
          name: targetReturnEntity,
          canonicalName: targetReturnEntity,
          salience: 1.0,
          mentionCount: 1,
          lastTurnIndex: 0,
          source: 'user_query',
        };
        this.upsertEntity(candidateMap, foundEntity);
      }

      const sorted = this.sortEntities(Array.from(candidateMap.values()));
      return {
        primaryEntity: foundEntity,
        secondaryEntities: sorted
          .filter((e) => e.canonicalName !== foundEntity!.canonicalName)
          .slice(0, this.MAX_FOCUS_ENTITIES - 1),
        activeTopic: foundEntity.canonicalName,
        topicSwitched: false,
        topicReturned: true,
      };
    }

    // 6. Normal ranking
    const sorted = this.sortEntities(Array.from(candidateMap.values()));
    const primaryEntity = sorted[0];
    const secondaryEntities = sorted.slice(1, this.MAX_FOCUS_ENTITIES);

    return {
      primaryEntity,
      secondaryEntities,
      activeTopic: primaryEntity?.canonicalName,
      topicSwitched: false,
      topicReturned: false,
    };
  }

  /**
   * Resolves pronouns and elliptical expressions in query using conversational entity state.
   */
  public static resolvePronounsAndEllipsis(
    query: string,
    entityState: EntityContextState,
  ): ResolvePronounsResult {
    const trimmed = query.trim();
    const primary = entityState.primaryEntity;
    const resolvedPronouns: Record<string, string> = {};

    if (!primary) {
      return {
        resolvedQuery: trimmed,
        wasResolved: false,
        resolvedPronouns,
      };
    }

    let modified = trimmed;

    // 1. Comparative questions: "How does it compare to Redis?" or "Compare that with Redis"
    const compareMatch = modified.match(
      /\b(?:how does\s+(?:that|it|this)\s+compare to|compare\s+(?:that|it|this)\s+with|how do they compare to)\s+([a-zA-Z0-9_\-\s]+?)(?:\?|$)/i,
    );
    if (compareMatch) {
      const targetEntity = compareMatch[1].trim();
      resolvedPronouns['it'] = primary.canonicalName;
      return {
        resolvedQuery: `How does ${primary.canonicalName} compare to ${targetEntity}?`,
        wasResolved: true,
        resolvedPronouns,
      };
    }

    // 2. Plural pronouns: "they", "them", "these", "those", "their", "both"
    if (this.PLURAL_PRONOUNS.test(modified)) {
      const combinedEntities =
        entityState.secondaryEntities.length > 0
          ? [
              primary.canonicalName,
              ...entityState.secondaryEntities.slice(0, 2).map((e) => e.canonicalName),
            ].join(' and ')
          : primary.canonicalName;

      const pluralMatch = modified.match(this.PLURAL_PRONOUNS);
      if (pluralMatch) {
        resolvedPronouns[pluralMatch[0].toLowerCase()] = combinedEntities;
        modified = modified.replace(this.PLURAL_PRONOUNS, combinedEntities);
      }
    }

    // 3. Demonstrative noun phrases: "that database", "the system", "that algorithm"
    if (this.DEMONSTRATIVE_NOUNS.test(modified)) {
      const demoMatch = modified.match(this.DEMONSTRATIVE_NOUNS);
      if (demoMatch) {
        resolvedPronouns[demoMatch[0].toLowerCase()] = primary.canonicalName;
        modified = modified.replace(this.DEMONSTRATIVE_NOUNS, primary.canonicalName);
      }
    }

    // 4. Singular pronouns: "it", "its", "this", "that"
    if (this.SINGULAR_PRONOUNS.test(modified)) {
      // Handle possessive "its <property>" -> "<property> of <primary>"
      const itsMatch = modified.match(
        /\b(?:what are\s+)?its\s+(limitations|features|drawbacks|advantages|benefits|indexes|storage engines|internals|components|use cases)\b/i,
      );
      if (itsMatch && itsMatch[1]) {
        resolvedPronouns['its'] = primary.canonicalName;
        modified = `${itsMatch[1]} of ${primary.canonicalName}`;
      } else {
        const singMatch = modified.match(this.SINGULAR_PRONOUNS);
        if (singMatch) {
          resolvedPronouns[singMatch[0].toLowerCase()] = primary.canonicalName;
          modified = modified.replace(this.SINGULAR_PRONOUNS, primary.canonicalName);
        }
      }
    }

    // 5. Short elliptical starts: "Give me an example", "What about performance?"
    if (
      this.ELLIPTICAL_STARTS.test(modified) &&
      !modified.toLowerCase().includes(primary.canonicalName.toLowerCase())
    ) {
      if (/^(?:give me|show me|provide)?\s*(?:a\s+)?(?:real-world\s+)?example/i.test(modified)) {
        modified = `example of ${primary.canonicalName}`;
        resolvedPronouns['[ellipsis]'] = primary.canonicalName;
      } else if (/^(?:what about|how about)\s+(.*)/i.test(modified)) {
        const aspectMatch = modified.match(/^(?:what about|how about)\s+(.*)/i);
        const aspect = aspectMatch ? aspectMatch[1].replace(/[?!.]+$/, '').trim() : '';
        modified = `${aspect} in ${primary.canonicalName}`;
        resolvedPronouns['[ellipsis]'] = primary.canonicalName;
      } else if (modified.split(/\s+/).length <= 4) {
        modified = `${modified} ${primary.canonicalName}`;
        resolvedPronouns['[ellipsis]'] = primary.canonicalName;
      }
    }

    const wasResolved = modified.trim().toLowerCase() !== trimmed.toLowerCase();
    return {
      resolvedQuery: wasResolved ? modified.trim() : trimmed,
      wasResolved,
      resolvedPronouns,
    };
  }

  /**
   * Upserts entity candidate into map with salience merging.
   */
  private static upsertEntity(map: Map<string, FocusEntityItem>, item: FocusEntityItem): void {
    const key = EntityNormalizer.normalize(item.canonicalName);
    if (!key || key.length < 2) return;

    const existing = map.get(key);
    if (existing) {
      existing.salience = Math.min(1.0, existing.salience + item.salience * 0.5);
      existing.mentionCount += item.mentionCount;
      existing.lastTurnIndex = Math.min(existing.lastTurnIndex, item.lastTurnIndex);
      if (item.entityType && !existing.entityType) {
        existing.entityType = item.entityType;
      }
      if (item.entityId && !existing.entityId) {
        existing.entityId = item.entityId;
      }
    } else {
      map.set(key, { ...item });
    }
  }

  /**
   * Deterministic sorting: Salience DESC -> CanonicalName ASC (code-point).
   */
  private static sortEntities(entities: FocusEntityItem[]): FocusEntityItem[] {
    return entities.sort((a, b) => {
      if (b.salience !== a.salience) {
        return b.salience - a.salience;
      }
      return compareStringsCodePoint(a.canonicalName, b.canonicalName);
    });
  }

  /**
   * Extracts clean entity candidates from arbitrary text.
   */
  private static extractEntityNamesFromText(text: string): string[] {
    if (!text || typeof text !== 'string') return [];
    const results = new Set<string>();

    // 1. Match acronyms with parenthetical expansions: "Write-Ahead Logging (WAL)", "PostgreSQL (Postgres)"
    const acronymMatches = text.matchAll(
      /\b([A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+)*)\s*\(([A-Za-z0-9_-]+)\)/g,
    );
    for (const match of acronymMatches) {
      if (match[1] && match[1].length >= 3 && !this.isStopword(match[1])) {
        results.add(match[1].trim());
      }
      if (match[2] && match[2].length >= 2 && !this.isStopword(match[2])) {
        results.add(match[2].trim());
      }
    }

    // 2. Match mixed-case identifiers like PostgreSQL, MySQL, MongoDB, SQLite, CockroachDB, GiST
    const mixedCaseMatches = text.matchAll(/\b([A-Z][a-zA-Z0-9]*(?:[A-Z][a-zA-Z0-9]*)+)\b/g);
    for (const match of mixedCaseMatches) {
      const term = match[1].trim();
      if (!this.isStopword(term) && term.length >= 3) {
        results.add(term);
      }
    }

    // 3. Match hyphenated technical terms: B-Tree, SP-GiST, Write-Ahead
    const hyphenMatches = text.matchAll(/\b([A-Za-z0-9]+-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\b/g);
    for (const match of hyphenMatches) {
      const term = match[1].trim();
      if (!this.isStopword(term) && term.length >= 3) {
        results.add(term);
      }
    }

    // 4. Match all-caps technical acronyms (2 to 6 characters): WAL, GIN, BRIN, RRF, SSE, PDF
    const acronymOnlyMatches = text.matchAll(/\b([A-Z]{2,6})\b/g);
    for (const match of acronymOnlyMatches) {
      const term = match[1].trim();
      if (!this.isStopword(term) && term.length >= 2) {
        results.add(term);
      }
    }

    // 5. Match capitalized proper nouns / Title Case phrases (1 to 2 words): Redis, Cassandra, Neural Network
    const titleCaseMatches = text.matchAll(/\b([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+)?)\b/g);
    for (const match of titleCaseMatches) {
      const term = match[1].trim();
      if (!this.isStopword(term) && term.length >= 3) {
        results.add(term);
      }
    }

    return Array.from(results);
  }

  /**
   * Extracts core entity from a query string.
   */
  public static extractCoreEntityFromQuery(query: string): string | null {
    if (!query) return null;
    let cleaned = query
      .replace(
        /^(?:what (?:is|are|were|was)|how (?:does|do|can|to)|why (?:is|are|do|does)|explain|describe|tell me (?:about|more about)|define|summarize)\s+/i,
        '',
      )
      .replace(/[?!.]+$/, '')
      .trim();

    // Strip leading descriptors
    cleaned = cleaned
      .replace(
        /^(?:the\s+)?(?:benefits|limitations|drawbacks|challenges|advantages|disadvantages|features|details|overview|architecture|purpose|mechanisms?|indexes|storage)\s+(?:of\s+)?/i,
        '',
      )
      .replace(/^(?:a|an|the)\s+/i, '')
      .trim();

    // Strip trailing descriptors
    cleaned = cleaned
      .replace(
        /\s+(?:architecture|internals|overview|concepts?|details|configuration|system|engine|infrastructure|mechanisms?)$/i,
        '',
      )
      .trim();

    // If the extracted text contains unresolved follow-up pronouns, it is not a standalone entity
    if (/\b(?:it|its|this|that|they|them|these|those|you|me|we|us|have|does)\b/i.test(cleaned)) {
      return null;
    }

    return cleaned.length >= 2 ? cleaned : null;
  }

  private static isStopword(term: string): boolean {
    const stopwords = new Set([
      'The',
      'This',
      'That',
      'These',
      'Those',
      'There',
      'Their',
      'Here',
      'What',
      'When',
      'Where',
      'Which',
      'Why',
      'How',
      'Can',
      'Could',
      'Would',
      'Should',
      'Does',
      'Have',
      'Has',
      'Had',
      'Give',
      'Tell',
      'Explain',
      'Describe',
      'Summarize',
      'Please',
      'First',
      'Second',
      'AND',
      'OR',
      'NOT',
      'FOR',
      'ARE',
      'CAN',
      'HOW',
      'WHY',
      'WHAT',
      'WHO',
      'ITS',
      'THE',
      'YOU',
      'ALL',
      'OUT',
      'NEW',
    ]);
    return stopwords.has(term) || stopwords.has(term.toUpperCase());
  }
}
