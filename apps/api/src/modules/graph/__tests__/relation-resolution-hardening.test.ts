import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { graphRepository } from '../repositories/graph.repository.js';
import { RelationResolver } from '../resolvers/relation.resolver.js';

describe('Phase 6.2: Relation Resolution & Canonicalization Hardening Tests', () => {
  let wsId: string;
  let docId: string;
  let chunk1Id: string;
  let chunk2Id: string;
  let chunk3Id: string;
  let entAId: string;
  let entBId: string;
  let entCId: string;
  let resolver: RelationResolver;

  beforeAll(async () => {
    resolver = new RelationResolver(graphRepository);

    // 1. Create Workspace
    const ws = await prisma.workspace.create({
      data: {
        name: 'Relation Hardening WS',
        slug: `rel-hardening-ws-${Date.now()}`,
      },
    });
    wsId = ws.id;

    // 2. Create User & Document
    const user = await prisma.user.create({
      data: {
        email: `rel-tester-${Date.now()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Relation Tester',
      },
    });

    const doc = await prisma.document.create({
      data: {
        workspaceId: wsId,
        uploadedById: user.id,
        originalName: 'System_Architecture.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(4096),
        checksum: `chk-${Date.now()}`,
        storageKey: `key-${Date.now()}`,
      },
    });
    docId = doc.id;

    // 3. Create Document Chunks
    const c1 = await prisma.documentChunk.create({
      data: {
        documentId: docId,
        workspaceId: wsId,
        chunkIndex: 0,
        content: 'Service Alpha connects to Service Beta over gRPC. Alpha depends upon Beta.',
        tokenCount: 20,
      },
    });
    chunk1Id = c1.id;

    const c2 = await prisma.documentChunk.create({
      data: {
        documentId: docId,
        workspaceId: wsId,
        chunkIndex: 1,
        content:
          'Service Beta connects to Service Alpha directly. Service Beta is part of System Gamma.',
        tokenCount: 20,
      },
    });
    chunk2Id = c2.id;

    const c3 = await prisma.documentChunk.create({
      data: {
        documentId: docId,
        workspaceId: wsId,
        chunkIndex: 2,
        content: 'System Gamma contains Service Beta within its core domain.',
        tokenCount: 20,
      },
    });
    chunk3Id = c3.id;

    // 4. Create Graph Entities
    const entA = await graphRepository.createEntity({
      workspaceId: wsId,
      canonicalName: 'Service Alpha',
      normalizedName: 'service alpha',
      entityType: 'TECHNOLOGY',
    });
    entAId = entA.id;

    const entB = await graphRepository.createEntity({
      workspaceId: wsId,
      canonicalName: 'Service Beta',
      normalizedName: 'service beta',
      entityType: 'TECHNOLOGY',
    });
    entBId = entB.id;

    const entC = await graphRepository.createEntity({
      workspaceId: wsId,
      canonicalName: 'System Gamma',
      normalizedName: 'system gamma',
      entityType: 'CONCEPT',
    });
    entCId = entC.id;
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({
      where: { id: wsId },
    });
  });

  describe('1. Symmetric Relation Canonicalization', () => {
    it('canonicalizes symmetric relations (e.g. CONNECTS_TO) regardless of extracted order', async () => {
      const entityMap = new Map<string, string>([
        ['service alpha', entAId],
        ['service beta', entBId],
      ]);

      // Extraction 1: Alpha -> Beta
      const val1 = resolver.validate(
        {
          sourceEntity: 'Service Alpha',
          targetEntity: 'Service Beta',
          relationType: 'connects to',
          evidence: 'Service Alpha connects to Service Beta over gRPC.',
          confidence: 0.9,
        },
        entityMap,
        'Service Alpha connects to Service Beta over gRPC. Alpha depends upon Beta.',
      );
      expect(val1).not.toBeNull();
      expect(val1?.relationType).toBe('CONNECTS_TO');

      const res1 = await resolver.resolveAndPersist(wsId, docId, chunk1Id, val1!);
      expect(res1.relation.weight).toBe(1.0);

      // Extraction 2: Beta -> Alpha (reversed direction in text)
      const val2 = resolver.validate(
        {
          sourceEntity: 'Service Beta',
          targetEntity: 'Service Alpha',
          relationType: 'connects_to',
          evidence: 'Service Beta connects to Service Alpha directly.',
          confidence: 0.95,
        },
        entityMap,
        'Service Beta connects to Service Alpha directly. Service Beta is part of System Gamma.',
      );
      expect(val2).not.toBeNull();

      // Because CONNECTS_TO is symmetric, endpoints are canonicalized to the same order
      expect(val2?.sourceEntityId).toBe(val1?.sourceEntityId);
      expect(val2?.targetEntityId).toBe(val1?.targetEntityId);

      const res2 = await resolver.resolveAndPersist(wsId, docId, chunk2Id, val2!);
      // Both extractions map to the SAME database relation record!
      expect(res2.relation.id).toBe(res1.relation.id);
      // Weight has incremented from 1.0 to 2.0 because two distinct chunks contributed evidence
      expect(res2.relation.weight).toBe(2.0);
      expect(res2.relation.confidence).toBe(0.95);
    });
  });

  describe('2. Relation Synonym Canonicalization', () => {
    it('canonicalizes synonymous relation types to schema standard vocabulary', async () => {
      const entityMap = new Map<string, string>([
        ['service alpha', entAId],
        ['service beta', entBId],
      ]);

      // LLM extracted 'depends upon' instead of 'DEPENDS_ON'
      const val = resolver.validate(
        {
          sourceEntity: 'Service Alpha',
          targetEntity: 'Service Beta',
          relationType: 'depends upon',
          evidence: 'Alpha depends upon Beta.',
          confidence: 0.88,
        },
        entityMap,
        'Service Alpha connects to Service Beta over gRPC. Alpha depends upon Beta.',
      );

      expect(val).not.toBeNull();
      // Must be canonicalized to DEPENDS_ON
      expect(val?.relationType).toBe('DEPENDS_ON');

      const res = await resolver.resolveAndPersist(wsId, docId, chunk1Id, val!);
      expect(res.relation.relationType).toBe('DEPENDS_ON');
    });
  });

  describe('3. Inverse Relation Evidence Consolidation', () => {
    it('consolidates evidence into existing inverse canonical relation (CONTAINS vs PART_OF)', async () => {
      const entityMap = new Map<string, string>([
        ['system gamma', entCId],
        ['service beta', entBId],
      ]);

      // 1. Establish canonical relation: System Gamma CONTAINS Service Beta
      const valContains = resolver.validate(
        {
          sourceEntity: 'System Gamma',
          targetEntity: 'Service Beta',
          relationType: 'CONTAINS',
          evidence: 'System Gamma contains Service Beta within its core domain.',
          confidence: 0.9,
        },
        entityMap,
        'System Gamma contains Service Beta within its core domain.',
      );
      expect(valContains).not.toBeNull();

      const resContains = await resolver.resolveAndPersist(wsId, docId, chunk3Id, valContains!);
      expect(resContains.relation.weight).toBe(1.0);
      expect(resContains.relation.relationType).toBe('CONTAINS');

      // 2. Later, chunk 2 extracts the inverse: Service Beta PART_OF System Gamma
      const valPartOf = resolver.validate(
        {
          sourceEntity: 'Service Beta',
          targetEntity: 'System Gamma',
          relationType: 'part of',
          evidence: 'Service Beta is part of System Gamma.',
          confidence: 0.92,
        },
        entityMap,
        'Service Beta connects to Service Alpha directly. Service Beta is part of System Gamma.',
      );
      expect(valPartOf).not.toBeNull();
      expect(valPartOf?.relationType).toBe('PART_OF');

      // Persistence should detect existing CONTAINS relation and consolidate evidence onto it!
      const resPartOf = await resolver.resolveAndPersist(wsId, docId, chunk2Id, valPartOf!);

      expect(resPartOf.relation.id).toBe(resContains.relation.id);
      expect(resPartOf.relation.relationType).toBe('CONTAINS');
      // Weight has incremented to 2.0 because evidence from chunk 2 was consolidated!
      expect(resPartOf.relation.weight).toBe(2.0);
    });
  });
});
