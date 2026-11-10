/**
 * MindVault — Retrieval Engine: Reciprocal Rank Fusion (RRF)
 *
 * Implements standard weighted Reciprocal Rank Fusion to combine candidate
 * ranked lists from disparate retrieval channels (dense semantic vector search,
 * sparse PostgreSQL full-text search, and knowledge graph evidence retrieval)
 * without scale bias.
 *
 * Mathematical Formula:
 *   RRF_score(d) = Σ_{m ∈ {semantic, keyword, graph}} [ weight_m / (k + rank_m(d)) ]
 *   where k = 60 (standard RRF constant), weights default to 1.0.
 */

import type { SearchChunkResult } from '../../../lib/db.js';
import type { RawGraphChunkRow, RawGraphRelationRow } from '@mindvault/shared';

export type RetrievalSource = 'semantic' | 'keyword' | 'graph';

export interface ChannelWeights {
  semantic?: number;
  keyword?: number;
  graph?: number;
}

export interface FusionOptions {
  /** RRF smoothing constant (default: 60, must be a finite positive number) */
  k?: number;
  /** Maximum number of fused candidates to return (default: 10, must be positive integer) */
  topK?: number;
  /** Channel-specific positive weights (default: 1.0 for each channel, must be finite non-negative numbers) */
  weights?: ChannelWeights;
  /** Maximum permitted candidates per channel (default: 50) */
  maxChannelCandidates?: number;
}

export interface NormalizedCandidate {
  chunkId: string;
  documentId: string;
  documentName?: string;
  documentExtension?: string;
  content: string;
  chunkIndex: number;
  tokenCount?: number;
  pageStart?: number | null;
  pageEnd?: number | null;
  metadata?: Record<string, unknown>;
  score?: number;
  workspaceId?: string;
  // Graph provenance
  supportedRelationsCount?: number;
  supportedRelationIds?: string[];
  relationTypes?: string[];
  graphRelations?: RawGraphRelationRow[];
}

export interface ThreeChannelInput {
  semantic?: Array<SearchChunkResult | NormalizedCandidate>;
  keyword?: Array<SearchChunkResult | NormalizedCandidate>;
  graph?: Array<RawGraphChunkRow | SearchChunkResult | NormalizedCandidate>;
}

export interface FusedCandidate {
  chunkId: string;
  documentId: string;
  documentName: string;
  documentExtension: string;
  content: string;
  chunkIndex: number;
  tokenCount: number;
  pageStart: number | null;
  pageEnd: number | null;
  metadata: Record<string, unknown>;
  semanticRank?: number;
  semanticScore?: number;
  keywordRank?: number;
  keywordScore?: number;
  graphRank?: number;
  graphScore?: number;
  supportedRelationsCount?: number;
  supportedRelationIds?: string[];
  relationTypes?: string[];
  graphRelations?: RawGraphRelationRow[];
  retrievalSources: RetrievalSource[];
  rrfScore: number;
  rank: number;
}

interface InternalCandidateEntry {
  candidate: FusedCandidate;
  supportedRelationIdsSet: Set<string>;
  relationTypesSet: Set<string>;
  graphRelationsMap: Map<string, RawGraphRelationRow>;
}

/**
 * Validates and normalizes any channel candidate input into a standardized NormalizedCandidate.
 */
function extractCandidate(item: unknown, channelName: string, index: number): NormalizedCandidate {
  if (!item || typeof item !== 'object') {
    throw new Error(
      `Invalid candidate in channel '${channelName}' at index ${index}: candidate must be a non-null object`,
    );
  }

  const raw = item as Record<string, unknown>;

  // Case 1: SearchChunkResult (has chunk property)
  if (raw.chunk && typeof raw.chunk === 'object') {
    const chunk = raw.chunk as Record<string, unknown>;
    const doc =
      raw.document && typeof raw.document === 'object'
        ? (raw.document as Record<string, unknown>)
        : {};

    const chunkId = typeof chunk.id === 'string' ? chunk.id.trim() : '';
    if (!chunkId) {
      throw new Error(
        `Invalid candidate in channel '${channelName}' at index ${index}: chunkId must be a non-empty string`,
      );
    }

    const chunkIndex = typeof chunk.chunkIndex === 'number' ? chunk.chunkIndex : -1;
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      throw new Error(
        `Invalid candidate in channel '${channelName}' at index ${index}: chunkIndex must be a non-negative integer`,
      );
    }

    return {
      chunkId,
      documentId:
        typeof chunk.documentId === 'string'
          ? chunk.documentId
          : typeof doc.id === 'string'
            ? doc.id
            : '',
      documentName: typeof doc.originalName === 'string' ? doc.originalName : 'unknown',
      documentExtension: typeof doc.extension === 'string' ? doc.extension : '',
      content: typeof chunk.content === 'string' ? chunk.content : '',
      chunkIndex,
      tokenCount: typeof chunk.tokenCount === 'number' ? chunk.tokenCount : 0,
      pageStart: typeof chunk.pageStart === 'number' ? chunk.pageStart : null,
      pageEnd: typeof chunk.pageEnd === 'number' ? chunk.pageEnd : null,
      metadata:
        chunk.metadata && typeof chunk.metadata === 'object' && !Array.isArray(chunk.metadata)
          ? { ...(chunk.metadata as Record<string, unknown>) }
          : {},
      score: typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : 0,
      workspaceId: typeof chunk.workspaceId === 'string' ? chunk.workspaceId : undefined,
    };
  }

  // Case 2: RawGraphChunkRow or NormalizedCandidate (has chunkId property)
  const chunkId = typeof raw.chunkId === 'string' ? raw.chunkId.trim() : '';
  if (!chunkId) {
    throw new Error(
      `Invalid candidate in channel '${channelName}' at index ${index}: chunkId must be a non-empty string`,
    );
  }

  const chunkIndex = typeof raw.chunkIndex === 'number' ? raw.chunkIndex : -1;
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new Error(
      `Invalid candidate in channel '${channelName}' at index ${index}: chunkIndex must be a non-negative integer`,
    );
  }

  return {
    chunkId,
    documentId: typeof raw.documentId === 'string' ? raw.documentId : '',
    documentName:
      typeof raw.documentName === 'string'
        ? raw.documentName
        : typeof raw.docOriginalName === 'string'
          ? raw.docOriginalName
          : 'unknown',
    documentExtension:
      typeof raw.documentExtension === 'string'
        ? raw.documentExtension
        : typeof raw.docExtension === 'string'
          ? raw.docExtension
          : '',
    content: typeof raw.content === 'string' ? raw.content : '',
    chunkIndex,
    tokenCount: typeof raw.tokenCount === 'number' ? raw.tokenCount : 0,
    pageStart: typeof raw.pageStart === 'number' ? raw.pageStart : null,
    pageEnd: typeof raw.pageEnd === 'number' ? raw.pageEnd : null,
    metadata:
      raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
        ? { ...(raw.metadata as Record<string, unknown>) }
        : {},
    score: typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : 0,
    workspaceId: typeof raw.workspaceId === 'string' ? raw.workspaceId : undefined,
    supportedRelationsCount:
      typeof raw.supportedRelationsCount === 'number' ? raw.supportedRelationsCount : undefined,
    supportedRelationIds: Array.isArray(raw.supportedRelationIds)
      ? raw.supportedRelationIds.filter(
          (id): id is string => typeof id === 'string' && id.trim().length > 0,
        )
      : undefined,
    relationTypes: Array.isArray(raw.relationTypes)
      ? raw.relationTypes.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      : undefined,
    graphRelations: Array.isArray(raw.graphRelations)
      ? (raw.graphRelations as RawGraphRelationRow[])
      : undefined,
  };
}

/**
 * Validates fusion configuration options.
 */
function validateOptions(options?: FusionOptions): {
  k: number;
  topK: number;
  weights: { semantic: number; keyword: number; graph: number };
  maxChannelCandidates: number;
} {
  const k = options?.k !== undefined ? options.k : ReciprocalRankFusion.DEFAULT_K;
  if (typeof k !== 'number' || !Number.isFinite(k) || k <= 0) {
    throw new Error(`Invalid RRF constant k: must be a finite positive number, received ${k}`);
  }

  const topK = options?.topK !== undefined ? options.topK : ReciprocalRankFusion.DEFAULT_TOP_K;
  if (typeof topK !== 'number' || !Number.isInteger(topK) || topK <= 0) {
    throw new Error(`Invalid topK: must be a positive integer, received ${topK}`);
  }

  const maxChannelCandidates =
    options?.maxChannelCandidates !== undefined
      ? options.maxChannelCandidates
      : ReciprocalRankFusion.DEFAULT_MAX_CHANNEL_CANDIDATES;
  if (
    typeof maxChannelCandidates !== 'number' ||
    !Number.isInteger(maxChannelCandidates) ||
    maxChannelCandidates <= 0
  ) {
    throw new Error(
      `Invalid maxChannelCandidates: must be a positive integer, received ${maxChannelCandidates}`,
    );
  }

  const rawWeights = options?.weights;
  const wSem =
    rawWeights?.semantic !== undefined ? rawWeights.semantic : ReciprocalRankFusion.DEFAULT_WEIGHT;
  const wKw =
    rawWeights?.keyword !== undefined ? rawWeights.keyword : ReciprocalRankFusion.DEFAULT_WEIGHT;
  const wGraph =
    rawWeights?.graph !== undefined ? rawWeights.graph : ReciprocalRankFusion.DEFAULT_WEIGHT;

  const weightsToCheck = { semantic: wSem, keyword: wKw, graph: wGraph };
  for (const [name, val] of Object.entries(weightsToCheck)) {
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
      throw new Error(
        `Invalid channel weight for '${name}': must be a finite non-negative number, received ${val}`,
      );
    }
  }

  if (wSem === 0 && wKw === 0 && wGraph === 0) {
    throw new Error('Invalid channel weights: at least one channel weight must be positive');
  }

  return {
    k,
    topK,
    weights: { semantic: wSem, keyword: wKw, graph: wGraph },
    maxChannelCandidates,
  };
}

/**
 * Validates that candidate array does not exceed max candidate limit.
 */
function validateChannelCandidates(
  candidates: unknown[] | undefined,
  channelName: string,
  maxLimit: number,
): void {
  if (!candidates) return;
  if (!Array.isArray(candidates)) {
    throw new Error(`Invalid candidates for channel '${channelName}': must be an array`);
  }
  if (candidates.length > maxLimit) {
    throw new Error(
      `Channel '${channelName}' candidate count (${candidates.length}) exceeds maximum allowed limit (${maxLimit})`,
    );
  }
}

/**
 * Deterministically merges metadata from multiple channels without relying on arrival order.
 */
function mergeMetadata(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null) {
      continue;
    }
    const existingVal = result[key];
    if (existingVal === undefined || existingVal === null) {
      result[key] = value;
    } else if (
      typeof existingVal === 'object' &&
      !Array.isArray(existingVal) &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      result[key] = mergeMetadata(
        existingVal as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    }
    // If key already has a primitive value, existing value is preserved for determinism
  }
  return result;
}

/**
 * Deterministic Four-Tier Comparator:
 * 1. rrfScore DESC
 * 2. retrievalSources.length DESC (breadth of channel corroboration)
 * 3. chunkIndex ASC (document order)
 * 4. chunkId ASC (locale-independent UTF-16 code point comparison)
 */
function compareFusedCandidates(a: FusedCandidate, b: FusedCandidate): number {
  // Tier 1: Fused score descending
  if (b.rrfScore !== a.rrfScore) {
    return b.rrfScore - a.rrfScore;
  }

  // Tier 2: Source breadth descending
  if (b.retrievalSources.length !== a.retrievalSources.length) {
    return b.retrievalSources.length - a.retrievalSources.length;
  }

  // Tier 3: Document chunk index ascending
  if (a.chunkIndex !== b.chunkIndex) {
    return a.chunkIndex - b.chunkIndex;
  }

  // Tier 4: Canonical chunkId ascending (ASCII / code point comparison)
  if (a.chunkId < b.chunkId) return -1;
  if (a.chunkId > b.chunkId) return 1;
  return 0;
}

export class ReciprocalRankFusion {
  public static readonly DEFAULT_K = 60;
  public static readonly DEFAULT_TOP_K = 10;
  public static readonly DEFAULT_WEIGHT = 1.0;
  public static readonly DEFAULT_MAX_CHANNEL_CANDIDATES = 50;

  /**
   * Primary entry point for Three-Way Reciprocal Rank Fusion.
   *
   * @param channels Object containing ranked candidate lists for semantic, keyword, and graph channels
   * @param options Fusion tuning parameters (k, topK, weights, maxChannelCandidates)
   * @returns Fused candidates deduplicated by canonical chunk ID, sorted by four-tier deterministic ranking
   */
  public static fuseChannels(
    channels: ThreeChannelInput,
    options?: FusionOptions,
  ): FusedCandidate[] {
    const config = validateOptions(options);

    validateChannelCandidates(channels.semantic, 'semantic', config.maxChannelCandidates);
    validateChannelCandidates(channels.keyword, 'keyword', config.maxChannelCandidates);
    validateChannelCandidates(channels.graph, 'graph', config.maxChannelCandidates);

    const candidateMap = new Map<string, InternalCandidateEntry>();

    const processChannel = (
      channelList: unknown[] | undefined,
      channelName: RetrievalSource,
      channelWeight: number,
    ) => {
      if (!channelList || channelList.length === 0 || channelWeight === 0) {
        return;
      }

      // Track chunk IDs already seen in THIS channel to prevent duplicate contributions within a single channel
      const seenInThisChannel = new Set<string>();

      channelList.forEach((rawItem, index) => {
        const norm = extractCandidate(rawItem, channelName, index);

        // Duplicate candidate in the same channel does not contribute a second rank
        if (seenInThisChannel.has(norm.chunkId)) {
          return;
        }
        seenInThisChannel.add(norm.chunkId);

        const rank = index + 1; // 1-indexed rank
        const scoreIncrement = channelWeight / (config.k + rank);

        const existingEntry = candidateMap.get(norm.chunkId);

        if (existingEntry) {
          const c = existingEntry.candidate;
          c.rrfScore += scoreIncrement;

          if (!c.retrievalSources.includes(channelName)) {
            c.retrievalSources.push(channelName);
          }

          if (channelName === 'semantic') {
            c.semanticRank = rank;
            c.semanticScore = norm.score;
          } else if (channelName === 'keyword') {
            c.keywordRank = rank;
            c.keywordScore = norm.score;
          } else if (channelName === 'graph') {
            c.graphRank = rank;
            c.graphScore = norm.score;
          }

          // Metadata enrichment
          if (norm.pageStart !== null && norm.pageStart !== undefined && c.pageStart === null) {
            c.pageStart = norm.pageStart;
          }
          if (norm.pageEnd !== null && norm.pageEnd !== undefined && c.pageEnd === null) {
            c.pageEnd = norm.pageEnd;
          }
          if (norm.tokenCount && norm.tokenCount > 0 && c.tokenCount === 0) {
            c.tokenCount = norm.tokenCount;
          }
          if (norm.documentExtension && !c.documentExtension) {
            c.documentExtension = norm.documentExtension;
          }
          if (
            norm.documentName &&
            norm.documentName !== 'unknown' &&
            c.documentName === 'unknown'
          ) {
            c.documentName = norm.documentName;
          }
          if (norm.content && !c.content) {
            c.content = norm.content;
          }

          c.metadata = mergeMetadata(c.metadata, norm.metadata || {});

          // Merge graph provenance
          if (norm.supportedRelationIds) {
            for (const rId of norm.supportedRelationIds) {
              existingEntry.supportedRelationIdsSet.add(rId);
            }
          }
          if (norm.relationTypes) {
            for (const rType of norm.relationTypes) {
              existingEntry.relationTypesSet.add(rType);
            }
          }
          if (norm.graphRelations) {
            for (const rel of norm.graphRelations) {
              if (rel && typeof rel.relationId === 'string' && rel.relationId.trim()) {
                existingEntry.graphRelationsMap.set(rel.relationId.trim(), rel);
              }
            }
          }
        } else {
          // Initialize new fused candidate entry
          const newCandidate: FusedCandidate = {
            chunkId: norm.chunkId,
            documentId: norm.documentId,
            documentName: norm.documentName || 'unknown',
            documentExtension: norm.documentExtension || '',
            content: norm.content,
            chunkIndex: norm.chunkIndex,
            tokenCount: norm.tokenCount || 0,
            pageStart: norm.pageStart ?? null,
            pageEnd: norm.pageEnd ?? null,
            metadata: { ...(norm.metadata || {}) },
            retrievalSources: [channelName],
            rrfScore: scoreIncrement,
            rank: 0,
          };

          if (channelName === 'semantic') {
            newCandidate.semanticRank = rank;
            newCandidate.semanticScore = norm.score;
          } else if (channelName === 'keyword') {
            newCandidate.keywordRank = rank;
            newCandidate.keywordScore = norm.score;
          } else if (channelName === 'graph') {
            newCandidate.graphRank = rank;
            newCandidate.graphScore = norm.score;
          }

          const entry: InternalCandidateEntry = {
            candidate: newCandidate,
            supportedRelationIdsSet: new Set(norm.supportedRelationIds || []),
            relationTypesSet: new Set(norm.relationTypes || []),
            graphRelationsMap: new Map(),
          };

          if (norm.graphRelations) {
            for (const rel of norm.graphRelations) {
              if (rel && typeof rel.relationId === 'string' && rel.relationId.trim()) {
                entry.graphRelationsMap.set(rel.relationId.trim(), rel);
              }
            }
          }

          candidateMap.set(norm.chunkId, entry);
        }
      });
    };

    // 1. Process Semantic Results in fixed canonical order
    processChannel(channels.semantic, 'semantic', config.weights.semantic);

    // 2. Process Keyword Results
    processChannel(channels.keyword, 'keyword', config.weights.keyword);

    // 3. Process Graph Results
    processChannel(channels.graph, 'graph', config.weights.graph);

    // Finalize merged graph provenance arrays deterministically
    const candidates: FusedCandidate[] = [];
    for (const entry of candidateMap.values()) {
      const c = entry.candidate;
      if (entry.supportedRelationIdsSet.size > 0) {
        c.supportedRelationIds = Array.from(entry.supportedRelationIdsSet).sort();
        c.supportedRelationsCount = c.supportedRelationIds.length;
      }
      if (entry.relationTypesSet.size > 0) {
        c.relationTypes = Array.from(entry.relationTypesSet).sort();
      }
      if (entry.graphRelationsMap.size > 0) {
        c.graphRelations = Array.from(entry.graphRelationsMap.values()).sort((a, b) =>
          a.relationId < b.relationId ? -1 : a.relationId > b.relationId ? 1 : 0,
        );
      }
      candidates.push(c);
    }

    // 4. Sort by four-tier deterministic ordering
    candidates.sort(compareFusedCandidates);

    // 5. Assign 1-indexed overall rank and truncate to topK
    const finalResults = candidates.slice(0, config.topK).map((candidate, idx) => ({
      ...candidate,
      rank: idx + 1,
    }));

    return finalResults;
  }

  /**
   * Overloaded positional fuse method for 100% backward compatibility with Phase 3 callers
   * and support for 3-channel positional invocations.
   *
   * Call signatures:
   * 1. fuse(semantic, keyword, options) -> Legacy Phase 3 2-way fusion
   * 2. fuse(semantic, keyword, graph, options) -> Modern Phase 6 3-way fusion
   */
  public static fuse(
    semanticResults: Array<SearchChunkResult | NormalizedCandidate>,
    keywordResults: Array<SearchChunkResult | NormalizedCandidate>,
    graphResultsOrOptions?:
      Array<RawGraphChunkRow | SearchChunkResult | NormalizedCandidate> | FusionOptions,
    options?: FusionOptions,
  ): FusedCandidate[] {
    if (Array.isArray(graphResultsOrOptions)) {
      return this.fuseChannels(
        {
          semantic: semanticResults,
          keyword: keywordResults,
          graph: graphResultsOrOptions,
        },
        options,
      );
    }

    const legacyOptions = graphResultsOrOptions as FusionOptions | undefined;
    return this.fuseChannels(
      {
        semantic: semanticResults,
        keyword: keywordResults,
      },
      legacyOptions || options,
    );
  }
}
