import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { prisma } from '../../../lib/prisma.js';
import { graphRepository } from '../repositories/graph.repository.js';
import { generateAccessToken } from '../../auth/auth.security.js';
import { env } from '../../../config/env.js';

describe('Phase 6.5.5: Adversarial, Security & Concurrency Verification', () => {
  let app: ReturnType<typeof createApp>;

  // Workspaces
  let wsAlphaId: string;
  let wsBetaId: string;
  let wsGammaId: string; // Unrelated workspace

  // Users
  let userAlphaId: string;
  let userBetaId: string;
  let userGammaId: string;

  // Tokens
  let tokenUserAlpha: string;
  let tokenUserBeta: string;
  let tokenUserGamma: string;

  // Entities in Alpha
  let entA: string;
  let entB: string;
  let entC: string;
  let entHub: string;
  const hubTargets: string[] = [];

  // Entities in Beta (for IDOR tests)
  let entBeta1: string;
  let entBeta2: string;

  beforeAll(async () => {
    app = createApp();

    // 1. Create Workspaces
    const wsA = await prisma.workspace.create({
      data: { name: 'Adversarial WS Alpha', slug: `adv-alpha-${randomUUID()}` },
    });
    wsAlphaId = wsA.id;

    const wsB = await prisma.workspace.create({
      data: { name: 'Adversarial WS Beta', slug: `adv-beta-${randomUUID()}` },
    });
    wsBetaId = wsB.id;

    const wsG = await prisma.workspace.create({
      data: { name: 'Adversarial WS Gamma', slug: `adv-gamma-${randomUUID()}` },
    });
    wsGammaId = wsG.id;

    // 2. Create Users & Memberships
    const userA = await prisma.user.create({
      data: {
        email: `adv-user-a-${randomUUID()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Adv User Alpha',
      },
    });
    userAlphaId = userA.id;
    tokenUserAlpha = generateAccessToken({ id: userA.id, email: userA.email, name: userA.name });

    const userB = await prisma.user.create({
      data: {
        email: `adv-user-b-${randomUUID()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Adv User Beta',
      },
    });
    userBetaId = userB.id;
    tokenUserBeta = generateAccessToken({ id: userB.id, email: userB.email, name: userB.name });

    const userG = await prisma.user.create({
      data: {
        email: `adv-user-g-${randomUUID()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Adv User Gamma',
      },
    });
    userGammaId = userG.id;
    tokenUserGamma = generateAccessToken({ id: userG.id, email: userG.email, name: userG.name });

    await prisma.workspaceMember.create({
      data: { workspaceId: wsAlphaId, userId: userAlphaId, role: 'MEMBER' },
    });
    await prisma.workspaceMember.create({
      data: { workspaceId: wsBetaId, userId: userBetaId, role: 'MEMBER' },
    });
    await prisma.workspaceMember.create({
      data: { workspaceId: wsGammaId, userId: userGammaId, role: 'MEMBER' },
    });

    // 3. Document & Chunk for Evidence in Alpha
    const doc = await prisma.document.create({
      data: {
        workspaceId: wsAlphaId,
        uploadedById: userAlphaId,
        originalName: 'AdversarialDoc.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(1024),
        checksum: `ck-adv-${randomUUID()}`,
        storageKey: `key-adv-${randomUUID()}`,
      },
    });

    const chunk = await prisma.documentChunk.create({
      data: {
        workspaceId: wsAlphaId,
        documentId: doc.id,
        chunkIndex: 0,
        content: 'Chunk text for adversarial evidence',
        tokenCount: 20,
      },
    });

    // 4. Alpha Topology: Cyclic Triangle (A -> B -> C -> A)
    const eA = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Adv Alpha A',
      normalizedName: `adv-alpha-a-${randomUUID()}`,
      entityType: 'CONCEPT',
    });
    entA = eA.id;

    const eB = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Adv Alpha B',
      normalizedName: `adv-alpha-b-${randomUUID()}`,
      entityType: 'CONCEPT',
    });
    entB = eB.id;

    const eC = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Adv Alpha C',
      normalizedName: `adv-alpha-c-${randomUUID()}`,
      entityType: 'CONCEPT',
    });
    entC = eC.id;

    // Cyclic Relations: A -> B -> C -> A
    const rAB = await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entA,
      targetEntityId: entB,
      relationType: 'LINKS_TO',
      weight: 1.0,
      confidence: 0.95,
    });
    await graphRepository.createEvidence({
      workspaceId: wsAlphaId,
      relationId: rAB.id,
      chunkId: chunk.id,
      documentId: doc.id,
      evidenceText: 'A links to B',
    });

    const rBC = await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entB,
      targetEntityId: entC,
      relationType: 'LINKS_TO',
      weight: 0.9,
      confidence: 0.9,
    });
    await graphRepository.createEvidence({
      workspaceId: wsAlphaId,
      relationId: rBC.id,
      chunkId: chunk.id,
      documentId: doc.id,
      evidenceText: 'B links to C',
    });

    const rCA = await graphRepository.createRelation({
      workspaceId: wsAlphaId,
      sourceEntityId: entC,
      targetEntityId: entA,
      relationType: 'LINKS_TO',
      weight: 0.8,
      confidence: 0.85,
    });
    await graphRepository.createEvidence({
      workspaceId: wsAlphaId,
      relationId: rCA.id,
      chunkId: chunk.id,
      documentId: doc.id,
      evidenceText: 'C links to A (cycle)',
    });

    // 5. High-Degree Hub Node (50 Outgoing Edges) in Alpha
    const eHub = await graphRepository.createEntity({
      workspaceId: wsAlphaId,
      canonicalName: 'Dense Hub Node',
      normalizedName: `adv-hub-${randomUUID()}`,
      entityType: 'CONCEPT',
    });
    entHub = eHub.id;

    for (let i = 0; i < 50; i++) {
      const eTarget = await graphRepository.createEntity({
        workspaceId: wsAlphaId,
        canonicalName: `Hub Spoke ${i}`,
        normalizedName: `adv-spoke-${i}-${randomUUID()}`,
        entityType: 'CONCEPT',
      });
      hubTargets.push(eTarget.id);

      const rHub = await graphRepository.createRelation({
        workspaceId: wsAlphaId,
        sourceEntityId: entHub,
        targetEntityId: eTarget.id,
        relationType: 'SPOKE_OF',
        weight: Number((1.0 - i * 0.01).toFixed(2)),
        confidence: 0.9,
      });

      await graphRepository.createEvidence({
        workspaceId: wsAlphaId,
        relationId: rHub.id,
        chunkId: chunk.id,
        documentId: doc.id,
        evidenceText: `Hub connects to spoke ${i}`,
      });
    }

    // 6. Beta Entities (Isolated Workspace)
    const eBeta1 = await graphRepository.createEntity({
      workspaceId: wsBetaId,
      canonicalName: 'Beta Isolated 1',
      normalizedName: `adv-beta-1-${randomUUID()}`,
      entityType: 'CONCEPT',
    });
    entBeta1 = eBeta1.id;

    const eBeta2 = await graphRepository.createEntity({
      workspaceId: wsBetaId,
      canonicalName: 'Beta Isolated 2',
      normalizedName: `adv-beta-2-${randomUUID()}`,
      entityType: 'CONCEPT',
    });
    entBeta2 = eBeta2.id;

    await graphRepository.createRelation({
      workspaceId: wsBetaId,
      sourceEntityId: entBeta1,
      targetEntityId: entBeta2,
      relationType: 'BETA_SECRET_EDGE',
      weight: 1.0,
      confidence: 1.0,
    });
  });

  afterAll(async () => {
    const wsIds = [wsAlphaId, wsBetaId, wsGammaId].filter(Boolean);
    if (wsIds.length > 0) {
      await prisma.workspace.deleteMany({
        where: { id: { in: wsIds } },
      });
    }
    const userIds = [userAlphaId, userBetaId, userGammaId].filter(Boolean);
    if (userIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }
  });

  // =========================================================================
  // 1. Authentication Bypass & Token Attacks
  // =========================================================================
  describe('1. Authentication Bypass & Token Attacks', () => {
    it('rejects neighborhood request with missing Authorization header (401)', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects path discovery request with missing Authorization header (401)', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('x-workspace-id', wsAlphaId)
        .send({ sourceEntityId: entA, targetEntityId: entB });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects empty Bearer prefix (401)', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood`)
        .set('Authorization', 'Bearer ')
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects malformed token string (401)', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood`)
        .set('Authorization', 'Bearer invalid.token.value')
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });

    it('rejects token signed with an invalid/forged secret key (401)', async () => {
      const forgedToken = jwt.sign(
        { sub: userAlphaId, email: 'fake@mindvault.dev' },
        'wrong-secret-key-attacker',
      );

      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood`)
        .set('Authorization', `Bearer ${forgedToken}`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });

    it('rejects expired JWT token (401)', async () => {
      const expiredToken = jwt.sign(
        { sub: userAlphaId, email: 'expired@mindvault.dev', jti: randomUUID() },
        env.JWT_ACCESS_SECRET,
        { expiresIn: '-1s' },
      );

      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood`)
        .set('Authorization', `Bearer ${expiredToken}`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    });

    it('rejects non-Bearer authentication scheme (Basic Auth) (401)', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood`)
        .set('Authorization', 'Basic dXNlcjpwYXNz')
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  // =========================================================================
  // 2. Workspace Authorization & Multi-Tenant Isolation
  // =========================================================================
  describe('2. Workspace Authorization & Multi-Tenant Isolation', () => {
    it('rejects request with missing workspace ID (400 MISSING_WORKSPACE_ID)', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood`)
        .set('Authorization', `Bearer ${tokenUserAlpha}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('MISSING_WORKSPACE_ID');
    });

    it('denies access when User Alpha attempts to access Workspace Beta (403 WORKSPACE_ACCESS_DENIED)', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entBeta1}/neighborhood`)
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsBetaId);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('WORKSPACE_ACCESS_DENIED');
    });

    it('denies access when User Beta attempts to access Workspace Alpha (403 WORKSPACE_ACCESS_DENIED)', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood`)
        .set('Authorization', `Bearer ${tokenUserBeta}`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('WORKSPACE_ACCESS_DENIED');
    });

    it('denies access when referencing a non-existent workspace ID (403 WORKSPACE_ACCESS_DENIED)', async () => {
      const nonExistentWs = randomUUID();
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood`)
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', nonExistentWs);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('WORKSPACE_ACCESS_DENIED');
    });

    it('does not allow forged body workspaceId in POST /api/graph/paths to access another tenant', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId)
        .send({
          workspaceId: wsBetaId,
          sourceEntityId: entBeta1,
          targetEntityId: entBeta2,
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ENTITY_NOT_FOUND');
    });
  });

  // =========================================================================
  // 3. Cross-Workspace IDOR (Insecure Direct Object Reference)
  // =========================================================================
  describe('3. Cross-Workspace IDOR (Insecure Direct Object Reference)', () => {
    it('returns 404 ENTITY_NOT_FOUND when requesting neighborhood of entity from another workspace', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entBeta1}/neighborhood`)
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ENTITY_NOT_FOUND');
      expect(JSON.stringify(res.body)).not.toContain('Beta Isolated');
    });

    it('returns 404 when pathfinding with source entity in Alpha and target entity in Beta', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entBeta1,
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ENTITY_NOT_FOUND');
      expect(res.body.error.message).toContain(entBeta1);
    });

    it('returns 404 when pathfinding with source entity in Beta and target entity in Alpha', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId)
        .send({
          sourceEntityId: entBeta1,
          targetEntityId: entA,
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ENTITY_NOT_FOUND');
      expect(res.body.error.message).toContain(entBeta1);
    });

    it('returns 404 when pathfinding where both entities belong to Beta from Alpha context', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId)
        .send({
          sourceEntityId: entBeta1,
          targetEntityId: entBeta2,
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ENTITY_NOT_FOUND');
    });

    it('guarantees zero leakage of Beta edges/nodes during exhaustive Alpha neighborhood traversal', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood?depth=3&limit=100`)
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(200);
      const returnedNodeIds = res.body.data.nodes.map((n: { id: string }) => n.id);

      expect(returnedNodeIds).not.toContain(entBeta1);
      expect(returnedNodeIds).not.toContain(entBeta2);
      expect(JSON.stringify(res.body.data)).not.toContain('BETA_SECRET_EDGE');
      expect(JSON.stringify(res.body.data)).not.toContain('Beta Isolated');
    });
  });

  // =========================================================================
  // 4. Adversarial Input & Injection Payloads
  // =========================================================================
  describe('4. Adversarial Input & Injection Payloads', () => {
    it('neutralizes non-UUID / non-existent string in entity URL parameter safely (404 ENTITY_NOT_FOUND)', async () => {
      const res = await request(app)
        .get('/api/graph/entities/not-a-valid-uuid-12345/neighborhood')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ENTITY_NOT_FOUND');
    });

    it('neutralizes SQL injection payload in entity URL parameter safely via parameterized lookup (404 ENTITY_NOT_FOUND)', async () => {
      const payload = encodeURIComponent("' OR '1'='1' --");
      const res = await request(app)
        .get(`/api/graph/entities/${payload}/neighborhood`)
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ENTITY_NOT_FOUND');
    });

    it('rejects SQL injection in sourceEntityId in path finding (400 INVALID_GRAPH_QUERY)', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId)
        .send({
          sourceEntityId: "'; DROP TABLE graph_entities; --",
          targetEntityId: entB,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects SQL injection in targetEntityId in path finding (400 INVALID_GRAPH_QUERY)', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: "d97f262a-0000-0000-0000-000000000000' UNION SELECT * FROM users --",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects SQL injection attempt in depth query parameter (400 INVALID_GRAPH_QUERY)', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood?depth=1;%20DROP%20TABLE%20users;`)
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects invalid/injection value in direction parameter (400 INVALID_GRAPH_QUERY)', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood?direction=OUTGOING'--`)
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects unexpected array types in path discovery body (400 INVALID_GRAPH_QUERY)', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId)
        .send({
          sourceEntityId: [entA, entB],
          targetEntityId: entC,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects numeric types in entity UUID fields (400 INVALID_GRAPH_QUERY)', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId)
        .send({
          sourceEntityId: 123456789,
          targetEntityId: 987654321,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });
  });

  // =========================================================================
  // 5. Parameter Boundaries & Validation Defense
  // =========================================================================
  describe('5. Parameter Boundaries & Validation Defense', () => {
    it('rejects neighborhood depth exceeding ceiling (> 3) with 400', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood?depth=4`)
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects neighborhood depth=99999 with 400', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood?depth=99999`)
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects negative neighborhood depth (< 1) with 400', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood?depth=-1`)
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects floating-point neighborhood depth (depth=1.5) with 400', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood?depth=1.5`)
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects neighborhood limit exceeding maximum (> 100) with 400', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood?limit=101`)
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects neighborhood limit below minimum (< 5) with 400', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood?limit=4`)
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects neighborhood limit=0 with 400', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood?limit=0`)
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects unsupported direction value with 400', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood?direction=unsupported`)
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects path discovery depth exceeding ceiling (> 4) with 400', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entB,
          maxDepth: 5,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects path discovery depth below minimum (< 1) with 400', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entB,
          maxDepth: 0,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects path discovery limit exceeding ceiling (> 10) with 400', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entB,
          limit: 11,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects path discovery limit below minimum (< 1) with 400', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entB,
          limit: 0,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });
  });

  // =========================================================================
  // 6. Graph Topology Extremes (Cycles & High-Degree Hubs)
  // =========================================================================
  describe('6. Graph Topology Extremes (Cycles & High-Degree Hubs)', () => {
    it('safely handles cyclic graph structures (A -> B -> C -> A) without infinite recursion', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entC,
          maxDepth: 4,
          limit: 5,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.paths.length).toBeGreaterThanOrEqual(1);

      // Verify discovered path is valid and cycle-free
      const path1 = res.body.data.paths[0];
      const nodeIds = path1.pathEntities.map((e: { id: string }) => e.id);
      expect(nodeIds).toEqual([entA, entB, entC]);
      expect(path1.depth).toBe(2);

      // Verify no duplicate node occurrence within the path
      const uniqueNodes = new Set(nodeIds);
      expect(uniqueNodes.size).toBe(nodeIds.length);
    });

    it('safely handles identical source and target endpoints without looping', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId)
        .send({
          sourceEntityId: entA,
          targetEntityId: entA,
          maxDepth: 3,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.pathsFound).toBe(0);
      expect(res.body.data.paths).toEqual([]);
      expect(res.body.data.sourceEntityId).toBe(entA);
      expect(res.body.data.targetEntityId).toBe(entA);
    });

    it('enforces intermediate candidate fan-out limit on high-degree hub node (50 outgoing edges)', async () => {
      // Query neighborhood of the dense hub node with requested limit 50
      const res = await request(app)
        .get(`/api/graph/entities/${entHub}/neighborhood?depth=1&limit=50`)
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const { nodes, edges } = res.body.data;

      // Center node must be entHub
      expect(nodes.some((n: { id: string }) => n.id === entHub)).toBe(true);

      // Response must be bounded by limit
      expect(edges.length).toBeLessThanOrEqual(50);
      expect(nodes.length).toBeLessThanOrEqual(51);

      // Hub node degree attribute must reflect its real subgraph degree
      const hubNode = nodes.find((n: { id: string }) => n.id === entHub);
      expect(hubNode.degree).toBe(edges.length);
    });
  });

  // =========================================================================
  // 7. Concurrency & Load Safety
  // =========================================================================
  describe('7. Concurrency & Load Safety', () => {
    it('executes 20 concurrent traversal requests simultaneously without starvation or errors', async () => {
      const requests = Array.from({ length: 20 }, (_, idx) => {
        if (idx % 2 === 0) {
          // Neighborhood request
          return request(app)
            .get(`/api/graph/entities/${entA}/neighborhood?depth=2&limit=25`)
            .set('Authorization', `Bearer ${tokenUserAlpha}`)
            .set('x-workspace-id', wsAlphaId);
        } else {
          // Pathfinding request
          return request(app)
            .post('/api/graph/paths')
            .set('Authorization', `Bearer ${tokenUserAlpha}`)
            .set('x-workspace-id', wsAlphaId)
            .send({
              sourceEntityId: entA,
              targetEntityId: entC,
              maxDepth: 3,
              limit: 5,
            });
        }
      });

      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const totalDuration = Date.now() - startTime;

      // Verify every single concurrent request succeeded
      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeDefined();
      }

      // Total duration for 20 concurrent requests should complete comfortably under 10s
      expect(totalDuration).toBeLessThan(10000);
    });
  });

  // =========================================================================
  // 8. Information Leakage & Error Sanitization
  // =========================================================================
  describe('8. Information Leakage & Error Sanitization', () => {
    it('ensures 401 error response contains zero internal stack traces or database keywords', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entA}/neighborhood`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(401);
      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toContain('stack');
      expect(bodyStr).not.toContain('prisma');
      expect(bodyStr).not.toContain('pg_');
      expect(bodyStr).not.toContain('SELECT');
    });

    it('ensures 403 error response contains zero internal stack traces or database keywords', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${entBeta1}/neighborhood`)
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsBetaId);

      expect(res.status).toBe(403);
      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toContain('stack');
      expect(bodyStr).not.toContain('prisma');
      expect(bodyStr).not.toContain('pg_');
      expect(bodyStr).not.toContain('SELECT');
    });

    it('ensures 404 error response contains zero internal schema or table definitions', async () => {
      const res = await request(app)
        .get(`/api/graph/entities/${randomUUID()}/neighborhood`)
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId);

      expect(res.status).toBe(404);
      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toContain('stack');
      expect(bodyStr).not.toContain('graph_entities');
      expect(bodyStr).not.toContain('graph_relations');
      expect(bodyStr).not.toContain('SELECT');
    });

    it('ensures 400 validation error provides structured issues without exposing server internals', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('x-workspace-id', wsAlphaId)
        .send({
          sourceEntityId: 'invalid-id',
          targetEntityId: 'invalid-target',
          maxDepth: 999,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');

      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toContain('stack');
      expect(bodyStr).not.toContain('prisma');
      expect(bodyStr).not.toContain('postgres');
    });
  });
});
