import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { graphRepository } from '../repositories/graph.repository.js';
import { EntityResolver } from '../resolvers/entity.resolver.js';

describe('Phase 6.1: EntityResolver Integration Tests', () => {
  let wsAlphaId: string;
  let wsBetaId: string;
  let resolver: EntityResolver;

  beforeAll(async () => {
    resolver = new EntityResolver(graphRepository);

    const wsAlpha = await prisma.workspace.create({
      data: {
        name: 'Resolver WS Alpha',
        slug: `resolver-alpha-${Date.now()}`,
      },
    });
    wsAlphaId = wsAlpha.id;

    const wsBeta = await prisma.workspace.create({
      data: {
        name: 'Resolver WS Beta',
        slug: `resolver-beta-${Date.now()}`,
      },
    });
    wsBetaId = wsBeta.id;
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({
      where: { id: { in: [wsAlphaId, wsBetaId] } },
    });
  });

  it('creates a new entity when no match exists in the workspace', async () => {
    const result = await resolver.resolve(wsAlphaId, {
      name: 'PostgreSQL Database',
      entityType: 'TECHNOLOGY',
      description: 'Advanced open-source relational database',
      aliases: ['Postgres', 'PostgresDB'],
      confidence: 0.95,
    });

    expect(result.isNew).toBe(true);
    expect(result.resolvedBy).toBe('CREATED');
    expect(result.entity.canonicalName).toBe('PostgreSQL Database');
    expect(result.entity.normalizedName).toBe('postgresql database');
    expect(result.entity.workspaceId).toBe(wsAlphaId);

    // Verify canonical alias was created automatically
    const canonicalAlias = await prisma.graphEntityAlias.findUnique({
      where: {
        workspaceId_normalizedAlias: {
          workspaceId: wsAlphaId,
          normalizedAlias: 'postgresql database',
        },
      },
    });
    expect(canonicalAlias).not.toBeNull();
    expect(canonicalAlias?.aliasType).toBe('CANONICAL');

    // Verify discovered synonyms were attached
    const synAlias = await prisma.graphEntityAlias.findUnique({
      where: {
        workspaceId_normalizedAlias: {
          workspaceId: wsAlphaId,
          normalizedAlias: 'postgres',
        },
      },
    });
    expect(synAlias).not.toBeNull();
    expect(synAlias?.entityId).toBe(result.entity.id);
  });

  it('resolves by exact canonical name match', async () => {
    // Calling with same name (case-varied)
    const result = await resolver.resolve(wsAlphaId, {
      name: 'postgresql database',
      entityType: 'TECHNOLOGY',
      confidence: 0.9,
      aliases: [],
    });

    expect(result.isNew).toBe(false);
    expect(result.resolvedBy).toBe('CANONICAL_NAME');
    expect(result.entity.canonicalName).toBe('PostgreSQL Database');
  });

  it('resolves by discovered alias match', async () => {
    // Calling with alias 'Postgres'
    const result = await resolver.resolve(wsAlphaId, {
      name: 'Postgres',
      entityType: 'TECHNOLOGY',
      confidence: 0.92,
      aliases: [],
    });

    expect(result.isNew).toBe(false);
    expect(result.resolvedBy).toBe('ALIAS');
    expect(result.entity.canonicalName).toBe('PostgreSQL Database');
  });

  it('STRICTLY enforces workspace isolation (same term in Workspace Beta creates a separate entity)', async () => {
    // In Workspace Beta, 'PostgreSQL Database' does not exist yet
    const resultBeta = await resolver.resolve(wsBetaId, {
      name: 'PostgreSQL Database',
      entityType: 'TECHNOLOGY',
      confidence: 0.95,
      aliases: [],
    });

    expect(resultBeta.isNew).toBe(true);
    expect(resultBeta.resolvedBy).toBe('CREATED');
    expect(resultBeta.entity.workspaceId).toBe(wsBetaId);

    // Verify Alpha and Beta entities have distinct IDs
    const alphaEntity = await prisma.graphEntity.findUnique({
      where: {
        workspaceId_normalizedName: {
          workspaceId: wsAlphaId,
          normalizedName: 'postgresql database',
        },
      },
    });

    expect(alphaEntity).not.toBeNull();
    expect(resultBeta.entity.id).not.toBe(alphaEntity!.id);
  });

  it('handles concurrent resolution collision gracefully without crashing', async () => {
    const term = `concurrency-ent-${Date.now()}`;

    // Simulate two parallel resolvers attempting to resolve the same new entity simultaneously
    const [res1, res2] = await Promise.all([
      resolver.resolve(wsAlphaId, {
        name: term,
        entityType: 'CONCEPT',
        confidence: 0.9,
        aliases: [],
      }),
      resolver.resolve(wsAlphaId, {
        name: term,
        entityType: 'CONCEPT',
        confidence: 0.9,
        aliases: [],
      }),
    ]);

    expect(res1.entity.id).toBe(res2.entity.id);
    expect(res1.entity.normalizedName).toBe(term.toLowerCase());

    const totalInDb = await prisma.graphEntity.count({
      where: {
        workspaceId: wsAlphaId,
        normalizedName: term.toLowerCase(),
      },
    });
    expect(totalInDb).toBe(1);
  });

  it('persists all 9 approved entity types successfully in PostgreSQL', async () => {
    const approvedTypes = [
      'CONCEPT',
      'TECHNOLOGY',
      'ORGANIZATION',
      'PERSON',
      'LOCATION',
      'EVENT',
      'METRIC',
      'PRODUCT',
      'CUSTOM',
    ] as const;

    for (const type of approvedTypes) {
      const termName = `${type} Entity ${Date.now()}`;
      const result = await resolver.resolve(wsAlphaId, {
        name: termName,
        entityType: type,
        confidence: 0.9,
        aliases: [],
      });

      expect(result.isNew).toBe(true);
      expect(result.entity.entityType).toBe(type);

      const inDb = await prisma.graphEntity.findUnique({
        where: {
          workspaceId_id: {
            workspaceId: wsAlphaId,
            id: result.entity.id,
          },
        },
      });
      expect(inDb?.entityType).toBe(type);
    }
  });

  it('maps legacy OTHER entity type deterministically to CUSTOM', async () => {
    const legacyTerm = `Legacy Other Entity ${Date.now()}`;
    const result = await resolver.resolve(wsAlphaId, {
      name: legacyTerm,
      entityType: 'OTHER' as any,
      confidence: 0.85,
      aliases: [],
    });

    expect(result.isNew).toBe(true);
    expect(result.entity.entityType).toBe('CUSTOM');

    const inDb = await prisma.graphEntity.findUnique({
      where: {
        workspaceId_id: {
          workspaceId: wsAlphaId,
          id: result.entity.id,
        },
      },
    });
    expect(inDb?.entityType).toBe('CUSTOM');
  });

  it('rejects arbitrary invalid entity types and NEVER silently defaults to CONCEPT', async () => {
    const invalidTerm = `Invalid Type Entity ${Date.now()}`;

    await expect(
      resolver.resolve(wsAlphaId, {
        name: invalidTerm,
        entityType: 'ANIMAL' as any,
        confidence: 0.85,
        aliases: [],
      }),
    ).rejects.toThrow(/Invalid entity type: "ANIMAL"/);

    // Verify it was NOT saved as CONCEPT
    const inDb = await prisma.graphEntity.findFirst({
      where: {
        workspaceId: wsAlphaId,
        canonicalName: invalidTerm,
      },
    });
    expect(inDb).toBeNull();
  });
});
