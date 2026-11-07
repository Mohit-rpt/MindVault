import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { graphRepository } from '../repositories/graph.repository.js';

describe('Phase 6.2: PostgreSQL Trigger Concurrency & Row-Locking Test Suite', () => {
  let wsId: string;
  let docId: string;
  let entSourceId: string;
  let entTargetId: string;
  let relationId: string;
  const chunkIds: string[] = [];

  beforeAll(async () => {
    // 1. Create Workspace
    const ws = await prisma.workspace.create({
      data: {
        name: 'Trigger Concurrency WS',
        slug: `trigger-concurrency-ws-${Date.now()}`,
      },
    });
    wsId = ws.id;

    // 2. Create User & Document
    const user = await prisma.user.create({
      data: {
        email: `trigger-tester-${Date.now()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Trigger Tester',
      },
    });

    const doc = await prisma.document.create({
      data: {
        workspaceId: wsId,
        uploadedById: user.id,
        originalName: 'Concurrency_Spec.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(8192),
        checksum: `chk-${Date.now()}`,
        storageKey: `key-${Date.now()}`,
      },
    });
    docId = doc.id;

    // 3. Create 10 distinct chunks
    for (let i = 0; i < 10; i++) {
      const c = await prisma.documentChunk.create({
        data: {
          documentId: docId,
          workspaceId: wsId,
          chunkIndex: i,
          content: `Chunk ${i} mentions that Node A connects to Node B reliably.`,
          tokenCount: 15,
        },
      });
      chunkIds.push(c.id);
    }

    // 4. Create Source and Target Entities
    const entA = await graphRepository.createEntity({
      workspaceId: wsId,
      canonicalName: 'Node A',
      normalizedName: 'node a',
      entityType: 'TECHNOLOGY',
    });
    entSourceId = entA.id;

    const entB = await graphRepository.createEntity({
      workspaceId: wsId,
      canonicalName: 'Node B',
      normalizedName: 'node b',
      entityType: 'TECHNOLOGY',
    });
    entTargetId = entB.id;

    // 5. Create Relation
    const rel = await graphRepository.createRelation({
      workspaceId: wsId,
      sourceEntityId: entSourceId,
      targetEntityId: entTargetId,
      relationType: 'COMMUNICATES_WITH',
      weight: 1.0,
      confidence: 0.8,
    });
    relationId = rel.id;
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({
      where: { id: wsId },
    });
  });

  it('accurately synchronizes relation weight to 10.0 under simultaneous concurrent evidence insertions', async () => {
    // Fire 10 simultaneous insert transactions for 10 distinct chunks on the same relation
    await Promise.all(
      chunkIds.map((chunkId, index) =>
        graphRepository.createEvidenceIdempotent({
          workspaceId: wsId,
          relationId,
          chunkId,
          documentId: docId,
          evidenceText: `Chunk ${index} mentions that Node A connects to Node B reliably.`,
          confidence: 0.85,
        }),
      ),
    );

    // Verify all 10 evidence rows are in DB
    const evidenceCount = await prisma.relationEvidence.count({
      where: {
        workspaceId: wsId,
        relationId,
      },
    });
    expect(evidenceCount).toBe(10);

    // Verify authoritative weight on graph_relations record
    const updatedRel = await prisma.graphRelation.findUnique({
      where: {
        workspaceId_id: {
          workspaceId: wsId,
          id: relationId,
        },
      },
    });

    expect(updatedRel).not.toBeNull();
    // With row locking (FOR UPDATE) in the trigger, every transaction serialized its count,
    // guaranteeing no lost updates and producing exactly weight = 10.0
    expect(updatedRel?.weight).toBe(10.0);
  });

  it('accurately decrements relation weight when 5 chunks are deleted in parallel', async () => {
    // Delete first 5 chunks concurrently
    const chunksToDelete = chunkIds.slice(0, 5);
    await Promise.all(
      chunksToDelete.map((chunkId) =>
        prisma.documentChunk.delete({
          where: {
            workspaceId_id: {
              workspaceId: wsId,
              id: chunkId,
            },
          },
        }),
      ),
    );

    // 5 evidence rows remain
    const remainingEvidence = await prisma.relationEvidence.count({
      where: {
        workspaceId: wsId,
        relationId,
      },
    });
    expect(remainingEvidence).toBe(5);

    // Verify weight decremented to exactly 5.0
    const relAfterDelete = await prisma.graphRelation.findUnique({
      where: {
        workspaceId_id: {
          workspaceId: wsId,
          id: relationId,
        },
      },
    });

    expect(relAfterDelete?.weight).toBe(5.0);
  });
});
