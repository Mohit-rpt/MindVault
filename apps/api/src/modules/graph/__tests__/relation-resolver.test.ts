import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { graphRepository } from '../repositories/graph.repository.js';
import { RelationResolver } from '../resolvers/relation.resolver.js';

describe('Phase 6.1: RelationResolver Integration Tests', () => {
  let wsId: string;
  let docId: string;
  let chunk1Id: string;
  let chunk2Id: string;
  let entAId: string;
  let entBId: string;
  let relationResolver: RelationResolver;
  const chunk1Content =
    'Node.js is powered by the Google V8 JavaScript engine for high performance.';
  const chunk2Content =
    'Node.js embeds Google V8 runtime to execute server-side JavaScript applications.';

  beforeAll(async () => {
    relationResolver = new RelationResolver(graphRepository);

    // 1. Create Workspace
    const ws = await prisma.workspace.create({
      data: {
        name: 'Relation Resolver WS',
        slug: `rel-res-ws-${Date.now()}`,
      },
    });
    wsId = ws.id;

    // 2. Create User
    const user = await prisma.user.create({
      data: {
        email: `rel-res-${Date.now()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Rel Tester',
      },
    });

    // 3. Create Document
    const doc = await prisma.document.create({
      data: {
        workspaceId: wsId,
        uploadedById: user.id,
        originalName: 'Node_Architecture.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(1024),
        checksum: `chk-rel-${Date.now()}`,
        storageKey: `key-rel-${Date.now()}`,
      },
    });
    docId = doc.id;

    // 4. Create Chunks
    const c1 = await prisma.documentChunk.create({
      data: {
        documentId: docId,
        workspaceId: wsId,
        chunkIndex: 0,
        content: chunk1Content,
        tokenCount: 12,
      },
    });
    chunk1Id = c1.id;

    const c2 = await prisma.documentChunk.create({
      data: {
        documentId: docId,
        workspaceId: wsId,
        chunkIndex: 1,
        content: chunk2Content,
        tokenCount: 11,
      },
    });
    chunk2Id = c2.id;

    // 5. Create Entities
    const eA = await prisma.graphEntity.create({
      data: {
        workspaceId: wsId,
        canonicalName: 'Node.js',
        normalizedName: 'node.js',
        entityType: 'TECHNOLOGY',
      },
    });
    entAId = eA.id;

    const eB = await prisma.graphEntity.create({
      data: {
        workspaceId: wsId,
        canonicalName: 'V8 Engine',
        normalizedName: 'v8 engine',
        entityType: 'TECHNOLOGY',
      },
    });
    entBId = eB.id;
  });

  afterAll(async () => {
    await prisma.workspace.delete({ where: { id: wsId } });
  });

  it('rejects self-loops where source entity equals target entity', () => {
    const entityMap = new Map<string, string>([
      ['node.js', entAId],
      ['v8 engine', entBId],
    ]);

    const selfLoop = {
      sourceEntity: 'Node.js',
      targetEntity: 'Node.js',
      relationType: 'USES',
      evidence: 'Node.js is powered by Node.js',
      confidence: 0.9,
    };

    const validated = relationResolver.validate(selfLoop, entityMap, chunk1Content);
    expect(validated).toBeNull();
  });

  it('rejects relations with unmapped or missing endpoints', () => {
    const entityMap = new Map<string, string>([['node.js', entAId]]); // Missing target

    const missingTgt = {
      sourceEntity: 'Node.js',
      targetEntity: 'Unknown Nonexistent Lib',
      relationType: 'USES',
      evidence: 'Node.js uses Unknown Nonexistent Lib',
      confidence: 0.85,
    };

    const validated = relationResolver.validate(missingTgt, entityMap, chunk1Content);
    expect(validated).toBeNull();
  });

  it('rejects relations with hallucinated evidence that is absent from the chunk', () => {
    const entityMap = new Map<string, string>([
      ['node.js', entAId],
      ['v8 engine', entBId],
    ]);

    const hallucinated = {
      sourceEntity: 'Node.js',
      targetEntity: 'V8 Engine',
      relationType: 'USES',
      evidence: 'This sentence was hallucinated by LLM and never written in the document.',
      confidence: 0.9,
    };

    const validated = relationResolver.validate(hallucinated, entityMap, chunk1Content);
    expect(validated).toBeNull();
  });

  it('validates and persists a valid relation with evidence', async () => {
    const entityMap = new Map<string, string>([
      ['node.js', entAId],
      ['v8 engine', entBId],
    ]);

    const validRel = {
      sourceEntity: 'Node.js',
      targetEntity: 'V8 Engine',
      relationType: 'USES',
      description: 'Node.js uses Google V8 engine',
      evidence: 'Node.js is powered by the Google V8 JavaScript engine',
      confidence: 0.92,
    };

    const validated = relationResolver.validate(validRel, entityMap, chunk1Content);
    expect(validated).not.toBeNull();

    const { relation, evidenceId } = await relationResolver.resolveAndPersist(
      wsId,
      docId,
      chunk1Id,
      validated!,
    );

    expect(relation.id).toBeDefined();
    expect(relation.relationType).toBe('USES');
    expect(relation.weight).toBe(1.0);
    expect(relation.confidence).toBe(0.92);
    expect(evidenceId).toBeDefined();

    // Verify evidence row in database
    const ev = await prisma.relationEvidence.findUnique({
      where: { id: evidenceId },
    });
    expect(ev).not.toBeNull();
    expect(ev?.chunkId).toBe(chunk1Id);
    expect(ev?.documentId).toBe(docId);
  });

  it('deduplicates relation and ACCUMULATES weight (> 1.0) when corroborated by a second chunk', async () => {
    const entityMap = new Map<string, string>([
      ['node.js', entAId],
      ['v8 engine', entBId],
    ]);

    // Second chunk corroborating the same relation
    const secondCorroboration = {
      sourceEntity: 'Node.js',
      targetEntity: 'V8 Engine',
      relationType: 'USES',
      description: 'Node.js embeds Google V8 runtime',
      evidence: 'Node.js embeds Google V8 runtime to execute server-side JavaScript applications.',
      confidence: 0.96, // higher confidence
    };

    const validated = relationResolver.validate(secondCorroboration, entityMap, chunk2Content);
    expect(validated).not.toBeNull();

    const { relation, evidenceId } = await relationResolver.resolveAndPersist(
      wsId,
      docId,
      chunk2Id,
      validated!,
    );

    // Weight must be accumulated (1.0 + 1.0 = 2.0)
    expect(relation.weight).toBe(2.0);
    // Confidence must be upgraded to highest (0.96)
    expect(relation.confidence).toBe(0.96);

    // Total evidence for this relation must now be 2
    const totalEvidence = await prisma.relationEvidence.count({
      where: { relationId: relation.id },
    });
    expect(totalEvidence).toBe(2);
  });

  it('enforces weight idempotency: reprocessing chunk A and chunk B does NOT increase weight', async () => {
    const entityMap = new Map<string, string>([
      ['node.js', entAId],
      ['v8 engine', entBId],
    ]);

    // Reprocess chunk 1
    const reprocessedChunk1 = {
      sourceEntity: 'Node.js',
      targetEntity: 'V8 Engine',
      relationType: 'USES',
      evidence: 'Node.js is powered by the Google V8 JavaScript engine',
      confidence: 0.9, // lower confidence
    };
    const val1 = relationResolver.validate(reprocessedChunk1, entityMap, chunk1Content);
    const res1 = await relationResolver.resolveAndPersist(wsId, docId, chunk1Id, val1!);

    // Weight must NOT increase (remains 2.0)
    expect(res1.relation.weight).toBe(2.0);
    // Confidence must NOT decrease (remains 0.96)
    expect(res1.relation.confidence).toBe(0.96);

    // Reprocess chunk 2
    const reprocessedChunk2 = {
      sourceEntity: 'Node.js',
      targetEntity: 'V8 Engine',
      relationType: 'USES',
      evidence: 'Node.js embeds Google V8 runtime to execute server-side JavaScript applications.',
      confidence: 0.95,
    };
    const val2 = relationResolver.validate(reprocessedChunk2, entityMap, chunk2Content);
    const res2 = await relationResolver.resolveAndPersist(wsId, docId, chunk2Id, val2!);

    // Weight must still NOT increase (remains 2.0)
    expect(res2.relation.weight).toBe(2.0);
    expect(res2.relation.confidence).toBe(0.96);

    // Total evidence rows must still be exactly 2
    const evidenceCount = await prisma.relationEvidence.count({
      where: { relationId: res2.relation.id },
    });
    expect(evidenceCount).toBe(2);
  });

  it('handles concurrent processing of different chunks and same chunk safely', async () => {
    const entityMap = new Map<string, string>([
      ['node.js', entAId],
      ['v8 engine', entBId],
    ]);

    // Create chunks 3 and 4
    const c3 = await prisma.documentChunk.create({
      data: {
        documentId: docId,
        workspaceId: wsId,
        chunkIndex: 2,
        content: 'V8 engine provides garbage collection for Node.js applications.',
        tokenCount: 9,
      },
    });
    const c4 = await prisma.documentChunk.create({
      data: {
        documentId: docId,
        workspaceId: wsId,
        chunkIndex: 3,
        content: 'High throughput in Node.js relies on V8 engine JIT compilation.',
        tokenCount: 10,
      },
    });

    const rel3 = {
      sourceEntity: 'Node.js',
      targetEntity: 'V8 Engine',
      relationType: 'USES',
      evidence: 'V8 engine provides garbage collection for Node.js applications.',
      confidence: 0.93,
    };
    const rel4 = {
      sourceEntity: 'Node.js',
      targetEntity: 'V8 Engine',
      relationType: 'USES',
      evidence: 'High throughput in Node.js relies on V8 engine JIT compilation.',
      confidence: 0.94,
    };

    const val3 = relationResolver.validate(rel3, entityMap, c3.content)!;
    const val4 = relationResolver.validate(rel4, entityMap, c4.content)!;

    // Concurrently process different chunks
    await Promise.all([
      relationResolver.resolveAndPersist(wsId, docId, c3.id, val3),
      relationResolver.resolveAndPersist(wsId, docId, c4.id, val4),
    ]);

    // Concurrently process same chunk c3
    await Promise.all([
      relationResolver.resolveAndPersist(wsId, docId, c3.id, val3),
      relationResolver.resolveAndPersist(wsId, docId, c3.id, val3),
    ]);

    const relInDb = await prisma.graphRelation.findFirst({
      where: {
        workspaceId: wsId,
        sourceEntityId: entAId,
        targetEntityId: entBId,
        relationType: 'USES',
      },
    });

    // Total distinct chunks with evidence: c1, c2, c3, c4 = 4
    expect(relInDb?.weight).toBe(4.0);
    expect(relInDb?.confidence).toBe(0.96);

    const distinctEvidence = await prisma.relationEvidence.count({
      where: { relationId: relInDb!.id },
    });
    expect(distinctEvidence).toBe(4);
  });

  it('strictly validates evidence: accepts exact match, whitespace variations, and trailing punctuation', () => {
    const entityMap = new Map<string, string>([
      ['node.js', entAId],
      ['v8 engine', entBId],
    ]);

    // 1. Whitespace variations (tabs, newlines)
    const whitespaceEvidence = {
      sourceEntity: 'Node.js',
      targetEntity: 'V8 Engine',
      relationType: 'USES',
      evidence: 'Node.js   is  powered\nby the Google V8 JavaScript engine',
      confidence: 0.9,
    };
    expect(relationResolver.validate(whitespaceEvidence, entityMap, chunk1Content)).not.toBeNull();

    // 2. Outer quotation marks
    const quotedEvidence = {
      sourceEntity: 'Node.js',
      targetEntity: 'V8 Engine',
      relationType: 'USES',
      evidence: '“Node.js is powered by the Google V8 JavaScript engine for high performance.”',
      confidence: 0.9,
    };
    expect(relationResolver.validate(quotedEvidence, entityMap, chunk1Content)).not.toBeNull();

    // 3. Trailing punctuation difference (chunk has period, evidence has no period)
    const trailingPunctEvidence = {
      sourceEntity: 'Node.js',
      targetEntity: 'V8 Engine',
      relationType: 'USES',
      evidence: 'Node.js is powered by the Google V8 JavaScript engine for high performance',
      confidence: 0.9,
    };
    expect(
      relationResolver.validate(trailingPunctEvidence, entityMap, chunk1Content),
    ).not.toBeNull();
  });

  it('strictly rejects fabricated continuations and partial prefix-only matches', () => {
    const entityMap = new Map<string, string>([
      ['node.js', entAId],
      ['v8 engine', entBId],
    ]);

    // 1. Real 30-char prefix followed by completely fabricated hallucinated clause
    const fabricatedContinuation = {
      sourceEntity: 'Node.js',
      targetEntity: 'V8 Engine',
      relationType: 'USES',
      evidence:
        'Node.js is powered by the Google V8 JavaScript engine which was created by aliens on Mars in 1990.',
      confidence: 0.9,
    };
    // MUST be rejected! (Previously allowed by prefix slicing)
    expect(relationResolver.validate(fabricatedContinuation, entityMap, chunk1Content)).toBeNull();

    // 2. Fabricated sentence with only scattered keywords
    const scatteredKeywords = {
      sourceEntity: 'Node.js',
      targetEntity: 'V8 Engine',
      relationType: 'USES',
      evidence: 'Node.js and Google V8 engine are completely unrelated legacy technologies.',
      confidence: 0.9,
    };
    expect(relationResolver.validate(scatteredKeywords, entityMap, chunk1Content)).toBeNull();
  });
});
