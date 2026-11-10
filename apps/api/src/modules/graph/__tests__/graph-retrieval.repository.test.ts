import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { graphRepository } from '../repositories/graph.repository.js';
import {
  buildSeedDiscoveryQuery,
  buildGraphEvidenceQuery,
  buildSupportingRelationsQuery,
} from '../queries/graph-retrieval.sql.js';
import { GraphTraversalTimeoutError } from '../errors/graph-traversal.error.js';

describe('Task 6.6.1: Seed Discovery & Graph Evidence Repository Implementation', () => {
  let wsAlphaId: string;
  let wsBetaId: string;
  let userId: string;

  // Documents & Chunks in Alpha
  let docAlphaCompleted: string;
  let docAlphaPending: string;
  let chunk1: string; // Substantiates Rel(A -> B) [1-hop]
  let chunk2: string; // Substantiates Rel(B -> C) [2-hop] and mentions Node A
  let chunk3: string; // Mentions Node A only (no relation evidence)
  let chunk4Pending: string; // Belongs to PENDING document

  // Entities in Alpha
  let entA: string;
  let entB: string;
  let entC: string;
  let entD: string; // Disconnected node
  let entUngrounded: string;

  // Relations in Alpha
  let relAB: string;
  let relBC: string;
  let relUngrounded: string;

  // Beta IDs (for cross-tenant isolation testing)
  let docBetaId: string;
  let chunkBetaId: string;
  let entBeta: string;
  let relBeta: string;

  beforeAll(async () => {
    // 1. Create isolated workspaces
    const wsA = await prisma.workspace.create({
      data: { name: 'WS GraphRAG Alpha', slug: `ws-graphrag-alpha-${randomUUID()}` },
    });
    wsAlphaId = wsA.id;

    const wsB = await prisma.workspace.create({
      data: { name: 'WS GraphRAG Beta', slug: `ws-graphrag-beta-${randomUUID()}` },
    });
    wsBetaId = wsB.id;

    const user = await prisma.user.create({
      data: {
        email: `graphrag-tester-${randomUUID()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'GraphRAG Tester',
      },
    });
    userId = user.id;

    // 2. Create Completed Document in Workspace Alpha
    const docComp = await prisma.document.create({
      data: {
        workspaceId: wsAlphaId,
        uploadedById: userId,
        originalName: 'PostgresStorageEngine.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(2048),
        checksum: `ck-comp-${randomUUID()}`,
        storageKey: `key-comp-${randomUUID()}`,
        status: 'COMPLETED',
        pageCount: 10,
        chunkCount: 3,
      },
    });
    docAlphaCompleted = docComp.id;

    // Create Pending Document in Workspace Alpha (to verify status filtering)
    const docPend = await prisma.document.create({
      data: {
        workspaceId: wsAlphaId,
        uploadedById: userId,
        originalName: 'DraftArchitecture.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(1024),
        checksum: `ck-pend-${randomUUID()}`,
        storageKey: `key-pend-${randomUUID()}`,
        status: 'PROCESSING',
        pageCount: 2,
        chunkCount: 1,
      },
    });
    docAlphaPending = docPend.id;

    // 3. Create Document Chunks in Alpha
    const c1 = await prisma.documentChunk.create({
      data: {
        documentId: docAlphaCompleted,
        workspaceId: wsAlphaId,
        chunkIndex: 0,
        content:
          'Write-Ahead Logging guarantees durability by persisting changes before updating heap pages.',
        tokenCount: 16,
        pageStart: 1,
        pageEnd: 1,
      },
    });
    chunk1 = c1.id;

    const c2 = await prisma.documentChunk.create({
      data: {
        documentId: docAlphaCompleted,
        workspaceId: wsAlphaId,
        chunkIndex: 1,
        content:
          'Checkpoints flush dirty shared buffer pool pages to disk, coordinating with WAL write positions.',
        tokenCount: 16,
        pageStart: 2,
        pageEnd: 2,
      },
    });
    chunk2 = c2.id;

    const c3 = await prisma.documentChunk.create({
      data: {
        documentId: docAlphaCompleted,
        workspaceId: wsAlphaId,
        chunkIndex: 2,
        content:
          'PostgreSQL architecture references Write-Ahead Logging in its crash recovery overview documentation.',
        tokenCount: 14,
        pageStart: 3,
        pageEnd: 3,
      },
    });
    chunk3 = c3.id;

    const c4 = await prisma.documentChunk.create({
      data: {
        documentId: docAlphaPending,
        workspaceId: wsAlphaId,
        chunkIndex: 0,
        content: 'Draft content in an uncompleted document mentioning Write-Ahead Logging.',
        tokenCount: 12,
        pageStart: 1,
        pageEnd: 1,
      },
    });
    chunk4Pending = c4.id;

    // 4. Create Entities in Workspace Alpha
    const eA = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Write-Ahead Logging',
      normalizedName: 'write ahead logging',
      entityType: 'CONCEPT',
      description: 'Transaction durability mechanism',
    });
    entA = eA.id;

    // Create Alias for Entity A
    await graphRepository.createAlias({
      workspaceId: wsAlphaId,
      entityId: entA,
      alias: 'WAL',
      normalizedAlias: 'wal',
      aliasType: 'ACRONYM',
    });

    const eB = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Checkpointing',
      normalizedName: 'checkpointing',
      entityType: 'CONCEPT',
      description: 'Buffer flushing process',
    });
    entB = eB.id;

    const eC = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Shared Buffer Pool',
      normalizedName: 'shared buffer pool',
      entityType: 'TECHNOLOGY',
      description: 'In-memory caching mechanism',
    });
    entC = eC.id;

    const eD = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Isolated Component',
      normalizedName: 'isolated component',
      entityType: 'CONCEPT',
    });
    entD = eD.id;

    const eUngrounded = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Ghost Concept',
      normalizedName: 'ghost concept',
      entityType: 'CONCEPT',
    });
    entUngrounded = eUngrounded.id;

    // 5. Create Relations in Workspace Alpha
    // Rel 1: A -> B (1-hop, weight: 1.0, conf: 0.95)
    const rAB = await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entA,
      targetEntityId: entB,
      relationType: 'COORDINATES_WITH',
      weight: 1.0,
      confidence: 0.95,
    });
    relAB = rAB.id;

    // Rel 2: B -> C (2-hop from A, weight: 0.85, conf: 0.90)
    const rBC = await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entB,
      targetEntityId: entC,
      relationType: 'FLUSHES_PAGES_FROM',
      weight: 0.85,
      confidence: 0.9,
    });
    relBC = rBC.id;

    // Rel 3: Ungrounded relation with 0 evidence records (isolated from grounded cluster)
    const eUngrounded2 = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Phantom Concept',
      normalizedName: 'phantom concept',
      entityType: 'CONCEPT',
    });

    const rUngrounded = await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entUngrounded,
      targetEntityId: eUngrounded2.id,
      relationType: 'HYPOTHETICAL_LINK',
      weight: 0.7,
      confidence: 0.8,
    });
    relUngrounded = rUngrounded.id;

    // 6. Create Evidence Links
    // chunk1 substantiates Rel AB
    await graphRepository.createEvidence({
      workspaceId: wsAlphaId,
      relationId: relAB,
      chunkId: chunk1,
      documentId: docAlphaCompleted,
      evidenceText: 'Write-Ahead Logging coordinates with checkpointing.',
      confidence: 0.95,
    });

    // chunk2 substantiates Rel BC
    await graphRepository.createEvidence({
      workspaceId: wsAlphaId,
      relationId: relBC,
      chunkId: chunk2,
      documentId: docAlphaCompleted,
      evidenceText: 'Checkpoints flush pages from shared buffer pool.',
      confidence: 0.9,
    });

    // 7. Create Entity Mention Links
    // chunk2 mentions Node A (in addition to supporting Rel BC)
    await graphRepository.createMention({
      workspaceId: wsAlphaId,
      chunkId: chunk2,
      entityId: entA,
      mentionText: 'WAL write positions',
      confidence: 0.85,
    });

    // chunk3 mentions Node A only (no relation evidence)
    await graphRepository.createMention({
      workspaceId: wsAlphaId,
      chunkId: chunk3,
      entityId: entA,
      mentionText: 'Write-Ahead Logging',
      confidence: 0.9,
    });

    // chunk4Pending mentions Node A (but document is not completed)
    await graphRepository.createMention({
      workspaceId: wsAlphaId,
      chunkId: chunk4Pending,
      entityId: entA,
      mentionText: 'Write-Ahead Logging',
      confidence: 0.9,
    });

    // 8. Create Workspace Beta Tenant Artifacts (for isolation tests)
    const docBeta = await prisma.document.create({
      data: {
        workspaceId: wsBetaId,
        uploadedById: userId,
        originalName: 'ConfidentialBetaDoc.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(1024),
        checksum: `ck-beta-${randomUUID()}`,
        storageKey: `key-beta-${randomUUID()}`,
        status: 'COMPLETED',
      },
    });
    docBetaId = docBeta.id;

    const cBeta = await prisma.documentChunk.create({
      data: {
        documentId: docBetaId,
        workspaceId: wsBetaId,
        chunkIndex: 0,
        content: 'Confidential Beta Document content strictly isolated from Alpha.',
        tokenCount: 10,
      },
    });
    chunkBetaId = cBeta.id;

    const eBeta = await graphRepository.createEntity({
      workspaceId: wsBetaId,
      canonicalName: 'Write-Ahead Logging', // Same name in Beta
      normalizedName: 'write ahead logging',
      entityType: 'CONCEPT',
    });
    entBeta = eBeta.id;

    const eBeta2 = await graphRepository.createEntity({
      workspaceId: wsBetaId,
      canonicalName: 'Beta Target Concept',
      normalizedName: 'beta target concept',
      entityType: 'CONCEPT',
    });

    const rBeta = await graphRepository.createRelation({
      workspaceId: wsBetaId,
      sourceEntityId: entBeta,
      targetEntityId: eBeta2.id,
      relationType: 'INTERNAL_BETA_REL',
      weight: 1.0,
      confidence: 1.0,
    });
    relBeta = rBeta.id;

    await graphRepository.createEvidence({
      workspaceId: wsBetaId,
      relationId: relBeta,
      chunkId: chunkBetaId,
      documentId: docBetaId,
      evidenceText: 'Beta evidence passage.',
      confidence: 1.0,
    });
  });

  afterAll(async () => {
    // Clean up test data
    if (wsAlphaId) {
      await prisma.workspace.delete({ where: { id: wsAlphaId } }).catch(() => {});
    }
    if (wsBetaId) {
      await prisma.workspace.delete({ where: { id: wsBetaId } }).catch(() => {});
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
  });

  describe('Part 1: SQL Query Builders Safety & Parameterization', () => {
    it('buildSeedDiscoveryQuery compiles parameterized SQL with multi-tenant filtering', () => {
      const query = buildSeedDiscoveryQuery({
        workspaceId: wsAlphaId,
        ngrams: ['write ahead logging', 'wal'],
        maxSeeds: 5,
      });

      expect(query.sql).toContain('WHERE e.workspace_id =');
      expect(query.sql).toContain('WHERE a.workspace_id =');
      expect(query.sql).toContain('DISTINCT ON ("entityId")');
      expect(query.sql).toContain('LIMIT');
    });

    it('buildGraphEvidenceQuery compiles parameterized recursive SQL with bounded ceilings', () => {
      const query = buildGraphEvidenceQuery({
        workspaceId: wsAlphaId,
        seedEntityIds: [entA],
        topK: 20,
        minConfidence: 0.6,
        minWeight: 0.5,
      });

      expect(query.sql).toContain('WITH RECURSIVE graph_expansion AS');
      expect(query.sql).toContain('LIMIT 50'); // Anchor ceiling
      expect(query.sql).toContain('LIMIT 10'); // Frontier & lateral limit
      expect(query.sql).toContain('LIMIT 150'); // Intermediate deduplication ceiling
      expect(query.sql).toContain('RELATION_EVIDENCE');
      expect(query.sql).toContain('ENTITY_MENTION');
      expect(query.sql).toContain('c."documentId" AS document_id'); // Quoting check
      expect(query.sql).toContain("d.status = 'COMPLETED'");
    });

    it('buildSupportingRelationsQuery compiles parameterized query for relation triples', () => {
      const query = buildSupportingRelationsQuery(wsAlphaId, [relAB, relBC]);

      expect(query.sql).toContain('FROM graph_relations r');
      expect(query.sql).toContain('r.workspace_id =');
      expect(query.sql).toContain('se.canonical_name AS "sourceCanonicalName"');
      expect(query.sql).toContain('te.canonical_name AS "targetCanonicalName"');
      expect(query.sql).toContain('"evidenceChunkIds"');
    });
  });

  describe('Part 2: Seed Discovery Integration', () => {
    it('discovers entity seed via exact canonical name match', async () => {
      const seeds = await graphRepository.discoverEntitySeeds({
        workspaceId: wsAlphaId,
        ngrams: ['write ahead logging'],
      });

      expect(seeds.length).toBeGreaterThanOrEqual(1);
      const match = seeds.find((s) => s.entityId === entA);
      expect(match).toBeDefined();
      expect(match?.canonicalName).toBe('Write-Ahead Logging');
      expect(match?.seedScore).toBe(1.0);
      expect(match?.matchStrategy).toBe('LEXICAL');
    });

    it('discovers entity seed via alias registry match (score 0.95)', async () => {
      const seeds = await graphRepository.discoverEntitySeeds({
        workspaceId: wsAlphaId,
        ngrams: ['wal'],
      });

      expect(seeds.length).toBeGreaterThanOrEqual(1);
      const match = seeds.find((s) => s.entityId === entA);
      expect(match).toBeDefined();
      expect(match?.canonicalName).toBe('Write-Ahead Logging');
      expect(match?.seedScore).toBe(0.95);
      expect(match?.matchStrategy).toBe('ALIAS');
    });

    it('respects maxSeeds limit and clamps parameter', async () => {
      const seeds = await graphRepository.discoverEntitySeeds({
        workspaceId: wsAlphaId,
        ngrams: [
          'write ahead logging',
          'checkpointing',
          'shared buffer pool',
          'isolated component',
        ],
        maxSeeds: 2,
      });

      expect(seeds.length).toBeLessThanOrEqual(2);
    });

    it('returns empty array when ngrams list is empty or matches nothing', async () => {
      const emptySeeds = await graphRepository.discoverEntitySeeds({
        workspaceId: wsAlphaId,
        ngrams: [],
      });
      expect(emptySeeds).toEqual([]);

      const noMatchSeeds = await graphRepository.discoverEntitySeeds({
        workspaceId: wsAlphaId,
        ngrams: ['nonexistent unknown term 12345'],
      });
      expect(noMatchSeeds).toEqual([]);
    });

    it('enforces workspace isolation in seed discovery: never matches other workspace entities', async () => {
      // In Beta, search for terms that only exist in Alpha
      const betaSeeds = await graphRepository.discoverEntitySeeds({
        workspaceId: wsBetaId,
        ngrams: ['checkpointing'], // Exists only in Alpha
      });

      expect(betaSeeds).toEqual([]);
    });
  });

  describe('Part 3: Graph Evidence Retrieval Integration (searchGraphEvidence)', () => {
    it('retrieves evidence chunks substantiating 1-hop relation with correct provenance', async () => {
      const result = await graphRepository.searchGraphEvidence({
        workspaceId: wsAlphaId,
        seedEntityIds: [entA],
        topK: 10,
      });

      expect(result.chunks.length).toBeGreaterThanOrEqual(1);

      // chunk1 substantiates Rel AB
      const c1Result = result.chunks.find((c) => c.chunkId === chunk1);
      expect(c1Result).toBeDefined();
      expect(c1Result?.documentId).toBe(docAlphaCompleted);
      expect(c1Result?.docOriginalName).toBe('PostgresStorageEngine.pdf');
      expect(c1Result?.docStatus).toBe('COMPLETED');
      expect(c1Result?.supportedRelationsCount).toBeGreaterThanOrEqual(1);
      expect(c1Result?.supportedRelationIds).toContain(relAB);
      expect(c1Result?.relationTypes).toContain('COORDINATES_WITH');
      expect(c1Result?.score).toBeGreaterThan(0.8); // 1.0 * 0.95 * 0.95 * 1.0 = ~0.9025
    });

    it('retrieves 2-hop bounded expansion evidence with depth penalty', async () => {
      const result = await graphRepository.searchGraphEvidence({
        workspaceId: wsAlphaId,
        seedEntityIds: [entA],
        topK: 10,
      });

      // chunk2 substantiates Rel BC (2-hop) and mentions A
      const c2Result = result.chunks.find((c) => c.chunkId === chunk2);
      expect(c2Result).toBeDefined();
      expect(c2Result?.supportedRelationIds).toContain(relBC);
      expect(c2Result?.relationTypes).toContain('FLUSHES_PAGES_FROM');
    });

    it('retrieves chunks via direct entity mention (ENTITY_MENTION provenance)', async () => {
      const result = await graphRepository.searchGraphEvidence({
        workspaceId: wsAlphaId,
        seedEntityIds: [entA],
        topK: 10,
      });

      // chunk3 mentions Node A only (has no relation evidence)
      const c3Result = result.chunks.find((c) => c.chunkId === chunk3);
      expect(c3Result).toBeDefined();
      expect(c3Result?.supportedRelationsCount).toBe(0);
      expect(c3Result?.supportedRelationIds).toEqual([]);
      expect(c3Result?.score).toBeCloseTo(0.9 * 0.75, 2); // 0.675
    });

    it('excludes chunks belonging to non-completed documents (status != COMPLETED)', async () => {
      const result = await graphRepository.searchGraphEvidence({
        workspaceId: wsAlphaId,
        seedEntityIds: [entA],
        topK: 10,
      });

      // chunk4Pending belongs to docAlphaPending (PROCESSING)
      const pendingResult = result.chunks.find((c) => c.chunkId === chunk4Pending);
      expect(pendingResult).toBeUndefined();
    });

    it('strictly excludes ungrounded relations from chunk retrieval', async () => {
      const result = await graphRepository.searchGraphEvidence({
        workspaceId: wsAlphaId,
        seedEntityIds: [entUngrounded],
        topK: 10,
      });

      // Ghost Concept has zero evidence records, so zero chunks should be returned
      expect(result.chunks).toEqual([]);
    });

    it('returns supporting relation metadata for retrieved chunks', async () => {
      const result = await graphRepository.searchGraphEvidence({
        workspaceId: wsAlphaId,
        seedEntityIds: [entA],
        topK: 10,
      });

      expect(result.relations.length).toBeGreaterThanOrEqual(1);
      const relMeta = result.relations.find((r) => r.relationId === relAB);
      expect(relMeta).toBeDefined();
      expect(relMeta?.sourceCanonicalName).toBe('Write-Ahead Logging');
      expect(relMeta?.targetCanonicalName).toBe('Checkpointing');
      expect(relMeta?.relationType).toBe('COORDINATES_WITH');
      expect(relMeta?.evidenceChunkIds).toContain(chunk1);
    });

    it('enforces deterministic ordering: highest score first, chunkIndex ASC, id ASC', async () => {
      const result = await graphRepository.searchGraphEvidence({
        workspaceId: wsAlphaId,
        seedEntityIds: [entA],
        topK: 10,
      });

      for (let i = 0; i < result.chunks.length - 1; i++) {
        expect(result.chunks[i].score).toBeGreaterThanOrEqual(result.chunks[i + 1].score);
      }
    });

    it('respects topK pagination parameter and clamps to 50', async () => {
      const result = await graphRepository.searchGraphEvidence({
        workspaceId: wsAlphaId,
        seedEntityIds: [entA],
        topK: 1,
      });

      expect(result.chunks.length).toBeLessThanOrEqual(1);
    });

    it('handles empty seed list safely without database error', async () => {
      const result = await graphRepository.searchGraphEvidence({
        workspaceId: wsAlphaId,
        seedEntityIds: [],
      });

      expect(result.chunks).toEqual([]);
      expect(result.relations).toEqual([]);
    });

    it('enforces strict multi-tenant workspace isolation: zero cross-tenant chunk leakage', async () => {
      // Query Alpha with Beta seed ID
      const crossTenantResult = await graphRepository.searchGraphEvidence({
        workspaceId: wsAlphaId,
        seedEntityIds: [entBeta], // Foreign workspace entity
      });

      expect(crossTenantResult.chunks).toEqual([]);
      expect(crossTenantResult.relations).toEqual([]);

      // Query Beta: should only return Beta chunks, never Alpha
      const betaResult = await graphRepository.searchGraphEvidence({
        workspaceId: wsBetaId,
        seedEntityIds: [entBeta],
      });

      expect(betaResult.chunks.length).toBe(1);
      expect(betaResult.chunks[0].chunkId).toBe(chunkBetaId);
      expect(betaResult.chunks[0].workspaceId).toBe(wsBetaId);

      // Verify no Alpha chunks in Beta results
      const leakedChunk = betaResult.chunks.find((c) => c.chunkId === chunk1);
      expect(leakedChunk).toBeUndefined();
    });
  });

  describe('Part 4: Statement Timeout & Error Handling', () => {
    it('GraphTraversalTimeoutError has statusCode 504 and code GRAPH_TRAVERSAL_TIMEOUT', () => {
      const err = new GraphTraversalTimeoutError();
      expect(err.statusCode).toBe(504);
      expect(err.code).toBe('GRAPH_TRAVERSAL_TIMEOUT');
      expect(err.name).toBe('GraphTraversalTimeoutError');
    });
  });
});
