/**
 * MindVault Post-Phase — Stage 1.2: Evaluation Database Client
 *
 * Dedicated database client operating strictly on the isolated `mindvault_eval`
 * database on port 5433. Never touches production data.
 */

import { PrismaClient } from '@prisma/client';
import { EVAL_CONFIG } from './eval-config.js';

export interface EvalDocumentRecord {
  id: string;
  workspaceId: string;
  uploadedById: string;
  originalName: string;
  mimeType: string;
  extension: string;
  sizeBytes: bigint;
  checksum: string;
  storageKey: string;
  status: 'UPLOADED' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  pageCount: number;
  chunkCount: number;
  embeddingModel: string;
  embeddingDimension: number;
  metadata?: Record<string, unknown>;
}

export interface EvalChunkRecord {
  id: string;
  documentId: string;
  workspaceId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageStart?: number | null;
  pageEnd?: number | null;
  metadata?: Record<string, unknown>;
  embedding: number[];
}

export interface EvalSearchResult {
  chunkId: string;
  documentId: string;
  documentName: string;
  workspaceId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageStart: number | null;
  pageEnd: number | null;
  score: number;
}

export class EvalDatabaseService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient({
      datasources: {
        db: {
          url: EVAL_CONFIG.databaseUrl,
        },
      },
    });
  }

  public get client(): PrismaClient {
    return this.prisma;
  }

  public async verifyConnection(): Promise<{
    database: string;
    pgvectorVersion: string;
    hnswIndexPresent: boolean;
    ginIndexPresent: boolean;
  }> {
    const dbRes: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT current_database() as db_name, (SELECT extversion FROM pg_extension WHERE extname = 'vector') as vec_ver`,
    );

    const indexRes: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT indexname, indexdef FROM pg_indexes 
      WHERE tablename = 'document_chunks'
    `);

    const indexDefs = indexRes.map((r) => r.indexdef.toLowerCase());
    const hnswIndexPresent = indexDefs.some(
      (d) => d.includes('hnsw') && d.includes('vector_cosine_ops'),
    );
    const ginIndexPresent = indexDefs.some((d) => d.includes('gin') && d.includes('search_vector'));

    return {
      database: dbRes[0]?.db_name || 'unknown',
      pgvectorVersion: dbRes[0]?.vec_ver || 'unknown',
      hnswIndexPresent,
      ginIndexPresent,
    };
  }

  public async setupEvaluationWorkspace(): Promise<void> {
    const { workspaceId, workspaceName, workspaceSlug, userId, userEmail, userName } = EVAL_CONFIG;

    // 1. Ensure User exists
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "users" (id, name, email, "passwordHash", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'eval_hash_not_for_auth', NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET name = $2, email = $3`,
      userId,
      userName,
      userEmail,
    );

    // 2. Ensure Workspace exists
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "workspaces" (id, name, slug, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET name = $2, slug = $3`,
      workspaceId,
      workspaceName,
      workspaceSlug,
    );

    // 3. Ensure Membership exists
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "workspace_members" (id, "userId", "workspaceId", role, "joinedAt")
       VALUES ($1, $2, $3, 'OWNER'::"WorkspaceRole", NOW())
       ON CONFLICT DO NOTHING`,
      `mem_${userId}_${workspaceId}`,
      userId,
      workspaceId,
    );
  }

  public async clearEvaluationWorkspace(): Promise<void> {
    const { workspaceId } = EVAL_CONFIG;
    // Cascade delete handles chunks, mentions, evidence, and canonical aliases
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM "relation_evidence" WHERE "workspace_id" = $1`,
      workspaceId,
    );
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM "graph_relations" WHERE "workspace_id" = $1`,
      workspaceId,
    );
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM "graph_entities" WHERE "workspace_id" = $1`,
      workspaceId,
    );
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM "document_chunks" WHERE "workspaceId" = $1`,
      workspaceId,
    );
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM "documents" WHERE "workspaceId" = $1`,
      workspaceId,
    );
  }

  public async insertDocument(doc: EvalDocumentRecord): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "documents" (
        id, "workspaceId", "uploadedById", "originalName", "mimeType", extension,
        "sizeBytes", checksum, "storageKey", status, "pageCount", "chunkCount",
        "embeddingModel", "embeddingDimension", metadata, "createdAt", "updatedAt", "processedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::"DocumentStatus", $11, $12, $13, $14, $15::jsonb, NOW(), NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        status = $10::"DocumentStatus", "pageCount" = $11, "chunkCount" = $12, metadata = $15::jsonb, "updatedAt" = NOW()`,
      doc.id,
      doc.workspaceId,
      doc.uploadedById,
      doc.originalName,
      doc.mimeType,
      doc.extension,
      doc.sizeBytes,
      doc.checksum,
      doc.storageKey,
      doc.status,
      doc.pageCount,
      doc.chunkCount,
      doc.embeddingModel,
      doc.embeddingDimension,
      JSON.stringify(doc.metadata || {}),
    );
  }

  public async insertChunk(chunk: EvalChunkRecord): Promise<void> {
    const vectorStr = `[${chunk.embedding.join(',')}]`;
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "document_chunks" (
        id, "documentId", "workspaceId", "chunkIndex", content, "tokenCount",
        "pageStart", "pageEnd", metadata, embedding, "createdAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::vector, NOW())
      ON CONFLICT (id) DO UPDATE SET
        content = $5, "tokenCount" = $6, embedding = $10::vector, metadata = $9::jsonb`,
      chunk.id,
      chunk.documentId,
      chunk.workspaceId,
      chunk.chunkIndex,
      chunk.content,
      chunk.tokenCount,
      chunk.pageStart ?? null,
      chunk.pageEnd ?? null,
      JSON.stringify(chunk.metadata || {}),
      vectorStr,
    );
  }

  public async searchVectorChunks(
    workspaceId: string,
    queryEmbedding: number[],
    topK = 5,
    similarityFloor = 0.0,
  ): Promise<EvalSearchResult[]> {
    const vectorStr = `[${queryEmbedding.join(',')}]`;
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT c.id as "chunkId", c."documentId", c."workspaceId", c."chunkIndex",
              c.content, c."tokenCount", c."pageStart", c."pageEnd",
              d."originalName" as "documentName",
              (1 - (c."embedding" <=> $2::vector)) AS score
       FROM "document_chunks" c
       JOIN "documents" d ON d.id = c."documentId"
       WHERE c."workspaceId" = $1 AND d."status" = 'COMPLETED'
         AND (1 - (c."embedding" <=> $2::vector)) >= $4
       ORDER BY score DESC
       LIMIT $3`,
      workspaceId,
      vectorStr,
      topK,
      similarityFloor,
    );

    return rows.map((r) => ({
      chunkId: r.chunkId,
      documentId: r.documentId,
      documentName: r.documentName,
      workspaceId: r.workspaceId,
      chunkIndex: r.chunkIndex,
      content: r.content,
      tokenCount: r.tokenCount,
      pageStart: r.pageStart,
      pageEnd: r.pageEnd,
      score: Number(r.score),
    }));
  }

  public async searchKeywordChunks(
    workspaceId: string,
    query: string,
    topK = 5,
  ): Promise<EvalSearchResult[]> {
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT c.id as "chunkId", c."documentId", c."workspaceId", c."chunkIndex",
              c.content, c."tokenCount", c."pageStart", c."pageEnd",
              d."originalName" as "documentName",
              ts_rank_cd(c."search_vector", websearch_to_tsquery('english', $2)) AS rank
       FROM "document_chunks" c
       JOIN "documents" d ON d.id = c."documentId"
       WHERE c."workspaceId" = $1 AND d."status" = 'COMPLETED'
         AND (c."search_vector" @@ websearch_to_tsquery('english', $2) OR c."search_vector" @@ plainto_tsquery('english', $2))
       ORDER BY rank DESC
       LIMIT $3`,
      workspaceId,
      query,
      topK,
    );

    return rows.map((r) => ({
      chunkId: r.chunkId,
      documentId: r.documentId,
      documentName: r.documentName,
      workspaceId: r.workspaceId,
      chunkIndex: r.chunkIndex,
      content: r.content,
      tokenCount: r.tokenCount,
      pageStart: r.pageStart,
      pageEnd: r.pageEnd,
      score: Number(r.rank),
    }));
  }

  public async insertGraphKnowledge(params: {
    workspaceId: string;
    entities: Array<{ id: string; name: string; entityType: string; description?: string }>;
    relations: Array<{
      id: string;
      sourceEntityId: string;
      targetEntityId: string;
      relationType: string;
      weight: number;
      evidenceChunkId: string;
      evidenceDocId: string;
      verbatimExcerpt: string;
    }>;
  }): Promise<void> {
    const { workspaceId, entities, relations } = params;

    for (const ent of entities) {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "graph_entities" (
          id, workspace_id, canonical_name, normalized_name, entity_type, description, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5::"EntityType", $6, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING`,
        ent.id,
        workspaceId,
        ent.name,
        ent.name.toLowerCase().trim(),
        ent.entityType,
        ent.description || null,
      );
    }

    for (const rel of relations) {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "graph_relations" (
          id, workspace_id, source_entity_id, target_entity_id, relation_type, weight, confidence, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 0.9, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING`,
        rel.id,
        workspaceId,
        rel.sourceEntityId,
        rel.targetEntityId,
        rel.relationType,
        rel.weight,
      );

      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "relation_evidence" (
          id, relation_id, workspace_id, document_id, chunk_id, evidence_text, confidence, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 0.9, NOW())
        ON CONFLICT (id) DO NOTHING`,
        `ev_${rel.id}`,
        rel.id,
        workspaceId,
        rel.evidenceDocId,
        rel.evidenceChunkId,
        rel.verbatimExcerpt,
      );
    }
  }

  public async searchGraphEvidence(
    workspaceId: string,
    seedEntityNames: string[],
    topK = 5,
  ): Promise<
    Array<{
      relationId: string;
      sourceName: string;
      targetName: string;
      relationType: string;
      weight: number;
      chunkId: string;
      documentId: string;
      documentName: string;
      verbatimExcerpt: string;
    }>
  > {
    if (seedEntityNames.length === 0) return [];

    const namesList = seedEntityNames
      .map((n) => `'${n.replace(/'/g, "''").toLowerCase()}'`)
      .join(',');
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `
      SELECT r.id as "relationId", s.canonical_name as "sourceName", t.canonical_name as "targetName",
             r.relation_type as "relationType", r.weight, e.chunk_id as "chunkId",
             e.document_id as "documentId", d."originalName" as "documentName",
             e.evidence_text as "verbatimExcerpt"
      FROM "graph_relations" r
      JOIN "graph_entities" s ON s.id = r.source_entity_id AND s.workspace_id = r.workspace_id
      JOIN "graph_entities" t ON t.id = r.target_entity_id AND t.workspace_id = r.workspace_id
      JOIN "relation_evidence" e ON e.relation_id = r.id AND e.workspace_id = r.workspace_id
      JOIN "documents" d ON d.id = e.document_id AND d."workspaceId" = r.workspace_id
      WHERE r.workspace_id = $1
        AND (LOWER(s.canonical_name) IN (${namesList}) OR LOWER(t.canonical_name) IN (${namesList}))
      ORDER BY r.weight DESC
      LIMIT $2
    `,
      workspaceId,
      topK,
    );

    return rows;
  }

  public async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
