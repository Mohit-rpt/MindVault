/**
 * MindVault — Generation Engine: Google Gemini LLM Provider
 *
 * Implements Google Gemini text generation and streaming using the official @google/genai SDK.
 * Inherits the canonical GeminiGenerationProvider implementation from @mindvault/shared.
 */

import { GeminiGenerationProvider, type GeminiGenerationConfig } from '@mindvault/shared';

export type GeminiProviderOptions = GeminiGenerationConfig;

export class GeminiProvider extends GeminiGenerationProvider {
  constructor(options?: GeminiProviderOptions) {
    super(options);
  }
}

export { GeminiGenerationProvider };
