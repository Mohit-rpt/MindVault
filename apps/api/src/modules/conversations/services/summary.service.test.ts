/**
 * MindVault — Rolling Summary Service Unit Tests (Phase 5)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SummaryService } from './summary.service.js';
import { ConversationRepository } from '../repositories/conversation.repository.js';
import { InMemoryDatabaseService, setDatabaseService } from '../../../lib/db.js';
import { LLMProviderFactory } from '../../generation/providers/provider.factory.js';
import { MockLLMProvider } from '../../generation/providers/mock.provider.js';

describe('SummaryService (Phase 5)', () => {
  let memoryDb: InMemoryDatabaseService;

  beforeEach(() => {
    memoryDb = new InMemoryDatabaseService();
    setDatabaseService(memoryDb);
    LLMProviderFactory.setProvider(new MockLLMProvider());
  });

  afterEach(() => {
    LLMProviderFactory.resetProvider();
  });

  it('should generate a summary when threshold messages are exceeded', async () => {
    const session = await ConversationRepository.createSession('ws_1', 'usr_1', 'ML Talk');

    // Add 4 completed messages
    await ConversationRepository.createMessage({
      sessionId: session.id,
      workspaceId: 'ws_1',
      role: 'USER',
      content: 'What is deep learning?',
      status: 'COMPLETED',
      sequenceNumber: 1,
    });
    await ConversationRepository.createMessage({
      sessionId: session.id,
      workspaceId: 'ws_1',
      role: 'ASSISTANT',
      content: 'Deep learning uses multi-layer neural networks [S1].',
      status: 'COMPLETED',
      sequenceNumber: 2,
    });
    await ConversationRepository.createMessage({
      sessionId: session.id,
      workspaceId: 'ws_1',
      role: 'USER',
      content: 'How are weights updated?',
      status: 'COMPLETED',
      sequenceNumber: 3,
    });
    await ConversationRepository.createMessage({
      sessionId: session.id,
      workspaceId: 'ws_1',
      role: 'ASSISTANT',
      content: 'Weights are updated using gradient descent and backpropagation [S2].',
      status: 'COMPLETED',
      sequenceNumber: 4,
    });

    const updatedSession = await ConversationRepository.findSessionById(session.id, 'ws_1');
    expect(updatedSession).not.toBeNull();
    expect(updatedSession!.messageCount).toBe(4);

    const summary = await SummaryService.generateAndUpdateSummary(updatedSession!, 'ws_1');
    expect(summary).not.toBeNull();
    expect(summary!.length).toBeGreaterThan(10);

    const refreshed = await ConversationRepository.findSessionById(session.id, 'ws_1');
    expect(refreshed!.summaryVersion).toBe(1);
    expect(refreshed!.summarizedThroughSeq).toBe(4);
    expect(refreshed!.summary).toBe(summary);
  });

  it('should fall back gracefully to deterministic summary if LLM fails', async () => {
    LLMProviderFactory.setProvider(
      new MockLLMProvider({ shouldFail: true, failureMessage: 'Ollama down' }),
    );

    const session = await ConversationRepository.createSession('ws_1', 'usr_1', 'Fallback Test');
    await ConversationRepository.createMessage({
      sessionId: session.id,
      workspaceId: 'ws_1',
      role: 'USER',
      content: 'Discussing vector search algorithms.',
      status: 'COMPLETED',
      sequenceNumber: 1,
    });

    const refreshed = await ConversationRepository.findSessionById(session.id, 'ws_1');
    const summary = await SummaryService.generateAndUpdateSummary(refreshed!, 'ws_1');

    expect(summary).not.toBeNull();
    expect(summary).toContain('Discussion covered topics');
  });
});
