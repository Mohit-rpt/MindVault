/**
 * MindVault — Retrieval Engine: Embedding Service & Compatibility Validator
 *
 * Responsibilities:
 * - Generates query embeddings matching the document ingestion model
 * - Enforces the strict 768-dimensional nomic-embed-text invariant
 * - Rejects dimension and model mismatches with actionable errors
 * - Provides mock provider in test mode and Ollama provider in live mode
 */

import type { EmbeddingProvider } from '@mindvault/shared';
import { createHash } from 'crypto';

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
 * Ollama Embedding Provider for live local LLM embedding generation
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  public readonly modelName: string;
  public readonly dimension: number;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options?: {
    baseUrl?: string;
    modelName?: string;
    dimension?: number;
    timeoutMs?: number;
  }) {
    this.baseUrl = (
      options?.baseUrl ||
      process.env.OLLAMA_BASE_URL ||
      'http://localhost:11434'
    ).replace(/\/$/, '');
    this.modelName = options?.modelName || process.env.EMBEDDING_MODEL || 'nomic-embed-text';
    this.dimension = options?.dimension || 768;
    this.timeoutMs = options?.timeoutMs || 30000;
  }

  public async generateEmbedding(text: string): Promise<number[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          prompt: text,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `Ollama embedding generation failed (HTTP ${response.status}): ${errorText || response.statusText}`,
        );
      }

      const data = (await response.json()) as { embedding: number[] };
      if (!Array.isArray(data.embedding)) {
        throw new Error('Malformed embedding response: missing embedding array');
      }

      if (data.embedding.length !== this.dimension) {
        throw new Error(
          `Embedding dimension mismatch: expected ${this.dimension}, received ${data.embedding.length} from model '${this.modelName}'`,
        );
      }

      return data.embedding;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error(`Ollama embedding request timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    }
  }

  public async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.generateEmbedding(text));
    }
    return results;
  }
}

/**
 * Global Embedding Service managing active embedding provider and compatibility validation
 */
export class EmbeddingService {
  private static activeProvider: EmbeddingProvider | null = null;

  public static getProvider(): EmbeddingProvider {
    if (!this.activeProvider) {
      if (process.env.NODE_ENV === 'test') {
        this.activeProvider = new MockEmbeddingProvider();
      } else {
        this.activeProvider = new OllamaEmbeddingProvider();
      }
    }
    return this.activeProvider;
  }

  public static setProvider(provider: EmbeddingProvider): void {
    this.activeProvider = provider;
  }

  public static resetProvider(): void {
    this.activeProvider = null;
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
   * Validates that the active query model is compatible with indexed workspace documents.
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

      // Check model compatibility if specified on document
      if (
        doc.embeddingModel &&
        doc.embeddingModel !== provider.modelName &&
        process.env.NODE_ENV !== 'test'
      ) {
        return {
          compatible: false,
          reason: `Document embedded with model '${doc.embeddingModel}' is incompatible with query model '${provider.modelName}'`,
        };
      }
    }

    return { compatible: true };
  }
}
