import type { EmbeddingProvider } from '@mindvault/shared';
import { OllamaEmbeddingProvider } from './ollama.provider.js';
import { MockEmbeddingProvider } from './mock.provider.js';

export interface CreateEmbeddingProviderOptions {
  provider?: 'ollama' | 'mock';
  modelName?: string;
  model?: string;
  dimension?: number;
  baseUrl?: string;
}

export function createEmbeddingProvider(
  typeOrOptions?: 'ollama' | 'mock' | CreateEmbeddingProviderOptions,
  options?: CreateEmbeddingProviderOptions,
): EmbeddingProvider {
  let providerType: string | undefined;
  let config: CreateEmbeddingProviderOptions = {};

  if (typeof typeOrOptions === 'string') {
    providerType = typeOrOptions;
    config = options || {};
  } else if (typeof typeOrOptions === 'object' && typeOrOptions !== null) {
    providerType = typeOrOptions.provider;
    config = typeOrOptions;
  } else {
    providerType = process.env.NODE_ENV === 'test' ? 'mock' : 'ollama';
  }

  const model = config.modelName || config.model;

  if (providerType === 'mock') {
    return new MockEmbeddingProvider(model || 'mock-embed-768', config.dimension || 768);
  }

  if (providerType === 'ollama') {
    return new OllamaEmbeddingProvider({
      baseUrl: config.baseUrl,
      modelName: model,
      dimension: config.dimension || 768,
    });
  }

  throw new Error(`Unsupported embedding provider type: '${providerType}'`);
}

export { OllamaEmbeddingProvider, MockEmbeddingProvider };
