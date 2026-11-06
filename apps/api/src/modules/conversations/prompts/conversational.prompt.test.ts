/**
 * MindVault — Conversational Prompt Unit Tests (Phase 5)
 */

import { describe, it, expect } from 'vitest';
import { ConversationalPromptBuilder } from './conversational.prompt.js';
import type { SearchContextDto, ChatMessageDto } from '@mindvault/shared';

describe('ConversationalPromptBuilder (Phase 5)', () => {
  const dummyContext: SearchContextDto = {
    content:
      '--- SOURCE [S1] | Document: ml.pdf ---\nSupervised learning uses labeled training sets.',
    tokenEstimate: 50,
    sources: [
      {
        citationId: '[S1]',
        documentId: 'doc_1',
        documentName: 'ml.pdf',
        chunkId: 'chk_1',
        chunkIndex: 0,
        pageNumber: 1,
        pageRange: 'p. 1',
        section: null,
        content: 'Supervised learning uses labeled training sets.',
        rank: 1,
        score: 0.9,
        retrievalSources: ['semantic'],
      },
    ],
  };

  const dummyHistory: ChatMessageDto[] = [
    {
      id: 'msg_1',
      sessionId: 'ses_1',
      workspaceId: 'ws_1',
      role: 'USER',
      content: 'What is machine learning?',
      status: 'COMPLETED',
      sequenceNumber: 1,
      citations: [],
      metadata: {},
      tokenEstimate: 10,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    },
    {
      id: 'msg_2',
      sessionId: 'ses_1',
      workspaceId: 'ws_1',
      role: 'ASSISTANT',
      content: 'Machine learning enables computers to learn from data [S1].',
      status: 'COMPLETED',
      sequenceNumber: 2,
      citations: [],
      metadata: {},
      tokenEstimate: 15,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    },
  ];

  it('should generate system prompt with strict grounding rules and anti-injection instructions', () => {
    const systemPrompt = ConversationalPromptBuilder.getSystemPrompt();
    expect(systemPrompt).toContain(
      'You are MindVault, an evidence-grounded AI knowledge assistant',
    );
    expect(systemPrompt).toContain('GROUNDED EVIDENCE ONLY');
    expect(systemPrompt).toContain('CONVERSATIONAL CONTEXT VS EVIDENCE');
    expect(systemPrompt).toContain('CITATON REQUIREMENT'.replace('ON', 'ION')); // CITATION REQUIREMENT
    expect(systemPrompt).toContain('INSUFFICIENT EVIDENCE PROTOCOL');
    expect(systemPrompt).toContain('PROMPT INJECTION DEFENSE');
  });

  it('should encapsulate conversation summary inside untrusted boundaries', () => {
    const prompt = ConversationalPromptBuilder.buildPrompt({
      userQuery: 'What are its limitations?',
      contextualQuery: 'limitations of machine learning',
      context: dummyContext,
      summary: 'Discussion centered on basic ML definitions.',
    });

    expect(prompt).toContain('=== BEGIN CONVERSATION SUMMARY (UNTRUSTED CONTEXT) ===');
    expect(prompt).toContain('Discussion centered on basic ML definitions.');
    expect(prompt).toContain('=== END CONVERSATION SUMMARY ===');
  });

  it('should encapsulate recent dialogue history inside untrusted boundaries', () => {
    const prompt = ConversationalPromptBuilder.buildPrompt({
      userQuery: 'What are its limitations?',
      contextualQuery: 'limitations of machine learning',
      context: dummyContext,
      history: dummyHistory,
    });

    expect(prompt).toContain('=== BEGIN RECENT CONVERSATION HISTORY (UNTRUSTED CONTEXT) ===');
    expect(prompt).toContain('[USER]: What is machine learning?');
    expect(prompt).toContain(
      '[ASSISTANT]: Machine learning enables computers to learn from data [S1].',
    );
    expect(prompt).toContain('=== END RECENT CONVERSATION HISTORY ===');
  });

  it('should clearly delineate retrieved document context and query instructions', () => {
    const prompt = ConversationalPromptBuilder.buildPrompt({
      userQuery: 'What are its limitations?',
      contextualQuery: 'limitations of machine learning',
      context: dummyContext,
      history: dummyHistory,
    });

    expect(prompt).toContain('=== BEGIN UNTRUSTED RETRIEVED CONTEXT ===');
    expect(prompt).toContain('--- SOURCE [S1] | Document: ml.pdf ---');
    expect(prompt).toContain('=== END UNTRUSTED RETRIEVED CONTEXT ===');
    expect(prompt).toContain('USER QUERY:');
    expect(prompt).toContain('What are its limitations?');
    expect(prompt).toContain('CONTEXTUALIZED RETRIEVAL TOPIC:');
    expect(prompt).toContain('limitations of machine learning');
  });

  it('should handle zero document context gracefully with insufficient evidence notice', () => {
    const emptyContext: SearchContextDto = {
      content: '',
      tokenEstimate: 0,
      sources: [],
    };

    const prompt = ConversationalPromptBuilder.buildPrompt({
      userQuery: 'What is hyperdrive?',
      contextualQuery: 'What is hyperdrive?',
      context: emptyContext,
    });

    expect(prompt).toContain('NO RELEVANT DOCUMENTS FOUND IN WORKSPACE');
  });
});
