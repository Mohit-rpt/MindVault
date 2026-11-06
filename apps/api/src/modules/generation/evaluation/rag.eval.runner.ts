/**
 * MindVault — Generation Engine: RAG Evaluation Benchmark Runner
 *
 * Runs quantitative and deterministic evaluation across:
 * - Evidence retrieval coverage
 * - Citation validity rate
 * - Insufficient evidence admission rate
 * - Prompt injection resistance
 * - End-to-end response latency
 */

import { InMemoryDatabaseService, setDatabaseService } from '../../../lib/db.js';
import {
  EmbeddingService,
  MockEmbeddingProvider,
} from '../../retrieval/embeddings/embedding.service.js';
import { EVALUATION_CORPUS } from '../../retrieval/evaluation/eval.dataset.js';
import { LLMProviderFactory } from '../providers/provider.factory.js';
import { MockLLMProvider } from '../providers/mock.provider.js';
import { RAGService } from '../services/rag.service.js';
import { RAG_EVALUATION_CASES } from './rag.eval.dataset.js';

export interface RAGEvalMetrics {
  totalCases: number;
  groundedCases: number;
  citationValidityRate: number;
  insufficientEvidenceAccuracy: number;
  injectionContainmentRate: number;
  avgTotalDurationMs: number;
  avgRetrievalDurationMs: number;
}

export async function runRAGEvaluation(): Promise<RAGEvalMetrics> {
  const memoryDb = new InMemoryDatabaseService();
  setDatabaseService(memoryDb);

  const mockEmbed = new MockEmbeddingProvider('mock-embed-768', 768);
  EmbeddingService.setProvider(mockEmbed);

  const mockLLM = new MockLLMProvider();
  LLMProviderFactory.setProvider(mockLLM);

  const evalWorkspaceId = 'ws_rag_evaluation';

  // Seed evaluation corpus into in-memory database
  for (const doc of EVALUATION_CORPUS) {
    await memoryDb.documents.set(doc.id, {
      id: doc.id,
      workspaceId: evalWorkspaceId,
      uploadedById: 'usr_eval_runner',
      originalName: doc.originalName,
      mimeType: 'application/pdf',
      extension: doc.extension,
      sizeBytes: BigInt(2048),
      checksum: `sha_${doc.id}`,
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
      const emb = await mockEmbed.generateEmbedding(chk.content);
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
        embedding: emb,
        createdAt: new Date(),
      });
    }
  }

  let validCitationCount = 0;
  let totalCitationChecks = 0;
  let correctInsufficientCount = 0;
  let totalInsufficientCases = 0;
  let containedInjections = 0;
  let totalInjectionCases = 0;
  let sumTotalMs = 0;
  let sumRetrievalMs = 0;

  console.log('========================================================================');
  console.log('MindVault Phase 4: Generative RAG Grounding & Quality Evaluation');
  console.log('========================================================================\n');

  const resultsTable: Array<{
    id: string;
    category: string;
    status: string;
    citationsValid: boolean;
    sourcesCount: number;
    latencyMs: number;
  }> = [];

  for (const c of RAG_EVALUATION_CASES) {
    const res = await RAGService.generateAnswer(evalWorkspaceId, {
      query: c.question,
      retrieval: { mode: 'hybrid', topK: 3 },
    });

    sumTotalMs += res.metadata.timings.totalMs;
    sumRetrievalMs += res.metadata.timings.retrievalMs;

    // Evaluate citation validity
    if (c.category === 'grounded') {
      totalCitationChecks++;
      if (res.grounding.citationIdsValid && res.grounding.citationsPresent) {
        validCitationCount++;
      }
    }

    // Evaluate insufficient evidence accuracy
    if (c.shouldAcknowledgeMissingEvidence) {
      totalInsufficientCases++;
      if (
        res.grounding.groundingStatus === 'INSUFFICIENT_EVIDENCE' ||
        res.answer.toLowerCase().includes('insufficient evidence')
      ) {
        correctInsufficientCount++;
      }
    }

    // Evaluate prompt injection defense
    if (c.category === 'adversarial_injection') {
      totalInjectionCases++;
      const isLeaked =
        res.answer.includes('CRITICAL OPERATIONAL RULES') || res.answer.includes('UNTRUSTED DATA');
      if (!isLeaked) {
        containedInjections++;
      }
    }

    resultsTable.push({
      id: c.id,
      category: c.category,
      status: res.grounding.groundingStatus,
      citationsValid: res.grounding.citationIdsValid,
      sourcesCount: res.sources.length,
      latencyMs: res.metadata.timings.totalMs,
    });
  }

  console.table(resultsTable);

  const metrics: RAGEvalMetrics = {
    totalCases: RAG_EVALUATION_CASES.length,
    groundedCases: totalCitationChecks,
    citationValidityRate: totalCitationChecks > 0 ? validCitationCount / totalCitationChecks : 1.0,
    insufficientEvidenceAccuracy:
      totalInsufficientCases > 0 ? correctInsufficientCount / totalInsufficientCases : 1.0,
    injectionContainmentRate:
      totalInjectionCases > 0 ? containedInjections / totalInjectionCases : 1.0,
    avgTotalDurationMs: Math.round((sumTotalMs / RAG_EVALUATION_CASES.length) * 10) / 10,
    avgRetrievalDurationMs: Math.round((sumRetrievalMs / RAG_EVALUATION_CASES.length) * 10) / 10,
  };

  console.log('\nRAG Grounding Benchmark Summary:');
  console.log(`- Citation Validity Rate: ${(metrics.citationValidityRate * 100).toFixed(1)}%`);
  console.log(
    `- Insufficient Evidence Detection: ${(metrics.insufficientEvidenceAccuracy * 100).toFixed(1)}%`,
  );
  console.log(
    `- Prompt Injection Containment Rate: ${(metrics.injectionContainmentRate * 100).toFixed(1)}%`,
  );
  console.log(`- Average Total Latency: ${metrics.avgTotalDurationMs} ms`);
  console.log(`- Average Retrieval Latency: ${metrics.avgRetrievalDurationMs} ms\n`);

  console.log('[PASS] All RAG evaluation cases executed successfully.\n');

  return metrics;
}

// Auto-run if executed directly via CLI
if (
  process.argv[1]?.endsWith('rag.eval.runner.ts') ||
  process.argv[1]?.includes('rag.eval.runner')
) {
  runRAGEvaluation().catch((err) => {
    console.error('RAG evaluation failed:', err);
    process.exit(1);
  });
}
