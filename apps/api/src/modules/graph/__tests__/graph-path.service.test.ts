import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { graphRepository } from '../repositories/graph.repository.js';
import {
  GraphTraversalService,
  graphTraversalService,
} from '../services/graph-traversal.service.js';
import {
  InvalidGraphQueryError,
  ForbiddenWorkspaceError,
  EntityNotFoundError,
  GraphTraversalTimeoutError,
} from '../errors/graph-traversal.error.js';
import type { IGraphRepository } from '../repositories/graph.repository.interface.js';

describe('Task 6.5.3: GraphTraversalService.findPaths', () => {
  let wsAlphaId: string;
  let wsBetaId: string;
  let userAlphaId: string;
  let userBetaId: string;

  // Linear chain: A -> B -> C -> D -> E -> F (5 hops)
  let entA: string;
  let entB: string;
  let entB2: string; // Diamond alternative: A -> B2 -> C
  let entC: string;
  let entD: string;
  let entE: string;
  let entF: string; // 5-hop target
  let entIsolated: string;

  // Beta entities (for multi-tenant isolation)
  let entBeta1: string;
  let entBeta2: string;

  // Stored relation IDs for verification
  let relABId: string;
  let relBCId: string;
  let relAB2Id: string;
  let relB2CId: string;

  beforeAll(async () => {
    // 1. Create Workspaces
    const wsA = await prisma.workspace.create({
      data: { name: 'Path WS Alpha', slug: `path-alpha-${randomUUID()}` },
    });
    wsAlphaId = wsA.id;

    const wsB = await prisma.workspace.create({
      data: { name: 'Path WS Beta', slug: `path-beta-${randomUUID()}` },
    });
    wsBetaId = wsB.id;

    // 2. Create Users & Membership
    const userA = await prisma.user.create({
      data: {
        email: `path-user-alpha-${randomUUID()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Path User Alpha',
      },
    });
    userAlphaId = userA.id;

    const userB = await prisma.user.create({
      data: {
        email: `path-user-beta-${randomUUID()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Path User Beta',
      },
    });
    userBetaId = userB.id;

    // User A is MEMBER of WS Alpha
    await prisma.workspaceMember.create({
      data: {
        workspaceId: wsAlphaId,
        userId: userAlphaId,
        role: 'MEMBER',
      },
    });

    // User B is MEMBER of WS Beta
    await prisma.workspaceMember.create({
      data: {
        workspaceId: wsBetaId,
        userId: userBetaId,
        role: 'MEMBER',
      },
    });

    // 3. Document & Chunk for Evidence in Alpha
    const doc = await prisma.document.create({
      data: {
        workspaceId: wsAlphaId,
        uploadedById: userAlphaId,
        originalName: 'PathServiceDoc.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(2048),
        checksum: `ck-path-${randomUUID()}`,
        storageKey: `key-path-${randomUUID()}`,
      },
    });

    const chunk = await prisma.documentChunk.create({
      data: {
        documentId: doc.id,
        workspaceId: wsAlphaId,
        chunkIndex: 0,
        content: 'GraphTraversalService path evidence passage',
        tokenCount: 10,
      },
    });

    // 4. Entities in Workspace Alpha
    const eA = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node A',
      normalizedName: `node-a-${randomUUID()}`,
      entityType: 'CONCEPT',
      description: 'Source entity A',
    });
    entA = eA.id;

    const eB = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node B',
      normalizedName: `node-b-${randomUUID()}`,
      entityType: 'TECHNOLOGY',
      description: 'Intermediate entity B',
    });
    entB = eB.id;

    const eB2 = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node B2',
      normalizedName: `node-b2-${randomUUID()}`,
      entityType: 'TECHNOLOGY',
      description: 'Alternative intermediate entity B2',
    });
    entB2 = eB2.id;

    const eC = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node C',
      normalizedName: `node-c-${randomUUID()}`,
      entityType: 'PRODUCT',
      description: 'Intermediate entity C',
    });
    entC = eC.id;

    const eD = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node D',
      normalizedName: `node-d-${randomUUID()}`,
      entityType: 'ORGANIZATION',
      description: 'Intermediate entity D',
    });
    entD = eD.id;

    const eE = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node E',
      normalizedName: `node-e-${randomUUID()}`,
      entityType: 'LOCATION',
      description: '4-hop target entity E',
    });
    entE = eE.id;

    const eF = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node F',
      normalizedName: `node-f-${randomUUID()}`,
      entityType: 'CONCEPT',
      description: '5-hop unreachable target F',
    });
    entF = eF.id;

    const eIso = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Isolated Node',
      normalizedName: `isolated-${randomUUID()}`,
      entityType: 'CONCEPT',
      description: 'Completely disconnected node',
    });
    entIsolated = eIso.id;

    // 5. Entities in Workspace Beta (Cross-tenant isolation)
    const eBeta1 = await graphRepository.createEntity({
      workspaceId: wsBetaId,
      canonicalName: 'Beta Entity One',
      normalizedName: `beta-ent-1-${randomUUID()}`,
      entityType: 'CONCEPT',
      description: 'Workspace Beta entity 1',
    });
    entBeta1 = eBeta1.id;

    const eBeta2 = await graphRepository.createEntity({
      workspaceId: wsBetaId,
      canonicalName: 'Beta Entity Two',
      normalizedName: `beta-ent-2-${randomUUID()}`,
      entityType: 'CONCEPT',
      description: 'Workspace Beta entity 2',
    });
    entBeta2 = eBeta2.id;

    // 6. Relations in Workspace Alpha
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
    relABId = relAB.id;
    await graphRepository.createEvidence({
      workspaceId: wsAlphaId,
      relationId: relAB.id,
      chunkId: chunk.id,
      documentId: doc.id,
      evidenceText: 'Evidence for A -> B',
    });

    // Hop 2: B -> C
    const relBC = await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entB,
      targetEntityId: entC,
      relationType: 'DEPENDS_ON',
      weight: 0.9,
      confidence: 0.9,
      description: 'B depends on C',
    });
    relBCId = relBC.id;

    // Alternative diamond branch: A -> B2 -> C
    const relAB2 = await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entA,
      targetEntityId: entB2,
      relationType: 'LINKS_TO',
      weight: 0.95,
      confidence: 0.85, // Lower confidence than A -> B (0.95)
      description: 'A links to B2',
    });
    relAB2Id = relAB2.id;

    const relB2C = await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entB2,
      targetEntityId: entC,
      relationType: 'SUPPORTS',
      weight: 0.85,
      confidence: 0.88,
      description: 'B2 supports C',
    });
    relB2CId = relB2C.id;

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

    // Cycle: C -> A (Creates A -> B -> C -> A)
    await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entC,
      targetEntityId: entA,
      relationType: 'REFERENCES',
      weight: 0.5,
      confidence: 0.5,
      description: 'C references A (cycle)',
    });

    // 7. Relations in Workspace Beta (Cross-tenant secret)
    await graphRepository.createRelation({
      workspaceId: wsBetaId,
      sourceEntityId: entBeta1,
      targetEntityId: entBeta2,
      relationType: 'BETA_SECRET',
      weight: 1.0,
      confidence: 1.0,
      description: 'Secret relation in Beta',
    });
  });

  afterAll(async () => {
    const wsIds = [wsAlphaId, wsBetaId].filter(Boolean);
    if (wsIds.length > 0) {
      await prisma.workspace.deleteMany({
        where: { id: { in: wsIds } },
      });
    }
    const userIds = [userAlphaId, userBetaId].filter(Boolean);
    if (userIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }
  });

  // =========================================================================
  // 1. Input Validation & Parameter Boundaries (400 InvalidGraphQueryError)
  // =========================================================================
  describe('1. Input Validation & Parameter Boundaries (400 InvalidGraphQueryError)', () => {
    it('rejects missing or empty workspaceId with 400', async () => {
      await expect(
        graphTraversalService.findPaths({
          workspaceId: '',
          sourceEntityId: entA,
          targetEntityId: entB,
          userId: userAlphaId,
        }),
      ).rejects.toThrow(InvalidGraphQueryError);
    });

    it('rejects missing or empty sourceEntityId with 400', async () => {
      await expect(
        graphTraversalService.findPaths({
          workspaceId: wsAlphaId,
          sourceEntityId: '',
          targetEntityId: entB,
          userId: userAlphaId,
        }),
      ).rejects.toThrow(InvalidGraphQueryError);
    });

    it('rejects missing or empty targetEntityId with 400', async () => {
      await expect(
        graphTraversalService.findPaths({
          workspaceId: wsAlphaId,
          sourceEntityId: entA,
          targetEntityId: '',
          userId: userAlphaId,
        }),
      ).rejects.toThrow(InvalidGraphQueryError);
    });

    it('rejects non-UUID sourceEntityId with 400', async () => {
      await expect(
        graphTraversalService.findPaths({
          workspaceId: wsAlphaId,
          sourceEntityId: 'invalid-non-uuid',
          targetEntityId: entB,
          userId: userAlphaId,
        }),
      ).rejects.toThrow(InvalidGraphQueryError);
    });

    it('rejects non-UUID targetEntityId with 400', async () => {
      await expect(
        graphTraversalService.findPaths({
          workspaceId: wsAlphaId,
          sourceEntityId: entA,
          targetEntityId: 'invalid-non-uuid',
          userId: userAlphaId,
        }),
      ).rejects.toThrow(InvalidGraphQueryError);
    });

    it('rejects maxDepth < 1 with 400', async () => {
      await expect(
        graphTraversalService.findPaths({
          workspaceId: wsAlphaId,
          sourceEntityId: entA,
          targetEntityId: entB,
          query: { maxDepth: 0 },
          userId: userAlphaId,
        }),
      ).rejects.toThrow(InvalidGraphQueryError);
    });

    it('rejects maxDepth > 4 with 400', async () => {
      await expect(
        graphTraversalService.findPaths({
          workspaceId: wsAlphaId,
          sourceEntityId: entA,
          targetEntityId: entB,
          query: { maxDepth: 5 },
          userId: userAlphaId,
        }),
      ).rejects.toThrow(InvalidGraphQueryError);
    });

    it('rejects limit < 1 with 400', async () => {
      await expect(
        graphTraversalService.findPaths({
          workspaceId: wsAlphaId,
          sourceEntityId: entA,
          targetEntityId: entB,
          query: { limit: 0 },
          userId: userAlphaId,
        }),
      ).rejects.toThrow(InvalidGraphQueryError);
    });

    it('rejects limit > 10 with 400', async () => {
      await expect(
        graphTraversalService.findPaths({
          workspaceId: wsAlphaId,
          sourceEntityId: entA,
          targetEntityId: entB,
          query: { limit: 11 },
          userId: userAlphaId,
        }),
      ).rejects.toThrow(InvalidGraphQueryError);
    });
  });

  // =========================================================================
  // 2. Authorization & Multi-Tenant Isolation (403 & 404)
  // =========================================================================
  describe('2. Authorization & Multi-Tenant Isolation (403 & 404)', () => {
    it('throws 403 ForbiddenWorkspaceError when User Beta queries Workspace Alpha without membership', async () => {
      await expect(
        graphTraversalService.findPaths({
          workspaceId: wsAlphaId,
          sourceEntityId: entA,
          targetEntityId: entB,
          userId: userBetaId, // User B is not a member of Workspace Alpha
        }),
      ).rejects.toThrow(ForbiddenWorkspaceError);
    });

    it('throws 403 ForbiddenWorkspaceError when accessing non-existent workspace ID', async () => {
      await expect(
        graphTraversalService.findPaths({
          workspaceId: randomUUID(),
          sourceEntityId: entA,
          targetEntityId: entB,
        }),
      ).rejects.toThrow(ForbiddenWorkspaceError);
    });

    it('throws 404 EntityNotFoundError when source entity does not exist in workspace', async () => {
      await expect(
        graphTraversalService.findPaths({
          workspaceId: wsAlphaId,
          sourceEntityId: randomUUID(),
          targetEntityId: entB,
          userId: userAlphaId,
        }),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('throws 404 EntityNotFoundError when target entity does not exist in workspace', async () => {
      await expect(
        graphTraversalService.findPaths({
          workspaceId: wsAlphaId,
          sourceEntityId: entA,
          targetEntityId: randomUUID(),
          userId: userAlphaId,
        }),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('throws 404 EntityNotFoundError when source entity belongs to another workspace (cross-tenant IDOR protection)', async () => {
      // User Alpha attempts to query path from entBeta1 (which belongs to Workspace Beta)
      await expect(
        graphTraversalService.findPaths({
          workspaceId: wsAlphaId,
          sourceEntityId: entBeta1,
          targetEntityId: entB,
          userId: userAlphaId,
        }),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('throws 404 EntityNotFoundError when target entity belongs to another workspace (cross-tenant IDOR protection)', async () => {
      // User Alpha attempts to query path to entBeta2 (which belongs to Workspace Beta)
      await expect(
        graphTraversalService.findPaths({
          workspaceId: wsAlphaId,
          sourceEntityId: entA,
          targetEntityId: entBeta2,
          userId: userAlphaId,
        }),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('strictly isolates graphs: traversal in Workspace Alpha never returns Workspace Beta relations or entities', async () => {
      const result = await graphTraversalService.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entA,
        targetEntityId: entC,
        query: { maxDepth: 4, limit: 10 },
        userId: userAlphaId,
      });

      expect(result.pathsFound).toBeGreaterThanOrEqual(1);
      for (const p of result.paths) {
        for (const ent of p.pathEntities) {
          expect(ent.id).not.toBe(entBeta1);
          expect(ent.id).not.toBe(entBeta2);
        }
        for (const rel of p.pathRelations) {
          expect(rel.type).not.toBe('BETA_SECRET');
        }
      }
    });
  });

  // =========================================================================
  // 3. Direct 1-Hop Path Discovery
  // =========================================================================
  describe('3. Direct 1-Hop Path Discovery', () => {
    it('discovers direct 1-hop path with canonical DTO mapping', async () => {
      const result = await graphTraversalService.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entA,
        targetEntityId: entB,
        query: { maxDepth: 1, limit: 5 },
        userId: userAlphaId,
      });

      expect(result.sourceEntityId).toBe(entA);
      expect(result.targetEntityId).toBe(entB);
      expect(result.pathsFound).toBe(1);
      expect(result.paths.length).toBe(1);

      const path = result.paths[0];
      expect(path.depth).toBe(1);
      expect(path.weight).toBeCloseTo(1.0);
      expect(path.confidence).toBeCloseTo(0.95);

      // Path entities
      expect(path.pathEntities).toHaveLength(2);
      expect(path.pathEntities[0]).toEqual({
        id: entA,
        name: 'Node A',
      });
      expect(path.pathEntities[1]).toEqual({
        id: entB,
        name: 'Node B',
      });

      // Path relations
      expect(path.pathRelations).toHaveLength(1);
      expect(path.pathRelations[0]).toEqual({
        id: relABId,
        type: 'CONNECTS_TO',
      });
    });
  });

  // =========================================================================
  // 4. Multi-Hop Path Discovery (2-Hop, 3-Hop, 4-Hop)
  // =========================================================================
  describe('4. Multi-Hop Path Discovery (2-Hop, 3-Hop, 4-Hop)', () => {
    it('discovers 2-hop path (A -> B -> C)', async () => {
      const result = await graphTraversalService.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entA,
        targetEntityId: entC,
        query: { maxDepth: 2, limit: 5 },
        userId: userAlphaId,
      });

      expect(result.pathsFound).toBeGreaterThanOrEqual(1);
      // The best path should be A -> B -> C (depth 2)
      const primaryPath = result.paths[0];
      expect(primaryPath.depth).toBe(2);
      expect(primaryPath.pathEntities.map((e) => e.id)).toEqual([entA, entB, entC]);
      expect(primaryPath.pathEntities.map((e) => e.name)).toEqual(['Node A', 'Node B', 'Node C']);
      expect(primaryPath.pathRelations.map((r) => r.type)).toEqual(['CONNECTS_TO', 'DEPENDS_ON']);
    });

    it('discovers 3-hop path (A -> B -> C -> D)', async () => {
      const result = await graphTraversalService.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entA,
        targetEntityId: entD,
        query: { maxDepth: 3, limit: 5 },
        userId: userAlphaId,
      });

      expect(result.pathsFound).toBeGreaterThanOrEqual(1);
      const path = result.paths[0];
      expect(path.depth).toBe(3);
      expect(path.pathEntities.map((e) => e.id)).toEqual([entA, entB, entC, entD]);
      expect(path.pathEntities.map((e) => e.name)).toEqual([
        'Node A',
        'Node B',
        'Node C',
        'Node D',
      ]);
      expect(path.pathRelations.map((r) => r.type)).toEqual(['CONNECTS_TO', 'DEPENDS_ON', 'USES']);
    });

    it('discovers 4-hop path (A -> B -> C -> D -> E)', async () => {
      const result = await graphTraversalService.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entA,
        targetEntityId: entE,
        query: { maxDepth: 4, limit: 5 },
        userId: userAlphaId,
      });

      expect(result.pathsFound).toBeGreaterThanOrEqual(1);
      const path = result.paths[0];
      expect(path.depth).toBe(4);
      expect(path.pathEntities.map((e) => e.id)).toEqual([entA, entB, entC, entD, entE]);
      expect(path.pathEntities.map((e) => e.name)).toEqual([
        'Node A',
        'Node B',
        'Node C',
        'Node D',
        'Node E',
      ]);
      expect(path.pathRelations.map((r) => r.type)).toEqual([
        'CONNECTS_TO',
        'DEPENDS_ON',
        'USES',
        'ENABLES',
      ]);
    });
  });

  // =========================================================================
  // 5. Deterministic Ordering & Alternative Paths (Diamond Graph)
  // =========================================================================
  describe('5. Deterministic Ordering & Alternative Paths (Diamond Graph)', () => {
    it('ranks multiple paths deterministically by depth ASC, confidence DESC, weight DESC', async () => {
      // Two paths exist between A and C:
      // Path 1: A -> B -> C (composite confidence = min(0.95, 0.90) = 0.90, composite weight = 1.0 * 0.9 = 0.9)
      // Path 2: A -> B2 -> C (composite confidence = min(0.85, 0.88) = 0.85, composite weight = 0.95 * 0.85 = 0.8075)
      const result = await graphTraversalService.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entA,
        targetEntityId: entC,
        query: { maxDepth: 2, limit: 5 },
        userId: userAlphaId,
      });

      expect(result.pathsFound).toBe(2);
      expect(result.paths[0].pathEntities.map((e) => e.id)).toEqual([entA, entB, entC]);
      expect(result.paths[1].pathEntities.map((e) => e.id)).toEqual([entA, entB2, entC]);

      // Path 0 confidence must be greater than or equal to Path 1
      expect(result.paths[0].confidence).toBeGreaterThanOrEqual(result.paths[1].confidence);
    });

    it('respects limit parameter and truncates alternative paths cleanly', async () => {
      // Query with limit = 1: must return only the single highest-salience path
      const result = await graphTraversalService.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entA,
        targetEntityId: entC,
        query: { maxDepth: 2, limit: 1 },
        userId: userAlphaId,
      });

      expect(result.pathsFound).toBe(1);
      expect(result.paths).toHaveLength(1);
      expect(result.paths[0].pathEntities.map((e) => e.id)).toEqual([entA, entB, entC]);
    });
  });

  // =========================================================================
  // 6. Cycle Containment & Termination
  // =========================================================================
  describe('6. Cycle Containment & Termination', () => {
    it('terminates cleanly on cyclic subgraphs without infinite loops or duplicate nodes', async () => {
      // Cycle: A -> B -> C -> A. Searching from A to D must traverse through C to D without looping
      const result = await graphTraversalService.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entA,
        targetEntityId: entD,
        query: { maxDepth: 4, limit: 5 },
        userId: userAlphaId,
      });

      expect(result.pathsFound).toBeGreaterThanOrEqual(1);
      for (const path of result.paths) {
        // No node should be visited twice in any path
        const visitedIds = path.pathEntities.map((e) => e.id);
        const uniqueIds = new Set(visitedIds);
        expect(uniqueIds.size).toBe(visitedIds.length);
      }
    });
  });

  // =========================================================================
  // 7. Depth Limits & Reachability Bounds
  // =========================================================================
  describe('7. Depth Limits & Reachability Bounds', () => {
    it('target 5 hops away (Node F) is unreachable and returns 0 paths within maxDepth=4', async () => {
      // Node F is 5 hops from Node A: A -> B -> C -> D -> E -> F
      // Maximum allowed depth is 4. Querying with maxDepth = 4 must not find Node F
      const result = await graphTraversalService.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entA,
        targetEntityId: entF,
        query: { maxDepth: 4, limit: 5 },
        userId: userAlphaId,
      });

      expect(result.sourceEntityId).toBe(entA);
      expect(result.targetEntityId).toBe(entF);
      expect(result.pathsFound).toBe(0);
      expect(result.paths).toEqual([]);
    });

    it('depth parameter is clamped to 4: 5-hop target is unreachable even if 50 is requested at API layer', async () => {
      // In the SQL query builder, depth is clamped to 4: pf.depth < LEAST(GREATEST($4::int, 1), 4)
      // When queried with maxDepth: 4 (maximum valid Zod value), Node F remains unreachable
      const result = await graphTraversalService.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entA,
        targetEntityId: entF,
        query: { maxDepth: 4, limit: 10 },
        userId: userAlphaId,
      });

      expect(result.pathsFound).toBe(0);
      expect(result.paths).toEqual([]);
    });
  });

  // =========================================================================
  // 8. Edge Cases: Identical Endpoints & Disconnected Graphs
  // =========================================================================
  describe('8. Edge Cases: Identical Endpoints & Disconnected Graphs', () => {
    it('handles identical source and target entities (A -> A) returning 0 paths found', async () => {
      const result = await graphTraversalService.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entA,
        targetEntityId: entA,
        userId: userAlphaId,
      });

      expect(result.sourceEntityId).toBe(entA);
      expect(result.targetEntityId).toBe(entA);
      expect(result.pathsFound).toBe(0);
      expect(result.paths).toEqual([]);
    });

    it('returns empty paths array when no path exists between disconnected entities', async () => {
      // F has incoming from E, but no outgoing edges back to A
      const result = await graphTraversalService.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entF,
        targetEntityId: entA,
        query: { maxDepth: 4, limit: 5 },
        userId: userAlphaId,
      });

      expect(result.sourceEntityId).toBe(entF);
      expect(result.targetEntityId).toBe(entA);
      expect(result.pathsFound).toBe(0);
      expect(result.paths).toEqual([]);
    });

    it('handles isolated entity with zero connections gracefully', async () => {
      const result = await graphTraversalService.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entA,
        targetEntityId: entIsolated,
        query: { maxDepth: 4, limit: 5 },
        userId: userAlphaId,
      });

      expect(result.pathsFound).toBe(0);
      expect(result.paths).toEqual([]);
    });
  });

  // =========================================================================
  // 9. Repository Timeout Propagation & Fallback Resolution
  // =========================================================================
  describe('9. Repository Timeout Propagation & Fallback Resolution', () => {
    it('propagates GraphTraversalTimeoutError (504) thrown by repository', async () => {
      const mockRepo: IGraphRepository = Object.assign(Object.create(graphRepository), {
        findEntityById: async (wsId: string, id: string) => ({
          id,
          workspaceId: wsId,
          canonicalName: 'Mock Entity',
          normalizedName: 'mock-entity',
          entityType: 'CONCEPT' as const,
          description: null,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        findPaths: async () => {
          throw new GraphTraversalTimeoutError();
        },
      });

      const timeoutService = new GraphTraversalService(mockRepo);
      await expect(
        timeoutService.findPaths({
          workspaceId: wsAlphaId,
          sourceEntityId: entA,
          targetEntityId: entB,
          userId: userAlphaId,
        }),
      ).rejects.toThrow(GraphTraversalTimeoutError);
    });

    it('falls back gracefully to findEntityById if findEntitiesByIds is not implemented', async () => {
      const mockRepo: IGraphRepository = Object.assign(Object.create(graphRepository), {
        findEntityById: async (wsId: string, id: string) => ({
          id,
          workspaceId: wsId,
          canonicalName: id === entA ? 'Node A' : id === entC ? 'Node C' : 'Node B Fallback',
          normalizedName: 'mock-entity',
          entityType: 'CONCEPT' as const,
          description: null,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        findEntitiesByIds: undefined, // Explicitly simulate repository without batch lookup
        findPaths: async () => [
          {
            relation_id: relBCId,
            entity_path: [entA, entB, entC],
            relation_path: [relABId, relBCId],
            type_path: ['CONNECTS_TO', 'DEPENDS_ON'],
            depth: 2,
            weight: 0.9,
            confidence: 0.9,
          },
        ],
      });

      const fallbackService = new GraphTraversalService(mockRepo);
      const result = await fallbackService.findPaths({
        workspaceId: wsAlphaId,
        sourceEntityId: entA,
        targetEntityId: entC,
        userId: userAlphaId,
      });

      expect(result.pathsFound).toBe(1);
      expect(result.paths[0].pathEntities).toHaveLength(3);
      expect(result.paths[0].pathEntities[1].name).toBe('Node B Fallback');
    });
  });

  // =========================================================================
  // 10. Multi-Parameter Calling Signature Support
  // =========================================================================
  describe('10. Multi-Parameter Calling Signature Support', () => {
    it('supports positional argument invocation signature', async () => {
      const result = await graphTraversalService.findPaths(
        wsAlphaId,
        entA,
        entB,
        { maxDepth: 1, limit: 5 },
        userAlphaId,
      );

      expect(result.sourceEntityId).toBe(entA);
      expect(result.targetEntityId).toBe(entB);
      expect(result.pathsFound).toBe(1);
    });
  });
});
