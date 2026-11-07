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
    /^(give me|show me|tell me more|what about|how about|why|can you elaborate|give an example|another example|and what about|its limitations|advantages and disadvantages)\b/i;
  private static readonly TOPIC_RETURN_PATTERN =
    /\b(going back to|back to|returning to|as for our earlier discussion about|in regards to the first topic)\b/i;
  private static readonly TOPIC_SWITCH_PATTERN =
    /^(now[\s,]+let us|now[\s,]+let's|switching topics|changing topic|on another note|by the way|unrelated question)\b/i;

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

    // 2. Check for explicit topic switch (e.g. "Now, let us talk about Prisma migrations")
    if (this.TOPIC_SWITCH_PATTERN.test(trimmed)) {
      const cleanTopic = trimmed
        .replace(this.TOPIC_SWITCH_PATTERN, '')
        .replace(/^(talk about|discuss|explore|look at|consider)\s+/i, '')
        .replace(/[?!.]+$/, '')
        .trim();

      if (cleanTopic.length > 5) {
        return {
          originalQuery: trimmed,
          contextualQuery: cleanTopic,
          wasRewritten: cleanTopic.toLowerCase() !== trimmed.toLowerCase(),
          strategy: 'heuristic',
        };
      }
    }

    // 3. Check if query is self-contained without referential ambiguity
    const hasPronouns = this.FOLLOW_UP_PRONOUNS.test(trimmed);
    const isElliptical = this.ELLIPTICAL_STARTS.test(trimmed);
    const isTopicReturn = this.TOPIC_RETURN_PATTERN.test(trimmed);
    const isVeryShort = trimmed.split(/\s+/).length <= 4 && (hasPronouns || isElliptical);

    if (!hasPronouns && !isElliptical && !isTopicReturn && !isVeryShort) {
      // Query is already self-contained (e.g. "What is a PostgreSQL GIN index?")
      return {
        originalQuery: trimmed,
        contextualQuery: trimmed,
        wasRewritten: false,
        strategy: 'pass_through',
      };
    }

    // 4. Optional LLM Contextualization if configured and available
    if (options?.useLLM) {
      try {
        const llmResult = await this.rewriteWithLLM(trimmed, history, summary);
        if (llmResult && llmResult.toLowerCase() !== trimmed.toLowerCase()) {
          return {
            originalQuery: trimmed,
            contextualQuery: llmResult,
            wasRewritten: true,
            strategy: 'llm',
          };
        }
      } catch {
        // Fall back safely to deterministic heuristic resolution on LLM timeout or error
      }
    }

    // 5. Deterministic Heuristic Reference Resolution
    const heuristicResult = this.resolveHeuristically(trimmed, history, summary);
    const wasRewritten = heuristicResult.toLowerCase() !== trimmed.toLowerCase();

    return {
      originalQuery: trimmed,
      contextualQuery: wasRewritten ? heuristicResult : trimmed,
      wasRewritten,
      strategy: 'heuristic',
    };
  }

  /**
   * Cleans raw message text into its core subject entity.
   */
  public static extractCoreSubject(text: string): string {
    let cleaned = text
      .replace(
        /^(what (is|are|were|was)|how (does|do|can|to)|why (is|are|do|does)|explain|describe|tell me (about|more about)|define|summarize)\s+/i,
        '',
      )
      .replace(/[?!.]+$/, '')
      .trim();

    // Strip leading meta-descriptors like "the benefits of", "the purpose of", "the drawbacks of"
    cleaned = cleaned
      .replace(
        /^(the\s+)?(benefits|limitations|drawbacks|challenges|advantages|disadvantages|features|details|overview|architecture|purpose|mechanisms?)\s+(of\s+)?/i,
        '',
      )
      .trim();

    // Strip leading articles
    cleaned = cleaned.replace(/^(a|an|the)\s+/i, '').trim();

    return cleaned;
  }

  /**
   * Fast, deterministic reference resolution for follow-ups.
   */
  private static resolveHeuristically(
    query: string,
    history: ChatMessageDto[],
    summary: string | null,
  ): string {
    // 1. Handle explicit topic return: "Going back to our first discussion about gradients, how does learning rate affect them?"
    if (this.TOPIC_RETURN_PATTERN.test(query)) {
      const returnMatch = query.match(
        /\b(?:going back to|back to|returning to|as for our earlier discussion about)\s+(?:our\s+)?(?:first\s+|previous\s+)?(?:discussion\s+about\s+)?([a-zA-Z0-9_\-\s]+?)(?:,\s*|\.\s*|$)(.*)/i,
      );

      if (returnMatch) {
        const topicKeyword = returnMatch[1].trim();
        const remainingQuestion = returnMatch[2]?.trim() || '';

        // Find the earliest message in history matching this topic
        const matchedTurn = history.find(
          (m) =>
            m.content.toLowerCase().includes(topicKeyword.toLowerCase()) &&
            !m.content.toLowerCase().includes('going back to'),
        );

        const fullEntity = matchedTurn
          ? this.extractCoreSubject(matchedTurn.content)
          : topicKeyword;

        if (remainingQuestion) {
          // Resolve pronouns in the remaining question
          const resolvedQuestion = remainingQuestion.replace(
            /\b(them|it|these|those)\b/gi,
            fullEntity,
          );
          return resolvedQuestion.replace(/^[,\s]+/, '');
        }

        return `details and concepts of ${fullEntity}`;
      }
    }

    // Find the most recent user question in history
    const pastUserMessages = history.filter((m) => m.role === 'USER');
    const lastUserMsg = pastUserMessages[pastUserMessages.length - 1];

    if (!lastUserMsg) {
      if (summary) {
        return query;
      }
      return query;
    }

    // Extract core subject from previous user message
    const cleanLast = this.extractCoreSubject(lastUserMsg.content);
    if (!cleanLast) return query;

    // 2. Handle "Give me a real-world example" -> "real-world example of <subject>"
    if (/^(give me|show me|provide)?\s*(a\s+)?(real-world\s+)?example/i.test(query)) {
      return `real-world example of ${cleanLast}`;
    }

    // 3. Handle "What are its drawbacks?" / "And what about its drawbacks?"
    if (
      /\b(its|their|the)\s+(limitations|drawbacks|challenges|advantages|benefits|features|pros and cons)\b/i.test(
        query,
      ) ||
      /\b(what about|how about)\s+(its|their|the)?\s*(drawbacks|limitations|advantages|benefits)\b/i.test(
        query,
      )
    ) {
      const match = query.match(
        /\b(limitations|drawbacks|challenges|advantages|benefits|features|pros and cons)\b/i,
      );
      const aspect = match ? match[1].toLowerCase() : 'drawbacks and limitations';
      return `${aspect} of ${cleanLast}`;
    }

    // 4. Handle comparative questions: "How does that compare to RabbitMQ?"
    if (
      /\b(how does\s+(?:that|it)\s+compare to|compare\s+(?:that|it)\s+with|how do they compare to)\s+([a-zA-Z0-9_-]+)/i.test(
        query,
      )
    ) {
      const compareMatch = query.match(
        /\b(?:how does\s+(?:that|it)\s+compare to|compare\s+(?:that|it)\s+with)\s+([a-zA-Z0-9_-]+)/i,
      );
      const targetEntity = compareMatch ? compareMatch[1] : 'alternative';
      return `How does ${cleanLast} compare to ${targetEntity}?`;
    }

    // Extract potential acronym for cleanLast from conversation history (e.g. "Reciprocal Rank Fusion (RRF)")
    let resolvedSubject = cleanLast;
    const historyText = history.map((m) => m.content).join(' ');
    const acronymMatches = historyText.matchAll(
      /\b([A-Z][a-zA-Z0-9]*(?:\s+[A-Z][a-zA-Z0-9]*)*)\s*\(([A-Za-z0-9]+)\)/g,
    );
    for (const match of acronymMatches) {
      const fullTerm = match[1];
      const acronym = match[2];
      if (
        cleanLast.toLowerCase().includes(fullTerm.toLowerCase()) &&
        !cleanLast.toLowerCase().includes(acronym.toLowerCase())
      ) {
        resolvedSubject = cleanLast.replace(
          new RegExp(fullTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
          `${fullTerm} (${acronym.toUpperCase()})`,
        );
        break;
      }
    }

    // Handle demonstrative noun phrases: "that technique", "that algorithm", "that approach", "that method"
    if (
      /\b(?:that|this|the)\s+(?:technique|method|algorithm|approach|model|tool|system|concept|process)\b/i.test(
        query,
      )
    ) {
      return query.replace(
        /\b(?:that|this|the)\s+(?:technique|method|algorithm|approach|model|tool|system|concept|process)\b/gi,
        resolvedSubject,
      );
    }

    // 5. Handle generic pronoun replacement (e.g. "what is it used for?" -> "what is <subject> used for?")
    if (/\b(it|this|that)\b/i.test(query)) {
      return query.replace(/\b(it|this|that)\b/gi, resolvedSubject);
    }

    // 6. Conservative Fallback: If query is already a full question, preserve it rather than inventing context
    if (query.split(/\s+/).length > 5 && !this.ELLIPTICAL_STARTS.test(query)) {
      return query;
    }

    // For short elliptical fragments (<= 3 words), attach the clean subject
    if (query.split(/\s+/).length <= 4) {
      return `${query} ${cleanLast}`;
    }

    return query;
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
      .replace(/^["'`]|["'`]$/g, '')
      .replace(/^\/|\/$/g, '')
      .trim();

    if (candidate.length >= 3 && candidate.length <= 300) {
      return candidate;
    }
    return query;
  }
}
