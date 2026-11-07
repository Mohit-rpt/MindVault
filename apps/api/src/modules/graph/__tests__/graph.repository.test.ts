import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { graphRepository } from '../repositories/graph.repository.js';

describe('GraphRepository (Phase 6.0)', () => {
  let workspaceId: string;
  let userId: string;
  let documentId: string;
  let chunkId: string;

  beforeAll(async () => {
    const ws = await prisma.workspace.create({
      data: { name: 'Repo Test WS', slug: `repo-test-${Date.now()}` },
    });
    workspaceId = ws.id;

    const user = await prisma.user.create({
      data: {
        email: `repo-user-${Date.now()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Repo User',
      },
    });
    userId = user.id;

    const doc = await prisma.document.create({
      data: {
        workspaceId,
        uploadedById: userId,
        originalName: 'RepoDoc.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(512),
        checksum: `ck-${Date.now()}`,
        storageKey: `key-${Date.now()}`,
      },
    });
    documentId = doc.id;

    const chunk = await prisma.documentChunk.create({
      data: {
        documentId,
        workspaceId,
        chunkIndex: 0,
        content: 'Graph repository test chunk content',
        tokenCount: 6,
      },
    });
    chunkId = chunk.id;
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('creates and finds entities by id, canonical name, and alias', async () => {
    // 1. Create entity
    const entity = await graphRepository.createEntity({
      workspaceId,
      canonicalName: 'Vitest Runner',
      normalizedName: 'vitest-runner',
      entityType: 'TECHNOLOGY',
      description: 'A blazing fast test runner powered by Vite',
      metadata: { author: 'Anthony Fu' },
    });
    expect(entity.id).toBeDefined();
    expect(entity.canonicalName).toBe('Vitest Runner');

    // 2. Find by ID
    const foundById = await graphRepository.findEntityById(workspaceId, entity.id);
    expect(foundById).not.toBeNull();
    expect(foundById?.canonicalName).toBe('Vitest Runner');

    // 3. Find by Name
    const foundByName = await graphRepository.findEntityByName(workspaceId, 'vitest-runner');
    expect(foundByName).not.toBeNull();
    expect(foundByName?.id).toBe(entity.id);

    // 4. Create an alias
    const alias = await graphRepository.createAlias({
      workspaceId,
      entityId: entity.id,
      alias: 'vitest',
      normalizedAlias: 'vitest',
      aliasType: 'ACRONYM',
    });
    expect(alias.id).toBeDefined();

    // 5. Find by Alias
    const foundByAlias = await graphRepository.findEntityByAlias(workspaceId, 'vitest');
    expect(foundByAlias).not.toBeNull();
    expect(foundByAlias?.id).toBe(entity.id);
  });

  it('creates relations, mentions, and evidence correctly', async () => {
    const e1 = await graphRepository.createEntity({
      workspaceId,
      canonicalName: 'Fastify',
      normalizedName: 'fastify',
      entityType: 'TECHNOLOGY',
    });

    const e2 = await graphRepository.createEntity({
      workspaceId,
      canonicalName: 'Node',
      normalizedName: 'node',
      entityType: 'TECHNOLOGY',
    });

    // Relation
    const relation = await graphRepository.createRelation({
      workspaceId,
      sourceEntityId: e1.id,
      targetEntityId: e2.id,
      relationType: 'RUNS_ON',
      weight: 1.0,
      confidence: 0.98,
    });
    expect(relation.id).toBeDefined();

    // Mention
    const mention = await graphRepository.createMention({
      workspaceId,
      chunkId,
      entityId: e1.id,
      mentionText: 'Fastify framework',
      startOffset: 0,
      endOffset: 17,
      confidence: 0.99,
    });
    expect(mention.id).toBeDefined();

    // Evidence
    const evidence = await graphRepository.createEvidence({
      workspaceId,
      relationId: relation.id,
      chunkId,
      documentId,
      evidenceText: 'Fastify runs on Node.js',
      confidence: 0.95,
    });
    expect(evidence.id).toBeDefined();

    // Find relations
    const relations = await graphRepository.findRelations(workspaceId, e1.id);
    expect(relations.length).toBe(1);
    expect(relations[0].relationType).toBe('RUNS_ON');
  });

  it('deletes entity and cascades to aliases and relations', async () => {
    const e = await graphRepository.createEntity({
      workspaceId,
      canonicalName: 'Temporary Entity',
      normalizedName: 'temp-entity',
    });

    const deleted = await graphRepository.deleteEntity(workspaceId, e.id);
    expect(deleted).toBe(true);

    const found = await graphRepository.findEntityById(workspaceId, e.id);
    expect(found).toBeNull();
  });
});
