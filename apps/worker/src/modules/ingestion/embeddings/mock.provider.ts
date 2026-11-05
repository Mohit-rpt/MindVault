import crypto from 'node:crypto';
import type { EmbeddingProvider } from '@mindvault/shared';

export class MockEmbeddingProvider implements EmbeddingProvider {
  public readonly providerName = 'mock';
  public readonly modelName: string;
  public readonly dimension: number;

  constructor(modelNameOrDimension: string | number = 'mock-embed-768', dimension = 768) {
    if (typeof modelNameOrDimension === 'number') {
      this.modelName = 'mock-embed-768';
      this.dimension = modelNameOrDimension;
    } else {
      this.modelName = modelNameOrDimension;
      this.dimension = dimension;
    }
  }

  public async generateEmbedding(text: string): Promise<number[]> {
    return this.createDeterministicVector(text);
  }

  public async generateEmbeddings(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.createDeterministicVector(t));
  }

  public async embedText(text: string): Promise<number[]> {
    return this.generateEmbedding(text);
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    return this.generateEmbeddings(texts);
  }

  public getDimensions(): number {
    return this.dimension;
  }

  private createDeterministicVector(text: string): number[] {
    const vector: number[] = new Array(this.dimension);
    let hash = crypto
      .createHash('sha256')
      .update(text || '')
      .digest();

    for (let i = 0; i < this.dimension; i++) {
      // If we run out of hash bytes, re-hash with index salt
      if (i % 32 === 0 && i > 0) {
        hash = crypto.createHash('sha256').update(hash).digest();
      }
      const byteVal = hash[i % 32];
      // Map byte [0, 255] to [-1.0, 1.0]
      vector[i] = byteVal / 127.5 - 1.0;
    }

    // L2 unit normalize so cosine similarity = dot product
    let sumSq = 0;
    for (let i = 0; i < this.dimension; i++) {
      sumSq += vector[i] * vector[i];
    }
    const norm = Math.sqrt(sumSq) || 1.0;
    for (let i = 0; i < this.dimension; i++) {
      vector[i] = Number((vector[i] / norm).toFixed(6));
    }

    return vector;
  }
}
