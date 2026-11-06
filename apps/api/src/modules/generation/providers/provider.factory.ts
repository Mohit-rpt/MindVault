/**
 * MindVault — Generation Engine: LLM Provider Factory & Registry
 */

import type { LLMProvider } from '@mindvault/shared';
import { OllamaProvider } from './ollama.provider.js';
import { MockLLMProvider } from './mock.provider.js';
import { GeminiProvider } from './gemini.provider.js';

export class LLMProviderFactory {
  private static activeProvider: LLMProvider | null = null;
  private static instances: Map<string, LLMProvider> = new Map();

  public static getProvider(requestedProvider?: string): LLMProvider {
    // If a mock provider has been explicitly set (e.g. in test suite), prioritize it
    if (this.activeProvider && process.env.NODE_ENV === 'test') {
      return this.activeProvider;
    }

    const providerType =
      requestedProvider ||
      (process.env.NODE_ENV === 'test' ? 'mock' : process.env.LLM_PROVIDER || 'ollama');

    if (this.instances.has(providerType)) {
      return this.instances.get(providerType)!;
    }

    let instance: LLMProvider;
    if (providerType === 'mock') {
      instance = new MockLLMProvider();
    } else if (providerType === 'gemini') {
      instance = new GeminiProvider();
    } else {
      instance = new OllamaProvider();
    }

    this.instances.set(providerType, instance);
    return instance;
  }

  public static setProvider(provider: LLMProvider): void {
    this.activeProvider = provider;
    this.instances.set(provider.providerName, provider);
  }

  public static resetProvider(): void {
    this.activeProvider = null;
    this.instances.clear();
  }
}
