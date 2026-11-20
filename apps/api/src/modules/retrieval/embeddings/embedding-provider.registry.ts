/**
 * MindVault — Retrieval Engine: Embedding Provider Registry Architecture
 *
 * Responsibilities:
 * - Centralized registration and lifecycle management of EmbeddingProvider factories
 * - Canonical provider identity validation ('ollama', 'gemini', 'mock')
 * - Fail-closed resolution for unsupported, malformed, or missing providers
 * - Strict 768-dimensional vector output and contract validation
 * - Production isolation guarding mock providers from production usage
 * - Extensible provider registration with duplicate overwrite protection
 */

import {
  GeminiEmbeddingProvider,
  type EmbeddingProvider,
} from '@mindvault/shared';
import { createHash } from 'crypto';

/**
 * Builtin canonical provider identifiers
 */
export const BUILTIN_EMBEDDING_PROVIDERS = {
  GEMINI: 'gemini',
  MOCK: 'mock',
} as const;

export type BuiltinEmbeddingProvider =
  (typeof BUILTIN_EMBEDDING_PROVIDERS)[keyof typeof BUILTIN_EMBEDDING_PROVIDERS];

/**
 * Registry error hierarchy
 */
export class EmbeddingRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingRegistryError';
  }
}

export class UnsupportedEmbeddingProviderError extends EmbeddingRegistryError {
  public readonly providerId: string;
  public readonly availableProviders: string[];

  constructor(providerId: string, availableProviders: string[]) {
    super(
      `Unsupported embedding provider: "${providerId}". Approved providers: ${availableProviders.join(', ')}`,
    );
    this.name = 'UnsupportedEmbeddingProviderError';
    this.providerId = providerId;
    this.availableProviders = availableProviders;
  }
}

export class DuplicateEmbeddingProviderError extends EmbeddingRegistryError {
  public readonly providerId: string;

  constructor(providerId: string) {
    super(
      `Embedding provider "${providerId}" is already registered. To replace it, specify override: true.`,
    );
    this.name = 'DuplicateEmbeddingProviderError';
    this.providerId = providerId;
  }
}

export class InvalidEmbeddingProviderError extends EmbeddingRegistryError {
  public readonly providerId: string;
  public readonly reason: string;

  constructor(providerId: string, reason: string) {
    super(`Invalid embedding provider for "${providerId}": ${reason}`);
    this.name = 'InvalidEmbeddingProviderError';
    this.providerId = providerId;
    this.reason = reason;
  }
}

/**
 * Provider factory signature returning an instance conforming to EmbeddingProvider
 */
export type EmbeddingProviderFactory = () => EmbeddingProvider;

/**
 * Metadata descriptor for registered embedding providers
 */
export interface EmbeddingProviderDescriptor {
  readonly id: string;
  readonly providerName: string;
  readonly defaultModel: string;
  readonly dimension: number;
}

/**
 * Options for registering an embedding provider
 */
export interface ProviderRegistrationOptions {
  readonly override?: boolean;
  readonly descriptor?: EmbeddingProviderDescriptor;
}

/**
 * Deterministic Mock Embedding Provider for isolated unit & integration testing
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  public readonly modelName: string;
  public readonly dimension: number;

  constructor(modelName = 'mock-embed-768', dimension = 768) {
    this.modelName = modelName;
    this.dimension = dimension;
  }

  public async generateEmbedding(text: string): Promise<number[]> {
    const hash = createHash('sha256').update(text).digest();
    const vector = new Array<number>(this.dimension);

    for (let i = 0; i < this.dimension; i++) {
      const byte = hash[i % hash.length];
      vector[i] = (byte / 255.0) * 2 - 1;
    }

    // L2 Normalize
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return norm > 0 ? vector.map((v) => v / norm) : vector;
  }

  public async generateEmbeddings(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.generateEmbedding(t)));
  }
}

/**
 * Embedding Provider Registry managing registration, introspection, and resolution of providers
 */
export class EmbeddingProviderRegistry {
  private readonly providers = new Map<string, EmbeddingProviderFactory>();
  private readonly descriptors = new Map<string, EmbeddingProviderDescriptor>();

  constructor() {
    this.registerDefaults();
  }

  /**
   * Normalizes and validates provider identifier
   */
  private normalizeId(id: string): string {
    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      throw new InvalidEmbeddingProviderError(String(id), 'Provider identifier must be a non-empty string');
    }
    return id.trim().toLowerCase();
  }

  /**
   * Registers an embedding provider factory
   */
  public register(
    id: string,
    factory: EmbeddingProviderFactory,
    options?: ProviderRegistrationOptions,
  ): void {
    const normalizedId = this.normalizeId(id);

    if (typeof factory !== 'function') {
      throw new InvalidEmbeddingProviderError(
        normalizedId,
        'Provider factory must be an executable function',
      );
    }

    if (this.providers.has(normalizedId) && !options?.override) {
      throw new DuplicateEmbeddingProviderError(normalizedId);
    }

    this.providers.set(normalizedId, factory);

    if (options?.descriptor) {
      this.descriptors.set(normalizedId, options.descriptor);
    } else if (!this.descriptors.has(normalizedId)) {
      this.descriptors.set(normalizedId, {
        id: normalizedId,
        providerName: normalizedId,
        defaultModel: 'unknown',
        dimension: 768,
      });
    }
  }

  /**
   * Unregisters a provider by identifier
   */
  public unregister(id: string): boolean {
    const normalizedId = this.normalizeId(id);
    this.descriptors.delete(normalizedId);
    return this.providers.delete(normalizedId);
  }

  /**
   * Checks whether a provider is registered
   */
  public has(id: string): boolean {
    if (!id || typeof id !== 'string') return false;
    return this.providers.has(id.trim().toLowerCase());
  }

  /**
   * Returns list of all registered provider identifiers sorted alphabetically
   */
  public getRegisteredIds(): string[] {
    return Array.from(this.providers.keys()).sort();
  }

  /**
   * Retrieves descriptor metadata for a registered provider
   */
  public getDescriptor(id: string): EmbeddingProviderDescriptor | undefined {
    if (!id || typeof id !== 'string') return undefined;
    return this.descriptors.get(id.trim().toLowerCase());
  }

  /**
   * Resolves a provider instance by identifier.
   * If id is omitted, resolves from process.env.EMBEDDING_PROVIDER, defaulting to
   * 'mock' in test mode and 'ollama' in development/production.
   *
   * Fails closed with UnsupportedEmbeddingProviderError if requested id is unapproved.
   */
  public resolve(id?: string): EmbeddingProvider {
    const rawId = id?.trim().toLowerCase();
    const envId = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase();
    const targetId = rawId || envId || (process.env.NODE_ENV === 'test' ? 'mock' : 'gemini');

    if (!this.providers.has(targetId)) {
      throw new UnsupportedEmbeddingProviderError(targetId, this.getRegisteredIds());
    }

    // Production guard: mock provider is prohibited in production
    if (targetId === 'mock' && process.env.NODE_ENV === 'production') {
      throw new Error('MockEmbeddingProvider cannot be used in production environment.');
    }

    const factory = this.providers.get(targetId)!;
    const provider = factory();

    // Invariant validation of resolved provider instance
    if (!provider || typeof provider !== 'object') {
      throw new InvalidEmbeddingProviderError(
        targetId,
        'Factory returned null, undefined, or non-object instance',
      );
    }

    if (!provider.modelName || typeof provider.modelName !== 'string' || provider.modelName.trim().length === 0) {
      throw new InvalidEmbeddingProviderError(
        targetId,
        'Provider instance missing valid non-empty modelName string',
      );
    }

    if (provider.dimension !== 768) {
      throw new Error(
        `EmbeddingDimensionViolation (§MOD-01): MindVault pgvector schema strictly mandates 768 dimensions. Received unsupported dimension: ${provider.dimension} from provider '${targetId}'.`,
      );
    }

    if (
      typeof provider.generateEmbedding !== 'function' ||
      typeof provider.generateEmbeddings !== 'function'
    ) {
      throw new InvalidEmbeddingProviderError(
        targetId,
        'Provider instance missing required generateEmbedding / generateEmbeddings methods',
      );
    }

    return provider;
  }

  /**
   * Resets registry to default built-in registrations
   */
  public reset(): void {
    this.providers.clear();
    this.descriptors.clear();
    this.registerDefaults();
  }

  /**
   * Registers default built-in providers
   */
  private registerDefaults(): void {
    this.register(
      BUILTIN_EMBEDDING_PROVIDERS.GEMINI,
      () =>
        new GeminiEmbeddingProvider({
          apiKey:
            process.env.GEMINI_API_KEY ||
            (process.env.NODE_ENV === 'test'
              ? 'AIzaSyD-test-mock-api-key-for-unit-tests-12345'
              : undefined),
        }),
      {
        override: true,
        descriptor: {
          id: BUILTIN_EMBEDDING_PROVIDERS.GEMINI,
          providerName: 'Google Gemini',
          defaultModel: 'gemini-embedding-2',
          dimension: 768,
        },
      },
    );

    this.register(
      BUILTIN_EMBEDDING_PROVIDERS.MOCK,
      () => new MockEmbeddingProvider(),
      {
        override: true,
        descriptor: {
          id: BUILTIN_EMBEDDING_PROVIDERS.MOCK,
          providerName: 'Deterministic Mock',
          defaultModel: 'mock-embed-768',
          dimension: 768,
        },
      },
    );
  }
}

/**
 * Global singleton embedding provider registry instance
 */
export const embeddingProviderRegistry = new EmbeddingProviderRegistry();
