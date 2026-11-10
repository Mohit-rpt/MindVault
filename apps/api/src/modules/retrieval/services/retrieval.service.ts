/**
 * MindVault — Retrieval Engine: Pipeline Orchestration Service
 *
 * Coordinates query processing, semantic vector search, sparse keyword search,
 * knowledge graph evidence retrieval, reciprocal rank fusion (RRF),
 * reranking, context assembly, and observability telemetry.
 */

import type {
  SearchRequest,
  SearchResponseDto,
  SearchResultItem,
  SearchTimingMetadata,
  RawGraphChunkRow,
  RawGraphRelationRow,
} from '@mindvault/shared';
import { QueryProcessor } from '../query/query.processor.js';
import { EmbeddingService } from '../embeddings/embedding.service.js';
import { ReciprocalRankFusion, type FusedCandidate } from '../fusion/rrf.fusion.js';
import { RerankerService } from '../reranking/reranker.service.js';
import { ContextAssembler } from '../context/context.assembler.js';
import { dbService, type SearchChunkResult } from '../../../lib/db.js';
import { GraphRetrievalService } from './graph-retrieval.service.js';
import { GraphTraversalTimeoutError } from '../../graph/errors/graph-traversal.error.js';

export class RetrievalService {
  /**
   * Executes the full retrieval pipeline with strict tenancy enforcement.
   *
   * @param workspaceId The authenticated workspace ID derived from session/token
   * @param request The validated search parameters
   * @returns Complete evidence-grounded search response with citations and metadata
   */
  public static async executeSearch(
    workspaceId: string,
    request: Partial<SearchRequest> & { query: string },
    abortSignal?: AbortSignal,
  ): Promise<SearchResponseDto> {
    if (abortSignal?.aborted) {
      throw new Error('CLIENT_ABORTED');
    }

    const mode = request.mode || 'hybrid';
    const totalStart = performance.now();
    const timings: SearchTimingMetadata = {
      queryProcessingMs: 0,
      totalMs: 0,
    };

    // 1. Query Processing & Normalization
    const qpStart = performance.now();
    const processedQuery = QueryProcessor.process(request.query);
    timings.queryProcessingMs = Math.round((performance.now() - qpStart) * 100) / 100;

    let semanticResults: SearchChunkResult[] = [];
    let keywordResults: SearchChunkResult[] = [];
    let graphResults: RawGraphChunkRow[] = [];
    let _graphRelations: RawGraphRelationRow[] = [];
    let semanticUsed = false;
    let keywordUsed = false;
    let graphUsed = false;
    let graphError: 'TIMEOUT' | 'FAILED' | undefined = undefined;

    const topK = request.topK || 10;
    // Fetch a slightly broader candidate pool (topK * 2, max 50) for fusion
    const candidateFetchLimit = Math.min(topK * 2, 50);

    const filterOptions = {
      topK: candidateFetchLimit,
      documentIds: request.filters?.documentIds,
      fileTypes: request.filters?.fileTypes,
      pageStart: request.filters?.pageStart,
      pageEnd: request.filters?.pageEnd,
    };

    // 2. Query Embedding Lifecycle (Single inference shared across channels; 0 in keyword mode)
    const needsEmbedding =
      mode === 'semantic' || mode === 'hybrid' || mode === 'graph' || mode === 'graphrag';
    let queryVector: number[] | undefined;

    if (needsEmbedding) {
      const embStart = performance.now();
      queryVector = await EmbeddingService.generateQueryVector(processedQuery.normalizedQuery);
      timings.embeddingGenerationMs = Math.round((performance.now() - embStart) * 100) / 100;
    }

    // 3. Channel Retrieval Execution
    if (mode === 'graphrag') {
      semanticUsed = true;
      keywordUsed = true;

      const semStart = performance.now();
      const kwStart = performance.now();
      const graphStart = performance.now();

      // Concurrent dispatch via Promise.all with fail-soft isolation for graph channel
      const [semRes, kwRes, graphOutput] = await Promise.all([
        dbService.searchVectorChunks(workspaceId, queryVector!, filterOptions).then((res) => {
          timings.semanticSearchMs = Math.round((performance.now() - semStart) * 100) / 100;
          return res;
        }),
        dbService
          .searchKeywordChunks(workspaceId, processedQuery.keywordQuery, filterOptions)
          .then((res) => {
            timings.keywordSearchMs = Math.round((performance.now() - kwStart) * 100) / 100;
            return res;
          }),
        GraphRetrievalService.retrieveChunks(workspaceId, processedQuery.rawQuery, {
          queryVector,
          terms: processedQuery.terms,
          exactPhrases: processedQuery.exactPhrases,
          filters: request.filters,
          topK: candidateFetchLimit,
          focusEntityHints: request.focusEntityHints,
        })
          .then((res) => {
            timings.graphSearchMs = res.timings.totalGraphMs;
            timings.graphSeedDiscoveryMs = res.timings.seedDiscoveryMs;
            graphUsed = true;
            return res;
          })
          .catch((err: any) => {
            timings.graphSearchMs = Math.round((performance.now() - graphStart) * 100) / 100;
            timings.graphSeedDiscoveryMs = 0;
            const isTimeout =
              err instanceof GraphTraversalTimeoutError ||
              err.name === 'GraphTraversalTimeoutError' ||
              err.message?.includes('statement timeout') ||
              err.code === '57014';
            graphError = isTimeout ? 'TIMEOUT' : 'FAILED';
            console.warn(
              `[WARN] [GRAPH_RETRIEVAL] Graph retrieval degraded in graphrag mode: ${err.message}`,
            );
            return {
              chunks: [],
              relations: [],
              seeds: [],
              timings: {
                seedDiscoveryMs: 0,
                evidenceTraversalMs: 0,
                totalGraphMs: timings.graphSearchMs,
              },
            };
          }),
      ]);

      semanticResults = semRes;
      keywordResults = kwRes;
      _graphRelations = graphOutput.relations;

      const relMap = new Map<string, RawGraphRelationRow>();
      for (const rel of _graphRelations) {
        relMap.set(rel.relationId, rel);
      }
      graphResults = graphOutput.chunks.map((chunk) => ({
        ...chunk,
        graphRelations: (chunk.supportedRelationIds || [])
          .map((id) => relMap.get(id))
          .filter((r): r is RawGraphRelationRow => Boolean(r)),
      }));
    } else if (mode === 'graph') {
      graphUsed = true;
      const graphStart = performance.now();
      // In graph-only mode, errors fail-hard (throw 504 on timeout, 500 on DB error)
      const graphOutput = await GraphRetrievalService.retrieveChunks(
        workspaceId,
        processedQuery.rawQuery,
        {
          queryVector,
          terms: processedQuery.terms,
          exactPhrases: processedQuery.exactPhrases,
          filters: request.filters,
          topK: candidateFetchLimit,
          focusEntityHints: request.focusEntityHints,
        },
      );
      timings.graphSearchMs = graphOutput.timings.totalGraphMs;
      timings.graphSeedDiscoveryMs = graphOutput.timings.seedDiscoveryMs;
      _graphRelations = graphOutput.relations;

      const relMap = new Map<string, RawGraphRelationRow>();
      for (const rel of _graphRelations) {
        relMap.set(rel.relationId, rel);
      }
      graphResults = graphOutput.chunks.map((chunk) => ({
        ...chunk,
        graphRelations: (chunk.supportedRelationIds || [])
          .map((id) => relMap.get(id))
          .filter((r): r is RawGraphRelationRow => Boolean(r)),
      }));
    } else if (mode === 'hybrid') {
      semanticUsed = true;
      keywordUsed = true;

      const semSearchStart = performance.now();
      semanticResults = await dbService.searchVectorChunks(
        workspaceId,
        queryVector!,
        filterOptions,
      );
      timings.semanticSearchMs = Math.round((performance.now() - semSearchStart) * 100) / 100;

      const kwSearchStart = performance.now();
      keywordResults = await dbService.searchKeywordChunks(
        workspaceId,
        processedQuery.keywordQuery,
        filterOptions,
      );
      timings.keywordSearchMs = Math.round((performance.now() - kwSearchStart) * 100) / 100;
    } else if (mode === 'semantic') {
      semanticUsed = true;
      const semSearchStart = performance.now();
      semanticResults = await dbService.searchVectorChunks(
        workspaceId,
        queryVector!,
        filterOptions,
      );
      timings.semanticSearchMs = Math.round((performance.now() - semSearchStart) * 100) / 100;
    } else {
      // mode === 'keyword'
      keywordUsed = true;
      const kwSearchStart = performance.now();
      keywordResults = await dbService.searchKeywordChunks(
        workspaceId,
        processedQuery.keywordQuery,
        filterOptions,
      );
      timings.keywordSearchMs = Math.round((performance.now() - kwSearchStart) * 100) / 100;
    }

    if (abortSignal?.aborted) {
      throw new Error('CLIENT_ABORTED');
    }

    // 4. Fusion Strategy
    let fusedCandidates: FusedCandidate[] = [];
    const fusionStart = performance.now();

    if (mode === 'graphrag') {
      fusedCandidates = ReciprocalRankFusion.fuseChannels(
        {
          semantic: semanticResults,
          keyword: keywordResults,
          graph: graphResults,
        },
        {
          topK,
        },
      );
    } else if (mode === 'hybrid') {
      fusedCandidates = ReciprocalRankFusion.fuse(semanticResults, keywordResults, {
        topK,
      });
    } else if (mode === 'semantic') {
      // Single mode semantic mapping
      fusedCandidates = semanticResults.slice(0, topK).map((item, idx) => ({
        chunkId: item.chunk.id,
        documentId: item.chunk.documentId,
        documentName: item.document.originalName,
        documentExtension: item.document.extension,
        content: item.chunk.content,
        chunkIndex: item.chunk.chunkIndex,
        tokenCount: item.chunk.tokenCount,
        pageStart: item.chunk.pageStart,
        pageEnd: item.chunk.pageEnd,
        metadata: item.chunk.metadata || {},
        semanticRank: idx + 1,
        semanticScore: item.score,
        retrievalSources: ['semantic'],
        rrfScore: item.score,
        rank: idx + 1,
      }));
    } else if (mode === 'keyword') {
      // Single mode keyword mapping
      fusedCandidates = keywordResults.slice(0, topK).map((item, idx) => ({
        chunkId: item.chunk.id,
        documentId: item.chunk.documentId,
        documentName: item.document.originalName,
        documentExtension: item.document.extension,
        content: item.chunk.content,
        chunkIndex: item.chunk.chunkIndex,
        tokenCount: item.chunk.tokenCount,
        pageStart: item.chunk.pageStart,
        pageEnd: item.chunk.pageEnd,
        metadata: item.chunk.metadata || {},
        keywordRank: idx + 1,
        keywordScore: item.score,
        retrievalSources: ['keyword'],
        rrfScore: item.score,
        rank: idx + 1,
      }));
    } else {
      // Single mode graph mapping
      fusedCandidates = graphResults.slice(0, topK).map((item, idx) => {
        const metadata: Record<string, unknown> = { ...(item.metadata || {}) };
        if (
          item.supportedRelationsCount > 0 ||
          (item.supportedRelationIds && item.supportedRelationIds.length > 0)
        ) {
          metadata.graph = {
            supportedRelationsCount: item.supportedRelationsCount,
            supportedRelationIds: item.supportedRelationIds || [],
            relationTypes: item.relationTypes || [],
          };
        }
        return {
          chunkId: item.chunkId,
          documentId: item.documentId,
          documentName: item.docOriginalName,
          documentExtension: item.docExtension,
          content: item.content,
          chunkIndex: item.chunkIndex,
          tokenCount: item.tokenCount,
          pageStart: item.pageStart,
          pageEnd: item.pageEnd,
          metadata,
          graphRank: idx + 1,
          graphScore: item.score,
          supportedRelationsCount: item.supportedRelationsCount,
          supportedRelationIds: item.supportedRelationIds,
          relationTypes: item.relationTypes,
          graphRelations: item.graphRelations,
          retrievalSources: ['graph'],
          rrfScore: item.score,
          rank: idx + 1,
        };
      });
    }

    timings.fusionMs = Math.round((performance.now() - fusionStart) * 100) / 100;

    // 5. Optional Reranking
    const rerankStart = performance.now();
    const { candidates: rerankedCandidates, rerankingApplied } =
      await RerankerService.rerankCandidates(processedQuery.normalizedQuery, fusedCandidates, {
        enabled: request.enableReranking,
        topN: topK,
      });
    timings.rerankingMs = Math.round((performance.now() - rerankStart) * 100) / 100;

    // 6. Context Assembly & Source Citations
    let assembledContext = undefined;
    if (request.includeContext) {
      const ctxStart = performance.now();
      assembledContext = ContextAssembler.assemble(rerankedCandidates, {
        maxTokens: request.maxContextTokens,
      });
      timings.contextAssemblyMs = Math.round((performance.now() - ctxStart) * 100) / 100;
    }

    // 7. Map to public SearchResultItem contracts with stable citation identifiers & graph metadata
    const results: SearchResultItem[] = rerankedCandidates.map((candidate, idx) => {
      const citationId = `[S${idx + 1}]`;
      const metadata: Record<string, unknown> = { ...(candidate.metadata || {}) };

      // Preserve graph provenance metadata in public SearchResultItem
      if (
        candidate.supportedRelationsCount !== undefined ||
        (candidate.supportedRelationIds && candidate.supportedRelationIds.length > 0) ||
        (candidate.relationTypes && candidate.relationTypes.length > 0)
      ) {
        metadata.graph = {
          supportedRelationsCount:
            candidate.supportedRelationsCount ?? candidate.supportedRelationIds?.length ?? 0,
          supportedRelationIds: candidate.supportedRelationIds ?? [],
          relationTypes: candidate.relationTypes ?? [],
        };
      }

      return {
        chunkId: candidate.chunkId,
        documentId: candidate.documentId,
        documentName: candidate.documentName,
        content: candidate.content,
        chunkIndex: candidate.chunkIndex,
        rank: idx + 1,
        score: Math.round(candidate.rrfScore * 10000) / 10000,
        retrievalSources: candidate.retrievalSources,
        citationId,
        pageStart: candidate.pageStart,
        pageEnd: candidate.pageEnd,
        tokenCount: candidate.tokenCount,
        metadata,
      };
    });

    timings.totalMs = Math.round((performance.now() - totalStart) * 100) / 100;

    return {
      query: request.query,
      mode,
      results,
      context: assembledContext,
      metadata: {
        semanticSearchUsed: semanticUsed,
        keywordSearchUsed: keywordUsed,
        graphSearchUsed: graphUsed,
        ...(graphError ? { graphError } : {}),
        rerankingApplied,
        totalResults: results.length,
        query: processedQuery.rawQuery,
        normalizedQuery: processedQuery.normalizedQuery,
        timings,
      },
    };
  }
}
