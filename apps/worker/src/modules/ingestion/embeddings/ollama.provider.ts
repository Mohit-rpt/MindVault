import type { EmbeddingProvider } from '@mindvault/shared';

export interface OllamaProviderConfig {
  baseUrl?: string;
  modelName?: string;
  dimension?: number;
  maxBatchSize?: number;
  timeoutMs?: number;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  public readonly providerName = 'ollama';
  public readonly modelName: string;
  public readonly dimension: number;
  private baseUrl: string;
  private maxBatchSize: number;
  private timeoutMs: number;

  constructor(config?: OllamaProviderConfig) {
    this.baseUrl = (
      config?.baseUrl ||
      process.env.OLLAMA_BASE_URL ||
      'http://localhost:11434'
    ).replace(/\/$/, '');
    this.modelName = config?.modelName || process.env.EMBEDDING_MODEL || 'nomic-embed-text';
    this.dimension = config?.dimension || 768;
    this.maxBatchSize = config?.maxBatchSize || 16;
    this.timeoutMs = config?.timeoutMs || 30000;
  }

  public getDimensions(): number {
    return this.dimension;
  }

  public async generateEmbedding(text: string): Promise<number[]> {
    const results = await this.generateEmbeddings([text]);
    return results[0];
  }

  public async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    const embeddings: number[][] = [];

    // Process in batches to respect rate limits and socket limits
    for (let i = 0; i < texts.length; i += this.maxBatchSize) {
      const batch = texts.slice(i, i + this.maxBatchSize);
      const batchPromises = batch.map((item) => this.fetchEmbeddingWithRetry(item));
      const batchResults = await Promise.all(batchPromises);
      embeddings.push(...batchResults);
    }

    return embeddings;
  }

  private async fetchEmbeddingWithRetry(text: string, attempts = 3): Promise<number[]> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

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
          const errorBody = await response.text().catch(() => '');
          throw new Error(
            `Ollama embedding request failed (HTTP ${response.status}): ${errorBody || response.statusText}`,
          );
        }

        const data: any = await response.json();
        const vector: number[] = data.embedding;

        if (!Array.isArray(vector)) {
          throw new Error('Malformed embedding response: missing embedding array');
        }

        if (vector.length !== this.dimension) {
          throw new Error(
            `Embedding dimension mismatch: expected ${this.dimension}, received ${vector.length} from model '${this.modelName}'`,
          );
        }

        return vector;
      } catch (err: any) {
        lastError = err;
        if (attempt < attempts) {
          // Exponential backoff: 300ms, 600ms, ...
          await new Promise((res) => setTimeout(res, 300 * Math.pow(2, attempt - 1)));
        }
      }
    }

    throw new Error(
      `Failed to generate embedding with Ollama after ${attempts} attempts: ${lastError?.message}`,
    );
  }
}
