/**
 * MindVault — Graph Evaluation & Explorer Integration Test Suite (Phase 6.8)
 *
 * Verifies:
 * 1. Benchmark evaluation runner on 15 multi-hop scenarios
 * 2. Precision, recall, and evidence provenance metrics
 * 3. Explorer endpoints: entity directory, entity detail, relation evidence, graph overview
 * 4. Multi-tenant workspace isolation and adversarial resistance
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../lib/prisma.js';
import { graphRepository } from '../repositories/graph.repository.js';
import { graphTraversalService } from '../services/graph-traversal.service.js';
import { GraphEvaluationRunner } from '../evaluation/graph.eval.runner.js';
import { GRAPH_EVAL_DATASET } from '../evaluation/graph.eval.dataset.js';

describe('Phase 6.8: Graph Explorer & Evaluation Suite', () => {
  let wsId: string;
  let otherWsId: string;
  let docId: string;
  let chunkId: string;
  let entPostgresId: string;
  let entWalId: string;
  let relId: string;

  beforeAll(async () => {
    // 1. Setup isolated workspaces
    const ws = await prisma.workspace.create({
      data: { name: 'Graph Explorer WS', slug: `graph-exp-${randomUUID()}` },
    });
    wsId = ws.id;

    const otherWs = await prisma.workspace.create({
      data: { name: 'Other WS', slug: `other-ws-${randomUUID()}` },
    });
    otherWsId = otherWs.id;

    const user = await prisma.user.create({
      data: {
        email: `graph-eval-user-${randomUUID()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Graph Eval User',
      },
    });

    // 2. Setup document and chunk
    const doc = await prisma.document.create({
      data: {
        workspaceId: wsId,
        uploadedById: user.id,
        originalName: 'PostgresArchitecture.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(4096),
        checksum: `ck-eval-${randomUUID()}`,
        storageKey: `key-eval-${randomUUID()}`,
      },
    });
    docId = doc.id;

    const chunk = await prisma.documentChunk.create({
      data: {
        workspaceId: wsId,
        documentId: docId,
        chunkIndex: 0,
        content:
          'PostgreSQL implements write-ahead logging (WAL) for fault tolerance and crash recovery.',
        tokenCount: 16,
        pageStart: 1,
        pageEnd: 2,
      },
    });
    chunkId = chunk.id;

    // 3. Create Entities
    const ent1 = await graphRepository.createEntity({
      workspaceId: wsId,
      canonicalName: 'PostgreSQL',
      normalizedName: 'postgresql',
      entityType: 'TECHNOLOGY',
      description: 'Open-source relational database management system',
    });
    entPostgresId = ent1.id;

    await graphRepository.createAlias({
      workspaceId: wsId,
      entityId: entPostgresId,
      alias: 'Postgres',
      normalizedAlias: 'postgres',
      aliasType: 'ACRONYM',
    });

    const ent2 = await graphRepository.createEntity({
      workspaceId: wsId,
      canonicalName: 'Write-Ahead Logging',
      normalizedName: 'write-ahead logging',
      entityType: 'CONCEPT',
      description: 'Transaction log mechanism',
    });
    entWalId = ent2.id;

    // 4. Create Relation & Evidence
    const rel = await graphRepository.createRelation({
      workspaceId: wsId,
      sourceEntityId: entPostgresId,
      targetEntityId: entWalId,
      relationType: 'IMPLEMENTS',
      confidence: 0.95,
      weight: 1.0,
      description: 'PostgreSQL implements write-ahead logging for ACID persistence',
    });
    relId = rel.id;

    await graphRepository.createEvidence({
      workspaceId: wsId,
      relationId: relId,
      chunkId,
      documentId: docId,
      evidenceText: 'PostgreSQL implements write-ahead logging (WAL)',
      confidence: 0.95,
    });

    await graphRepository.createMention({
      workspaceId: wsId,
      chunkId,
      entityId: entPostgresId,
      mentionText: 'PostgreSQL',
      startOffset: 0,
      endOffset: 10,
    });

    await graphRepository.createMention({
      workspaceId: wsId,
      chunkId,
      entityId: entWalId,
      mentionText: 'write-ahead logging',
      startOffset: 22,
      endOffset: 41,
    });
  });

  // ---------------------------------------------------------------------------
  // Part 1: Benchmark Runner
  // ---------------------------------------------------------------------------
  describe('Benchmark Runner & Multi-Hop Dataset Evaluation', () => {
    it('evaluates all 15 benchmark scenarios deterministically', async () => {
      const runner = new GraphEvaluationRunner(graphRepository);
      const metrics = await runner.runEvaluation(GRAPH_EVAL_DATASET, wsId);

      expect(metrics.benchmarkCount).toBe(15);
      expect(metrics.passedCount).toBe(15);
      expect(metrics.failedCount).toBe(0);

      expect(metrics.extractionPrecision).toBeGreaterThanOrEqual(0.85);
      expect(metrics.extractionRecall).toBeGreaterThanOrEqual(0.85);
      expect(metrics.entityResolutionAccuracy).toBeGreaterThanOrEqual(0.85);
      expect(metrics.relationshipEvidenceCoverage).toBeGreaterThanOrEqual(0.85);
      expect(metrics.multiHopPathRecall).toBeGreaterThanOrEqual(0.85);

      expect(metrics.durationMs).toBeGreaterThanOrEqual(0);
      expect(metrics.details.length).toBe(15);
    });

    it('covers all five benchmark categories in the dataset', () => {
      const categories = new Set(GRAPH_EVAL_DATASET.map((item) => item.type));
      expect(categories.has('entity_resolution')).toBe(true);
      expect(categories.has('multi_hop_traversal')).toBe(true);
      expect(categories.has('cross_document_relation')).toBe(true);
      expect(categories.has('evidence_provenance')).toBe(true);
      expect(categories.has('adversarial_injection')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Part 2: Graph Explorer Backend Repository Methods
  // ---------------------------------------------------------------------------
  describe('Graph Explorer Backend Methods', () => {
    it('lists workspace entities with pagination and aggregate counts', async () => {
      const result = await graphRepository.listEntities(wsId, {
        limit: 10,
        offset: 0,
      });

      expect(result.total).toBeGreaterThanOrEqual(2);
      expect(result.items.length).toBeGreaterThanOrEqual(2);
      const postgresItem = result.items.find((i) => i.id === entPostgresId);
      expect(postgresItem).toBeDefined();
      expect(postgresItem?.canonicalName).toBe('PostgreSQL');
      expect(postgresItem?.degree).toBeGreaterThanOrEqual(1);
      expect(postgresItem?.aliases).toContain('Postgres');
    });

    it('filters entity directory by search keyword', async () => {
      const result = await graphRepository.listEntities(wsId, {
        search: 'Postgres',
        limit: 10,
        offset: 0,
      });

      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items.some((i) => i.id === entPostgresId)).toBe(true);
    });

    it('filters entity directory by entityType', async () => {
      const techResult = await graphRepository.listEntities(wsId, {
        entityType: 'TECHNOLOGY',
      });
      expect(techResult.items.some((i) => i.canonicalName === 'PostgreSQL')).toBe(true);

      const personResult = await graphRepository.listEntities(wsId, {
        entityType: 'PERSON',
      });
      expect(personResult.items.some((i) => i.canonicalName === 'PostgreSQL')).toBe(false);
    });

    it('retrieves detailed entity inspection with document references', async () => {
      const detail = await graphRepository.getEntityDetail(wsId, entPostgresId);

      expect(detail).not.toBeNull();
      expect(detail?.canonicalName).toBe('PostgreSQL');
      expect(detail?.aliases).toContain('Postgres');
      expect(detail?.outDegree).toBeGreaterThanOrEqual(1);
      expect(detail?.totalDegree).toBeGreaterThanOrEqual(1);
      expect(detail?.documentReferences.length).toBeGreaterThanOrEqual(1);
      expect(detail?.documentReferences[0]?.documentName).toBe('PostgresArchitecture.pdf');
    });

    it('retrieves verified evidence chunks for a relationship', async () => {
      const evidenceDetail = await graphRepository.getRelationEvidenceDetail(wsId, relId);

      expect(evidenceDetail).not.toBeNull();
      expect(evidenceDetail?.relationType).toBe('IMPLEMENTS');
      expect(evidenceDetail?.sourceEntity.canonicalName).toBe('PostgreSQL');
      expect(evidenceDetail?.targetEntity.canonicalName).toBe('Write-Ahead Logging');
      expect(evidenceDetail?.evidence.length).toBeGreaterThanOrEqual(1);
      expect(evidenceDetail?.evidence[0]?.documentName).toBe('PostgresArchitecture.pdf');
      expect(evidenceDetail?.evidence[0]?.pageStart).toBe(1);
      expect(evidenceDetail?.evidence[0]?.pageEnd).toBe(2);
      expect(evidenceDetail?.evidence[0]?.snippet).toContain(
        'PostgreSQL implements write-ahead logging',
      );
    });

    it('retrieves workspace-scoped graph overview statistics', async () => {
      const overview = await graphRepository.getGraphOverview(wsId);

      expect(overview.totalEntities).toBeGreaterThanOrEqual(2);
      expect(overview.totalRelations).toBeGreaterThanOrEqual(1);
      expect(overview.entityTypeBreakdown['TECHNOLOGY']).toBeGreaterThanOrEqual(1);
      expect(overview.entityTypeBreakdown['CONCEPT']).toBeGreaterThanOrEqual(1);
      expect(overview.topConnectedEntities.length).toBeGreaterThanOrEqual(1);
      expect(overview.topConnectedEntities[0]?.canonicalName).toBe('PostgreSQL');
    });

    it('enforces multi-tenant isolation (foreign workspace returns zero entities)', async () => {
      const otherResult = await graphRepository.listEntities(otherWsId, { limit: 10 });
      expect(otherResult.total).toBe(0);
      expect(otherResult.items.length).toBe(0);

      const foreignEntity = await graphRepository.getEntityDetail(otherWsId, entPostgresId);
      expect(foreignEntity).toBeNull();

      const foreignEvidence = await graphRepository.getRelationEvidenceDetail(otherWsId, relId);
      expect(foreignEvidence).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Part 3: Service-Level Validation & Error Handling
  // ---------------------------------------------------------------------------
  describe('Graph Traversal Service Explorer Integration', () => {
    it('throws EntityNotFoundError when entity does not exist', async () => {
      await expect(
        graphTraversalService.getEntityDetail({
          workspaceId: wsId,
          entityId: randomUUID(),
        }),
      ).rejects.toThrow();
    });

    it('throws RelationNotFoundError when relation does not exist', async () => {
      await expect(
        graphTraversalService.getRelationEvidence({
          workspaceId: wsId,
          relationId: randomUUID(),
        }),
      ).rejects.toThrow();
    });

    it('throws ForbiddenWorkspaceError on non-existent workspace', async () => {
      await expect(
        graphTraversalService.getOverview({
          workspaceId: randomUUID(),
        }),
      ).rejects.toThrow();
    });
  });
});
