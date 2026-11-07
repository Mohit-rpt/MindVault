import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { graphRepository } from '../repositories/graph.repository.js';
import { EntityResolver } from '../resolvers/entity.resolver.js';

describe('Phase 6.2: Entity Resolution & Knowledge Extraction Hardening Tests', () => {
  let wsId: string;
  let resolver: EntityResolver;

  beforeAll(async () => {
    resolver = new EntityResolver(graphRepository);

    const ws = await prisma.workspace.create({
      data: {
        name: 'Hardening Workspace',
        slug: `hardening-ws-${Date.now()}`,
      },
    });
    wsId = ws.id;
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({
      where: { id: wsId },
    });
  });

  describe('1. Normalization & Disambiguation Hardening', () => {
    it('resolves parenthetical acronyms into canonical stem and registers alias', async () => {
      const result = await resolver.resolve(wsId, {
        name: 'Amazon Web Services (AWS)',
        entityType: 'ORGANIZATION',
        description: 'Cloud computing platform by Amazon',
        aliases: [],
        confidence: 0.95,
      });

      expect(result.isNew).toBe(true);
      expect(result.entity.canonicalName).toBe('Amazon Web Services');
      expect(result.entity.normalizedName).toBe('amazon web services');

      // Verify that 'aws' was automatically registered as a synonym alias
      const aliasRecord = await prisma.graphEntityAlias.findUnique({
        where: {
          workspaceId_normalizedAlias: {
            workspaceId: wsId,
            normalizedAlias: 'aws',
          },
        },
      });
      expect(aliasRecord).not.toBeNull();
      expect(aliasRecord?.entityId).toBe(result.entity.id);
      expect(aliasRecord?.aliasType).toBe('SYNONYM');

      // Subsequent extraction of just 'AWS' must resolve to Amazon Web Services
      const awsResult = await resolver.resolve(wsId, {
        name: 'AWS',
        entityType: 'ORGANIZATION',
        aliases: [],
        confidence: 0.9,
      });
      expect(awsResult.isNew).toBe(false);
      expect(awsResult.entity.id).toBe(result.entity.id);
      expect(awsResult.resolvedBy).toBe('ALIAS');
    });

    it('resolves trailing sentence punctuation and possessives to the canonical entity', async () => {
      const baseResult = await resolver.resolve(wsId, {
        name: 'Redis',
        entityType: 'TECHNOLOGY',
        aliases: [],
        confidence: 0.9,
      });
      expect(baseResult.isNew).toBe(true);

      // Trailing period (e.g. "... caching with Redis.")
      const periodResult = await resolver.resolve(wsId, {
        name: 'Redis.',
        entityType: 'TECHNOLOGY',
        aliases: [],
        confidence: 0.85,
      });
      expect(periodResult.isNew).toBe(false);
      expect(periodResult.entity.id).toBe(baseResult.entity.id);

      // Possessive (e.g. "Redis's in-memory storage")
      const possessiveResult = await resolver.resolve(wsId, {
        name: "Redis's",
        entityType: 'TECHNOLOGY',
        aliases: [],
        confidence: 0.88,
      });
      expect(possessiveResult.isNew).toBe(false);
      expect(possessiveResult.entity.id).toBe(baseResult.entity.id);
    });
  });

  describe('2. False-Positive Merge Prevention', () => {
    it('PREVENTS unrelated entities from merging when sharing generic stop-word aliases', async () => {
      // Entity 1: Relational Database
      const rdbms = await resolver.resolve(wsId, {
        name: 'Oracle Database',
        entityType: 'TECHNOLOGY',
        aliases: ['database', 'system', 'rdbms'],
        confidence: 0.9,
      });
      expect(rdbms.isNew).toBe(true);

      // Verify that generic words 'database' and 'system' were NOT added to alias registry
      const genericAlias = await prisma.graphEntityAlias.findUnique({
        where: {
          workspaceId_normalizedAlias: {
            workspaceId: wsId,
            normalizedAlias: 'database',
          },
        },
      });
      expect(genericAlias).toBeNull();

      // Entity 2: Graph Database mentions 'database' as alias
      const neo4j = await resolver.resolve(wsId, {
        name: 'Neo4j',
        entityType: 'TECHNOLOGY',
        aliases: ['database', 'graph database'],
        confidence: 0.9,
      });
      expect(neo4j.isNew).toBe(true);
      expect(neo4j.entity.id).not.toBe(rdbms.entity.id);
    });

    it('PREVENTS alias-based merging across incompatible specific entity types', async () => {
      // Create a LOCATION entity
      const location = await resolver.resolve(wsId, {
        name: 'Washington State',
        entityType: 'LOCATION',
        aliases: ['Washington'],
        confidence: 0.9,
      });
      expect(location.isNew).toBe(true);

      // Attempt to resolve a PERSON entity with alias 'Washington'
      // Under hardened rules, PERSON and LOCATION are incompatible specific types
      const person = await resolver.resolve(wsId, {
        name: 'George Washington',
        entityType: 'PERSON',
        aliases: ['Washington'],
        confidence: 0.95,
      });
      expect(person.isNew).toBe(true);
      expect(person.entity.id).not.toBe(location.entity.id);
      expect(person.entity.entityType).toBe('PERSON');
    });
  });

  describe('3. Entity Type Promotion & Enrichment', () => {
    it('UPGRADES generic CONCEPT to specific TECHNOLOGY upon higher-specificity evidence', async () => {
      const termName = `Kafka Stream Engine ${Date.now()}`;

      // Initially extracted with generic CONCEPT type and no description
      const initial = await resolver.resolve(wsId, {
        name: termName,
        entityType: 'CONCEPT',
        aliases: [],
        confidence: 0.6,
      });
      expect(initial.isNew).toBe(true);
      expect(initial.entity.entityType).toBe('CONCEPT');
      expect(initial.entity.description).toBeNull();

      // Subsequent extraction accurately identifies it as TECHNOLOGY with a rich description
      const enriched = await resolver.resolve(wsId, {
        name: termName,
        entityType: 'TECHNOLOGY',
        description: 'Distributed event streaming platform',
        aliases: [],
        confidence: 0.95,
      });

      expect(enriched.isNew).toBe(false);
      expect(enriched.entity.id).toBe(initial.entity.id);
      expect(enriched.entity.entityType).toBe('TECHNOLOGY');
      expect(enriched.entity.description).toBe('Distributed event streaming platform');

      // Verify in DB
      const inDb = await prisma.graphEntity.findUnique({
        where: {
          workspaceId_id: {
            workspaceId: wsId,
            id: initial.entity.id,
          },
        },
      });
      expect(inDb?.entityType).toBe('TECHNOLOGY');
      expect(inDb?.description).toBe('Distributed event streaming platform');
    });

    it('PRESERVES existing specific type and does NOT downgrade when incoming type is CONCEPT', async () => {
      const termName = `Stripe Gateway ${Date.now()}`;

      const initial = await resolver.resolve(wsId, {
        name: termName,
        entityType: 'ORGANIZATION',
        description: 'Financial infrastructure provider',
        aliases: [],
        confidence: 0.92,
      });
      expect(initial.entity.entityType).toBe('ORGANIZATION');

      // Subsequent chunk mentions it with generic CONCEPT
      const subsequent = await resolver.resolve(wsId, {
        name: termName,
        entityType: 'CONCEPT',
        aliases: [],
        confidence: 0.7,
      });

      expect(subsequent.isNew).toBe(false);
      expect(subsequent.entity.id).toBe(initial.entity.id);
      // Must preserve ORGANIZATION, not downgrade to CONCEPT
      expect(subsequent.entity.entityType).toBe('ORGANIZATION');
    });

    it('maintains monotonically non-decreasing confidence in metadata', async () => {
      const termName = `Confidence Test Entity ${Date.now()}`;

      const res1 = await resolver.resolve(wsId, {
        name: termName,
        entityType: 'CONCEPT',
        aliases: [],
        confidence: 0.75,
      });
      expect((res1.entity.metadata as any)?.confidence).toBe(0.75);

      // Lower confidence incoming match does NOT decrease confidence
      const res2 = await resolver.resolve(wsId, {
        name: termName,
        entityType: 'CONCEPT',
        aliases: [],
        confidence: 0.6,
      });
      expect((res2.entity.metadata as any)?.confidence).toBe(0.75);

      // Higher confidence incoming match increases confidence
      const res3 = await resolver.resolve(wsId, {
        name: termName,
        entityType: 'CONCEPT',
        aliases: [],
        confidence: 0.95,
      });
      expect((res3.entity.metadata as any)?.confidence).toBe(0.95);
    });
  });
});
