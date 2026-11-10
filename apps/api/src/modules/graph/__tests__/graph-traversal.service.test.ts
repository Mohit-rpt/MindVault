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

describe('Task 6.5.2: GraphTraversalService.getNeighborhood', () => {
  let wsAlphaId: string;
  let wsBetaId: string;
  let userAlphaId: string;
  let userBetaId: string;

  let entA: string;
  let entB: string;
  let entC: string;
  let entD: string;
  let entIsolated: string;
  let entHub: string;

  let entBeta1: string;
  let entBeta2: string;

  beforeAll(async () => {
    // 1. Create Workspaces
    const wsA = await prisma.workspace.create({
      data: { name: 'Service WS Alpha', slug: `svc-alpha-${Date.now()}` },
    });
    wsAlphaId = wsA.id;

    const wsB = await prisma.workspace.create({
      data: { name: 'Service WS Beta', slug: `svc-beta-${Date.now()}` },
    });
    wsBetaId = wsB.id;

    // 2. Create Users & Membership
    const userA = await prisma.user.create({
      data: {
        email: `user-alpha-${Date.now()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'User Alpha',
      },
    });
    userAlphaId = userA.id;

    const userB = await prisma.user.create({
      data: {
        email: `user-beta-${Date.now()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'User Beta',
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

    // 3. Document & Chunk for Evidence
    const doc = await prisma.document.create({
      data: {
        workspaceId: wsAlphaId,
        uploadedById: userAlphaId,
        originalName: 'ServiceTestDoc.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(2048),
        checksum: `ck-svc-${Date.now()}`,
        storageKey: `key-svc-${Date.now()}`,
      },
    });

    const chunk = await prisma.documentChunk.create({
      data: {
        documentId: doc.id,
        workspaceId: wsAlphaId,
        chunkIndex: 0,
        content: 'GraphTraversalService test evidence passage',
        tokenCount: 10,
      },
    });

    // 4. Entities in Workspace Alpha
    const eA = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Central Node A',
      normalizedName: `central-node-a-${Date.now()}`,
      entityType: 'CONCEPT',
      description: 'Primary center entity for traversal testing',
    });
    entA = eA.id;

    const eB = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node B',
      normalizedName: `node-b-${Date.now()}`,
      entityType: 'TECHNOLOGY',
      description: 'First hop node B',
    });
    entB = eB.id;

    const eC = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node C',
      normalizedName: `node-c-${Date.now()}`,
      entityType: 'PRODUCT',
      description: 'First hop node C',
    });
    entC = eC.id;

    const eD = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node D',
      normalizedName: `node-d-${Date.now()}`,
      entityType: 'ORGANIZATION',
      description: 'Second hop node D',
    });
    entD = eD.id;

    const eIso = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Isolated Entity',
      normalizedName: `isolated-${Date.now()}`,
      entityType: 'CONCEPT',
      description: 'Has 0 connections',
    });
    entIsolated = eIso.id;

    // Outgoing relation from A: A -> B
    const relAB = await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entA,
      targetEntityId: entB,
      relationType: 'DEPENDS_ON',
      weight: 1.0,
      confidence: 0.95,
      description: 'A depends on B',
    });
    await graphRepository.createEvidence({
      workspaceId: wsAlphaId,
      relationId: relAB.id,
      chunkId: chunk.id,
      documentId: doc.id,
      evidenceText: 'Evidence supporting A depends on B',
    });

    // Incoming relation to A: C -> A
    await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entC,
      targetEntityId: entA,
      relationType: 'INFLUENCES',
      weight: 0.8,
      confidence: 0.85,
      description: 'C influences A',
    });

    // Second hop relation: B -> D
    await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entB,
      targetEntityId: entD,
      relationType: 'USES',
      weight: 0.7,
      confidence: 0.75,
      description: 'B uses D',
    });

    // Hub node with 30 relations
    const hub = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Large Hub',
      normalizedName: `large-hub-${Date.now()}`,
      entityType: 'ORGANIZATION',
    });
    entHub = hub.id;

    for (let i = 0; i < 30; i++) {
      const spoke = await graphRepository.createEntity({
        workspaceId: wsAlphaId,
        canonicalName: `Hub Spoke ${i}`,
        normalizedName: `hub-spoke-${i}-${Date.now()}`,
        entityType: 'CONCEPT',
      });
      await graphRepository.createRelation({
        workspaceId: wsAlphaId,
        sourceEntityId: entHub,
        targetEntityId: spoke.id,
        relationType: 'ASSOCIATES_WITH',
        weight: 0.5 + i * 0.01,
        confidence: 0.5 + i * 0.01,
        description: `Spoke relation ${i}`,
      });
    }

    // 5. Entities in Workspace Beta (Cross-tenant)
    const b1 = await graphRepository.createEntity({
      workspaceId: wsBetaId,
      canonicalName: 'Beta Entity 1',
      normalizedName: `beta-1-${Date.now()}`,
      entityType: 'CONCEPT',
    });
    entBeta1 = b1.id;

    const b2 = await graphRepository.createEntity({
      workspaceId: wsBetaId,
      canonicalName: 'Beta Entity 2',
      normalizedName: `beta-2-${Date.now()}`,
      entityType: 'CONCEPT',
    });
    entBeta2 = b2.id;

    await graphRepository.createRelation({
      workspaceId: wsBetaId,
      sourceEntityId: entBeta1,
      targetEntityId: entBeta2,
      relationType: 'BETA_SECRET',
      weight: 1.0,
      confidence: 1.0,
      description: 'Confidential Beta connection',
    });
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({
      where: { id: { in: [wsAlphaId, wsBetaId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userAlphaId, userBetaId] } },
    });
  });

  describe('1. Valid Neighborhood Requests & DTO Mapping', () => {
    it('executes a valid neighborhood request with default parameters and returns complete DTO', async () => {
      const result = await graphTraversalService.getNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entA,
        userId: userAlphaId,
      });

      // DTO structure checks
      expect(result.centerEntityId).toBe(entA);
      expect(result.depth).toBe(1); // default depth
      expect(result.totalNodes).toBe(3); // A, B, C
      expect(result.totalEdges).toBe(2); // A->B and C->A
      expect(result.nodes.length).toBe(3);
      expect(result.edges.length).toBe(2);

      // Center entity node checks
      const centerNode = result.nodes.find((n) => n.id === entA);
      expect(centerNode).toBeDefined();
      expect(centerNode?.depth).toBe(0); // Center entity is depth 0
      expect(centerNode?.label).toBe('Central Node A');
      expect(centerNode?.entityType).toBe('CONCEPT');
      expect(centerNode?.degree).toBe(2); // Connected to B and C

      // Neighbor nodes checks
      const nodeB = result.nodes.find((n) => n.id === entB);
      expect(nodeB).toBeDefined();
      expect(nodeB?.depth).toBe(1);
      expect(nodeB?.degree).toBe(1);

      const nodeC = result.nodes.find((n) => n.id === entC);
      expect(nodeC).toBeDefined();
      expect(nodeC?.depth).toBe(1);
      expect(nodeC?.degree).toBe(1);

      // Edge checks
      const edgeAB = result.edges.find((e) => e.source === entA && e.target === entB);
      expect(edgeAB).toBeDefined();
      expect(edgeAB?.label).toBe('DEPENDS_ON');
      expect(edgeAB?.weight).toBe(1.0);
      expect(edgeAB?.confidence).toBe(0.95);
      expect(edgeAB?.evidenceCount).toBe(1);
    });

    it('supports calling getNeighborhood with positional parameters', async () => {
      const result = await graphTraversalService.getNeighborhood(
        wsAlphaId,
        entA,
        { depth: 1, limit: 10, direction: 'outgoing' },
        userAlphaId,
      );

      expect(result.centerEntityId).toBe(entA);
      expect(result.edges.length).toBe(1);
      expect(result.edges[0].target).toBe(entB);
    });
  });

  describe('2. Direction Filtering (both, outgoing, incoming)', () => {
    it('filters outgoing-only relations', async () => {
      const result = await graphTraversalService.getNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entA,
        query: { direction: 'outgoing', depth: 1 },
        userId: userAlphaId,
      });

      expect(result.edges.length).toBe(1);
      expect(result.edges[0].source).toBe(entA);
      expect(result.edges[0].target).toBe(entB);
      expect(result.nodes.some((n) => n.id === entC)).toBe(false);
    });

    it('filters incoming-only relations', async () => {
      const result = await graphTraversalService.getNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entA,
        query: { direction: 'incoming', depth: 1 },
        userId: userAlphaId,
      });

      expect(result.edges.length).toBe(1);
      expect(result.edges[0].source).toBe(entC);
      expect(result.edges[0].target).toBe(entA);
      expect(result.nodes.some((n) => n.id === entB)).toBe(false);
    });

    it('traverses both directions by default', async () => {
      const result = await graphTraversalService.getNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entA,
        query: { direction: 'both', depth: 1 },
        userId: userAlphaId,
      });

      expect(result.edges.some((e) => e.source === entA && e.target === entB)).toBe(true);
      expect(result.edges.some((e) => e.source === entC && e.target === entA)).toBe(true);
      expect(result.edges.length).toBe(2);
    });
  });

  describe('3. Depth Boundaries (1, 2, 3)', () => {
    it('traverses 2-hop neighborhood reaching node D', async () => {
      const result = await graphTraversalService.getNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entA,
        query: { depth: 2, direction: 'outgoing', limit: 20 },
        userId: userAlphaId,
      });

      expect(result.depth).toBe(2);
      expect(result.edges.length).toBe(2); // A->B and B->D
      const nodeD = result.nodes.find((n) => n.id === entD);
      expect(nodeD).toBeDefined();
      expect(nodeD?.depth).toBe(2);
    });

    it('traverses depth 1 boundary without reaching depth 2 nodes', async () => {
      const result = await graphTraversalService.getNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entA,
        query: { depth: 1, direction: 'outgoing', limit: 20 },
        userId: userAlphaId,
      });

      expect(result.depth).toBe(1);
      expect(result.nodes.some((n) => n.id === entD)).toBe(false);
    });

    it('traverses depth 3 boundary successfully', async () => {
      const result = await graphTraversalService.getNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entA,
        query: { depth: 3, limit: 30 },
        userId: userAlphaId,
      });

      expect(result.depth).toBe(3);
      expect(result.totalNodes).toBeGreaterThanOrEqual(3);
    });
  });

  describe('4. Limit Boundaries (Minimum 5, Default 30, Maximum 100)', () => {
    it('honors minimum limit 5', async () => {
      const result = await graphTraversalService.getNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entHub,
        query: { limit: 5, direction: 'outgoing' },
        userId: userAlphaId,
      });

      expect(result.edges.length).toBe(5);
      expect(result.totalEdges).toBe(5);
    });

    it('honors default limit 30', async () => {
      const result = await graphTraversalService.getNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entHub,
        query: { direction: 'outgoing' }, // default limit is 30
        userId: userAlphaId,
      });

      expect(result.edges.length).toBe(30);
    });

    it('honors maximum limit 100', async () => {
      const result = await graphTraversalService.getNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entHub,
        query: { limit: 100, direction: 'outgoing' },
        userId: userAlphaId,
      });

      // entHub has 30 relations total, so returning all 30 is within limit 100
      expect(result.edges.length).toBe(30);
    });
  });

  describe('5. Input Validation Errors (400 INVALID_GRAPH_QUERY)', () => {
    it('rejects invalid depth < 1 with 400', async () => {
      await expect(
        graphTraversalService.getNeighborhood({
          workspaceId: wsAlphaId,
          centerEntityId: entA,
          query: { depth: 0 },
          userId: userAlphaId,
        }),
      ).rejects.toThrow(InvalidGraphQueryError);
    });

    it('rejects invalid depth > 3 with 400', async () => {
      await expect(
        graphTraversalService.getNeighborhood({
          workspaceId: wsAlphaId,
          centerEntityId: entA,
          query: { depth: 4 },
          userId: userAlphaId,
        }),
      ).rejects.toThrow(InvalidGraphQueryError);
    });

    it('rejects invalid limit < 5 with 400', async () => {
      await expect(
        graphTraversalService.getNeighborhood({
          workspaceId: wsAlphaId,
          centerEntityId: entA,
          query: { limit: 4 },
          userId: userAlphaId,
        }),
      ).rejects.toThrow(InvalidGraphQueryError);
    });

    it('rejects invalid limit > 100 with 400', async () => {
      await expect(
        graphTraversalService.getNeighborhood({
          workspaceId: wsAlphaId,
          centerEntityId: entA,
          query: { limit: 101 },
          userId: userAlphaId,
        }),
      ).rejects.toThrow(InvalidGraphQueryError);
    });

    it('rejects invalid direction with 400', async () => {
      await expect(
        graphTraversalService.getNeighborhood({
          workspaceId: wsAlphaId,
          centerEntityId: entA,
          query: { direction: 'diagonal' as any },
          userId: userAlphaId,
        }),
      ).rejects.toThrow(InvalidGraphQueryError);
    });

    it('rejects missing or empty workspaceId with 400', async () => {
      await expect(
        graphTraversalService.getNeighborhood({
          workspaceId: '',
          centerEntityId: entA,
          userId: userAlphaId,
        }),
      ).rejects.toThrow(InvalidGraphQueryError);
    });

    it('rejects missing or empty centerEntityId with 400', async () => {
      await expect(
        graphTraversalService.getNeighborhood({
          workspaceId: wsAlphaId,
          centerEntityId: '',
          userId: userAlphaId,
        }),
      ).rejects.toThrow(InvalidGraphQueryError);
    });
  });

  describe('6. Authorization & Multi-Tenant Isolation (403 & 404)', () => {
    it('throws 403 ForbiddenWorkspaceError when User B queries Workspace Alpha without membership', async () => {
      await expect(
        graphTraversalService.getNeighborhood({
          workspaceId: wsAlphaId,
          centerEntityId: entA,
          userId: userBetaId, // User B is not a member of Workspace Alpha
        }),
      ).rejects.toThrow(ForbiddenWorkspaceError);
    });

    it('throws 403 ForbiddenWorkspaceError when accessing non-existent workspace ID', async () => {
      await expect(
        graphTraversalService.getNeighborhood({
          workspaceId: 'ws_non_existent_random_id',
          centerEntityId: entA,
        }),
      ).rejects.toThrow(ForbiddenWorkspaceError);
    });

    it('throws 404 EntityNotFoundError when center entity does not exist in workspace', async () => {
      await expect(
        graphTraversalService.getNeighborhood({
          workspaceId: wsAlphaId,
          centerEntityId: 'ent_non_existent_123',
          userId: userAlphaId,
        }),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('throws 404 EntityNotFoundError when center entity belongs to another workspace (cross-tenant IDOR protection)', async () => {
      // User Alpha queries Workspace Alpha with entBeta1 (which belongs to Workspace Beta)
      // Must return 404, never leaking the existence of Beta's entity
      await expect(
        graphTraversalService.getNeighborhood({
          workspaceId: wsAlphaId,
          centerEntityId: entBeta1,
          userId: userAlphaId,
        }),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('strictly isolates graphs: traversal in Workspace Alpha never returns Workspace Beta relations', async () => {
      const result = await graphTraversalService.getNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entA,
        query: { depth: 3, limit: 100 },
        userId: userAlphaId,
      });

      for (const node of result.nodes) {
        expect(node.id).not.toBe(entBeta1);
        expect(node.id).not.toBe(entBeta2);
      }
      for (const edge of result.edges) {
        expect(edge.label).not.toBe('BETA_SECRET');
      }
    });
  });

  describe('7. Empty Neighborhood Handling', () => {
    it('handles isolated entity with 0 relations gracefully without errors', async () => {
      const result = await graphTraversalService.getNeighborhood({
        workspaceId: wsAlphaId,
        centerEntityId: entIsolated,
        userId: userAlphaId,
      });

      expect(result.centerEntityId).toBe(entIsolated);
      expect(result.totalNodes).toBe(1);
      expect(result.totalEdges).toBe(0);
      expect(result.edges).toEqual([]);
      expect(result.nodes.length).toBe(1);
      expect(result.nodes[0]).toEqual({
        id: entIsolated,
        label: 'Isolated Entity',
        entityType: 'CONCEPT',
        description: 'Has 0 connections',
        degree: 0,
        depth: 0,
      });
    });
  });

  describe('8. Repository Timeout Propagation (504)', () => {
    it('propagates GraphTraversalTimeoutError (504) thrown by repository', async () => {
      // Mock repository throwing GraphTraversalTimeoutError
      const mockRepo: IGraphRepository = Object.assign(Object.create(graphRepository), {
        findEntityById: async () => ({
          id: entA,
          workspaceId: wsAlphaId,
          canonicalName: 'Mock Entity',
          normalizedName: 'mock-entity',
          entityType: 'CONCEPT' as const,
          description: null,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        traverseNeighborhood: async () => {
          throw new GraphTraversalTimeoutError();
        },
      });

      const customService = new GraphTraversalService(mockRepo);

      await expect(
        customService.getNeighborhood({
          workspaceId: wsAlphaId,
          centerEntityId: entA,
          userId: userAlphaId,
        }),
      ).rejects.toThrow(GraphTraversalTimeoutError);
    });
  });
});
