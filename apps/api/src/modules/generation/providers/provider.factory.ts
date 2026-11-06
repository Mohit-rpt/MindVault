/**
 * MindVault — Generation Engine: LLM Provider Factory & Registry
 */

import type { LLMProvider } from '@mindvault/shared';
import { OllamaProvider } from './ollama.provider.js';
import { MockLLMProvider } from './mock.provider.js';

export class LLMProviderFactory {
  private static activeProvider: LLMProvider | null = null;

  public static getProvider(): LLMProvider {
    if (!this.activeProvider) {
      const providerType =
        process.env.NODE_ENV === 'test' ? 'mock' : process.env.LLM_PROVIDER || 'ollama';

      if (providerType === 'mock') {
        this.activeProvider = new MockLLMProvider();
      } else {
        this.activeProvider = new OllamaProvider();
      }
    }
    return this.activeProvider;
  }

  public static setProvider(provider: LLMProvider): void {
    this.activeProvider = provider;
  }

  public static resetProvider(): void {
    this.activeProvider = null;
  }
}
