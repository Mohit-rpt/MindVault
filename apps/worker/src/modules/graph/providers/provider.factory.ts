/**
 * MindVault — Knowledge Graph: Extraction Provider Factory
 */

import type { IKnowledgeExtractionProvider } from './extraction-provider.interface.js';
import { MockExtractionProvider } from './mock-extraction.provider.js';
import { GeminiExtractionProvider } from './gemini-extraction.provider.js';

export function createExtractionProvider(
  providerType?: 'gemini' | 'mock' | string,
): IKnowledgeExtractionProvider {
  const selected =
    providerType ||
    (process.env.GRAPH_EXTRACTION_PROVIDER as string) ||
    (process.env.LLM_PROVIDER as string) ||
    (process.env.NODE_ENV === 'test' ? 'mock' : 'gemini');

  switch (selected) {
    case 'gemini':
      return new GeminiExtractionProvider();
    case 'mock':
      if (process.env.NODE_ENV === 'production') {
        throw new Error('MockExtractionProvider cannot be used in production environment.');
      }
      return new MockExtractionProvider();
    default:
      throw new Error(
        `Unsupported graph extraction provider: "${selected}". MindVault strictly uses "gemini" (or "mock" in test environments).`,
      );
  }
}
