/**
 * MindVault — Knowledge Graph: Extraction Provider Factory
 */

import type { IKnowledgeExtractionProvider } from './extraction-provider.interface.js';
import { MockExtractionProvider } from './mock-extraction.provider.js';
import { OllamaExtractionProvider } from './ollama-extraction.provider.js';
import { GeminiExtractionProvider } from './gemini-extraction.provider.js';

export function createExtractionProvider(
  providerType?: 'ollama' | 'gemini' | 'mock',
): IKnowledgeExtractionProvider {
  const selected =
    providerType ||
    (process.env.GRAPH_EXTRACTION_PROVIDER as 'ollama' | 'gemini' | 'mock') ||
    (process.env.LLM_PROVIDER as 'ollama' | 'gemini' | 'mock') ||
    (process.env.NODE_ENV === 'test' ? 'mock' : 'ollama');

  switch (selected) {
    case 'gemini':
      return new GeminiExtractionProvider();
    case 'mock':
      if (process.env.NODE_ENV === 'production') {
        throw new Error('MockExtractionProvider cannot be used in production environment.');
      }
      return new MockExtractionProvider();
    case 'ollama':
      return new OllamaExtractionProvider();
    default:
      throw new Error(`Unsupported graph extraction provider: "${selected}"`);
  }
}
