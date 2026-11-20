/**
 * MindVault — Retrieval Engine: Embedding Service & Compatibility Validator
 *
 * Responsibilities:
 * - Delegates provider resolution to the authoritative EmbeddingProviderRegistry
 * - Generates query embeddings matching the document ingestion model
 * - Enforces the strict 768-dimensional pgvector schema invariant
 * - Rejects dimension and model mismatches with actionable errors
 * - Provides mock provider in test mode and Gemini provider in live mode by default
 * - Validates document compatibility using the shared EmbeddingModelPolicy
 */

import {
  EmbeddingModelPolicy,
  type EmbeddingProvider,
} from '@mindvault/shared';
import {
  EmbeddingProviderRegistry,
  embeddingProviderRegistry,
  MockEmbeddingProvider,
  BUILTIN_EMBEDDING_PROVIDERS,
  EmbeddingRegistryError,
  UnsupportedEmbeddingProviderError,
  DuplicateEmbeddingProviderError,
  InvalidEmbeddingProviderError,
  type BuiltinEmbeddingProvider,
  type EmbeddingProviderDescriptor,
  type EmbeddingProviderFactory,
  type ProviderRegistrationOptions,
} from './embedding-provider.registry.js';

// Re-export providers, registry, and errors for backward compatibility
export {
  MockEmbeddingProvider,
  EmbeddingProviderRegistry,
  embeddingProviderRegistry,
  BUILTIN_EMBEDDING_PROVIDERS,
  EmbeddingRegistryError,
  UnsupportedEmbeddingProviderError,
  DuplicateEmbeddingProviderError,
  InvalidEmbeddingProviderError,
  type BuiltinEmbeddingProvider,
  type EmbeddingProviderDescriptor,
  type EmbeddingProviderFactory,
  type ProviderRegistrationOptions,
};

/**
 * Global Embedding Service managing active embedding provider and compatibility validation
 */
export class EmbeddingService {
  private static activeProvider: EmbeddingProvider | null = null;
  private static registry: EmbeddingProviderRegistry = embeddingProviderRegistry;

  /**
   * Returns the underlying embedding provider registry
   */
  public static getRegistry(): EmbeddingProviderRegistry {
    return this.registry;
  }

  /**
   * Overrides the embedding provider registry (primarily for isolated test fixtures)
   */
  public static setRegistry(registry: EmbeddingProviderRegistry): void {
    this.registry = registry;
    this.activeProvider = null;
  }

  /**
   * Resolves the active embedding provider via registry if not explicitly assigned
   */
  public static getProvider(): EmbeddingProvider {
    if (!this.activeProvider) {
      this.activeProvider = this.registry.resolve();
    }
    return this.activeProvider;
  }

  /**
   * Explicitly sets the active provider (e.g. for mock injection in unit tests)
   */
  public static setProvider(provider: EmbeddingProvider): void {
    this.activeProvider = provider;
  }

  /**
   * Resets the active provider instance, forcing re-resolution on next access
   */
  public static resetProvider(): void {
    this.activeProvider = null;
  }

  /**
   * Returns the model identifier of the currently active embedding provider.
   */
  public static getModelName(): string {
    return this.getProvider().modelName;
  }

  /**
   * Generates a 768-dimensional query vector and validates dimension conformity.
   */
  public static async generateQueryVector(queryText: string): Promise<number[]> {
    const provider = this.getProvider();
    const vector = await provider.generateEmbedding(queryText);

    if (!Array.isArray(vector) || vector.length !== 768) {
      throw new Error(
        `Critical embedding invariant violation: query vector length is ${vector?.length || 0}, but MindVault strictly requires 768 dimensions`,
      );
    }

    return vector;
  }

  /**
   * Generates a 768-dimensional query vector and returns both the vector and authoritative model name.
   * Guarantees strict 1:1 consistency between vector generation and model provenance.
   */
  public static async generateQueryVectorWithModel(
    queryText: string,
  ): Promise<{ vector: number[]; modelName: string }> {
    const provider = this.getProvider();
    const vector = await this.generateQueryVector(queryText);
    return {
      vector,
      modelName: provider.modelName,
    };
  }

  /**
   * Validates that the active query model is compatible with indexed workspace documents
   * using the authoritative shared EmbeddingModelPolicy.
   */
  public static validateCompatibility(
    targetDocuments?: Array<{ embeddingModel?: string | null; embeddingDimension?: number | null }>,
  ): { compatible: boolean; reason?: string } {
    const provider = this.getProvider();

    if (provider.dimension !== 768) {
      return {
        compatible: false,
        reason: `Active embedding provider '${provider.modelName}' dimension is ${provider.dimension}. System requires 768.`,
      };
    }

    if (!targetDocuments || targetDocuments.length === 0) {
      return { compatible: true };
    }

    for (const doc of targetDocuments) {
      if (doc.embeddingDimension && doc.embeddingDimension !== provider.dimension) {
        return {
          compatible: false,
          reason: `Document embedded with dimension ${doc.embeddingDimension} is incompatible with query provider dimension ${provider.dimension}`,
        };
      }

      // Check model compatibility via authoritative EmbeddingModelPolicy
      if (!EmbeddingModelPolicy.isDocumentCompatible(provider.modelName, doc.embeddingModel)) {
        return {
          compatible: false,
          reason: `Document embedded with model '${doc.embeddingModel || 'NULL'}' is incompatible with query model '${provider.modelName}'`,
        };
      }
    }

    return { compatible: true };
  }
}
