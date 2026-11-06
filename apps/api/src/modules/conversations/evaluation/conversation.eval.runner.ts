/**
 * MindVault — Phase 5: Conversational RAG Evaluation Benchmark Runner
 *
 * Runs quantitative and deterministic evaluation across 12 conversational scenarios:
 * 1. Single-turn baseline RAG
 * 2. Pronoun reference resolution
 * 3. Demonstrative reference resolution
 * 4. Elliptical follow-up expansion
 * 5. Comparative follow-up handling
 * 6. Topic shift detection
 * 7. Topic return handling
 * 8. Rolling summary memory compression
 * 9. Adversarial prompt injection containment
 * 10. Multi-tenant workspace isolation
 * 11. Disconnect and abort lifecycle recovery
 * 12. Full conversation CRUD lifecycle operations
 */

import { InMemoryDatabaseService, setDatabaseService } from '../../../lib/db.js';
import {
  EmbeddingService,
  MockEmbeddingProvider,
} from '../../retrieval/embeddings/embedding.service.js';
import { EVALUATION_CORPUS } from '../../retrieval/evaluation/eval.dataset.js';
import { LLMProviderFactory } from '../../generation/providers/provider.factory.js';
import { MockLLMProvider } from '../../generation/providers/mock.provider.js';
import { ConversationRepository } from '../repositories/conversation.repository.js';
import { QueryContextService } from '../services/query-context.service.js';
import { ConversationSummaryService } from '../services/summary.service.js';
import { ConversationalPromptBuilder } from '../prompts/conversational.prompt.js';
import {
  CONVERSATION_EVAL_SCENARIOS,
  type ConversationEvalScenario,
} from './conversation.eval.dataset.js';
import type { ChatMessageDto, SearchContextDto } from '@mindvault/shared';

export interface ConversationEvalMetrics {
  totalScenarios: number;
  passedScenarios: number;
  rewriteAccuracy: number;
  isolationRate: number;
  abortRecoveryRate: number;
  summaryAccuracy: number;
  avgDurationMs: number;
}

export async function runConversationEvaluation(): Promise<ConversationEvalMetrics> {
  const memoryDb = new InMemoryDatabaseService();
  setDatabaseService(memoryDb);

  const mockEmbed = new MockEmbeddingProvider('mock-embed-768', 768);
  EmbeddingService.setProvider(mockEmbed);

  const mockLLM = new MockLLMProvider();
  LLMProviderFactory.setProvider(mockLLM);

  const evalWorkspaceId = 'ws_eval_conv_1';
  const evalUserId = 'usr_eval_runner';

  // Seed sample documents into in-memory database
  for (const doc of EVALUATION_CORPUS) {
    await memoryDb.documents.set(doc.id, {
      id: doc.id,
      workspaceId: evalWorkspaceId,
      uploadedById: evalUserId,
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

  console.log('========================================================================');
  console.log('MindVault Phase 5: Conversational RAG & Memory Benchmark Evaluation');
  console.log('========================================================================\n');

  let passedScenarios = 0;
  const resultsTable: Array<{
    id: string;
    scenario: string;
    category: string;
    status: 'PASS' | 'FAIL';
    durationMs: number;
    details: string;
  }> = [];

  const startTimeAll = performance.now();

  for (const scenario of CONVERSATION_EVAL_SCENARIOS) {
    const start = performance.now();
    let passed = false;
    let details = '';

    try {
      switch (scenario.expectedCategory) {
        case 'single_turn': {
          // Baseline single turn query
          const session = await ConversationRepository.createSession(
            evalWorkspaceId,
            evalUserId,
            scenario.name,
          );

          const rewriteResult = await QueryContextService.contextualizeQuery(
            scenario.query,
            [],
            null,
          );

          passed = !rewriteResult.wasRewritten && rewriteResult.contextualQuery === scenario.query;
          details = `Search query unmodified: "${rewriteResult.contextualQuery.slice(0, 40)}..."`;
          break;
        }

        case 'pronoun_resolution':
        case 'demonstrative_resolution':
        case 'elliptical':
        case 'comparative':
        case 'topic_return':
        case 'multiple_antecedents':
        case 'ambiguous_reference': {
          // Conversational rewrite resolution
          const messagesForRewrite: ChatMessageDto[] = scenario.history.map((h, i) => ({
            id: `msg_eval_${i}`,
            sessionId: 'sess_eval',
            workspaceId: evalWorkspaceId,
            role: h.role,
            content: h.content,
            status: 'COMPLETED' as const,
            sequenceNumber: i + 1,
            citations: [],
            metadata: {},
            tokenEstimate: 50,
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          }));

          const rewriteResult = await QueryContextService.contextualizeQuery(
            scenario.query,
            messagesForRewrite,
            null,
            { useLLM: true },
          );

          const lowerRewritten = rewriteResult.contextualQuery.toLowerCase();
          const matchesExpected =
            !scenario.expectedResolvedTerms ||
            scenario.expectedResolvedTerms.every((term) =>
              lowerRewritten.includes(term.toLowerCase()),
            );

          const noForbiddenTerms =
            !scenario.forbiddenTerms ||
            scenario.forbiddenTerms.every((term) => !lowerRewritten.includes(term.toLowerCase()));

          const matchesSubstring =
            !scenario.expectedOutputSubstring ||
            rewriteResult.contextualQuery.includes(scenario.expectedOutputSubstring);

          const matchesRewriteFlag =
            scenario.shouldTriggerRewrite === undefined ||
            rewriteResult.wasRewritten === scenario.shouldTriggerRewrite;

          passed = matchesRewriteFlag && matchesExpected && noForbiddenTerms && matchesSubstring;
          details = `Rewritten: "${rewriteResult.contextualQuery}"`;
          break;
        }

        case 'self_contained': {
          const messagesForRewrite: ChatMessageDto[] = scenario.history.map((h, i) => ({
            id: `msg_eval_${i}`,
            sessionId: 'sess_eval',
            workspaceId: evalWorkspaceId,
            role: h.role,
            content: h.content,
            status: 'COMPLETED' as const,
            sequenceNumber: i + 1,
            citations: [],
            metadata: {},
            tokenEstimate: 50,
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          }));

          const rewriteResult = await QueryContextService.contextualizeQuery(
            scenario.query,
            messagesForRewrite,
            null,
          );

          const lowerRewritten = rewriteResult.contextualQuery.toLowerCase();
          const noForbiddenTerms =
            !scenario.forbiddenTerms ||
            scenario.forbiddenTerms.every((term) => !lowerRewritten.includes(term.toLowerCase()));

          const matchesSubstring =
            !scenario.expectedOutputSubstring ||
            rewriteResult.contextualQuery.includes(scenario.expectedOutputSubstring);

          passed = !rewriteResult.wasRewritten && noForbiddenTerms && matchesSubstring;
          details = `Unmodified: "${rewriteResult.contextualQuery}"`;
          break;
        }

        case 'topic_shift': {
          // Independent topic shift should not pollute the new topic
          const messagesForRewrite: ChatMessageDto[] = scenario.history.map((h, i) => ({
            id: `msg_eval_${i}`,
            sessionId: 'sess_eval',
            workspaceId: evalWorkspaceId,
            role: h.role,
            content: h.content,
            status: 'COMPLETED' as const,
            sequenceNumber: i + 1,
            citations: [],
            metadata: {},
            tokenEstimate: 50,
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          }));

          const rewriteResult = await QueryContextService.contextualizeQuery(
            scenario.query,
            messagesForRewrite,
            null,
          );

          const lowerRewritten = rewriteResult.contextualQuery.toLowerCase();
          const matchesExpected =
            !scenario.expectedResolvedTerms ||
            scenario.expectedResolvedTerms.every((term) =>
              lowerRewritten.includes(term.toLowerCase()),
            );

          const noForbiddenTerms =
            !scenario.forbiddenTerms ||
            scenario.forbiddenTerms.every((term) => !lowerRewritten.includes(term.toLowerCase()));

          passed = matchesExpected && noForbiddenTerms;
          details = `Topic preserved: "${rewriteResult.contextualQuery}"`;
          break;
        }

        case 'summarization': {
          // Summary generation check when message threshold is reached
          const messages: ChatMessageDto[] = scenario.history.map((h, i) => ({
            id: `msg_sum_${i}`,
            sessionId: 'sess_sum',
            workspaceId: evalWorkspaceId,
            role: h.role,
            content: h.content,
            status: 'COMPLETED' as const,
            sequenceNumber: i + 1,
            citations: [],
            metadata: {},
            tokenEstimate: 40,
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          }));

          const shouldSum = ConversationSummaryService.shouldSummarize(messages.length);
          const generated = await ConversationSummaryService.generateSummary({
            existingSummary: null,
            messagesToSummarize: messages,
          });

          passed = shouldSum && Boolean(generated.summary) && generated.summary.length > 20;
          details = `Summary v${generated.summaryVersion}: "${generated.summary.slice(0, 50)}..."`;
          break;
        }

        case 'adversarial_containment': {
          // Prompt isolation: untrusted history cannot escape system instructions
          const messages: ChatMessageDto[] = scenario.history.map((h, i) => ({
            id: `msg_adv_${i}`,
            sessionId: 'sess_adv',
            workspaceId: evalWorkspaceId,
            role: h.role,
            content: h.content,
            status: 'COMPLETED' as const,
            sequenceNumber: i + 1,
            citations: [],
            metadata: {},
            tokenEstimate: 40,
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          }));

          const mockContext: SearchContextDto = {
            content: 'Neural networks use backpropagation.',
            sources: [
              {
                citationId: '[S1]',
                chunkId: 'chk_1',
                documentId: 'doc_1',
                documentName: 'ai.pdf',
                chunkIndex: 0,
                pageNumber: 1,
                pageRange: '1',
                section: null,
                content: 'Neural networks use backpropagation.',
                rank: 1,
                score: 0.9,
                retrievalSources: ['vector'],
              },
            ],
            tokenEstimate: 20,
          };

          const systemPrompt = ConversationalPromptBuilder.getSystemPrompt();
          const userPrompt = ConversationalPromptBuilder.buildPrompt({
            userQuery: scenario.query,
            contextualQuery: scenario.query,
            context: mockContext,
            history: messages,
            summary: null,
          });

          passed =
            userPrompt.includes('BEGIN RECENT CONVERSATION HISTORY (UNTRUSTED CONTEXT)') &&
            userPrompt.includes('SYSTEM OVERRIDE') &&
            systemPrompt.includes('PROMPT INJECTION DEFENSE');
          details = 'Untrusted history isolated in explicit context boundaries';
          break;
        }

        case 'workspace_isolation': {
          // Cross-workspace session access denied
          const sessionWs1 = await ConversationRepository.createSession(
            'ws_tenant_alpha',
            'usr_alpha',
            'Alpha Secret Notes',
          );

          // Attempt read from Beta workspace
          const sessionFoundFromBeta = await ConversationRepository.findSessionById(
            sessionWs1.id,
            'ws_tenant_beta',
          );

          passed = sessionFoundFromBeta === null;
          details = 'Session in Workspace Alpha completely invisible to Workspace Beta';
          break;
        }

        case 'abort_recovery': {
          // Disconnected or aborted stream recovers gracefully
          const session = await ConversationRepository.createSession(
            evalWorkspaceId,
            evalUserId,
            'Abort Recovery Test',
          );

          await ConversationRepository.createMessage({
            sessionId: session.id,
            workspaceId: evalWorkspaceId,
            role: 'USER',
            content: 'Hello, stream this!',
            sequenceNumber: 1,
            tokenEstimate: 5,
          });

          const asstMsg = await ConversationRepository.createMessage({
            sessionId: session.id,
            workspaceId: evalWorkspaceId,
            role: 'ASSISTANT',
            content: '',
            status: 'STREAMING',
            sequenceNumber: 2,
            tokenEstimate: 0,
          });

          // Abort signal simulation: mark status as CANCELLED
          await ConversationRepository.updateMessage(asstMsg.id, session.id, {
            status: 'CANCELLED',
          });

          const messages = await ConversationRepository.listMessages(session.id, evalWorkspaceId);
          const abortedMsg = messages.find((m) => m.id === asstMsg.id);

          passed = abortedMsg?.status === 'CANCELLED';
          details = 'Assistant message safely transitioned from STREAMING to CANCELLED';
          break;
        }

        case 'lifecycle': {
          // Session CRUD lifecycle
          const created = await ConversationRepository.createSession(
            evalWorkspaceId,
            evalUserId,
            'Initial Lifecycle Title',
          );

          const renamed = await ConversationRepository.updateSession(created.id, evalWorkspaceId, {
            title: 'Renamed Title',
          });

          const archived = await ConversationRepository.updateSession(created.id, evalWorkspaceId, {
            status: 'ARCHIVED',
          });

          await ConversationRepository.deleteSession(created.id, evalWorkspaceId);
          const foundAfterDelete = await ConversationRepository.findSessionById(
            created.id,
            evalWorkspaceId,
          );

          passed =
            renamed.title === 'Renamed Title' &&
            archived.status === 'ARCHIVED' &&
            foundAfterDelete === null;
          details = 'Create -> Rename -> Archive -> Soft-Delete lifecycle verified';
          break;
        }
      }
    } catch (err: any) {
      passed = false;
      details = `Error: ${err.message}`;
    }

    const durationMs = Math.round(performance.now() - start);
    if (passed) passedScenarios++;

    resultsTable.push({
      id: scenario.id,
      scenario: scenario.name,
      category: scenario.expectedCategory,
      status: passed ? 'PASS' : 'FAIL',
      durationMs,
      details,
    });
  }

  const totalDurationMs = Math.round(performance.now() - startTimeAll);

  // Print results table
  console.log(
    '| ID      | Scenario Name                                  | Category               | Status | Time (ms) | Details',
  );
  console.log(
    '|---------|------------------------------------------------|------------------------|--------|-----------|-------------------------------------------------------',
  );
  for (const r of resultsTable) {
    const paddedId = r.id.padEnd(7);
    const paddedName = r.scenario.padEnd(46).slice(0, 46);
    const paddedCat = r.category.padEnd(22).slice(0, 22);
    const paddedStatus = (
      r.status === 'PASS' ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'
    ).padEnd(14);
    const paddedTime = `${r.durationMs}ms`.padStart(9);
    console.log(
      `| ${paddedId} | ${paddedName} | ${paddedCat} | ${paddedStatus} | ${paddedTime} | ${r.details}`,
    );
  }

  console.log('\n========================================================================');
  console.log(
    `Conversational Benchmark Summary: ${passedScenarios}/${CONVERSATION_EVAL_SCENARIOS.length} passed (${Math.round(
      (passedScenarios / CONVERSATION_EVAL_SCENARIOS.length) * 100,
    )}%) in ${totalDurationMs}ms`,
  );
  console.log('========================================================================\n');

  const metrics: ConversationEvalMetrics = {
    totalScenarios: CONVERSATION_EVAL_SCENARIOS.length,
    passedScenarios,
    rewriteAccuracy: 1.0,
    isolationRate: 1.0,
    abortRecoveryRate: 1.0,
    summaryAccuracy: 1.0,
    avgDurationMs: Math.round(totalDurationMs / CONVERSATION_EVAL_SCENARIOS.length),
  };

  if (passedScenarios < CONVERSATION_EVAL_SCENARIOS.length) {
    throw new Error(
      `Conversational evaluation failed: only ${passedScenarios}/${CONVERSATION_EVAL_SCENARIOS.length} scenarios passed.`,
    );
  }

  return metrics;
}

// Self-executing CLI runner
if (
  process.argv[1]?.endsWith('conversation.eval.runner.ts') ||
  process.argv[1]?.endsWith('conversation.eval.runner.js')
) {
  runConversationEvaluation()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Evaluation runner failed:', err);
      process.exit(1);
    });
}
