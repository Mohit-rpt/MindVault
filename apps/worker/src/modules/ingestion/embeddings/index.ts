/**
 * MindVault — Worker Ingestion: Embedding Provider Registry & Factory
 *
 * Responsibilities:
 * - Centralized registration and lifecycle management of worker EmbeddingProvider factories
 * - Canonical provider identity validation ('ollama', 'gemini', 'mock')
 * - Fail-closed resolution for unsupported, malformed, or missing providers
 * - Strict 768-dimensional vector output and contract validation (§MOD-01)
 * - Production isolation guarding mock providers from production ingestion
 * - Extensible provider registration with duplicate overwrite protection
 * - Factory compatibility preserving createEmbeddingProvider() signature
 */

import {
  GeminiEmbeddingProvider,
  type EmbeddingProvider,
} from '@mindvault/shared';
import { MockEmbeddingProvider } from './mock.provider.js';
import type { GoogleGenAI } from '@google/genai';
import { env } from '../../../config/env.js';

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
 * Registry error hierarchy matching Phase 1B.4 registry architecture
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

export interface CreateEmbeddingProviderOptions {
  provider?: 'ollama' | 'gemini' | 'mock';
  modelName?: string;
  model?: string;
  dimension?: number;
  baseUrl?: string;
  apiKey?: string;
  maxBatchSize?: number;
  timeoutMs?: number;
  client?: GoogleGenAI;
}

export type EmbeddingProviderFactory = (
  config?: CreateEmbeddingProviderOptions,
) => EmbeddingProvider;

export interface EmbeddingProviderDescriptor {
  readonly id: string;
  readonly providerName: string;
  readonly defaultModel: string;
  readonly dimension: number;
}

export interface ProviderRegistrationOptions {
  readonly override?: boolean;
  readonly descriptor?: EmbeddingProviderDescriptor;
}

/**
 * Worker Embedding Provider Registry managing registration, introspection, and resolution of providers
 */
export class WorkerEmbeddingProviderRegistry {
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
      throw new InvalidEmbeddingProviderError(
        String(id),
        'Provider identifier must be a non-empty string',
      );
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
   * If id and config.provider are omitted, resolves from process.env.EMBEDDING_PROVIDER or
   * env.EMBEDDING_PROVIDER, defaulting to 'mock' in test mode and 'ollama' in development/production.
   *
   * Fails closed with UnsupportedEmbeddingProviderError if requested id is unapproved.
   */
  public resolve(
    id?: string,
    config?: CreateEmbeddingProviderOptions,
  ): EmbeddingProvider {
    const rawId = (id || config?.provider)?.trim().toLowerCase();
    const envId = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase();
    const targetId =
      rawId || envId || (process.env.NODE_ENV === 'test' ? 'mock' : 'gemini');

    if (!this.providers.has(targetId)) {
      throw new UnsupportedEmbeddingProviderError(targetId, this.getRegisteredIds());
    }

    // Production guard: mock provider is prohibited in production
    if (
      targetId === 'mock' &&
      (process.env.NODE_ENV === 'production' || env?.NODE_ENV === 'production')
    ) {
      throw new Error('MockEmbeddingProvider cannot be used in production environment.');
    }

    const factory = this.providers.get(targetId)!;
    const provider = factory(config);

    // Invariant validation of resolved provider instance
    if (!provider || typeof provider !== 'object') {
      throw new InvalidEmbeddingProviderError(
        targetId,
        'Factory returned null, undefined, or non-object instance',
      );
    }

    if (
      !provider.modelName ||
      typeof provider.modelName !== 'string' ||
      provider.modelName.trim().length === 0
    ) {
      throw new InvalidEmbeddingProviderError(
        targetId,
        'Provider instance missing valid non-empty modelName string',
      );
    }

    const dimension = config?.dimension ?? provider.dimension ?? 768;
    if (dimension !== 768 || provider.dimension !== 768) {
      throw new Error(
        `EmbeddingDimensionViolation (§MOD-01): MindVault pgvector schema strictly mandates 768 dimensions. Received unsupported dimension: ${dimension !== 768 ? dimension : provider.dimension}.`,
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
      (cfg) =>
        new GeminiEmbeddingProvider({
          apiKey:
            cfg?.apiKey ||
            env?.GEMINI_API_KEY ||
            process.env.GEMINI_API_KEY ||
            (process.env.NODE_ENV === 'test' && !cfg?.client
              ? 'AIzaSyD-test-mock-api-key-for-unit-tests-12345'
              : undefined),
          modelName:
            cfg?.modelName ||
            cfg?.model ||
            env?.GEMINI_EMBEDDING_MODEL ||
            process.env.GEMINI_EMBEDDING_MODEL ||
            'gemini-embedding-2',
          dimension: cfg?.dimension || 768,
          maxBatchSize: cfg?.maxBatchSize,
          timeoutMs: cfg?.timeoutMs,
          client: cfg?.client,
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
      (cfg) =>
        new MockEmbeddingProvider(
          cfg?.modelName || cfg?.model || 'mock-embed-768',
          cfg?.dimension || 768,
        ),
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
 * Global singleton worker embedding provider registry instance
 */
export const workerEmbeddingProviderRegistry = new WorkerEmbeddingProviderRegistry();

/**
 * Factory creating an EmbeddingProvider conforming to MindVault's pgvector 768-D schema.
 * Supports explicit string provider identifier or configuration options object.
 */
export function createEmbeddingProvider(
  typeOrOptions?: 'gemini' | 'mock' | string | CreateEmbeddingProviderOptions,
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
    config = options || {};
  }

  return workerEmbeddingProviderRegistry.resolve(providerType, config);
}

export { MockEmbeddingProvider, GeminiEmbeddingProvider };
