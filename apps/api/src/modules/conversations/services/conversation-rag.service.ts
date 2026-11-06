/**
 * MindVault — Conversation Engine: Conversational RAG Service
 *
 * Coordinates the full conversational RAG lifecycle:
 * 1. Session & Workspace Verification
 * 2. Message Persistence (User turn & Pending Assistant turn)
 * 3. Query Contextualization for Follow-ups
 * 4. Fresh Hybrid Retrieval via Phase 3 RetrievalEngine
 * 5. Conversational Prompt Construction
 * 6. Real-Time Token Streaming via Active LLMProvider
 * 7. Citation Validation & Grounding Status Assessment
 * 8. Assistant Message Finalization & Rolling Summary Scheduling
 * 9. Fail-Safe Disconnection & Error Cleanup (No orphaned STREAMING records)
 */

import { ConversationRepository } from '../repositories/conversation.repository.js';
import { QueryContextService } from './query-context.service.js';
import { SummaryService } from './summary.service.js';
import { ConversationalPromptBuilder } from '../prompts/conversational.prompt.js';
import { RetrievalService } from '../../retrieval/services/retrieval.service.js';
import { GroundingService } from '../../generation/services/grounding.service.js';
import { LLMProviderFactory } from '../../generation/providers/provider.factory.js';
import { ContextAssembler } from '../../retrieval/context/context.assembler.js';
import type {
  SendConversationMessageRequest,
  ConversationStreamEvent,
  SearchContextDto,
  ChatMessageDto,
} from '@mindvault/shared';

export class ConversationRAGService {
  /**
   * Streams a conversational RAG answer, persisting messages and updating session state.
   */
  public static async *streamConversationMessage(
    sessionId: string,
    workspaceId: string,
    userId: string,
    request: SendConversationMessageRequest,
    abortSignal?: AbortSignal,
  ): AsyncIterable<ConversationStreamEvent> {
    const totalStart = performance.now();

    // 1. Verify session exists and belongs to workspace and user
    const session = await ConversationRepository.findSessionById(sessionId, workspaceId);
    if (!session) {
      yield {
        type: 'error',
        code: 'NOT_FOUND',
        message: 'Chat session not found or access denied',
      };
      return;
    }

    if (session.userId !== userId) {
      yield {
        type: 'error',
        code: 'FORBIDDEN',
        message: 'Access to this conversation is unauthorized',
      };
      return;
    }

    // 2. Persist the incoming USER message immediately
    const userMessage = await ConversationRepository.createMessage({
      sessionId,
      workspaceId,
      role: 'USER',
      content: request.content,
      status: 'COMPLETED',
      tokenEstimate: ContextAssembler.estimateTokens(request.content),
    });

    // 3. Create a pending ASSISTANT message in database
    const assistantMessage = await ConversationRepository.createMessage({
      sessionId,
      workspaceId,
      role: 'ASSISTANT',
      content: '',
      status: 'STREAMING',
    });

    // Emit initial lifecycle events
    yield {
      type: 'start',
      sessionId,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      sequenceNumber: assistantMessage.sequenceNumber,
    };

    yield {
      type: 'user_message',
      message: userMessage,
    };

    let accumulatedText = '';
    let completedAssistantMessage: ChatMessageDto | null = null;

    try {
      // 4. Fetch bounded recent history for context (excluding the current turn)
      const recentHistory: ChatMessageDto[] = await ConversationRepository.getRecentContextMessages(
        sessionId,
        workspaceId,
        6,
      );

      // Exclude the current user message from history array to avoid duplicate turn
      const historyContext = recentHistory.filter((m) => m.id !== userMessage.id);

      // 5. Contextualize query for follow-up reference resolution
      const ctxStart = performance.now();
      const queryContext = await QueryContextService.contextualizeQuery(
        request.content,
        historyContext,
        session.summary,
        { useLLM: true },
      );
      const contextualizationMs = Math.round((performance.now() - ctxStart) * 100) / 100;

      // 6. Execute fresh hybrid retrieval in workspace
      const retrievalStart = performance.now();
      const retrievalResponse = await RetrievalService.executeSearch(workspaceId, {
        query: queryContext.contextualQuery,
        mode: request.retrieval?.mode || 'hybrid',
        topK: request.retrieval?.topK || 5,
        filters: request.retrieval?.filters,
        enableReranking: request.retrieval?.enableReranking || false,
        includeContext: true,
        maxContextTokens: request.retrieval?.maxContextTokens || 3000,
      });
      const retrievalMs = Math.round((performance.now() - retrievalStart) * 100) / 100;

      const context: SearchContextDto = retrievalResponse.context || {
        content: '',
        tokenEstimate: 0,
        sources: [],
      };

      // Emit retrieval completion & sources
      yield {
        type: 'retrieval_complete',
        totalSources: context.sources.length,
        retrievalMode: retrievalResponse.mode,
        contextualQuery: queryContext.contextualQuery,
        timings: { retrievalMs, contextualizationMs },
      };

      yield {
        type: 'sources',
        sources: context.sources,
      };

      // 7. Check for client cancellation before generation
      if (abortSignal?.aborted) {
        throw new Error('CLIENT_ABORTED');
      }

      // 8. Build Conversational Prompt
      const systemPrompt = ConversationalPromptBuilder.getSystemPrompt();
      const userPrompt = ConversationalPromptBuilder.buildPrompt({
        userQuery: request.content,
        contextualQuery: queryContext.contextualQuery,
        context,
        history: historyContext,
        summary: session.summary,
      });

      // 9. Stream tokens from LLM Provider
      const provider = LLMProviderFactory.getProvider();
      const genStart = performance.now();

      const stream = provider.generateStream(userPrompt, {
        systemPrompt,
        temperature: request.generation?.temperature ?? 0.2,
        maxTokens: request.generation?.maxOutputTokens ?? 1024,
      });

      for await (const chunk of stream) {
        if (abortSignal?.aborted) {
          throw new Error('CLIENT_ABORTED');
        }

        if (chunk.text) {
          accumulatedText += chunk.text;
          yield { type: 'token', text: chunk.text };
        }
      }

      const generationDurationMs = Math.round((performance.now() - genStart) * 100) / 100;

      // 10. Citation & Grounding Validation
      const grounding = GroundingService.evaluateGrounding(accumulatedText, context.sources);
      yield { type: 'validation', grounding };

      // 11. Finalize and persist completed assistant message
      completedAssistantMessage = await ConversationRepository.updateMessage(
        assistantMessage.id,
        sessionId,
        {
          content: accumulatedText,
          status: 'COMPLETED',
          citations: context.sources.filter((s) =>
            grounding.referencedCitationIds.includes(s.citationId),
          ),
          metadata: {
            grounding,
            contextualQuery: queryContext.contextualQuery,
            wasRewritten: queryContext.wasRewritten,
            timings: {
              retrievalMs,
              generationDurationMs,
              totalMs: Math.round((performance.now() - totalStart) * 100) / 100,
            },
          },
          tokenEstimate: ContextAssembler.estimateTokens(accumulatedText),
          completedAt: new Date(),
        },
      );

      // Auto-update conversation title if it's the first turn and titled "New Conversation"
      if (session.messageCount <= 1 || session.title === 'New Conversation') {
        const generatedTitle = request.content
          .slice(0, 40)
          .replace(/[?.\n]/g, '')
          .trim();
        if (generatedTitle.length > 2) {
          await ConversationRepository.updateSession(sessionId, workspaceId, {
            title: generatedTitle,
          }).catch(() => {});
        }
      }

      const totalMs = Math.round((performance.now() - totalStart) * 100) / 100;

      yield {
        type: 'done',
        message: completedAssistantMessage,
        finishReason: 'stop',
        metadata: {
          totalMs,
          generationDurationMs,
        },
      };

      // 12. Evaluate and schedule background rolling summary update
      const updatedSession = await ConversationRepository.findSessionById(sessionId, workspaceId);
      if (updatedSession) {
        SummaryService.evaluateAndTriggerSummaryUpdate(updatedSession, workspaceId);
      }
    } catch (err: unknown) {
      const isAbortError =
        err instanceof Error && (err.message === 'CLIENT_ABORTED' || err.name === 'AbortError');
      const isAbort = isAbortError || Boolean(abortSignal?.aborted);

      const status = isAbort ? 'CANCELLED' : 'FAILED';
      const errorMessage = isAbort
        ? 'Generation cancelled by user'
        : err instanceof Error
          ? err.message
          : 'Generation error';

      // Ensure assistant message is NEVER left as STREAMING
      await ConversationRepository.updateMessage(assistantMessage.id, sessionId, {
        content: accumulatedText.length > 0 ? accumulatedText : errorMessage,
        status,
        metadata: {
          error: errorMessage,
          cancelled: isAbort,
        },
        completedAt: new Date(),
      }).catch((dbErr) => {
        console.error(
          '[ConversationRAGService] Failed to clean up assistant message status:',
          dbErr,
        );
      });

      yield {
        type: 'error',
        code: isAbort ? 'CLIENT_ABORTED' : 'GENERATION_ERROR',
        message: errorMessage,
      };
    }
  }
}
