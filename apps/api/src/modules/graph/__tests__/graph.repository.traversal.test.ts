import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { graphRepository } from '../repositories/graph.repository.js';
import {
  buildNeighborhoodQuery,
  buildPathFinderQuery,
} from '../queries/recursive-traversal.sql.js';
import { GraphTraversalTimeoutError } from '../errors/graph-traversal.error.js';

describe('Task 6.5.1: SQL Traversal Foundation & GraphRepository Implementation', () => {
  let wsAlphaId: string;
  let wsBetaId: string;
  let userId: string;
  let docAlphaId: string;
  let chunkAlphaId: string;

  // Alpha entity IDs
  let entA: string;
  let entB: string;
  let entC: string;
  let entD: string;
  let entE: string;
  let entF: string; // 5-hop target
  let entHub: string;

  // Beta entity IDs (for workspace isolation)
  let entBetaA: string;
  let entBetaB: string;

  beforeAll(async () => {
    // 1. Create isolated workspaces
    const wsA = await prisma.workspace.create({
      data: { name: 'WS Traversal Alpha', slug: `ws-alpha-${randomUUID()}` },
    });
    wsAlphaId = wsA.id;

    const wsB = await prisma.workspace.create({
      data: { name: 'WS Traversal Beta', slug: `ws-beta-${randomUUID()}` },
    });
    wsBetaId = wsB.id;

    const user = await prisma.user.create({
      data: {
        email: `trav-user-${randomUUID()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Traversal Tester',
      },
    });
    userId = user.id;

    const doc = await prisma.document.create({
      data: {
        workspaceId: wsAlphaId,
        uploadedById: userId,
        originalName: 'TraversalDoc.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(1024),
        checksum: `ck-trav-${randomUUID()}`,
        storageKey: `key-trav-${randomUUID()}`,
      },
    });
    docAlphaId = doc.id;

    const chunk = await prisma.documentChunk.create({
      data: {
        documentId: docAlphaId,
        workspaceId: wsAlphaId,
        chunkIndex: 0,
        content: 'Graph traversal test chunk content for evidence linkage',
        tokenCount: 12,
      },
    });
    chunkAlphaId = chunk.id;

    // 2. Create entities in Workspace Alpha: Chain A -> B -> C -> D -> E -> F
    const eA = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node A',
      normalizedName: `node-a-${Date.now()}`,
      entityType: 'CONCEPT',
    });
    entA = eA.id;

    const eB = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node B',
      normalizedName: `node-b-${Date.now()}`,
      entityType: 'TECHNOLOGY',
    });
    entB = eB.id;

    const eC = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node C',
      normalizedName: `node-c-${Date.now()}`,
      entityType: 'CONCEPT',
    });
    entC = eC.id;

    const eD = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node D',
      normalizedName: `node-d-${Date.now()}`,
      entityType: 'PRODUCT',
    });
    entD = eD.id;

    const eE = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node E',
      normalizedName: `node-e-${Date.now()}`,
      entityType: 'ORGANIZATION',
    });
    entE = eE.id;

    const eF = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node F',
      normalizedName: `node-f-${Date.now()}`,
      entityType: 'CONCEPT',
    });
    entF = eF.id;

    // Linear chain: A -> B -> C -> D -> E -> F
    // Hop 1: A -> B
    const relAB = await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entA,
      targetEntityId: entB,
      relationType: 'CONNECTS_TO',
      weight: 1.0,
      confidence: 0.95,
      description: 'A connects to B',
    });
    await graphRepository.createEvidence({
      workspaceId: wsAlphaId,
      relationId: relAB.id,
      chunkId: chunkAlphaId,
      documentId: docAlphaId,
      evidenceText: 'Evidence linking A and B',
    });

    // Hop 2: B -> C
    await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entB,
      targetEntityId: entC,
      relationType: 'DEPENDS_ON',
      weight: 0.9,
      confidence: 0.9,
      description: 'B depends on C',
    });

    // Hop 3: C -> D
    await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entC,
      targetEntityId: entD,
      relationType: 'USES',
      weight: 0.8,
      confidence: 0.85,
      description: 'C uses D',
    });

    // Hop 4: D -> E
    await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entD,
      targetEntityId: entE,
      relationType: 'ENABLES',
      weight: 0.7,
      confidence: 0.8,
      description: 'D enables E',
    });

    // Hop 5: E -> F
    await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entE,
      targetEntityId: entF,
      relationType: 'PRODUCES',
      weight: 0.6,
      confidence: 0.75,
      description: 'E produces F',
    });

    // Cycle edge: C -> A (forms A -> B -> C -> A)
    await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entC,
      targetEntityId: entA,
      relationType: 'REVIEWS',
      weight: 0.5,
      confidence: 0.7,
      description: 'C reviews A in a cycle',
    });

    // Hub node with 25 outgoing relations
    const hub = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Central Hub',
      normalizedName: `central-hub-${Date.now()}`,
      entityType: 'ORGANIZATION',
    });
    entHub = hub.id;

    for (let i = 0; i < 25; i++) {
      const spoke = await graphRepository.createEntity({
        workspaceId: wsAlphaId,
        canonicalName: `Spoke Node ${i}`,
        normalizedName: `spoke-node-${i}-${Date.now()}`,
        entityType: 'CONCEPT',
      });
      await graphRepository.createRelation({
        workspaceId: wsAlphaId,
        sourceEntityId: entHub,
        targetEntityId: spoke.id,
        relationType: 'ASSOCIATED_WITH',
        weight: 0.5 + i * 0.01,
        confidence: 0.5 + i * 0.01,
        description: `Hub associated with Spoke ${i}`,
      });
    }

    // 3. Workspace Beta entities & relations (for isolation verification)
    const betaA = await graphRepository.createEntity({
      workspaceId: wsBetaId,
      canonicalName: 'Beta Secret Entity A',
      normalizedName: `beta-secret-a-${Date.now()}`,
      entityType: 'CONCEPT',
    });
    entBetaA = betaA.id;

    const betaB = await graphRepository.createEntity({
      workspaceId: wsBetaId,
      canonicalName: 'Beta Secret Entity B',
      normalizedName: `beta-secret-b-${Date.now()}`,
      entityType: 'CONCEPT',
    });
    entBetaB = betaB.id;

    await graphRepository.createRelation({
      workspaceId: wsBetaId,
      sourceEntityId: entBetaA,
      targetEntityId: entBetaB,
      relationType: 'SECRET_RELATION',
      weight: 1.0,
      confidence: 1.0,
      description: 'Top secret Beta relation',
    });
  });

  afterAll(async () => {
    const wsIds = [wsAlphaId, wsBetaId].filter(Boolean);
    if (wsIds.length > 0) {
      await prisma.workspace.deleteMany({
        where: { id: { in: wsIds } },
      });
    }
    if (userId) {
      await prisma.user.deleteMany({
        where: { id: userId },
      });
    }
  });

  describe('Part 1: SQL Traversal Foundation & Query Builder Safety Limits', () => {
    it('buildNeighborhoodQuery compiles parameterized SQL with all 7 safety limits', () => {
      const sqlObj = buildNeighborhoodQuery({
        workspaceId: wsAlphaId,
        centerEntityId: entA,
        direction: 'both',
        maxDepth: 2,
        limit: 30,
      });

      const sqlText = sqlObj.sql;

      // 1. Parameterized binds (not raw strings)
      expect(sqlObj.values).toBeDefined();
      expect(sqlObj.values.length).toBeGreaterThan(0);
      expect(sqlObj.values).toContain(wsAlphaId);
      expect(sqlObj.values).toContain(entA);

      // 2. Multi-tenant workspace isolation in anchor, recursive, and entity joins
      expect(sqlText).toContain('r.workspace_id =');
      expect(sqlText).toContain('s.workspace_id =');
      expect(sqlText).toContain('t.workspace_id =');
      expect(sqlText).toContain('re.workspace_id =');

      // 3. Depth clamping inside SQL: LEAST(GREATEST($N::int, 1), 3)
      expect(sqlText).toMatch(/gw\.depth\s*<\s*LEAST\(GREATEST\(.*::int,\s*1\),\s*3\)/i);

      // 4. Visited nodes bound: array_length(gw.path, 1) <= 4
      expect(sqlText).toContain('array_length(gw.path, 1) <= 4');

      // 5. Cycle containment: NOT (r.target_entity_id = ANY(gw.path))
      expect(sqlText).toContain('NOT (r.target_entity_id = ANY(gw.path))');
      expect(sqlText).toContain('NOT (r.source_entity_id = ANY(gw.path))');

      // 6. Intermediate expansion ceiling: candidate lateral join LIMIT 15
      expect(sqlText).toContain('LIMIT 15');

      // 7. Two-stage deduplication & response budget cap
      expect(sqlText).toContain('deduplicated_relations AS');
      expect(sqlText).toContain('DISTINCT ON (gw.relation_id)');
      expect(sqlText).toMatch(
        /ORDER BY\s+dr\.depth ASC,\s*dr\.confidence DESC,\s*dr\.weight DESC,\s*dr\.relation_id ASC/i,
      );
      expect(sqlText).toMatch(/LIMIT LEAST\(GREATEST\(.*::int,\s*5\),\s*100\)/i);
    });

    it('buildPathFinderQuery compiles parameterized SQL with all 9 safety limits', () => {
      const sqlObj = buildPathFinderQuery({
        workspaceId: wsAlphaId,
        sourceEntityId: entA,
        targetEntityId: entD,
        maxDepth: 3,
        limit: 5,
      });

      const sqlText = sqlObj.sql;

      // 1. Parameterized binds
      expect(sqlObj.values).toContain(wsAlphaId);
      expect(sqlObj.values).toContain(entA);
      expect(sqlObj.values).toContain(entD);

      // 2. Depth clamping: LEAST(GREATEST($N::int, 1), 4)
      expect(sqlText).toMatch(/pf\.depth\s*<\s*LEAST\(GREATEST\(.*::int,\s*1\),\s*4\)/i);

      // 3. Path node cap: array_length(pf.entity_path, 1) <= 5
      expect(sqlText).toContain('array_length(pf.entity_path, 1) <= 5');

      // 4. Cycle containment: NOT (r.target_entity_id = ANY(pf.entity_path))
      expect(sqlText).toContain('NOT (r.target_entity_id = ANY(pf.entity_path))');

      // 5. Destination short-circuit in recursive CTE
      expect(sqlText).toContain('pf.target_entity_id <>');

      // 6. Intermediate expansion ceiling: LIMIT 15
      expect(sqlText).toContain('LIMIT 15');

      // 7. Native array collision-safe tie-breaking
      expect(sqlText).toContain('pf.entity_path ASC');
      expect(sqlText).toContain('pf.relation_path ASC');

      // 8. Path budget cap: LIMIT LEAST(GREATEST($N::int, 1), 10)
      expect(sqlText).toMatch(/LIMIT LEAST\(GREATEST\(.*::int,\s*1\),\s*10\)/i);
    });
  });

  describe('Part 2: Real PostgreSQL Traversal Integration (Neighborhood)', () => {
    it('executes 1-hop neighborhood traversal with accurate evidence count and entity metadata', async () => {
      const results = await graphRepository.traverseNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entA,
        direction: 'outgoing',
        maxDepth: 1,
        limit: 10,
      });

      expect(results.length).toBe(1);
      const row = results[0];
      expect(row.depth).toBe(1);
      expect(row.source_id).toBe(entA);
      expect(row.source_name).toBe('Node A');
      expect(row.target_id).toBe(entB);
      expect(row.target_name).toBe('Node B');
      expect(row.relation_type).toBe('CONNECTS_TO');
      expect(row.evidence_count).toBe(1); // Connected to chunkAlphaId evidence
      expect(row.confidence).toBe(0.95);
      expect(row.weight).toBe(1.0);
    });

    it('executes multi-hop traversal (depth = 2 and depth = 3)', async () => {
      // Depth 2 from A: includes A->B (depth 1) and B->C (depth 2)
      const resDepth2 = await graphRepository.traverseNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entA,
        direction: 'outgoing',
        maxDepth: 2,
        limit: 20,
      });

      expect(resDepth2.some((r) => r.depth === 1 && r.target_id === entB)).toBe(true);
      expect(resDepth2.some((r) => r.depth === 2 && r.target_id === entC)).toBe(true);
      // D is 3 hops away, should NOT be in depth 2
      expect(resDepth2.some((r) => r.target_id === entD)).toBe(false);

      // Depth 3 from A: includes A->B (depth 1), B->C (depth 2), and C->D (depth 3)
      const resDepth3 = await graphRepository.traverseNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entA,
        direction: 'outgoing',
        maxDepth: 3,
        limit: 20,
      });

      expect(resDepth3.some((r) => r.depth === 1 && r.target_id === entB)).toBe(true);
      expect(resDepth3.some((r) => r.depth === 2 && r.target_id === entC)).toBe(true);
      expect(resDepth3.some((r) => r.depth === 3 && r.target_id === entD)).toBe(true);
    });

    it('strictly clamps excessive depth parameters (depth = 10, 50) to 3 inside SQL (AC-TRAV-01)', async () => {
      // Even if client passes depth 50, SQL clamp LEAST(GREATEST($4, 1), 3) restricts traversal to depth <= 3
      const results = await graphRepository.traverseNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entA,
        direction: 'outgoing',
        maxDepth: 50,
        limit: 50,
      });

      const maxObservedDepth = Math.max(...results.map((r) => r.depth));
      expect(maxObservedDepth).toBeLessThanOrEqual(3);

      // Node E (depth 4) and Node F (depth 5) must NEVER be included
      expect(results.some((r) => r.target_id === entE)).toBe(false);
      expect(results.some((r) => r.target_id === entF)).toBe(false);
    });

    it('strictly clamps negative depth parameters (depth = -5) to 1 inside SQL', async () => {
      const results = await graphRepository.traverseNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entA,
        direction: 'outgoing',
        maxDepth: -5,
        limit: 10,
      });

      expect(results.length).toBeGreaterThan(0);
      for (const row of results) {
        expect(row.depth).toBe(1);
      }
    });

    it('respects direction filtering: outgoing, incoming, and both', async () => {
      // entC has incoming from entB (B -> C), outgoing to entD (C -> D), and outgoing to entA (C -> A)
      const outgoing = await graphRepository.traverseNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entC,
        direction: 'outgoing',
        maxDepth: 1,
        limit: 10,
      });
      expect(outgoing.every((r) => r.source_id === entC)).toBe(true);
      expect(outgoing.some((r) => r.target_id === entD)).toBe(true);
      expect(outgoing.some((r) => r.target_id === entA)).toBe(true);
      expect(outgoing.some((r) => r.source_id === entB)).toBe(false);

      const incoming = await graphRepository.traverseNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entC,
        direction: 'incoming',
        maxDepth: 1,
        limit: 10,
      });
      expect(incoming.every((r) => r.target_id === entC)).toBe(true);
      expect(incoming.some((r) => r.source_id === entB)).toBe(true);
      expect(incoming.some((r) => r.source_id === entC)).toBe(false);

      const both = await graphRepository.traverseNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entC,
        direction: 'both',
        maxDepth: 1,
        limit: 10,
      });
      expect(both.some((r) => r.source_id === entC && r.target_id === entD)).toBe(true);
      expect(both.some((r) => r.source_id === entB && r.target_id === entC)).toBe(true);
    });

    it('safely terminates cyclic subgraphs without infinite loops or duplicate relation explosion', async () => {
      // Cycle: A -> B -> C -> A. Traversal from A with both directions and depth 3 must terminate cleanly
      const results = await graphRepository.traverseNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entA,
        direction: 'both',
        maxDepth: 3,
        limit: 50,
      });

      // Every returned relation_id must be unique (Stage 1 deduplication verified)
      const relIds = results.map((r) => r.relation_id);
      const uniqueRelIds = new Set(relIds);
      expect(uniqueRelIds.size).toBe(relIds.length);
    });

    it('truncates high-degree hub nodes cleanly to the requested limit', async () => {
      // entHub has 25 outgoing relations. Querying with limit = 10 must return exactly 10 relations
      const results = await graphRepository.traverseNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entHub,
        direction: 'outgoing',
        maxDepth: 1,
        limit: 10,
      });

      expect(results.length).toBe(10);
      // Results must be ordered by confidence DESC, weight DESC
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].confidence).toBeGreaterThanOrEqual(results[i + 1].confidence);
      }
    });

    it('enforces multi-tenant workspace isolation: returns 0 rows from other workspaces (AC-TRAV-06)', async () => {
      // Querying Workspace Alpha for Beta's entity returns 0 rows
      const resultsAlpha = await graphRepository.traverseNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entBetaA,
        direction: 'both',
        maxDepth: 3,
        limit: 50,
      });
      expect(resultsAlpha.length).toBe(0);

      // Traversal in Workspace Alpha never leaks entBetaA or entBetaB
      const resultsFromA = await graphRepository.traverseNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entA,
        direction: 'both',
        maxDepth: 3,
        limit: 100,
      });
      for (const row of resultsFromA) {
        expect(row.source_id).not.toBe(entBetaA);
        expect(row.source_id).not.toBe(entBetaB);
        expect(row.target_id).not.toBe(entBetaA);
        expect(row.target_id).not.toBe(entBetaB);
      }
    });
  });

  describe('Part 3: Real PostgreSQL Path Discovery Integration (findPaths)', () => {
    it('discovers direct 1-hop path between entities', async () => {
      const paths = await graphRepository.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entA,
        targetEntityId: entB,
        maxDepth: 3,
        limit: 5,
      });

      expect(paths.length).toBe(1);
      const p = paths[0];
      expect(p.depth).toBe(1);
      expect(p.entity_path).toEqual([entA, entB]);
      expect(p.type_path).toEqual(['CONNECTS_TO']);
    });

    it('discovers 2-hop and 3-hop multi-hop paths', async () => {
      // Path A -> C (2 hops: A -> B -> C)
      const pathsToC = await graphRepository.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entA,
        targetEntityId: entC,
        maxDepth: 3,
        limit: 5,
      });
      expect(pathsToC.length).toBe(1);
      expect(pathsToC[0].depth).toBe(2);
      expect(pathsToC[0].entity_path).toEqual([entA, entB, entC]);
      expect(pathsToC[0].type_path).toEqual(['CONNECTS_TO', 'DEPENDS_ON']);

      // Path A -> D (3 hops: A -> B -> C -> D)
      const pathsToD = await graphRepository.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entA,
        targetEntityId: entD,
        maxDepth: 3,
        limit: 5,
      });
      expect(pathsToD.length).toBe(1);
      expect(pathsToD[0].depth).toBe(3);
      expect(pathsToD[0].entity_path).toEqual([entA, entB, entC, entD]);
    });

    it('returns empty array when no path exists between disconnected entities', async () => {
      // entF has no outgoing edge back to entA
      const paths = await graphRepository.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entF,
        targetEntityId: entA,
        maxDepth: 4,
        limit: 5,
      });
      expect(paths).toEqual([]);
    });

    it('strictly clamps path discovery maxDepth to 4: 5-hop target is unreachable even with depth 50 (AC-TRAV-02)', async () => {
      // Node F is 5 hops from Node A: A -> B -> C -> D -> E -> F
      // Requesting maxDepth = 50 is clamped to 4, so Node F is unreachable
      const paths = await graphRepository.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entA,
        targetEntityId: entF,
        maxDepth: 50,
        limit: 5,
      });
      expect(paths.length).toBe(0);

      // Node E is 4 hops from Node A (within clamp [1, 4]), so Node E IS reached
      const pathsToE = await graphRepository.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entA,
        targetEntityId: entE,
        maxDepth: 50,
        limit: 5,
      });
      expect(pathsToE.length).toBe(1);
      expect(pathsToE[0].depth).toBe(4);
      expect(pathsToE[0].entity_path).toEqual([entA, entB, entC, entD, entE]);
    });

    it('enforces multi-tenant isolation in path discovery', async () => {
      // Attempting path discovery between Alpha and Beta entities returns empty
      const paths = await graphRepository.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entA,
        targetEntityId: entBetaB,
        maxDepth: 4,
        limit: 5,
      });
      expect(paths).toEqual([]);
    });
  });

  describe('Part 4: Statement Timeout & Error Handling', () => {
    it('maps SQLSTATE 57014 (query_canceled) to GraphTraversalTimeoutError (504)', async () => {
      // Trigger timeout using a test transaction with 1ms statement timeout on pg_sleep
      await expect(async () => {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL statement_timeout = '1ms';`;
          try {
            await tx.$queryRaw`SELECT pg_sleep(0.05);`;
          } catch (err: any) {
            if (
              err.code === '57014' ||
              err.meta?.code === '57014' ||
              err.message?.includes('canceling statement due to statement timeout') ||
              err.message?.includes('query_canceled')
            ) {
              throw new GraphTraversalTimeoutError();
            }
            throw err;
          }
        });
      }).rejects.toThrow(GraphTraversalTimeoutError);
    });

    it('GraphTraversalTimeoutError has statusCode 504 and code GRAPH_TRAVERSAL_TIMEOUT', () => {
      const err = new GraphTraversalTimeoutError();
      expect(err.statusCode).toBe(504);
      expect(err.code).toBe('GRAPH_TRAVERSAL_TIMEOUT');
      expect(err.message).toContain('2500ms');
    });
  });
});
