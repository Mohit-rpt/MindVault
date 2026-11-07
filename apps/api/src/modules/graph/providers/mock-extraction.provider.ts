/**
 * MindVault — Knowledge Graph: Mock Extraction Provider
 *
 * Provides deterministic entity and relation extraction for unit, integration,
 * and regression testing without requiring external LLM network connectivity.
 */

import type {
  IKnowledgeExtractionProvider,
  ExtractionContext,
} from './extraction-provider.interface.js';
import type { KnowledgeExtractionResponse } from '@mindvault/shared';

export class MockExtractionProvider implements IKnowledgeExtractionProvider {
  public readonly providerName = 'mock';
  private cannedResponses: Map<string, KnowledgeExtractionResponse> = new Map();
  private defaultResponse: KnowledgeExtractionResponse | null = null;
  private shouldFail = false;
  private shouldTimeout = false;
  private shouldReturnInvalid = false;
  private failureError: Error = new Error('Mock provider simulated extraction error');

  public setResponseForChunk(chunkText: string, response: KnowledgeExtractionResponse): void {
    this.cannedResponses.set(chunkText.trim(), response);
  }

  public setDefaultResponse(response: KnowledgeExtractionResponse | null): void {
    this.defaultResponse = response;
  }

  public simulateFailure(shouldFail = true, error?: Error): void {
    this.shouldFail = shouldFail;
    if (error) this.failureError = error;
  }

  public simulateTimeout(shouldTimeout = true): void {
    this.shouldTimeout = shouldTimeout;
  }

  public simulateInvalidOutput(shouldReturnInvalid = true): void {
    this.shouldReturnInvalid = shouldReturnInvalid;
  }

  public reset(): void {
    this.cannedResponses.clear();
    this.defaultResponse = null;
    this.shouldFail = false;
    this.shouldTimeout = false;
    this.shouldReturnInvalid = false;
  }

  public async extract(
    chunkText: string,
    _context?: ExtractionContext,
  ): Promise<KnowledgeExtractionResponse> {
    if (this.shouldTimeout) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      throw new Error('Extraction request timed out after 50000ms');
    }

    if (this.shouldFail) {
      throw this.failureError;
    }

    if (this.shouldReturnInvalid) {
      // Return invalid structure (confidence out of bounds, missing fields)
      return {
        version: '1.0',
        entities: [
          {
            name: '', // Invalid empty name
            entityType: 'CONCEPT' as any,
            aliases: [],
            confidence: 2.5, // Invalid confidence > 1.0
          },
        ],
        relations: [],
      };
    }

    const trimmed = chunkText.trim();
    if (this.cannedResponses.has(trimmed)) {
      return JSON.parse(JSON.stringify(this.cannedResponses.get(trimmed)!));
    }

    if (this.defaultResponse) {
      return JSON.parse(JSON.stringify(this.defaultResponse));
    }

    // Default heuristic extractor for testing common terms in text
    return this.heuristicExtract(chunkText);
  }

  public async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    return { ok: !this.shouldFail, message: this.shouldFail ? 'Mock unavailable' : 'Mock ready' };
  }

  /**
   * Simple deterministic heuristic extractor based on keyword matching
   */
  private heuristicExtract(text: string): KnowledgeExtractionResponse {
    const entities: any[] = [];
    const relations: any[] = [];
    const lower = text.toLowerCase();

    const techCatalog = [
      { name: 'PostgreSQL', type: 'TECHNOLOGY', aliases: ['postgres', 'pgsql'] },
      { name: 'Redis', type: 'TECHNOLOGY', aliases: ['redis-cache'] },
      { name: 'Node.js', type: 'TECHNOLOGY', aliases: ['nodejs'] },
      { name: 'BullMQ', type: 'TECHNOLOGY', aliases: ['bull-mq'] },
      { name: 'Docker', type: 'TECHNOLOGY', aliases: ['container-engine'] },
      { name: 'Kubernetes', type: 'TECHNOLOGY', aliases: ['K8s'] },
      { name: 'TypeScript', type: 'TECHNOLOGY', aliases: ['ts'] },
      { name: 'C++', type: 'TECHNOLOGY', aliases: ['cpp'] },
      { name: 'C#', type: 'TECHNOLOGY', aliases: ['csharp'] },
      { name: 'pgvector', type: 'TECHNOLOGY', aliases: ['pg-vector'] },
      { name: 'V8 Engine', type: 'TECHNOLOGY', aliases: ['V8'] },
      { name: 'Google', type: 'ORGANIZATION', aliases: ['google-inc'] },
      { name: 'MindVault', type: 'PRODUCT', aliases: ['mind-vault'] },
      { name: 'GraphRAG', type: 'CONCEPT', aliases: ['graph-rag'] },
      { name: 'Reciprocal Rank Fusion', type: 'CONCEPT', aliases: ['RRF'] },
      { name: 'Vector Search', type: 'CONCEPT', aliases: ['semantic-search'] },
      { name: 'HNSW', type: 'CONCEPT', aliases: ['hierarchical-navigable-small-world'] },
      { name: 'BM25', type: 'CONCEPT', aliases: ['best-matching-25'] },
      { name: 'B-Tree', type: 'CONCEPT', aliases: ['btree'] },
      { name: 'Apache Kafka', type: 'TECHNOLOGY', aliases: ['Kafka'] },
      { name: 'Microservices', type: 'CONCEPT', aliases: ['micro-services'] },
      { name: 'OpenAI', type: 'ORGANIZATION', aliases: ['open-ai'] },
      { name: 'San Francisco', type: 'LOCATION', aliases: ['sf'] },
      { name: 'Sam Altman', type: 'PERSON', aliases: ['altman'] },
      { name: 'ChatGPT', type: 'PRODUCT', aliases: ['chat-gpt'] },
      { name: 'Anthropic', type: 'ORGANIZATION', aliases: ['anthropic-ai'] },
      { name: 'Dario Amodei', type: 'PERSON', aliases: ['amodei'] },
      { name: 'Claude', type: 'PRODUCT', aliases: ['claude-ai'] },
      { name: 'Linux', type: 'TECHNOLOGY', aliases: ['linux-os'] },
      { name: 'Microsoft', type: 'ORGANIZATION', aliases: ['msft'] },
    ];

    const foundEntities: any[] = [];

    for (const item of techCatalog) {
      if (lower.includes(item.name.toLowerCase())) {
        const ent = {
          name: item.name,
          entityType: item.type,
          description: `${item.name} mentioned in chunk text`,
          aliases: item.aliases,
          confidence: 0.95,
          sourceText: item.name,
        };
        entities.push(ent);
        foundEntities.push(ent);
      }
    }

    const knownRelations = [
      { src: 'PostgreSQL', tgt: 'pgvector', type: 'SUPPORTS' },
      { src: 'pgvector', tgt: 'HNSW', type: 'IMPLEMENTS' },
      { src: 'HNSW', tgt: 'Vector Search', type: 'USED_FOR' },
      { src: 'BullMQ', tgt: 'Redis', type: 'DEPENDS_ON' },
      { src: 'BullMQ', tgt: 'Node.js', type: 'BUILT_FOR' },
      { src: 'MindVault', tgt: 'BullMQ', type: 'USES' },
      { src: 'Reciprocal Rank Fusion', tgt: 'BM25', type: 'COMBINES' },
      { src: 'MindVault', tgt: 'Reciprocal Rank Fusion', type: 'LEVERAGES' },
      { src: 'Google', tgt: 'V8 Engine', type: 'DEVELOPED' },
      { src: 'Node.js', tgt: 'V8 Engine', type: 'EMBEDS' },
      { src: 'V8 Engine', tgt: 'C++', type: 'IMPLEMENTED_IN' },
      { src: 'Kubernetes', tgt: 'Docker', type: 'ORCHESTRATES' },
      { src: 'Microservices', tgt: 'Apache Kafka', type: 'USES' },
      { src: 'OpenAI', tgt: 'San Francisco', type: 'LOCATED_IN' },
      { src: 'Sam Altman', tgt: 'OpenAI', type: 'WORKS_FOR' },
      { src: 'OpenAI', tgt: 'ChatGPT', type: 'DEVELOPED' },
      { src: 'Dario Amodei', tgt: 'Anthropic', type: 'WORKS_FOR' },
      { src: 'Anthropic', tgt: 'Claude', type: 'PRODUCES' },
      { src: 'Microsoft', tgt: 'TypeScript', type: 'DEVELOPED' },
      { src: 'TypeScript', tgt: 'Node.js', type: 'USES' },
    ];

    const sentences = text.split(/(?<=[.?!])\s+/);
    const getSentenceFor = (s: string, t: string) => {
      const match = sentences.find(
        (st) =>
          st.toLowerCase().includes(s.toLowerCase()) && st.toLowerCase().includes(t.toLowerCase()),
      );
      if (match) return match.trim();
      const matchSingle = sentences.find((st) => st.toLowerCase().includes(s.toLowerCase()));
      return matchSingle ? matchSingle.trim() : text.slice(0, Math.min(text.length, 120));
    };

    const entityNames = new Set(foundEntities.map((e) => e.name));
    let matchedAnyKnown = false;

    for (const kr of knownRelations) {
      if (entityNames.has(kr.src) && entityNames.has(kr.tgt)) {
        matchedAnyKnown = true;
        relations.push({
          sourceEntity: kr.src,
          targetEntity: kr.tgt,
          relationType: kr.type,
          description: `${kr.src} ${kr.type} ${kr.tgt}`,
          confidence: 0.9,
          evidence: getSentenceFor(kr.src, kr.tgt),
        });
      }
    }

    if (!matchedAnyKnown) {
      for (let i = 0; i < foundEntities.length - 1; i++) {
        const src = foundEntities[i];
        const tgt = foundEntities[i + 1];
        relations.push({
          sourceEntity: src.name,
          targetEntity: tgt.name,
          relationType: 'USES',
          description: `${src.name} uses ${tgt.name}`,
          confidence: 0.85,
          evidence: getSentenceFor(src.name, tgt.name),
        });
      }
    }

    return {
      version: '1.0',
      entities,
      relations,
    };
  }
}
