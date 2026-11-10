/**
 * MindVault — Generation Engine: RAG Orchestration Service
 *
 * Coordinates the full RAG pipeline:
 * 1. Hybrid Retrieval (Phase 3 RetrievalService)
 * 2. Evidence Context Assembly & Token Budgeting
 * 3. Evidence-Grounded Prompt Construction
 * 4. LLM Generation (Ollama or Mock via LLMProvider)
 * 5. Citation & Grounding Integrity Validation
 * 6. Structured Non-Streaming & Server-Sent Events (SSE) Streaming
 */

import { randomUUID } from 'crypto';
import {
  RAGAnswerRequestSchema,
  type RAGAnswerRequest,
  type RAGAnswerRequestInput,
  type RAGAnswerResponseDto,
  type RAGStreamEvent,
  type RAGTimingsDto,
  type SearchContextDto,
} from '@mindvault/shared';
import { RetrievalService } from '../../retrieval/services/retrieval.service.js';
import { LLMProviderFactory } from '../providers/provider.factory.js';
import { getSystemPrompt } from '../prompts/system.prompt.js';
import { RAGPromptBuilder } from '../prompts/rag.prompt.js';
import { GroundingService } from './grounding.service.js';

export class RAGService {
  /**
   * Non-Streaming Evidence-Grounded Answer Generation.
   */
  public static async generateAnswer(
    workspaceId: string,
    rawRequest: RAGAnswerRequest | RAGAnswerRequestInput,
  ): Promise<RAGAnswerResponseDto> {
    const request = RAGAnswerRequestSchema.parse(rawRequest);
    const totalStart = performance.now();
    const timings: Partial<RAGTimingsDto> = {};

    // 1. Retrieval Execution via Phase 3 RetrievalEngine
    const retrievalStart = performance.now();
    const retrievalResponse = await RetrievalService.executeSearch(workspaceId, {
      query: request.query,
      mode: request.retrieval?.mode || 'hybrid',
      topK: request.retrieval?.topK || 10,
      filters: request.retrieval?.filters,
      enableReranking: request.retrieval?.enableReranking || false,
      includeContext: true,
      maxContextTokens: request.retrieval?.maxContextTokens || 3000,
    });
    timings.retrievalMs = Math.round((performance.now() - retrievalStart) * 100) / 100;
    timings.contextAssemblyMs = retrievalResponse.metadata.timings.contextAssemblyMs || 0;

    const context: SearchContextDto = retrievalResponse.context || {
      content: '',
      tokenEstimate: 0,
      sources: [],
    };

    // 2. Prompt Building
    const promptStart = performance.now();
    const systemPrompt = getSystemPrompt();
    const prompt = RAGPromptBuilder.buildPrompt({
      query: request.query,
      context,
    });
    timings.promptBuildingMs = Math.round((performance.now() - promptStart) * 100) / 100;

    // 3. LLM Generation
    const provider = LLMProviderFactory.getProvider();
    const genStart = performance.now();
    const generationResult = await provider.generate(prompt, {
      systemPrompt,
      temperature: request.generation?.temperature ?? 0.2,
      maxTokens: request.generation?.maxOutputTokens ?? 1024,
    });
    timings.generationDurationMs = Math.round((performance.now() - genStart) * 100) / 100;

    // 4. Citation & Grounding Validation
    const valStart = performance.now();
    const grounding = GroundingService.evaluateGrounding(generationResult.text, context.sources);
    timings.validationMs = Math.round((performance.now() - valStart) * 100) / 100;
    timings.totalMs = Math.round((performance.now() - totalStart) * 100) / 100;

    return {
      query: request.query,
      answer: generationResult.text,
      sources: context.sources,
      grounding,
      context: request.includeContext ? context : undefined,
      metadata: {
        provider: provider.providerName,
        model: provider.modelName,
        retrievalMode: retrievalResponse.mode,
        totalSources: context.sources.length,
        timings: timings as RAGTimingsDto,
      },
    };
  }

  /**
   * Streaming Evidence-Grounded Answer Generation via Server-Sent Events Protocol.
   */
  public static async *generateAnswerStream(
    workspaceId: string,
    rawRequest: RAGAnswerRequest | RAGAnswerRequestInput,
    abortSignal?: AbortSignal,
  ): AsyncIterable<RAGStreamEvent> {
    const request = RAGAnswerRequestSchema.parse(rawRequest);
    const requestId = `rag_${randomUUID()}`;
    const totalStart = performance.now();

    yield { type: 'start', requestId };

    try {
      if (abortSignal?.aborted) {
        throw new Error('CLIENT_ABORTED');
      }

      // 1. Retrieval Execution via Phase 3 RetrievalEngine
      const retrievalStart = performance.now();
      const retrievalResponse = await RetrievalService.executeSearch(
        workspaceId,
        {
          query: request.query,
          mode: request.retrieval?.mode || 'hybrid',
          topK: request.retrieval?.topK || 10,
          filters: request.retrieval?.filters,
          enableReranking: request.retrieval?.enableReranking || false,
          includeContext: true,
          maxContextTokens: request.retrieval?.maxContextTokens || 3000,
        },
        abortSignal,
      );
      const retrievalMs = Math.round((performance.now() - retrievalStart) * 100) / 100;

      const context: SearchContextDto = retrievalResponse.context || {
        content: '',
        tokenEstimate: 0,
        sources: [],
      };

      // Emit retrieval completion and available sources
      yield {
        type: 'retrieval_complete',
        totalSources: context.sources.length,
        retrievalMode: retrievalResponse.mode,
        timings: { retrievalMs },
      };

      yield {
        type: 'sources',
        sources: context.sources,
      };

      if (abortSignal?.aborted) {
        throw new Error('CLIENT_ABORTED');
      }

      // 2. Build Evidence-Grounded Prompt
      const systemPrompt = getSystemPrompt();
      const prompt = RAGPromptBuilder.buildPrompt({
        query: request.query,
        context,
      });

      // 3. Stream Tokens from Active Provider
      const provider = LLMProviderFactory.getProvider();
      let accumulatedAnswer = '';
      const genStart = performance.now();

      const stream = provider.generateStream(prompt, {
        systemPrompt,
        temperature: request.generation?.temperature ?? 0.2,
        maxTokens: request.generation?.maxOutputTokens ?? 1024,
        signal: abortSignal,
      });

      for await (const chunk of stream) {
        if (abortSignal?.aborted) {
          throw new Error('CLIENT_ABORTED');
        }

        if (chunk.text) {
          accumulatedAnswer += chunk.text;
          yield { type: 'token', text: chunk.text };
        }
      }

      if (abortSignal?.aborted) {
        throw new Error('CLIENT_ABORTED');
      }

      const generationDurationMs = Math.round((performance.now() - genStart) * 100) / 100;

      // 4. Citation & Grounding Validation at Stream Completion
      const grounding = GroundingService.evaluateGrounding(accumulatedAnswer, context.sources);

      yield { type: 'validation', grounding };

      const totalMs = Math.round((performance.now() - totalStart) * 100) / 100;
      yield {
        type: 'done',
        finishReason: 'stop',
        metadata: {
          totalMs,
          generationDurationMs,
        },
      };
    } catch (err: any) {
      const isAbortError =
        err instanceof Error && (err.message === 'CLIENT_ABORTED' || err.name === 'AbortError');
      const isAbort = isAbortError || Boolean(abortSignal?.aborted);

      yield {
        type: 'error',
        message: isAbort
          ? 'Generation cancelled by client'
          : err.message || 'An unexpected error occurred during generation',
        code: isAbort ? 'CLIENT_ABORTED' : err.code || 'GENERATION_ERROR',
      };
    }
  }
}
