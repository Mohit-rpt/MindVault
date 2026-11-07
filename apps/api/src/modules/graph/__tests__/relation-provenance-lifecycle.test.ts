import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { graphRepository } from '../repositories/graph.repository.js';
import { RelationResolver } from '../resolvers/relation.resolver.js';
import { EntityResolver } from '../resolvers/entity.resolver.js';

describe('Phase 6.3: Relation Provenance & Evidence Lifecycle Integration Suite', () => {
  let wsId: string;
  let doc1Id: string;
  let doc2Id: string;
  let chunk1Id: string;
  let chunk2Id: string;
  let chunk3Id: string;
  let entPostgresId: string;
  let entRedisId: string;
  let relationResolver: RelationResolver;
  let entityResolver: EntityResolver;

  beforeAll(async () => {
    relationResolver = new RelationResolver(graphRepository);
    entityResolver = new EntityResolver(graphRepository);

    // 1. Create Workspace
    const ws = await prisma.workspace.create({
      data: {
        name: 'Provenance Lifecycle WS',
        slug: `provenance-ws-${Date.now()}`,
      },
    });
    wsId = ws.id;

    // 2. Create User
    const user = await prisma.user.create({
      data: {
        email: `provenance-${Date.now()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Provenance Tester',
      },
    });

    // 3. Create Document 1 (Architecture Spec)
    const doc1 = await prisma.document.create({
      data: {
        workspaceId: wsId,
        uploadedById: user.id,
        originalName: 'Architecture_Spec.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(4096),
        checksum: `chk-doc1-${Date.now()}`,
        storageKey: `key-doc1-${Date.now()}`,
      },
    });
    doc1Id = doc1.id;

    // 4. Create Document 2 (Performance Report)
    const doc2 = await prisma.document.create({
      data: {
        workspaceId: wsId,
        uploadedById: user.id,
        originalName: 'Performance_Report.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(8192),
        checksum: `chk-doc2-${Date.now()}`,
        storageKey: `key-doc2-${Date.now()}`,
      },
    });
    doc2Id = doc2.id;

    // 5. Create Chunks across Document 1 and Document 2
    const c1 = await prisma.documentChunk.create({
      data: {
        documentId: doc1Id,
        workspaceId: wsId,
        chunkIndex: 0,
        content: 'PostgreSQL integrates with Redis for fast caching and session storage.',
        tokenCount: 12,
      },
    });
    chunk1Id = c1.id;

    const c2 = await prisma.documentChunk.create({
      data: {
        documentId: doc2Id,
        workspaceId: wsId,
        chunkIndex: 0,
        content:
          'In production benchmarks, PostgreSQL systems leverage Redis to accelerate repeated read queries.',
        tokenCount: 15,
      },
    });
    chunk2Id = c2.id;

    const c3 = await prisma.documentChunk.create({
      data: {
        documentId: doc2Id,
        workspaceId: wsId,
        chunkIndex: 1,
        content:
          'Redis provides ultra-low latency key-value caching across all microservice instances.',
        tokenCount: 12,
      },
    });
    chunk3Id = c3.id;

    // 6. Resolve Entities
    const resPostgres = await entityResolver.resolve(wsId, {
      name: 'PostgreSQL',
      entityType: 'TECHNOLOGY',
      aliases: [],
      confidence: 0.95,
    });
    entPostgresId = resPostgres.entity.id;

    const resRedis = await entityResolver.resolve(wsId, {
      name: 'Redis',
      entityType: 'TECHNOLOGY',
      aliases: [],
      confidence: 0.95,
    });
    entRedisId = resRedis.entity.id;
  });

  afterAll(async () => {
    if (wsId) {
      await prisma.workspace.delete({ where: { id: wsId } });
    }
  });

  it('corroborates relations across multiple documents with distinct document provenance', async () => {
    const entityMap = new Map<string, string>([
      ['postgresql', entPostgresId],
      ['redis', entRedisId],
    ]);

    // 1. Process Chunk 1 from Document 1
    const content1 = 'PostgreSQL integrates with Redis for fast caching and session storage.';
    const val1 = relationResolver.validate(
      {
        sourceEntity: 'PostgreSQL',
        targetEntity: 'Redis',
        relationType: 'USES',
        evidence: 'PostgreSQL integrates with Redis for fast caching and session storage.',
        confidence: 0.9,
      },
      entityMap,
      content1,
    );
    expect(val1).not.toBeNull();

    const { relation: relDoc1, evidenceId: ev1Id } = await relationResolver.resolveAndPersist(
      wsId,
      doc1Id,
      chunk1Id,
      val1!,
    );
    expect(relDoc1.weight).toBe(1.0);
    expect(ev1Id).toBeTruthy();

    // Verify first evidence row links to Document 1
    const ev1 = await prisma.relationEvidence.findUnique({
      where: { id: ev1Id },
    });
    expect(ev1?.documentId).toBe(doc1Id);
    expect(ev1?.chunkId).toBe(chunk1Id);

    // 2. Corroborate from Chunk 2 of Document 2
    const content2 =
      'In production benchmarks, PostgreSQL systems leverage Redis to accelerate repeated read queries.';
    const val2 = relationResolver.validate(
      {
        sourceEntity: 'PostgreSQL',
        targetEntity: 'Redis',
        relationType: 'leverages', // normalized to USES via synonym
        evidence:
          'In production benchmarks, PostgreSQL systems leverage Redis to accelerate repeated read queries.',
        confidence: 0.95,
      },
      entityMap,
      content2,
    );
    expect(val2).not.toBeNull();
    expect(val2?.relationType).toBe('USES');

    const { relation: relDoc2, evidenceId: ev2Id } = await relationResolver.resolveAndPersist(
      wsId,
      doc2Id,
      chunk2Id,
      val2!,
    );
    expect(relDoc2.id).toBe(relDoc1.id);
    expect(relDoc2.weight).toBe(2.0); // 2 distinct chunks across 2 documents

    // Verify second evidence row links to Document 2
    const ev2 = await prisma.relationEvidence.findUnique({
      where: { id: ev2Id },
    });
    expect(ev2?.documentId).toBe(doc2Id);
    expect(ev2?.chunkId).toBe(chunk2Id);

    // Verify total evidence count in DB
    const totalEvidence = await prisma.relationEvidence.count({
      where: { relationId: relDoc1.id },
    });
    expect(totalEvidence).toBe(2);
  });

  it('guarantees worker retry idempotency without weight drift or duplicate evidence', async () => {
    const entityMap = new Map<string, string>([
      ['postgresql', entPostgresId],
      ['redis', entRedisId],
    ]);

    const content2 =
      'In production benchmarks, PostgreSQL systems leverage Redis to accelerate repeated read queries.';
    const val2 = relationResolver.validate(
      {
        sourceEntity: 'PostgreSQL',
        targetEntity: 'Redis',
        relationType: 'USES',
        evidence:
          'In production benchmarks, PostgreSQL systems leverage Redis to accelerate repeated read queries.',
        confidence: 0.95,
      },
      entityMap,
      content2,
    );

    // Simulate worker retry for Chunk 2
    const { relation: relRetried } = await relationResolver.resolveAndPersist(
      wsId,
      doc2Id,
      chunk2Id,
      val2!,
    );

    // Weight and evidence must remain exactly 2.0 and 2
    expect(relRetried.weight).toBe(2.0);
    const count = await prisma.relationEvidence.count({
      where: {
        workspaceId: wsId,
        relationId: relRetried.id,
        chunkId: chunk2Id,
      },
    });
    expect(count).toBe(1);
  });

  it('updates relation weight accurately when partial evidence is deleted', async () => {
    const rel = await prisma.graphRelation.findFirst({
      where: {
        workspaceId: wsId,
        sourceEntityId: entPostgresId,
        targetEntityId: entRedisId,
      },
    });
    expect(rel).not.toBeNull();
    expect(rel?.weight).toBe(2.0);

    // Delete Chunk 1 (from Document 1)
    await prisma.documentChunk.delete({
      where: {
        workspaceId_documentId_id: {
          workspaceId: wsId,
          documentId: doc1Id,
          id: chunk1Id,
        },
      },
    });

    // Evidence count drops to 1
    const remainingEvidence = await prisma.relationEvidence.count({
      where: { relationId: rel!.id },
    });
    expect(remainingEvidence).toBe(1);

    // Authoritative weight synchronized to 1.0 by PostgreSQL trigger
    const updatedRel = await prisma.graphRelation.findUnique({
      where: {
        workspaceId_id: {
          workspaceId: wsId,
          id: rel!.id,
        },
      },
    });
    expect(updatedRel).not.toBeNull();
    expect(updatedRel?.weight).toBe(1.0);
  });

  it('prunes orphaned relation automatically when all remaining evidence is deleted', async () => {
    const rel = await prisma.graphRelation.findFirst({
      where: {
        workspaceId: wsId,
        sourceEntityId: entPostgresId,
        targetEntityId: entRedisId,
      },
    });
    expect(rel).not.toBeNull();

    // Delete Chunk 2 (from Document 2) - all remaining evidence for this relation is removed
    await prisma.documentChunk.delete({
      where: {
        workspaceId_documentId_id: {
          workspaceId: wsId,
          documentId: doc2Id,
          id: chunk2Id,
        },
      },
    });

    // Evidence count is now 0
    const remainingEvidence = await prisma.relationEvidence.count({
      where: { relationId: rel!.id },
    });
    expect(remainingEvidence).toBe(0);

    // Phase 6.3 Invariant: Unsupported relations MUST NOT survive evidence deletion
    const prunedRel = await prisma.graphRelation.findUnique({
      where: {
        workspaceId_id: {
          workspaceId: wsId,
          id: rel!.id,
        },
      },
    });
    expect(prunedRel).toBeNull();
  });

  it('handles 8 concurrent multi-chunk evidence insertions without deadlocks or weight undercounting', async () => {
    // Create new entity pair
    const entDocker = await entityResolver.resolve(wsId, {
      name: 'Docker',
      entityType: 'TECHNOLOGY',
      aliases: [],
      confidence: 0.95,
    });
    const entK8s = await entityResolver.resolve(wsId, {
      name: 'Kubernetes',
      entityType: 'TECHNOLOGY',
      aliases: [],
      confidence: 0.95,
    });

    const entityMap = new Map<string, string>([
      ['docker', entDocker.entity.id],
      ['kubernetes', entK8s.entity.id],
    ]);

    // Create 8 parallel chunks
    const chunkPromises = Array.from({ length: 8 }, (_, i) =>
      prisma.documentChunk.create({
        data: {
          documentId: doc2Id,
          workspaceId: wsId,
          chunkIndex: 10 + i,
          content: `Cluster node ${i} verifies that Kubernetes orchestrates Docker containers reliably.`,
          tokenCount: 10,
        },
      }),
    );
    const createdChunks = await Promise.all(chunkPromises);

    // Concurrently validate and persist relation from all 8 chunks
    const persistPromises = createdChunks.map((chunk, i) => {
      const val = relationResolver.validate(
        {
          sourceEntity: 'Kubernetes',
          targetEntity: 'Docker',
          relationType: 'ORCHESTRATES',
          evidence: `Cluster node ${i} verifies that Kubernetes orchestrates Docker containers reliably.`,
          confidence: 0.9,
        },
        entityMap,
        chunk.content,
      );
      return relationResolver.resolveAndPersist(wsId, doc2Id, chunk.id, val!);
    });

    const results = await Promise.all(persistPromises);
    expect(results).toHaveLength(8);

    // Read authoritative final relation from database
    const finalRel = await prisma.graphRelation.findFirst({
      where: {
        workspaceId: wsId,
        sourceEntityId: entK8s.entity.id,
        targetEntityId: entDocker.entity.id,
        relationType: 'ORCHESTRATES',
      },
    });

    expect(finalRel).not.toBeNull();
    // Advisory lock serialization guarantees weight equals exactly 8.0 without race conditions
    expect(finalRel?.weight).toBe(8.0);

    const totalEvidence = await prisma.relationEvidence.count({
      where: { relationId: finalRel!.id },
    });
    expect(totalEvidence).toBe(8);
  });
});
