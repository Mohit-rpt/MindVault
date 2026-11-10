/**
 * MindVault — Phase 6.9: Release Hardening & Verification Test Suite
 *
 * Validates:
 * 1. Security & IDOR: Workspace parameter mismatch prevention (anti-context poisoning).
 * 2. Controller Input Validation: Rejection of malformed/empty entity and relation identifiers.
 * 3. Graph Integrity & Consistency: Automated orphan and unsupported relation detection.
 * 4. Graph Repair: Safe cleanup of orphaned elements without damaging active subgraphs.
 * 5. Extraction Accounting: Strict manifest hashing and finalization receipt invariants.
 * 6. Benchmark Suite: Deterministic 15-scenario knowledge graph evaluation.
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { prisma } from '../../../lib/prisma.js';
import { graphRepository } from '../repositories/graph.repository.js';
import { generateAccessToken } from '../../auth/auth.security.js';
import { graphEvaluationRunner } from '../evaluation/graph.eval.runner.js';
import {
  computeChunkManifestHash,
  validateFinalizationReceipt,
  type ManifestChunkInput,
  type GraphFinalizationReceipt,
} from '@mindvault/shared';

describe('Phase 6.9: Final Graph Hardening & Release Readiness', () => {
  let app: ReturnType<typeof createApp>;

  let wsAlphaId: string;
  let wsBetaId: string;
  let userAlphaId: string;
  let tokenUserAlpha: string;

  let activeEntityId: string;
  let targetEntityId: string;
  let activeRelationId: string;
  let activeChunkId: string;
  let activeDocId: string;

  beforeAll(async () => {
    app = createApp();

    // 1. Create Isolated Workspaces
    const wsA = await prisma.workspace.create({
      data: { name: 'Hardening WS Alpha', slug: `h-alpha-${randomUUID()}` },
    });
    wsAlphaId = wsA.id;

    const wsB = await prisma.workspace.create({
      data: { name: 'Hardening WS Beta', slug: `h-beta-${randomUUID()}` },
    });
    wsBetaId = wsB.id;

    // 2. Create User and Alpha Workspace Membership
    const user = await prisma.user.create({
      data: {
        email: `hardening-user-${randomUUID()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Hardening User',
      },
    });
    userAlphaId = user.id;
    tokenUserAlpha = generateAccessToken({ id: user.id, email: user.email, name: user.name });

    await prisma.workspaceMember.create({
      data: {
        workspaceId: wsAlphaId,
        userId: userAlphaId,
        role: 'MEMBER',
      },
    });

    // 3. Create Valid Connected Subgraph in WS Alpha
    const doc = await prisma.document.create({
      data: {
        workspaceId: wsAlphaId,
        uploadedById: userAlphaId,
        originalName: 'hardening.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(1024),
        checksum: `chk-alpha-hardening-${randomUUID()}`,
        storageKey: `key-alpha-hardening-${randomUUID()}`,
      },
    });
    activeDocId = doc.id;

    const chunk = await prisma.documentChunk.create({
      data: {
        workspaceId: wsAlphaId,
        documentId: doc.id,
        chunkIndex: 0,
        content: 'Alpha Architecture establishes rigorous context assembly and graph verification.',
        tokenCount: 12,
      },
    });
    activeChunkId = chunk.id;

    const ent1 = await prisma.graphEntity.create({
      data: {
        workspaceId: wsAlphaId,
        canonicalName: 'Alpha Architecture',
        normalizedName: 'alpha architecture',
        entityType: 'CONCEPT',
      },
    });
    activeEntityId = ent1.id;

    const ent2 = await prisma.graphEntity.create({
      data: {
        workspaceId: wsAlphaId,
        canonicalName: 'Context Assembly',
        normalizedName: 'context assembly',
        entityType: 'CONCEPT',
      },
    });
    targetEntityId = ent2.id;

    await prisma.chunkEntityMention.create({
      data: {
        workspaceId: wsAlphaId,
        chunkId: chunk.id,
        entityId: ent1.id,
        mentionText: 'Alpha Architecture',
      },
    });

    const rel = await prisma.graphRelation.create({
      data: {
        workspaceId: wsAlphaId,
        sourceEntityId: ent1.id,
        targetEntityId: ent2.id,
        relationType: 'ESTABLISHES',
        weight: 1.0,
      },
    });
    activeRelationId = rel.id;

    await prisma.relationEvidence.create({
      data: {
        workspaceId: wsAlphaId,
        relationId: rel.id,
        chunkId: chunk.id,
        documentId: doc.id,
        evidenceText: 'Alpha Architecture establishes rigorous context assembly.',
      },
    });
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({
      where: { id: { in: [wsAlphaId, wsBetaId] } },
    });
    await prisma.user.deleteMany({
      where: { id: userAlphaId },
    });
  });

  // =========================================================================
  // 1. Security & Anti-Poisoning IDOR Hardening
  // =========================================================================
  describe('Security & Multi-Tenant Isolation', () => {
    it('does not allow forged body workspaceId to escape authorized workspace context', async () => {
      const res = await request(app)
        .post('/api/graph/paths')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('X-Workspace-ID', wsAlphaId)
        .send({
          workspaceId: wsBetaId, // Spoofed body parameter attempting cross-tenant leakage
          sourceEntityId: activeEntityId,
          targetEntityId,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.meta.workspaceId).toBe(wsAlphaId);
      expect(res.body.meta.workspaceId).not.toBe(wsBetaId);
    });

    it('does not allow query workspaceId to override authorized header context', async () => {
      const res = await request(app)
        .get(`/api/graph/entities?workspaceId=${wsBetaId}`)
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('X-Workspace-ID', wsAlphaId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.meta.workspaceId).toBe(wsAlphaId);
      expect(res.body.meta.workspaceId).not.toBe(wsBetaId);
    });

    it('rejects unauthorized access when user attempts to access foreign workspace', async () => {
      const res = await request(app)
        .get('/api/graph/overview')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('X-Workspace-ID', wsBetaId); // User Alpha is NOT a member of Beta

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('WORKSPACE_ACCESS_DENIED');
    });
  });

  // =========================================================================
  // 2. Controller Input Validation
  // =========================================================================
  describe('Input Parameter Validation', () => {
    it('rejects whitespace-only entity ID on /entities/:id with 400', async () => {
      const res = await request(app)
        .get('/api/graph/entities/%20%20')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('X-Workspace-ID', wsAlphaId);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects whitespace-only relation ID on /relations/:id/evidence with 400', async () => {
      const res = await request(app)
        .get('/api/graph/relations/%20%20/evidence')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('X-Workspace-ID', wsAlphaId);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });

    it('rejects whitespace-only entity ID on /entities/:id/neighborhood with 400', async () => {
      const res = await request(app)
        .get('/api/graph/entities/%20%20/neighborhood')
        .set('Authorization', `Bearer ${tokenUserAlpha}`)
        .set('X-Workspace-ID', wsAlphaId);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_GRAPH_QUERY');
    });
  });

  // =========================================================================
  // 3. Graph Integrity & Orphan Detection & Repair
  // =========================================================================
  describe('Graph Integrity, Orphan Detection & Repair', () => {
    let orphanedEntId: string;
    let unsupportedRelId: string;

    beforeAll(async () => {
      // Create an orphaned entity (0 mentions, 0 relations)
      const orphan = await prisma.graphEntity.create({
        data: {
          workspaceId: wsAlphaId,
          canonicalName: 'Orphaned Component',
          normalizedName: 'orphaned component',
          entityType: 'CONCEPT',
        },
      });
      orphanedEntId = orphan.id;

      // Create an unsupported relation (0 evidence rows)
      const unsuppRel = await prisma.graphRelation.create({
        data: {
          workspaceId: wsAlphaId,
          sourceEntityId: activeEntityId,
          targetEntityId: targetEntityId,
          relationType: 'SPECULATIVE_LINK',
          weight: 0.1,
        },
      });
      unsupportedRelId = unsuppRel.id;
    });

    it('accurately identifies orphaned entities and unsupported relations', async () => {
      const report = await graphRepository.checkGraphIntegrity(wsAlphaId);

      expect(report.isHealthy).toBe(false);
      expect(report.orphanedEntities).toContain(orphanedEntId);
      expect(report.unsupportedRelations).toContain(unsupportedRelId);
      expect(report.danglingEvidence).toHaveLength(0);
    });

    it('safely cleans up orphaned elements without affecting connected subgraphs', async () => {
      const cleanup = await graphRepository.cleanupOrphanedGraphElements(wsAlphaId);

      expect(cleanup.deletedRelations).toBeGreaterThanOrEqual(1);
      expect(cleanup.deletedEntities).toBeGreaterThanOrEqual(1);

      // Verify orphaned entity is gone
      const checkOrphan = await prisma.graphEntity.findUnique({
        where: { workspaceId_id: { workspaceId: wsAlphaId, id: orphanedEntId } },
      });
      expect(checkOrphan).toBeNull();

      // Verify unsupported relation is gone
      const checkRel = await prisma.graphRelation.findUnique({
        where: { workspaceId_id: { workspaceId: wsAlphaId, id: unsupportedRelId } },
      });
      expect(checkRel).toBeNull();

      // Verify legitimate active entity & relation remain intact
      const checkActiveEnt = await prisma.graphEntity.findUnique({
        where: { workspaceId_id: { workspaceId: wsAlphaId, id: activeEntityId } },
      });
      expect(checkActiveEnt).not.toBeNull();

      const checkActiveRel = await prisma.graphRelation.findUnique({
        where: { workspaceId_id: { workspaceId: wsAlphaId, id: activeRelationId } },
      });
      expect(checkActiveRel).not.toBeNull();

      // Final integrity re-check should report healthy
      const postReport = await graphRepository.checkGraphIntegrity(wsAlphaId);
      expect(postReport.isHealthy).toBe(true);
      expect(postReport.orphanedEntities).toHaveLength(0);
      expect(postReport.unsupportedRelations).toHaveLength(0);
    });
  });

  // =========================================================================
  // 4. Extraction Accounting Invariants & Manifest Hashing
  // =========================================================================
  describe('Extraction Accounting & Receipts', () => {
    it('produces deterministic chunk manifest hashes regardless of input order', () => {
      const chunks: ManifestChunkInput[] = [
        { chunkIndex: 1, id: 'chunk-1', content: 'Second chunk text' },
        { chunkIndex: 0, id: 'chunk-0', content: 'First chunk text' },
      ];

      const hash1 = computeChunkManifestHash('doc-checksum-123', chunks);
      const hash2 = computeChunkManifestHash('doc-checksum-123', [...chunks].reverse());

      expect(hash1).toBe(hash2);
      expect(typeof hash1).toBe('string');
      expect(hash1.length).toBe(64);
    });

    it('enforces receipt accounting invariants and rejects corrupted receipts', () => {
      const validCompleted: GraphFinalizationReceipt = {
        terminalStatus: 'COMPLETED',
        extractionRunId: 'run-1',
        chunkManifestHash: 'hash-abc',
        completedAt: new Date().toISOString(),
        chunkCount: 3,
        processedChunksCount: 3,
        succeededChunksCount: 3,
        failedChunksCount: 0,
      };

      expect(validateFinalizationReceipt(validCompleted)).toBe(true);

      // Corrupted: succeeded + failed != processed
      const corruptedBalance = {
        ...validCompleted,
        succeededChunksCount: 2,
        failedChunksCount: 0, // Sum = 2, processed = 3
      };
      expect(validateFinalizationReceipt(corruptedBalance)).toBe(false);

      // Inconsistent: COMPLETED status with failedChunksCount > 0
      const corruptedStatus = {
        ...validCompleted,
        succeededChunksCount: 2,
        failedChunksCount: 1,
      };
      expect(validateFinalizationReceipt(corruptedStatus)).toBe(false);
    });
  });

  // =========================================================================
  // 5. Evaluation Benchmark Replay
  // =========================================================================
  describe('Quantitative Evaluation Benchmark Replay', () => {
    it('executes all 15 benchmark scenarios with 100% success rate', async () => {
      const result = await graphEvaluationRunner.runEvaluation();

      expect(result.benchmarkCount).toBe(15);
      expect(result.passedCount).toBe(15);
      expect(result.failedCount).toBe(0);
      expect(result.extractionPrecision).toBe(1.0);
      expect(result.extractionRecall).toBe(1.0);
      expect(result.entityResolutionAccuracy).toBe(1.0);
      expect(result.relationshipEvidenceCoverage).toBe(1.0);
      expect(result.multiHopPathRecall).toBe(1.0);
    });
  });
});
