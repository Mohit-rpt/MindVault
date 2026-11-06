/**
 * MindVault — Query Contextualization Unit Tests (Phase 5)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryContextService } from './query-context.service.js';
import { LLMProviderFactory } from '../../generation/providers/provider.factory.js';
import { MockLLMProvider } from '../../generation/providers/mock.provider.js';
import type { ChatMessageDto } from '@mindvault/shared';

describe('QueryContextService (Phase 5)', () => {
  beforeEach(() => {
    LLMProviderFactory.setProvider(new MockLLMProvider());
  });

  afterEach(() => {
    LLMProviderFactory.resetProvider();
  });

  const dummyHistory: ChatMessageDto[] = [
    {
      id: 'm1',
      sessionId: 's1',
      workspaceId: 'w1',
      role: 'USER',
      content: 'Explain the architecture of a neural network.',
      status: 'COMPLETED',
      sequenceNumber: 1,
      citations: [],
      metadata: {},
      tokenEstimate: 10,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    },
    {
      id: 'm2',
      sessionId: 's1',
      workspaceId: 'w1',
      role: 'ASSISTANT',
      content: 'A neural network consists of layers of interconnected neurons [S1].',
      status: 'COMPLETED',
      sequenceNumber: 2,
      citations: [],
      metadata: {},
      tokenEstimate: 20,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    },
  ];

  it('should pass through self-contained queries without alteration', async () => {
    const res = await QueryContextService.contextualizeQuery(
      'What is PostgreSQL pgvector index configuration?',
      dummyHistory,
      null,
    );

    expect(res.wasRewritten).toBe(false);
    expect(res.strategy).toBe('pass_through');
    expect(res.contextualQuery).toBe('What is PostgreSQL pgvector index configuration?');
  });

  it('should pass through queries when conversation history is empty', async () => {
    const res = await QueryContextService.contextualizeQuery('Give me an example', [], null);

    expect(res.wasRewritten).toBe(false);
    expect(res.strategy).toBe('pass_through');
    expect(res.contextualQuery).toBe('Give me an example');
  });

  it('should resolve pronoun follow-up "What are its limitations?" to subject', async () => {
    const res = await QueryContextService.contextualizeQuery(
      'What are its limitations?',
      dummyHistory,
      null,
    );

    expect(res.wasRewritten).toBe(true);
    expect(res.contextualQuery.toLowerCase()).toContain('limitations of');
    expect(res.contextualQuery.toLowerCase()).toContain('neural network');
  });

  it('should resolve elliptical follow-up "Give me a real-world example"', async () => {
    const res = await QueryContextService.contextualizeQuery(
      'Give me a real-world example',
      dummyHistory,
      null,
    );

    expect(res.wasRewritten).toBe(true);
    expect(res.contextualQuery.toLowerCase()).toContain('example of');
    expect(res.contextualQuery.toLowerCase()).toContain('neural network');
  });

  it('should handle LLM rewriting when enabled', async () => {
    const res = await QueryContextService.contextualizeQuery(
      'What are its limitations?',
      dummyHistory,
      null,
      { useLLM: true },
    );

    expect(res.wasRewritten).toBe(true);
    expect(res.strategy).toBe('llm');
    expect(res.contextualQuery).toBe('limitations of neural network architecture');
  });
});
