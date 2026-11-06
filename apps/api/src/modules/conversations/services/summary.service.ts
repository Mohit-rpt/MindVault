/**
 * MindVault — Conversation Engine: Rolling Summary Subsystem
 *
 * Maintains a compact, bounded rolling summary of long conversations.
 * Summaries capture conversational concepts, user objectives, and references
 * without storing raw message transcripts or hallucinating factual claims.
 */

import { ConversationRepository } from '../repositories/conversation.repository.js';
import { LLMProviderFactory } from '../../generation/providers/provider.factory.js';
import type { ChatSessionDto, ChatMessageDto } from '@mindvault/shared';

export class SummaryService {
  public static readonly SUMMARY_THRESHOLD_MESSAGES = 4;
  private static readonly activeSummaryJobs = new Set<string>();

  /**
   * Checks if session needs a summary update and performs it asynchronously in the background.
   */
  public static async evaluateAndTriggerSummaryUpdate(
    session: ChatSessionDto,
    workspaceId: string,
  ): Promise<void> {
    const sessionId = session.id;

    // Prevent concurrent duplicate summary jobs for the same session
    if (this.activeSummaryJobs.has(sessionId)) {
      return;
    }

    // Check if new completed messages exceed threshold
    const unsummarizedCount = session.messageCount - session.summarizedThroughSeq;
    if (unsummarizedCount < this.SUMMARY_THRESHOLD_MESSAGES) {
      return;
    }

    this.activeSummaryJobs.add(sessionId);

    // Run asynchronously without blocking primary caller
    (async () => {
      try {
        await this.generateAndUpdateSummary(session, workspaceId);
      } catch (err) {
        // Safe error suppression: summary failure must never block or crash the chat session
        console.warn(`[SummaryService] Failed to update summary for session ${sessionId}:`, err);
      } finally {
        this.activeSummaryJobs.delete(sessionId);
      }
    })();
  }

  /**
   * Generates a new summary version incorporating new messages.
   */
  public static async generateAndUpdateSummary(
    session: ChatSessionDto,
    workspaceId: string,
  ): Promise<string | null> {
    const sessionId = session.id;

    // Fetch messages since last summarized sequence
    const messages = await ConversationRepository.listMessages(sessionId, workspaceId, {
      afterSequence: session.summarizedThroughSeq,
      limit: 20,
    });

    const completedMessages = messages.filter((m) => m.status === 'COMPLETED');
    if (completedMessages.length === 0) {
      return session.summary;
    }

    const latestSeq = Math.max(...completedMessages.map((m) => m.sequenceNumber));
    const newSummaryText = await this.synthesizeSummary(session.summary, completedMessages);

    if (newSummaryText) {
      // Optimistic Concurrency Control: verify session has not been updated concurrently
      const currentSession = await ConversationRepository.findSessionById(sessionId, workspaceId);
      if (
        !currentSession ||
        currentSession.summaryVersion > session.summaryVersion ||
        currentSession.summarizedThroughSeq >= latestSeq
      ) {
        console.warn(
          `[SummaryService] Stale summary write discarded for session ${sessionId} (base v${session.summaryVersion}, current v${currentSession?.summaryVersion})`,
        );
        return currentSession?.summary || session.summary;
      }

      await ConversationRepository.updateSession(sessionId, workspaceId, {
        summary: newSummaryText,
        summaryVersion: currentSession.summaryVersion + 1,
        summarizedThroughSeq: latestSeq,
        summaryUpdatedAt: new Date(),
      });
      return newSummaryText;
    }

    return session.summary;
  }

  /**
   * Synthesizes compact summary text using LLM or deterministic fallback.
   */
  public static async synthesizeSummary(
    previousSummary: string | null,
    newMessages: ChatMessageDto[],
  ): Promise<string> {
    const provider = LLMProviderFactory.getProvider();

    const conversationTranscript = newMessages
      .map((m) => `${m.role}: ${m.content.slice(0, 300)}`)
      .join('\n');

    const prompt = `You are an AI conversation summarizer for MindVault.
Generate a concise, neutral summary of the dialogue below (under 120 words).
Focus on:
1. Primary concepts and topics discussed.
2. User's specific objectives and established references.
3. Any key constraints mentioned by the user.

Do NOT invent facts, extrapolate, or evaluate factual truth. Treat dialogue strictly as conversational history.

${previousSummary ? `Previous Summary:\n${previousSummary}\n\nNew Messages:\n` : 'New Messages:\n'}${conversationTranscript}

Updated Summary:`;

    try {
      const res = await provider.generate(prompt, {
        temperature: 0.1,
        maxTokens: 150,
        timeoutMs: 3000,
      });

      const summary = res.text.trim().replace(/^Updated Summary:\s*/i, '');
      if (summary.length >= 10) {
        return summary;
      }
    } catch {
      // Deterministic fallback if LLM is unavailable
    }

    // Deterministic fallback summary: extract last user questions
    const topics = newMessages
      .filter((m) => m.role === 'USER')
      .map((m) => m.content.slice(0, 50))
      .join('; ');

    if (previousSummary) {
      return `${previousSummary} Further topics discussed: ${topics}`.slice(0, 400);
    }
    return `Discussion covered topics: ${topics}`.slice(0, 400);
  }

  public static shouldSummarize(unsummarizedCount: number): boolean {
    return unsummarizedCount >= this.SUMMARY_THRESHOLD_MESSAGES;
  }

  public static async generateSummary(params: {
    existingSummary: string | null;
    messagesToSummarize: ChatMessageDto[];
  }): Promise<{ summary: string; summaryVersion: number }> {
    const summary = await this.synthesizeSummary(
      params.existingSummary,
      params.messagesToSummarize,
    );
    return {
      summary,
      summaryVersion: params.existingSummary ? 2 : 1,
    };
  }
}

export { SummaryService as ConversationSummaryService };
