import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { PrismaClient } from '@prisma/client';

/**
 * Helper to extract exact PostgreSQL SQLSTATE from Prisma error.
 * Prisma wraps PostgreSQL errors:
 * - In raw queries ($executeRaw), err.meta.code contains the literal PostgreSQL SQLSTATE ('23503', '23505', '23514').
 * - In model queries, err.code contains 'P2002' (for 23505 unique violation) or 'P2003' (for 23503 foreign key violation).
 */
function getSqlState(err: any): string {
  if (err?.meta?.code && typeof err.meta.code === 'string') {
    return err.meta.code;
  }
  if (err?.code === 'P2002') return '23505';
  if (err?.code === 'P2003') return '23503';
  return err?.code || '';
}

describe('Phase 6.0 Database Foundation & Referential Integrity', () => {
  let wsAlphaId: string;
  let wsBetaId: string;
  let userAlphaId: string;
  let docBetaId: string;
  let docAlpha1Id: string;
  let docAlpha2Id: string;

  beforeAll(async () => {
    // 1. Create two isolated workspaces
    const wsAlpha = await prisma.workspace.create({
      data: { name: 'Workspace Alpha', slug: `ws-alpha-${Date.now()}` },
    });
    wsAlphaId = wsAlpha.id;

    const wsBeta = await prisma.workspace.create({
      data: { name: 'Workspace Beta', slug: `ws-beta-${Date.now()}` },
    });
    wsBetaId = wsBeta.id;

    // 2. Create test user
    const user = await prisma.user.create({
      data: {
        email: `phase6-test-${Date.now()}@mindvault.dev`,
        passwordHash: 'dummy_hash',
        name: 'Phase 6 Tester',
      },
    });
    userAlphaId = user.id;

    // 3. Create Document in Workspace Beta
    const docBeta = await prisma.document.create({
      data: {
        workspaceId: wsBetaId,
        uploadedById: userAlphaId,
        originalName: 'Confidential_Beta.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(2048),
        checksum: `checksum-beta-${Date.now()}`,
        storageKey: `key-beta-${Date.now()}`,
      },
    });
    docBetaId = docBeta.id;

    // 4. Create Documents in Workspace Alpha for evidence testing
    const docAlpha1 = await prisma.document.create({
      data: {
        workspaceId: wsAlphaId,
        uploadedById: userAlphaId,
        originalName: 'Doc_Alpha_1.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(1024),
        checksum: `checksum-a1-${Date.now()}`,
        storageKey: `key-a1-${Date.now()}`,
      },
    });
    docAlpha1Id = docAlpha1.id;

    const docAlpha2 = await prisma.document.create({
      data: {
        workspaceId: wsAlphaId,
        uploadedById: userAlphaId,
        originalName: 'Doc_Alpha_2.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(1024),
        checksum: `checksum-a2-${Date.now()}`,
        storageKey: `key-a2-${Date.now()}`,
      },
    });
    docAlpha2Id = docAlpha2.id;
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({
      where: { id: { in: [wsAlphaId, wsBetaId] } },
    });
    await prisma.user.deleteMany({ where: { id: userAlphaId } });
  });

  // =========================================================================
  // 1. Document-to-Workspace Referential Integrity & Exact SQLSTATE 23503
  // =========================================================================
  describe('Document-to-Workspace Referential Integrity', () => {
    it('MUST REJECT inserting a chunk with mismatched document.workspaceId with exact SQLSTATE 23503', async () => {
      let capturedError: any = null;
      try {
        await prisma.$executeRaw`
          INSERT INTO "document_chunks" (
            "id", "documentId", "workspaceId", "chunkIndex", "content", "tokenCount", "createdAt"
          ) VALUES (
            gen_random_uuid()::text, ${docBetaId}, ${wsAlphaId}, 0, 'Cross tenant content', 10, NOW()
          );
        `;
      } catch (err: any) {
        capturedError = err;
      }

      expect(capturedError).not.toBeNull();
      // Assert exact PostgreSQL SQLSTATE 23503 (foreign_key_violation)
      expect(getSqlState(capturedError)).toBe('23503');
      expect(capturedError.meta?.code).toBe('23503');
    });

    it('MUST ACCEPT inserting chunks matching document.workspaceId', async () => {
      const chunk = await prisma.documentChunk.create({
        data: {
          documentId: docBetaId,
          workspaceId: wsBetaId,
          chunkIndex: 0,
          content: 'Legitimate Beta content',
          tokenCount: 10,
        },
      });

      expect(chunk.id).toBeDefined();
      expect(chunk.workspaceId).toBe(wsBetaId);
    });
  });

  // =========================================================================
  // 2. Multi-Tenant Composite Referential Integrity on Graph Entities & Relations
  // =========================================================================
  describe('Multi-Tenant Composite Referential Integrity on Graph Entities & Relations', () => {
    let entAlpha1Id: string;
    let entAlpha2Id: string;
    let entBetaId: string;

    beforeAll(async () => {
      const entA1 = await prisma.graphEntity.create({
        data: {
          workspaceId: wsAlphaId,
          canonicalName: 'PostgreSQL',
          normalizedName: 'postgresql',
          entityType: 'TECHNOLOGY',
        },
      });
      entAlpha1Id = entA1.id;

      const entA2 = await prisma.graphEntity.create({
        data: {
          workspaceId: wsAlphaId,
          canonicalName: 'pgvector',
          normalizedName: 'pgvector',
          entityType: 'TECHNOLOGY',
        },
      });
      entAlpha2Id = entA2.id;

      const entB = await prisma.graphEntity.create({
        data: {
          workspaceId: wsBetaId,
          canonicalName: 'Redis',
          normalizedName: 'redis',
          entityType: 'TECHNOLOGY',
        },
      });
      entBetaId = entB.id;
    });

    it('MUST REJECT cross-tenant relations with exact SQLSTATE 23503', async () => {
      let capturedError: any = null;
      try {
        // Attempt to create relation in Workspace Alpha linking entAlpha1 to entBeta
        await prisma.$executeRaw`
          INSERT INTO "graph_relations" (
            "id", "workspace_id", "source_entity_id", "target_entity_id", "relation_type", "created_at", "updated_at"
          ) VALUES (
            gen_random_uuid()::text, ${wsAlphaId}, ${entAlpha1Id}, ${entBetaId}, 'CONNECTS_TO', NOW(), NOW()
          );
        `;
      } catch (err: any) {
        capturedError = err;
      }

      expect(capturedError).not.toBeNull();
      // Assert exact SQLSTATE 23503 (foreign_key_violation)
      expect(getSqlState(capturedError)).toBe('23503');
      expect(capturedError.meta?.code).toBe('23503');
    });

    it('MUST REJECT self-loop relations with exact SQLSTATE 23514 (check_violation)', async () => {
      let capturedError: any = null;
      try {
        await prisma.$executeRaw`
          INSERT INTO "graph_relations" (
            "id", "workspace_id", "source_entity_id", "target_entity_id", "relation_type", "created_at", "updated_at"
          ) VALUES (
            gen_random_uuid()::text, ${wsAlphaId}, ${entAlpha1Id}, ${entAlpha1Id}, 'SELF_REF', NOW(), NOW()
          );
        `;
      } catch (err: any) {
        capturedError = err;
      }

      expect(capturedError).not.toBeNull();
      expect(getSqlState(capturedError)).toBe('23514');
      expect(capturedError.meta?.code).toBe('23514');
    });

    it('MUST ACCEPT valid intra-workspace relations', async () => {
      const relation = await prisma.graphRelation.create({
        data: {
          workspaceId: wsAlphaId,
          sourceEntityId: entAlpha1Id,
          targetEntityId: entAlpha2Id,
          relationType: 'EXTENDS',
          weight: 1.0,
          confidence: 0.95,
        },
      });

      expect(relation.id).toBeDefined();
      expect(relation.workspaceId).toBe(wsAlphaId);
    });
  });

  // =========================================================================
  // 3. Unified Alias Registry & Collision Prevention
  // =========================================================================
  describe('Unified Alias Registry & Collision Prevention', () => {
    it('automatically creates a CANONICAL alias row in graph_entity_aliases upon entity insertion', async () => {
      const entity = await prisma.graphEntity.create({
        data: {
          workspaceId: wsAlphaId,
          canonicalName: 'Docker Engine',
          normalizedName: 'docker-engine',
          entityType: 'TECHNOLOGY',
        },
      });

      const canonicalAlias = await prisma.graphEntityAlias.findUnique({
        where: {
          workspaceId_normalizedAlias: {
            workspaceId: wsAlphaId,
            normalizedAlias: 'docker-engine',
          },
        },
      });

      expect(canonicalAlias).not.toBeNull();
      expect(canonicalAlias?.alias).toBe('Docker Engine');
      expect(canonicalAlias?.aliasType).toBe('CANONICAL');
      expect(canonicalAlias?.entityId).toBe(entity.id);
    });

    it('MUST REJECT an alias that collides with an existing canonical entity with exact SQLSTATE 23505', async () => {
      // Create second entity in Workspace Alpha
      const otherEntity = await prisma.graphEntity.create({
        data: {
          workspaceId: wsAlphaId,
          canonicalName: 'Container Runtime',
          normalizedName: 'container-runtime',
          entityType: 'CONCEPT',
        },
      });

      let capturedError: any = null;
      try {
        // Attempt to assign alias "docker-engine" (which belongs canonically to Docker Engine) to Container Runtime
        await prisma.$executeRaw`
          INSERT INTO "graph_entity_aliases" (
            "id", "workspace_id", "entity_id", "alias", "normalized_alias", "alias_type", "created_at"
          ) VALUES (
            gen_random_uuid()::text, ${wsAlphaId}, ${otherEntity.id}, 'Docker Engine', 'docker-engine', 'SYNONYM', NOW()
          );
        `;
      } catch (err: any) {
        capturedError = err;
      }

      expect(capturedError).not.toBeNull();
      // Assert exact SQLSTATE 23505 (unique_violation)
      expect(getSqlState(capturedError)).toBe('23505');
      expect(capturedError.meta?.code).toBe('23505');
    });

    it('MUST REJECT creating a canonical entity whose name collides with an existing alias with exact SQLSTATE 23505', async () => {
      // 1. Create canonical entity "Kubernetes" with alias "K8s"
      const k8s = await prisma.graphEntity.create({
        data: {
          workspaceId: wsAlphaId,
          canonicalName: 'Kubernetes',
          normalizedName: 'kubernetes',
          entityType: 'TECHNOLOGY',
        },
      });

      await prisma.graphEntityAlias.create({
        data: {
          workspaceId: wsAlphaId,
          entityId: k8s.id,
          alias: 'K8s',
          normalizedAlias: 'k8s',
          aliasType: 'ACRONYM',
        },
      });

      // 2. Attempt to create a NEW canonical entity named "K8s" (cross-type collision test: CONCEPT)
      let capturedError: any = null;
      try {
        await prisma.graphEntity.create({
          data: {
            workspaceId: wsAlphaId,
            canonicalName: 'K8s',
            normalizedName: 'k8s',
            entityType: 'CONCEPT',
          },
        });
      } catch (err: any) {
        capturedError = err;
      }

      expect(capturedError).not.toBeNull();
      // Assert exact SQLSTATE 23505 (unique_violation)
      expect(getSqlState(capturedError)).toBe('23505');
    });

    it('MUST REJECT assigning an entity an alias identical to its own canonical name with exact SQLSTATE 23505', async () => {
      const entity = await prisma.graphEntity.create({
        data: {
          workspaceId: wsAlphaId,
          canonicalName: 'TypeScript',
          normalizedName: 'typescript',
          entityType: 'TECHNOLOGY',
        },
      });

      let capturedError: any = null;
      try {
        await prisma.$executeRaw`
          INSERT INTO "graph_entity_aliases" (
            "id", "workspace_id", "entity_id", "alias", "normalized_alias", "alias_type", "created_at"
          ) VALUES (
            gen_random_uuid()::text, ${wsAlphaId}, ${entity.id}, 'TypeScript', 'typescript', 'SYNONYM', NOW()
          );
        `;
      } catch (err: any) {
        capturedError = err;
      }

      expect(capturedError).not.toBeNull();
      expect(getSqlState(capturedError)).toBe('23505');
      expect(capturedError.meta?.code).toBe('23505');
    });

    it('MUST ALLOW identical names in DIFFERENT workspaces', async () => {
      // Workspace Beta can freely register "typescript"
      const betaTs = await prisma.graphEntity.create({
        data: {
          workspaceId: wsBetaId,
          canonicalName: 'TypeScript',
          normalizedName: 'typescript',
          entityType: 'TECHNOLOGY',
        },
      });

      expect(betaTs.id).toBeDefined();
      expect(betaTs.workspaceId).toBe(wsBetaId);
    });
  });

  // =========================================================================
  // 4. Protection of CANONICAL Registry Entries (Safeguard 1)
  // =========================================================================
  describe('CANONICAL Registry Entry Protection & Lifecycle', () => {
    let parentEntityId: string;
    let canonicalAliasId: string;

    beforeAll(async () => {
      const entity = await prisma.graphEntity.create({
        data: {
          workspaceId: wsAlphaId,
          canonicalName: 'GraphQL API',
          normalizedName: 'graphql-api',
          entityType: 'TECHNOLOGY',
        },
      });
      parentEntityId = entity.id;

      const alias = await prisma.graphEntityAlias.findUnique({
        where: {
          workspaceId_normalizedAlias: {
            workspaceId: wsAlphaId,
            normalizedAlias: 'graphql-api',
          },
        },
      });
      canonicalAliasId = alias!.id;
    });

    it('MUST REJECT direct DELETE of a CANONICAL alias with exact SQLSTATE 23505', async () => {
      let capturedError: any = null;
      try {
        await prisma.$executeRaw`
          DELETE FROM "graph_entity_aliases" WHERE "id" = ${canonicalAliasId};
        `;
      } catch (err: any) {
        capturedError = err;
      }

      expect(capturedError).not.toBeNull();
      expect(getSqlState(capturedError)).toBe('23505');
      expect(capturedError.meta?.code).toBe('23505');
    });

    it('MUST REJECT direct UPDATE of a CANONICAL alias with exact SQLSTATE 23505', async () => {
      let capturedError: any = null;
      try {
        await prisma.$executeRaw`
          UPDATE "graph_entity_aliases" 
          SET "alias" = 'Hacked GraphQL' 
          WHERE "id" = ${canonicalAliasId};
        `;
      } catch (err: any) {
        capturedError = err;
      }

      expect(capturedError).not.toBeNull();
      expect(getSqlState(capturedError)).toBe('23505');
      expect(capturedError.meta?.code).toBe('23505');
    });

    it('allows CANONICAL alias update when triggered by parent GraphEntity update', async () => {
      await prisma.graphEntity.update({
        where: {
          workspaceId_id: {
            workspaceId: wsAlphaId,
            id: parentEntityId,
          },
        },
        data: {
          canonicalName: 'GraphQL Interface',
          normalizedName: 'graphql-interface',
        },
      });

      const updatedAlias = await prisma.graphEntityAlias.findUnique({
        where: {
          workspaceId_normalizedAlias: {
            workspaceId: wsAlphaId,
            normalizedAlias: 'graphql-interface',
          },
        },
      });

      expect(updatedAlias).not.toBeNull();
      expect(updatedAlias?.alias).toBe('GraphQL Interface');
      expect(updatedAlias?.aliasType).toBe('CANONICAL');
    });

    it('allows clean CASCADE deletion of CANONICAL alias when parent GraphEntity is deleted', async () => {
      await prisma.graphEntity.delete({
        where: {
          workspaceId_id: {
            workspaceId: wsAlphaId,
            id: parentEntityId,
          },
        },
      });

      const aliasCount = await prisma.graphEntityAlias.count({
        where: {
          workspaceId: wsAlphaId,
          entityId: parentEntityId,
        },
      });

      expect(aliasCount).toBe(0);
    });
  });

  // =========================================================================
  // 5. Concurrent Transaction Tests (Safeguard 3)
  // =========================================================================
  describe('Concurrent Transaction Uniqueness Isolation', () => {
    it('MUST enforce term uniqueness under simultaneous entity/alias creation with exact SQLSTATE 23505 on the loser', async () => {
      const term = `concurrency-test-${Date.now()}`;

      // Create base entity A to attach alias to
      const baseEntity = await prisma.graphEntity.create({
        data: {
          workspaceId: wsAlphaId,
          canonicalName: `Base-${Date.now()}`,
          normalizedName: `base-${Date.now()}`,
          entityType: 'CONCEPT',
        },
      });

      // Use two independent Prisma clients to simulate concurrent parallel transactions
      const client1 = new PrismaClient();
      const client2 = new PrismaClient();

      let client1Result = 'SUCCESS';
      let client2Result = 'SUCCESS';
      let client1Error: any = null;
      let client2Error: any = null;

      try {
        await Promise.all([
          // Client 1 attempts to create canonical entity with normalizedName = term via raw SQL
          client1.$executeRaw`
            INSERT INTO "graph_entities" (
              "id", "workspace_id", "canonical_name", "normalized_name", "entity_type", "created_at", "updated_at"
            ) VALUES (
              gen_random_uuid()::text, ${wsAlphaId}, ${term}, ${term}, 'TECHNOLOGY', NOW(), NOW()
            );
          `.catch((err) => {
            client1Result = 'ERROR';
            client1Error = err;
          }),

          // Client 2 attempts to create alias on baseEntity with normalizedAlias = term via raw SQL
          client2.$executeRaw`
            INSERT INTO "graph_entity_aliases" (
              "id", "workspace_id", "entity_id", "alias", "normalized_alias", "alias_type", "created_at"
            ) VALUES (
              gen_random_uuid()::text, ${wsAlphaId}, ${baseEntity.id}, ${term}, ${term}, 'SYNONYM', NOW()
            );
          `.catch((err) => {
            client2Result = 'ERROR';
            client2Error = err;
          }),
        ]);

        // Exactly one client MUST succeed and exactly one client MUST fail
        const successCount =
          (client1Result === 'SUCCESS' ? 1 : 0) + (client2Result === 'SUCCESS' ? 1 : 0);
        const errorCount =
          (client1Result === 'ERROR' ? 1 : 0) + (client2Result === 'ERROR' ? 1 : 0);

        expect(successCount).toBe(1);
        expect(errorCount).toBe(1);

        const loserError = client1Error || client2Error;
        expect(loserError).not.toBeNull();
        // Loser must throw SQLSTATE 23505 (unique_violation)
        expect(getSqlState(loserError)).toBe('23505');
        expect(loserError.meta?.code).toBe('23505');

        // Verify database contains exactly one entry for this term
        const aliasEntries = await prisma.graphEntityAlias.count({
          where: {
            workspaceId: wsAlphaId,
            normalizedAlias: term,
          },
        });
        expect(aliasEntries).toBe(1);
      } finally {
        await client1.$disconnect();
        await client2.$disconnect();
      }
    });
  });

  // =========================================================================
  // 6. Evidence Provenance & Document Deletion Cascade
  // =========================================================================
  describe('Evidence Provenance & Document Deletion Cascade', () => {
    it('preserves corroborated relations when one supporting document is deleted', async () => {
      // 1. Create two entities
      const e1 = await prisma.graphEntity.create({
        data: {
          workspaceId: wsAlphaId,
          canonicalName: 'NodeJS',
          normalizedName: 'nodejs',
          entityType: 'TECHNOLOGY',
        },
      });

      const e2 = await prisma.graphEntity.create({
        data: {
          workspaceId: wsAlphaId,
          canonicalName: 'V8 Engine',
          normalizedName: 'v8-engine',
          entityType: 'TECHNOLOGY',
        },
      });

      // 2. Create chunks in docAlpha1 and docAlpha2
      const chunk1 = await prisma.documentChunk.create({
        data: {
          documentId: docAlpha1Id,
          workspaceId: wsAlphaId,
          chunkIndex: 0,
          content: 'Node.js is powered by the V8 JavaScript engine.',
          tokenCount: 10,
        },
      });

      const chunk2 = await prisma.documentChunk.create({
        data: {
          documentId: docAlpha2Id,
          workspaceId: wsAlphaId,
          chunkIndex: 0,
          content: 'Google V8 execution engine is embedded within Node runtime.',
          tokenCount: 11,
        },
      });

      // 3. Create relation between e1 and e2
      const rel = await prisma.graphRelation.create({
        data: {
          workspaceId: wsAlphaId,
          sourceEntityId: e1.id,
          targetEntityId: e2.id,
          relationType: 'USES',
          confidence: 0.95,
        },
      });

      // 4. Attach evidence from chunk1 (docAlpha1) and chunk2 (docAlpha2)
      await prisma.relationEvidence.create({
        data: {
          workspaceId: wsAlphaId,
          relationId: rel.id,
          chunkId: chunk1.id,
          documentId: docAlpha1Id,
          evidenceText: 'Node.js is powered by the V8 JavaScript engine.',
          confidence: 0.96,
        },
      });

      await prisma.relationEvidence.create({
        data: {
          workspaceId: wsAlphaId,
          relationId: rel.id,
          chunkId: chunk2.id,
          documentId: docAlpha2Id,
          evidenceText: 'Google V8 execution engine is embedded within Node runtime.',
          confidence: 0.94,
        },
      });

      // Verify two evidence rows exist
      let evidenceCount = await prisma.relationEvidence.count({
        where: { relationId: rel.id },
      });
      expect(evidenceCount).toBe(2);

      // 5. Delete Document Alpha 1
      await prisma.document.delete({
        where: {
          workspaceId_id: {
            workspaceId: wsAlphaId,
            id: docAlpha1Id,
          },
        },
      });

      // 6. Verify chunk1 and evidence1 were deleted via CASCADE
      evidenceCount = await prisma.relationEvidence.count({
        where: { relationId: rel.id },
      });
      expect(evidenceCount).toBe(1);

      // Verify the relation STILL EXISTS (because docAlpha2 evidence remains)
      const survivingRelation = await prisma.graphRelation.findUnique({
        where: {
          workspaceId_id: {
            workspaceId: wsAlphaId,
            id: rel.id,
          },
        },
      });
      expect(survivingRelation).not.toBeNull();
    });
  });
});
