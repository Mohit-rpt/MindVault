/**
 * MindVault — Conversation Engine: Query Contextualization Subsystem
 *
 * Resolves conversational pronouns, ambiguous follow-ups, and elliptical queries
 * using bounded conversation history and summary to produce a standalone
 * retrieval query for the Phase 3 RetrievalEngine.
 */

import type { ChatMessageDto } from '@mindvault/shared';
import { LLMProviderFactory } from '../../generation/providers/provider.factory.js';

export interface ContextualizedQueryResult {
  originalQuery: string;
  contextualQuery: string;
  wasRewritten: boolean;
  strategy: 'pass_through' | 'heuristic' | 'llm';
}

export class QueryContextService {
  private static readonly FOLLOW_UP_PRONOUNS =
    /\b(it|its|this|that|these|those|they|them|the former|the latter)\b/i;
  private static readonly ELLIPTICAL_STARTS =
    /^(give me|show me|tell me more|what about|how about|why\?|why is that\?|can you elaborate|give an example|another example|its limitations|advantages and disadvantages)\b/i;

  /**
   * Main entrypoint: Contextualize user query using conversational memory.
   */
  public static async contextualizeQuery(
    currentQuery: string,
    history: ChatMessageDto[],
    summary: string | null,
    options?: { useLLM?: boolean },
  ): Promise<ContextualizedQueryResult> {
    const trimmed = currentQuery.trim();

    // 1. If no history exists, pass through unchanged
    if (!history || history.length === 0) {
      return {
        originalQuery: trimmed,
        contextualQuery: trimmed,
        wasRewritten: false,
        strategy: 'pass_through',
      };
    }

    // 2. Check if query is likely a follow-up or contains pronouns
    const hasPronouns = this.FOLLOW_UP_PRONOUNS.test(trimmed);
    const isElliptical = this.ELLIPTICAL_STARTS.test(trimmed);
    const isVeryShort = trimmed.split(/\s+/).length <= 4 && (hasPronouns || isElliptical);

    if (!hasPronouns && !isElliptical && !isVeryShort) {
      // Query is already self-contained (e.g. "What is PostgreSQL pgvector index?")
      return {
        originalQuery: trimmed,
        contextualQuery: trimmed,
        wasRewritten: false,
        strategy: 'pass_through',
      };
    }

    // 3. Optional LLM Contextualization if configured and available
    if (options?.useLLM) {
      try {
        const llmResult = await this.rewriteWithLLM(trimmed, history, summary);
        if (llmResult && llmResult !== trimmed) {
          return {
            originalQuery: trimmed,
            contextualQuery: llmResult,
            wasRewritten: true,
            strategy: 'llm',
          };
        }
      } catch {
        // Fall back safely to heuristic resolution on LLM timeout or error
      }
    }

    // 4. Deterministic Heuristic Reference Resolution
    const heuristicResult = this.resolveHeuristically(trimmed, history, summary);
    return {
      originalQuery: trimmed,
      contextualQuery: heuristicResult,
      wasRewritten: heuristicResult.toLowerCase() !== trimmed.toLowerCase(),
      strategy: 'heuristic',
    };
  }

  /**
   * Fast, deterministic reference resolution for follow-ups.
   */
  private static resolveHeuristically(
    query: string,
    history: ChatMessageDto[],
    summary: string | null,
  ): string {
    // Find the most recent user question or topic in history
    const pastUserMessages = history.filter((m) => m.role === 'USER');
    const lastUserMsg = pastUserMessages[pastUserMessages.length - 1];

    if (!lastUserMsg) {
      if (summary) {
        return `${query} ${summary.slice(0, 80)}`;
      }
      return query;
    }

    // Extract core subject from previous user message
    const cleanLast = lastUserMsg.content
      .replace(/^(what is|what are|explain|describe|tell me about|how does|why is|define)\s+/i, '')
      .replace(/[?!.]+$/, '')
      .trim();

    if (!cleanLast) return query;

    // Handle "Give me a real-world example" -> "real-world example of <subject>"
    if (/^(give me|show me|provide)?\s*(a\s+)?(real-world\s+)?example/i.test(query)) {
      return `example of ${cleanLast}`;
    }

    // Handle "What are its limitations?" -> "limitations of <subject>"
    if (
      /\b(its|their|the)\s+(limitations|drawbacks|challenges|advantages|benefits|features)\b/i.test(
        query,
      )
    ) {
      const match = query.match(
        /\b(limitations|drawbacks|challenges|advantages|benefits|features)\b/i,
      );
      const aspect = match ? match[1].toLowerCase() : 'aspects';
      return `${aspect} of ${cleanLast}`;
    }

    // Handle generic pronoun replacement (e.g. "how does it work?" -> "how does <subject> work?")
    if (/\b(it|this|that)\b/i.test(query)) {
      return query.replace(/\b(it|this|that)\b/gi, cleanLast);
    }

    // Otherwise append the subject for retrieval enrichment
    return `${cleanLast} ${query}`;
  }

  /**
   * LLM-assisted query rewriting with strict timeout and fallback.
   */
  private static async rewriteWithLLM(
    query: string,
    history: ChatMessageDto[],
    summary: string | null,
  ): Promise<string> {
    const provider = LLMProviderFactory.getProvider();

    // Take last 3 turns
    const recentTurns = history
      .slice(-3)
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    const prompt = `Given the chat history below and the user's latest question, reformulate the latest question into a single standalone, self-contained search query.
Do NOT answer the question. Return ONLY the rewritten query text. If the question is already self-contained, return it unchanged.

${summary ? `Conversation Summary: ${summary}\n` : ''}Recent History:
${recentTurns}

User Question: ${query}

Standalone Query:`;

    const res = await provider.generate(prompt, {
      temperature: 0.0,
      maxTokens: 60,
      timeoutMs: 1500,
    });

    const candidate = res.text
      .trim()
      .replace(/^["']|["']$/g, '')
      .trim();
    if (candidate.length >= 3 && candidate.length <= 300) {
      return candidate;
    }
    return query;
  }
}
