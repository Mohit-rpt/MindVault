/**
 * MindVault — Retrieval Evaluation Runner
 *
 * Runs offline quantitative evaluation across Semantic, Keyword, and Hybrid (RRF) search
 * using the golden evaluation corpus and computes IR benchmarks:
 * - Precision@K
 * - Recall@K
 * - Mean Reciprocal Rank (MRR)
 * - nDCG@K
 */

import { InMemoryDatabaseService, setDatabaseService } from '../../../lib/db.js';
import { EmbeddingService, MockEmbeddingProvider } from '../embeddings/embedding.service.js';
import { RetrievalService } from '../services/retrieval.service.js';
import { RetrievalMetrics } from './metrics.js';
import { EVALUATION_CORPUS, EVALUATION_QUERIES } from './eval.dataset.js';
import type { RetrievalMode } from '@mindvault/shared';

export interface ModeEvaluationSummary {
  mode: RetrievalMode;
  precisionAt1: number;
  precisionAt3: number;
  recallAt1: number;
  recallAt3: number;
  mrr: number;
  ndcgAt3: number;
}

export async function runRetrievalEvaluation(): Promise<
  Record<RetrievalMode, ModeEvaluationSummary>
> {
  // 1. Initialize isolated in-memory test database and mock embedding provider
  const memoryDb = new InMemoryDatabaseService();
  setDatabaseService(memoryDb);
  const mockProvider = new MockEmbeddingProvider('mock-embed-768', 768);
  EmbeddingService.setProvider(mockProvider);

  const evalWorkspaceId = 'ws_evaluation_corp';

  // 2. Index evaluation documents and chunks
  for (const doc of EVALUATION_CORPUS) {
    await memoryDb.documents.set(doc.id, {
      id: doc.id,
      workspaceId: evalWorkspaceId,
      uploadedById: 'usr_eval_tester',
      originalName: doc.originalName,
      mimeType: doc.extension === 'pdf' ? 'application/pdf' : 'text/plain',
      extension: doc.extension,
      sizeBytes: BigInt(1024),
      checksum: `sha256_${doc.id}`,
      storageKey: `eval/${doc.id}`,
      status: 'COMPLETED',
      errorMessage: null,
      pageCount: doc.chunks.length,
      chunkCount: doc.chunks.length,
      embeddingModel: 'mock-embed-768',
      embeddingDimension: 768,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      processedAt: new Date(),
    });

    for (const chk of doc.chunks) {
      const embedding = await mockProvider.generateEmbedding(chk.content);
      memoryDb.chunks.set(chk.id, {
        id: chk.id,
        documentId: doc.id,
        workspaceId: evalWorkspaceId,
        chunkIndex: chk.chunkIndex,
        content: chk.content,
        tokenCount: chk.tokenCount,
        pageStart: chk.pageStart || null,
        pageEnd: chk.pageEnd || null,
        metadata: chk.heading ? { heading: chk.heading } : {},
        embedding,
        createdAt: new Date(),
      });
    }
  }

  const modes: RetrievalMode[] = ['semantic', 'keyword', 'hybrid'];
  const results: Record<string, ModeEvaluationSummary> = {} as any;

  // 3. Evaluate each retrieval mode across all evaluation queries
  for (const mode of modes) {
    const p1List: number[] = [];
    const p3List: number[] = [];
    const r1List: number[] = [];
    const r3List: number[] = [];
    const rrList: number[] = [];
    const ndcg3List: number[] = [];

    for (const queryItem of EVALUATION_QUERIES) {
      const relevantSet = new Set(Object.keys(queryItem.relevanceMap));
      const relevanceGrades = new Map(Object.entries(queryItem.relevanceMap));

      const response = await RetrievalService.executeSearch(evalWorkspaceId, {
        query: queryItem.query,
        mode,
        topK: 5,
        includeContext: false,
        maxContextTokens: 2000,
        enableReranking: false,
      });

      const retrievedIds = response.results.map((r) => r.chunkId);

      p1List.push(RetrievalMetrics.precisionAtK(retrievedIds, relevantSet, 1));
      p3List.push(RetrievalMetrics.precisionAtK(retrievedIds, relevantSet, 3));
      r1List.push(RetrievalMetrics.recallAtK(retrievedIds, relevantSet, 1));
      r3List.push(RetrievalMetrics.recallAtK(retrievedIds, relevantSet, 3));
      rrList.push(RetrievalMetrics.reciprocalRank(retrievedIds, relevantSet));
      ndcg3List.push(RetrievalMetrics.ndcgAtK(retrievedIds, relevanceGrades, 3));
    }

    const average = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

    results[mode] = {
      mode,
      precisionAt1: Math.round(average(p1List) * 1000) / 1000,
      precisionAt3: Math.round(average(p3List) * 1000) / 1000,
      recallAt1: Math.round(average(r1List) * 1000) / 1000,
      recallAt3: Math.round(average(r3List) * 1000) / 1000,
      mrr: Math.round(RetrievalMetrics.meanReciprocalRank(rrList) * 1000) / 1000,
      ndcgAt3: Math.round(average(ndcg3List) * 1000) / 1000,
    };
  }

  return results as Record<RetrievalMode, ModeEvaluationSummary>;
}

// CLI Execution entrypoint
if (process.argv[1]?.endsWith('eval.runner.ts') || process.argv[1]?.endsWith('eval.runner.js')) {
  console.log('========================================================================');
  console.log('MindVault Phase 3: Offline Retrieval Quality Evaluation Benchmark');
  console.log('========================================================================\n');

  runRetrievalEvaluation()
    .then((results) => {
      console.table(results);
      console.log('\nBenchmark Evaluation Summary:');
      console.log(`- Hybrid Search MRR: ${results.hybrid.mrr.toFixed(3)}`);
      console.log(`- Hybrid Search nDCG@3: ${results.hybrid.ndcgAt3.toFixed(3)}`);
      console.log(`- Keyword Search MRR: ${results.keyword.mrr.toFixed(3)}`);
      console.log(`- Semantic Search MRR: ${results.semantic.mrr.toFixed(3)}`);
      console.log('\n[PASS] All retrieval modes evaluated successfully.');
    })
    .catch((err) => {
      console.error('Evaluation benchmark failed:', err);
      process.exit(1);
    });
}
