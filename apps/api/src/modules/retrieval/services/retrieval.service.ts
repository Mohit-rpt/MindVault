/**
 * MindVault — Retrieval Engine: Pipeline Orchestration Service
 *
 * Coordinates query processing, semantic search, keyword search,
 * reciprocal rank fusion, reranking, context assembly, and observability telemetry.
 */

import type {
  SearchRequest,
  SearchResponseDto,
  SearchResultItem,
  SearchTimingMetadata,
} from '@mindvault/shared';
import { QueryProcessor } from '../query/query.processor.js';
import { EmbeddingService } from '../embeddings/embedding.service.js';
import { ReciprocalRankFusion, type FusedCandidate } from '../fusion/rrf.fusion.js';
import { RerankerService } from '../reranking/reranker.service.js';
import { ContextAssembler } from '../context/context.assembler.js';
import { dbService, type SearchChunkResult } from '../../../lib/db.js';

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
  ): Promise<SearchResponseDto> {
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
    let semanticUsed = false;
    let keywordUsed = false;

    const topK = request.topK || 10;
    // Fetch a slightly broader candidate pool (topK * 2) for fusion
    const candidateFetchLimit = Math.min(topK * 2, 50);

    const filterOptions = {
      topK: candidateFetchLimit,
      documentIds: request.filters?.documentIds,
      fileTypes: request.filters?.fileTypes,
      pageStart: request.filters?.pageStart,
      pageEnd: request.filters?.pageEnd,
    };

    // 2. Retrieval Execution
    if (mode === 'semantic' || mode === 'hybrid') {
      semanticUsed = true;
      // Embedding generation
      const embStart = performance.now();
      const queryVector = await EmbeddingService.generateQueryVector(
        processedQuery.normalizedQuery,
      );
      timings.embeddingGenerationMs = Math.round((performance.now() - embStart) * 100) / 100;

      // Vector search in PostgreSQL/pgvector
      const semSearchStart = performance.now();
      semanticResults = await dbService.searchVectorChunks(workspaceId, queryVector, filterOptions);
      timings.semanticSearchMs = Math.round((performance.now() - semSearchStart) * 100) / 100;
    }

    if (mode === 'keyword' || mode === 'hybrid') {
      keywordUsed = true;
      const kwSearchStart = performance.now();
      keywordResults = await dbService.searchKeywordChunks(
        workspaceId,
        processedQuery.keywordQuery,
        filterOptions,
      );
      timings.keywordSearchMs = Math.round((performance.now() - kwSearchStart) * 100) / 100;
    }

    // 3. Fusion Strategy
    let fusedCandidates: FusedCandidate[] = [];
    const fusionStart = performance.now();

    if (mode === 'hybrid') {
      fusedCandidates = ReciprocalRankFusion.fuse(semanticResults, keywordResults, {
        topK,
      });
    } else if (mode === 'semantic') {
      // In single mode, map semantic results into candidate structure
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
    } else {
      // Keyword single mode
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
    }

    timings.fusionMs = Math.round((performance.now() - fusionStart) * 100) / 100;

    // 4. Optional Reranking
    const rerankStart = performance.now();
    const { candidates: rerankedCandidates, rerankingApplied } =
      await RerankerService.rerankCandidates(processedQuery.normalizedQuery, fusedCandidates, {
        enabled: request.enableReranking,
        topN: topK,
      });
    timings.rerankingMs = Math.round((performance.now() - rerankStart) * 100) / 100;

    // 5. Context Assembly & Source Citations
    let assembledContext = undefined;
    if (request.includeContext) {
      const ctxStart = performance.now();
      assembledContext = ContextAssembler.assemble(rerankedCandidates, {
        maxTokens: request.maxContextTokens,
      });
      timings.contextAssemblyMs = Math.round((performance.now() - ctxStart) * 100) / 100;
    }

    // 6. Map to public SearchResultItem contracts with stable citation identifiers
    const results: SearchResultItem[] = rerankedCandidates.map((candidate, idx) => {
      const citationId = `[S${idx + 1}]`;
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
        metadata: candidate.metadata,
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
        rerankingApplied,
        totalResults: results.length,
        query: processedQuery.rawQuery,
        normalizedQuery: processedQuery.normalizedQuery,
        timings,
      },
    };
  }
}
