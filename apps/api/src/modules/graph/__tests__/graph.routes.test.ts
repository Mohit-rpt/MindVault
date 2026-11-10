import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { prisma } from '../../../lib/prisma.js';
import { graphRepository } from '../repositories/graph.repository.js';
import { generateAccessToken } from '../../auth/auth.security.js';
import { GraphTraversalService } from '../services/graph-traversal.service.js';
import { GraphController } from '../controllers/graph.controller.js';
import { createGraphRouter } from '../routes/graph.routes.js';
import { GraphTraversalTimeoutError } from '../errors/graph-traversal.error.js';
import type { IGraphRepository } from '../repositories/graph.repository.interface.js';
import express from 'express';
import { errorHandler } from '../../../middleware/errorHandler.js';

describe('Task 6.5.4: Graph API Routes & Controller Integration Tests', () => {
  let app: ReturnType<typeof createApp>;

  let wsAlphaId: string;
  let wsBetaId: string;
  let userAlphaId: string;
  let userBetaId: string;

  let tokenUserA: string;
  let tokenUserB: string;

  // Alpha Entities
  let entA: string;
  let entB: string;
  let entB2: string; // Diamond branch: A -> B2 -> C
  let entC: string;
  let entD: string;
  let entE: string;
  let entF: string; // 5 hops away from A
  let entIsolated: string;

  // Beta Entities (for IDOR and isolation tests)
  let entBeta1: string;
  let entBeta2: string;

  beforeAll(async () => {
    app = createApp();

    // 1. Create Isolated Workspaces
    const wsA = await prisma.workspace.create({
      data: { name: 'Route WS Alpha', slug: `route-alpha-${randomUUID()}` },
    });
    wsAlphaId = wsA.id;

    const wsB = await prisma.workspace.create({
      data: { name: 'Route WS Beta', slug: `route-beta-${randomUUID()}` },
    });
    wsBetaId = wsB.id;

    // 2. Create Users & Membership
    const userA = await prisma.user.create({
      data: {
        email: `route-user-alpha-${randomUUID()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Route User Alpha',
      },
    });
    userAlphaId = userA.id;
    tokenUserA = generateAccessToken({ id: userA.id, email: userA.email, name: userA.name });

    const userB = await prisma.user.create({
      data: {
        email: `route-user-beta-${randomUUID()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Route User Beta',
      },
    });
    userBetaId = userB.id;
    tokenUserB = generateAccessToken({ id: userB.id, email: userB.email, name: userB.name });

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
        originalName: 'RouteTestDoc.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(2048),
        checksum: `ck-route-${randomUUID()}`,
        storageKey: `key-route-${randomUUID()}`,
      },
    });

    const chunk = await prisma.documentChunk.create({
      data: {
        documentId: doc.id,
        workspaceId: wsAlphaId,
        chunkIndex: 0,
        content: 'Route integration test passage',
        tokenCount: 10,
      },
    });

    // 4. Alpha Entities
    const eA = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Central Node A',
      normalizedName: `central-node-a-${randomUUID()}`,
      entityType: 'CONCEPT',
      description: 'Center entity A',
    });
    entA = eA.id;

    const eB = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node B',
      normalizedName: `node-b-${randomUUID()}`,
      entityType: 'TECHNOLOGY',
      description: 'Hop 1 entity B',
    });
    entB = eB.id;

    const eB2 = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node B2',
      normalizedName: `node-b2-${randomUUID()}`,
      entityType: 'TECHNOLOGY',
      description: 'Alternative branch entity B2',
    });
    entB2 = eB2.id;

    const eC = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node C',
      normalizedName: `node-c-${randomUUID()}`,
      entityType: 'PRODUCT',
      description: 'Hop 2 entity C',
    });
    entC = eC.id;

    const eD = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node D',
      normalizedName: `node-d-${randomUUID()}`,
      entityType: 'ORGANIZATION',
      description: 'Hop 3 entity D',
    });
    entD = eD.id;

    const eE = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node E',
      normalizedName: `node-e-${randomUUID()}`,
      entityType: 'LOCATION',
      description: 'Hop 4 entity E',
    });
    entE = eE.id;

    const eF = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Node F',
      normalizedName: `node-f-${randomUUID()}`,
      entityType: 'CONCEPT',
      description: 'Hop 5 entity F (unreachable)',
    });
    entF = eF.id;

    const eIso = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Isolated Entity',
      normalizedName: `isolated-${randomUUID()}`,
      entityType: 'CONCEPT',
      description: 'Isolated entity without relations',
    });
    entIsolated = eIso.id;

    // 5. Beta Entities (Cross-tenant)
    const eBeta1 = await graphRepository.createEntity({
      workspaceId: wsBetaId,
      canonicalName: 'Beta Entity 1',
      normalizedName: `beta-1-${randomUUID()}`,
      entityType: 'CONCEPT',
      description: 'Beta secret entity 1',
    });
    entBeta1 = eBeta1.id;

    const eBeta2 = await graphRepository.createEntity({
      workspaceId: wsBetaId,
      canonicalName: 'Beta Entity 2',
      normalizedName: `beta-2-${randomUUID()}`,
      entityType: 'CONCEPT',
      description: 'Beta secret entity 2',
    });
    entBeta2 = eBeta2.id;

    // 6. Alpha Relations
    // A -> B
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
      chunkId: chunk.id,
      documentId: doc.id,
      evidenceText: 'Evidence linking A and B',
    });

    // B -> C
    await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entB,
      targetEntityId: entC,
      relationType: 'DEPENDS_ON',
      weight: 0.9,
      confidence: 0.9,
      description: 'B depends on C',
    });

    // A -> B2 -> C (Diamond alternative)
    await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entA,
      targetEntityId: entB2,
      relationType: 'LINKS_TO',
      weight: 0.95,
      confidence: 0.85,
      description: 'A links to B2',
    });

    await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entB2,
      targetEntityId: entC,
      relationType: 'SUPPORTS',
      weight: 0.85,
      confidence: 0.88,
      description: 'B2 supports C',
    });

    // C -> D
    await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entC,
      targetEntityId: entD,
      relationType: 'USES',
      weight: 0.8,
      confidence: 0.85,
      description: 'C uses D',
    });

    // D -> E
    await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entD,
      targetEntityId: entE,
      relationType: 'ENABLES',
      weight: 0.7,
      confidence: 0.8,
      description: 'D enables E',
    });

    // E -> F
    await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entE,
      targetEntityId: entF,
      relationType: 'PRODUCES',
      weight: 0.6,
      confidence: 0.75,
      description: 'E produces F',
    });

    // Cycle: C -> A
    await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entC,
      targetEntityId: entA,
      relationType: 'REFERENCES',
      weight: 0.5,
      confidence: 0.5,
      description: 'C references A',
    });

    // Beta Relation
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
  // 1. Neighborhood Traversal Endpoint: GET /api/graph/entities/:id/neighborhood
  // =========================================================================
  describe('1. GET /api/graph/entities/:id/neighborhood', () => {
    it('returns 200 OK with canonical envelope and default parameters (depth=1, limit=30, direction=both)', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.workspaceId).toBe(wsAlphaId);
      expect(res.body.meta.timestamp).toBeDefined();

      const data = res.body.data;
      expect(data.centerEntityId).toBe(entA);
      expect(data.depth).toBe(1);
      expect(data.totalNodes).toBeGreaterThanOrEqual(2);
      expect(data.totalEdges).toBeGreaterThanOrEqual(1);

      // Center entity at depth 0
      const centerNode = data.nodes.find((n: any) => n.id === entA);
      expect(centerNode).toBeDefined();
      expect(centerNode.depth).toBe(0);
      expect(centerNode.label).toBe('Central Node A');

      // Edge verification
      const edgeAB = data.edges.find((e: any) => e.source === entA && e.target === entB);
      expect(edgeAB).toBeDefined();
      expect(edgeAB.label).toBe('CONNECTS_TO');
      expect(edgeAB.evidenceCount).toBe(1);
    });

    it('respects custom query parameters: depth=2, limit=10, direction=outgoing', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood?depth=2&limit=10&direction=outgoing`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId);

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.depth).toBe(2);
      // At depth 2, Node C must be included via A -> B -> C or A -> B2 -> C
      expect(data.nodes.some((n: any) => n.id === entC)).toBe(true);
      // All edges must be directed outgoing from traversal paths
      expect(data.edges.length).toBeLessThanOrEqual(10);
    });

    it('handles isolated entity with zero relations returning 200 OK with totalNodes=1, totalEdges=0', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entIsolated}/neighborhood`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId);

      expect(res.status).toBe(200);
      expect(res.body.data.centerEntityId).toBe(entIsolated);
      expect(res.body.data.totalNodes).toBe(1);
      expect(res.body.data.totalEdges).toBe(0);
      expect(res.body.data.edges).toEqual([]);
      expect(res.body.data.nodes[0].id).toBe(entIsolated);
      expect(res.body.data.nodes[0].degree).toBe(0);
    });

    it('rejects invalid depth parameter (depth=0) with 400 INVALID_GRAPH_QUERY', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood?depth=0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects invalid depth parameter (depth=4) with 400 INVALID_GRAPH_QUERY', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood?depth=4`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects invalid limit parameter (limit=4) with 400 INVALID_GRAPH_QUERY', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood?limit=4`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects invalid limit parameter (limit=101) with 400 INVALID_GRAPH_QUERY', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood?limit=101`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects invalid direction parameter (direction=sideways) with 400 INVALID_GRAPH_QUERY', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood?direction=sideways`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('returns 400 MISSING_WORKSPACE_ID when no workspace ID is provided in request', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('MISSING_WORKSPACE_ID');
    });

    it('returns 401 UNAUTHORIZED when no authorization token is provided', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood`)
        .set('X-Workspace-ID', wsAlphaId);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 WORKSPACE_ACCESS_DENIED when User B queries Workspace Alpha without membership', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood`)
        .set('Authorization', `Bearer ${tokenUserB}`) // User B
        .set('X-Workspace-ID', wsAlphaId); // Workspace Alpha

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('WORKSPACE_ACCESS_DENIED');
    });

    it('returns 404 ENTITY_NOT_FOUND when center entity does not exist in workspace', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${randomUUID()}/neighborhood`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ENTITY_NOT_FOUND');
    });

    it('returns 404 ENTITY_NOT_FOUND on cross-workspace IDOR attempt (querying Beta entity from Alpha)', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entBeta1}/neighborhood`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ENTITY_NOT_FOUND');
    });
  });

  // =========================================================================
  // 2. Directed Path Discovery Endpoint: POST /api/graph/paths
  // =========================================================================
  describe('2. POST /api/graph/paths', () => {
    it('returns 200 OK with canonical GraphPathDto for 1-hop path', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entB,
          maxDepth: 1,
          limit: 5,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.meta.workspaceId).toBe(wsAlphaId);

      const data = res.body.data;
      expect(data.sourceEntityId).toBe(entA);
      expect(data.targetEntityId).toBe(entB);
      expect(data.pathsFound).toBe(1);
      expect(data.paths).toHaveLength(1);

      const p = data.paths[0];
      expect(p.depth).toBe(1);
      expect(p.pathEntities).toHaveLength(2);
      expect(p.pathEntities[0]).toEqual({ id: entA, name: 'Central Node A' });
      expect(p.pathEntities[1]).toEqual({ id: entB, name: 'Node B' });
      expect(p.pathRelations[0].type).toBe('CONNECTS_TO');
    });

    it('returns 200 OK discovering multi-hop paths (A -> C via 2 hops; A -> D via 3 hops)', async () => {
      // 2-hop to C
      const resC = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entC,
          maxDepth: 2,
          limit: 5,
        });

      expect(resC.status).toBe(200);
      expect(resC.body.data.pathsFound).toBeGreaterThanOrEqual(1);
      expect(resC.body.data.paths[0].depth).toBe(2);

      // 3-hop to D
      const resD = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entD,
          maxDepth: 3,
          limit: 5,
        });

      expect(resD.status).toBe(200);
      expect(resD.body.data.pathsFound).toBeGreaterThanOrEqual(1);
      expect(resD.body.data.paths[0].depth).toBe(3);
    });

    it('ranks multiple paths deterministically by depth, confidence, and weight', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entC,
          maxDepth: 2,
          limit: 5,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.pathsFound).toBe(2);
      // Path 0 must have higher confidence or weight than Path 1
      expect(res.body.data.paths[0].confidence).toBeGreaterThanOrEqual(
        res.body.data.paths[1].confidence,
      );
    });

    it('respects limit parameter truncating alternative paths', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entC,
          maxDepth: 2,
          limit: 1,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.pathsFound).toBe(1);
      expect(res.body.data.paths).toHaveLength(1);
    });

    it('handles identical source and target entities (A -> A) returning pathsFound=0, paths=[]', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entA,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.pathsFound).toBe(0);
      expect(res.body.data.paths).toEqual([]);
    });

    it('returns empty paths array when no path exists between disconnected entities', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId)
        .send({
          sourceEntityId: entF,
          targetEntityId: entA,
          maxDepth: 4,
          limit: 5,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.pathsFound).toBe(0);
      expect(res.body.data.paths).toEqual([]);
    });

    it('rejects non-UUID sourceEntityId with 400 INVALID_GRAPH_QUERY', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId)
        .send({
          sourceEntityId: 'not-a-uuid',
          targetEntityId: entB,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects non-UUID targetEntityId with 400 INVALID_GRAPH_QUERY', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: 'not-a-uuid',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects maxDepth < 1 with 400 INVALID_GRAPH_QUERY', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entB,
          maxDepth: 0,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects maxDepth > 4 with 400 INVALID_GRAPH_QUERY', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entB,
          maxDepth: 5,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects limit < 1 with 400 INVALID_GRAPH_QUERY', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entB,
          limit: 0,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects limit > 10 with 400 INVALID_GRAPH_QUERY', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entB,
          limit: 11,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('returns 400 MISSING_WORKSPACE_ID when no workspace ID is supplied in headers, query, or body', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          sourceEntityId: entA,
          targetEntityId: entB,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('MISSING_WORKSPACE_ID');
    });

    it('returns 401 UNAUTHORIZED when no authorization token is provided', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('X-Workspace-ID', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entB,
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 WORKSPACE_ACCESS_DENIED when User B requests Workspace Alpha paths', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .set('X-Workspace-ID', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entB,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('WORKSPACE_ACCESS_DENIED');
    });

    it('returns 404 ENTITY_NOT_FOUND when source entity does not exist', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId)
        .send({
          sourceEntityId: randomUUID(),
          targetEntityId: entB,
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ENTITY_NOT_FOUND');
    });

    it('returns 404 ENTITY_NOT_FOUND when target entity does not exist', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: randomUUID(),
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ENTITY_NOT_FOUND');
    });

    it('returns 404 ENTITY_NOT_FOUND on cross-workspace IDOR (User Alpha querying Beta entity)', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entBeta1,
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ENTITY_NOT_FOUND');
    });
  });

  // =========================================================================
  // 3. Statement Timeout & Error Mapping (504 GRAPH_TRAVERSAL_TIMEOUT)
  // =========================================================================
  describe('3. Statement Timeout & Error Mapping (504 GRAPH_TRAVERSAL_TIMEOUT)', () => {
    it('maps repository timeout to 504 GRAPH_TRAVERSAL_TIMEOUT without leaking database internals', async () => {
      // Create a test app with a mock traversal service that throws GraphTraversalTimeoutError
      const mockRepo: IGraphRepository = Object.assign(Object.create(graphRepository), {
        findEntityById: async () => ({
          id: entA,
          workspaceId: wsAlphaId,
          canonicalName: 'Node A',
          normalizedName: 'node-a',
          entityType: 'CONCEPT' as const,
          description: null,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        traverseNeighborhood: async () => {
          throw new GraphTraversalTimeoutError();
        },
        findPaths: async () => {
          throw new GraphTraversalTimeoutError();
        },
      });

      const timeoutService = new GraphTraversalService(mockRepo);
      const timeoutController = new GraphController(timeoutService);
      const testApp = express();
      testApp.use(express.json());
      testApp.use('/api/graph', createGraphRouter(timeoutController));
      testApp.use(errorHandler);

      // 1. Neighborhood Timeout
      const resNeigh = await request(testApp)
        .get(`/api/graph/entities/${entA}/neighborhood`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId);

      expect(resNeigh.status).toBe(504);
      expect(resNeigh.body.success).toBe(false);
      expect(resNeigh.body.error.code).toBe('GRAPH_TRAVERSAL_TIMEOUT');
      expect(resNeigh.body.error.message).toContain('2500ms safety timeout');
      expect(resNeigh.body.error.stack).toBeUndefined(); // Does not leak raw DB stack in production format

      // 2. Paths Timeout
      const resPath = await request(testApp)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entB,
        });

      expect(resPath.status).toBe(504);
      expect(resPath.body.success).toBe(false);
      expect(resPath.body.error.code).toBe('GRAPH_TRAVERSAL_TIMEOUT');
    });
  });

  // =========================================================================
  // 4. Phase 6.8 Graph Explorer Routes
  // =========================================================================
  describe('4. Phase 6.8 Graph Explorer Routes', () => {
    it('GET /api/graph/entities returns paginated workspace entity list with 200 OK', async () => {
      const res = await request(app)
        .get('/api/graph/entities?limit=10&offset=0')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.total).toBeGreaterThanOrEqual(1);
      expect(res.body.meta.workspaceId).toBe(wsAlphaId);
    });

    it('GET /api/graph/entities/:id returns entity detail with 200 OK', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(entA);
      expect(res.body.data.canonicalName).toBe('Central Node A');
      expect(Array.isArray(res.body.data.aliases)).toBe(true);
      expect(typeof res.body.data.totalDegree).toBe('number');
    });

    it('GET /api/graph/entities/:id returns 404 on cross-workspace IDOR', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entBeta1}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ENTITY_NOT_FOUND');
    });

    it('GET /api/graph/overview returns workspace graph stats with 200 OK', async () => {
      const res = await request(app)
        .get('/api/graph/overview')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('X-Workspace-ID', wsAlphaId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalEntities).toBeGreaterThanOrEqual(1);
      expect(typeof res.body.data.totalRelations).toBe('number');
      expect(typeof res.body.data.entityTypeBreakdown).toBe('object');
      expect(Array.isArray(res.body.data.topConnectedEntities)).toBe(true);
    });
  });
});
