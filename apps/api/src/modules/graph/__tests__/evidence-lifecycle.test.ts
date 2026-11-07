import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { graphRepository } from '../repositories/graph.repository.js';
import { RelationResolver } from '../resolvers/relation.resolver.js';

describe('Phase 6.1: Evidence Lifecycle & Weight Synchronization Integration Tests', () => {
  let wsId: string;
  let docId: string;
  let chunkAId: string;
  let chunkBId: string;
  let chunkCId: string;
  let ent1Id: string;
  let ent2Id: string;
  let relationResolver: RelationResolver;

  beforeAll(async () => {
    relationResolver = new RelationResolver(graphRepository);

    // 1. Create Workspace
    const ws = await prisma.workspace.create({
      data: {
        name: 'Evidence Lifecycle WS',
        slug: `evidence-lifecycle-${Date.now()}`,
      },
    });
    wsId = ws.id;

    // 2. Create User
    const user = await prisma.user.create({
      data: {
        email: `lifecycle-${Date.now()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Lifecycle Tester',
      },
    });

    // 3. Create Document
    const doc = await prisma.document.create({
      data: {
        workspaceId: wsId,
        uploadedById: user.id,
        originalName: 'Lifecycle_Test.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(2048),
        checksum: `chk-lifecycle-${Date.now()}`,
        storageKey: `key-lifecycle-${Date.now()}`,
      },
    });
    docId = doc.id;

    // 4. Create 3 Chunks
    const cA = await prisma.documentChunk.create({
      data: {
        documentId: docId,
        workspaceId: wsId,
        chunkIndex: 0,
        content: 'PostgreSQL provides robust ACID guarantees for transactions.',
        tokenCount: 8,
      },
    });
    chunkAId = cA.id;

    const cB = await prisma.documentChunk.create({
      data: {
        documentId: docId,
        workspaceId: wsId,
        chunkIndex: 1,
        content: 'Developers choose PostgreSQL because it enforces strict ACID compliance.',
        tokenCount: 9,
      },
    });
    chunkBId = cB.id;

    const cC = await prisma.documentChunk.create({
      data: {
        documentId: docId,
        workspaceId: wsId,
        chunkIndex: 2,
        content: 'ACID properties in PostgreSQL safeguard financial records against corruption.',
        tokenCount: 10,
      },
    });
    chunkCId = cC.id;

    // 5. Create Entities
    const e1 = await prisma.graphEntity.create({
      data: {
        workspaceId: wsId,
        canonicalName: 'PostgreSQL',
        normalizedName: 'postgresql',
        entityType: 'TECHNOLOGY',
      },
    });
    ent1Id = e1.id;

    const e2 = await prisma.graphEntity.create({
      data: {
        workspaceId: wsId,
        canonicalName: 'ACID',
        normalizedName: 'acid',
        entityType: 'CONCEPT',
      },
    });
    ent2Id = e2.id;
  });

  afterAll(async () => {
    await prisma.workspace.delete({ where: { id: wsId } });
  });

  it('keeps relation weight synchronized when evidence rows are deleted via chunk deletion', async () => {
    const entityMap = new Map<string, string>([
      ['postgresql', ent1Id],
      ['acid', ent2Id],
    ]);

    // 1. Ingest Chunk A -> weight = 1.0
    const relA = {
      sourceEntity: 'PostgreSQL',
      targetEntity: 'ACID',
      relationType: 'ENFORCES',
      evidence: 'PostgreSQL provides robust ACID guarantees for transactions.',
      confidence: 0.9,
    };
    const valA = relationResolver.validate(
      relA,
      entityMap,
      'PostgreSQL provides robust ACID guarantees for transactions.',
    )!;
    const resA = await relationResolver.resolveAndPersist(wsId, docId, chunkAId, valA);
    expect(resA.relation.weight).toBe(1.0);

    // 2. Ingest Chunk B -> weight = 2.0
    const relB = {
      sourceEntity: 'PostgreSQL',
      targetEntity: 'ACID',
      relationType: 'ENFORCES',
      evidence: 'Developers choose PostgreSQL because it enforces strict ACID compliance.',
      confidence: 0.92,
    };
    const valB = relationResolver.validate(
      relB,
      entityMap,
      'Developers choose PostgreSQL because it enforces strict ACID compliance.',
    )!;
    const resB = await relationResolver.resolveAndPersist(wsId, docId, chunkBId, valB);
    expect(resB.relation.weight).toBe(2.0);

    // 3. Ingest Chunk C -> weight = 3.0
    const relC = {
      sourceEntity: 'PostgreSQL',
      targetEntity: 'ACID',
      relationType: 'ENFORCES',
      evidence: 'ACID properties in PostgreSQL safeguard financial records against corruption.',
      confidence: 0.95,
    };
    const valC = relationResolver.validate(
      relC,
      entityMap,
      'ACID properties in PostgreSQL safeguard financial records against corruption.',
    )!;
    const resC = await relationResolver.resolveAndPersist(wsId, docId, chunkCId, valC);
    expect(resC.relation.weight).toBe(3.0);

    // Verify 3 distinct evidence rows exist in DB
    const evBeforeDelete = await prisma.relationEvidence.count({
      where: { relationId: resA.relation.id },
    });
    expect(evBeforeDelete).toBe(3);

    // 4. Delete Chunk C (CASCADE deletes relation_evidence row for Chunk C)
    await prisma.documentChunk.delete({
      where: {
        workspaceId_documentId_id: {
          workspaceId: wsId,
          documentId: docId,
          id: chunkCId,
        },
      },
    });

    // Verify evidence row count dropped to 2
    const evAfterChunkC = await prisma.relationEvidence.count({
      where: { relationId: resA.relation.id },
    });
    expect(evAfterChunkC).toBe(2);

    // Database trigger trg_relation_evidence_sync_weight must have updated relation weight to 2.0
    const relAfterC = await prisma.graphRelation.findUnique({
      where: {
        workspaceId_id: {
          workspaceId: wsId,
          id: resA.relation.id,
        },
      },
    });
    expect(relAfterC?.weight).toBe(2.0);

    // 5. Delete Chunk B -> weight drops to 1.0
    await prisma.documentChunk.delete({
      where: {
        workspaceId_documentId_id: {
          workspaceId: wsId,
          documentId: docId,
          id: chunkBId,
        },
      },
    });

    const relAfterB = await prisma.graphRelation.findUnique({
      where: {
        workspaceId_id: {
          workspaceId: wsId,
          id: resA.relation.id,
        },
      },
    });
    expect(relAfterB?.weight).toBe(1.0);
  });

  it('preserves relation with weight = 1.0 when all evidence rows are deleted', async () => {
    // Look up the relation from previous test
    const rel = await prisma.graphRelation.findFirst({
      where: {
        workspaceId: wsId,
        sourceEntityId: ent1Id,
        targetEntityId: ent2Id,
        relationType: 'ENFORCES',
      },
    });
    expect(rel).not.toBeNull();

    // Delete Chunk A (the final remaining evidence chunk)
    await prisma.documentChunk.delete({
      where: {
        workspaceId_documentId_id: {
          workspaceId: wsId,
          documentId: docId,
          id: chunkAId,
        },
      },
    });

    // Evidence count is now 0
    const evCount = await prisma.relationEvidence.count({
      where: { relationId: rel!.id },
    });
    expect(evCount).toBe(0);

    // Phase 6.3: Unsupported relationships must not survive evidence deletion when no valid evidence remains
    const relAfterAllDeleted = await prisma.graphRelation.findUnique({
      where: {
        workspaceId_id: {
          workspaceId: wsId,
          id: rel!.id,
        },
      },
    });
    expect(relAfterAllDeleted).toBeNull();
  });
});
