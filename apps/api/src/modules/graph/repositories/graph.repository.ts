import { prisma } from '../../../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import type {
  IGraphRepository,
  CreateEntityInput,
  CreateAliasInput,
  CreateRelationInput,
  CreateMentionInput,
  CreateEvidenceInput,
  GraphEntityRecord,
  GraphAliasRecord,
  GraphRelationRecord,
} from './graph.repository.interface.js';

export class GraphRepository implements IGraphRepository {
  async findEntityById(workspaceId: string, id: string): Promise<GraphEntityRecord | null> {
    const entity = await prisma.graphEntity.findUnique({
      where: {
        workspaceId_id: {
          workspaceId,
          id,
        },
      },
    });

    if (!entity) return null;
    return {
      ...entity,
      metadata: entity.metadata as Record<string, unknown>,
    };
  }

  async findEntityByName(
    workspaceId: string,
    normalizedName: string,
  ): Promise<GraphEntityRecord | null> {
    const entity = await prisma.graphEntity.findUnique({
      where: {
        workspaceId_normalizedName: {
          workspaceId,
          normalizedName,
        },
      },
    });

    if (!entity) return null;
    return {
      ...entity,
      metadata: entity.metadata as Record<string, unknown>,
    };
  }

  async findEntityByAlias(
    workspaceId: string,
    normalizedAlias: string,
  ): Promise<GraphEntityRecord | null> {
    const aliasRecord = await prisma.graphEntityAlias.findUnique({
      where: {
        workspaceId_normalizedAlias: {
          workspaceId,
          normalizedAlias,
        },
      },
      include: {
        entity: true,
      },
    });

    if (!aliasRecord || !aliasRecord.entity) return null;
    return {
      ...aliasRecord.entity,
      metadata: aliasRecord.entity.metadata as Record<string, unknown>,
    };
  }

  async createEntity(input: CreateEntityInput): Promise<GraphEntityRecord> {
    const entity = await prisma.graphEntity.create({
      data: {
        workspaceId: input.workspaceId,
        canonicalName: input.canonicalName,
        normalizedName: input.normalizedName,
        entityType: input.entityType ?? 'CONCEPT',
        description: input.description,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    return {
      ...entity,
      metadata: entity.metadata as Record<string, unknown>,
    };
  }

  async updateEntity(
    workspaceId: string,
    id: string,
    data: {
      entityType?: Prisma.EnumEntityTypeFieldUpdateOperationsInput | any;
      description?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<GraphEntityRecord> {
    const updated = await prisma.graphEntity.update({
      where: {
        workspaceId_id: {
          workspaceId,
          id,
        },
      },
      data: {
        ...(data.entityType ? { entityType: data.entityType } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.metadata !== undefined
          ? { metadata: data.metadata as Prisma.InputJsonValue }
          : {}),
      },
    });

    return {
      ...updated,
      metadata: updated.metadata as Record<string, unknown>,
    };
  }

  async createAlias(input: CreateAliasInput): Promise<GraphAliasRecord> {
    const alias = await prisma.graphEntityAlias.create({
      data: {
        workspaceId: input.workspaceId,
        entityId: input.entityId,
        alias: input.alias,
        normalizedAlias: input.normalizedAlias,
        aliasType: input.aliasType ?? 'SYNONYM',
      },
    });

    return alias;
  }

  async createRelation(input: CreateRelationInput): Promise<GraphRelationRecord> {
    const relation = await prisma.graphRelation.create({
      data: {
        workspaceId: input.workspaceId,
        sourceEntityId: input.sourceEntityId,
        targetEntityId: input.targetEntityId,
        relationType: input.relationType,
        description: input.description,
        weight: input.weight ?? 1.0,
        confidence: input.confidence ?? 0.8,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    return {
      ...relation,
      metadata: relation.metadata as Record<string, unknown>,
    };
  }

  async createMention(input: CreateMentionInput): Promise<{ id: string }> {
    const mention = await prisma.chunkEntityMention.create({
      data: {
        workspaceId: input.workspaceId,
        chunkId: input.chunkId,
        entityId: input.entityId,
        mentionText: input.mentionText,
        startOffset: input.startOffset,
        endOffset: input.endOffset,
        confidence: input.confidence ?? 1.0,
      },
      select: { id: true },
    });

    return mention;
  }

  async createEvidence(input: CreateEvidenceInput): Promise<{ id: string }> {
    const evidence = await prisma.relationEvidence.create({
      data: {
        workspaceId: input.workspaceId,
        relationId: input.relationId,
        chunkId: input.chunkId,
        documentId: input.documentId,
        evidenceText: input.evidenceText,
        confidence: input.confidence ?? 0.85,
      },
      select: { id: true },
    });

    return evidence;
  }

  async deleteEntity(workspaceId: string, id: string): Promise<boolean> {
    try {
      await prisma.graphEntity.delete({
        where: {
          workspaceId_id: {
            workspaceId,
            id,
          },
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  async findRelations(workspaceId: string, entityId: string): Promise<GraphRelationRecord[]> {
    const relations = await prisma.graphRelation.findMany({
      where: {
        workspaceId,
        OR: [{ sourceEntityId: entityId }, { targetEntityId: entityId }],
      },
    });

    return relations.map((rel) => ({
      ...rel,
      metadata: rel.metadata as Record<string, unknown>,
    }));
  }

  async findRelationByEndpoints(
    workspaceId: string,
    sourceEntityId: string,
    targetEntityId: string,
    relationType: string,
  ): Promise<GraphRelationRecord | null> {
    const relation = await prisma.graphRelation.findUnique({
      where: {
        workspaceId_sourceEntityId_targetEntityId_relationType: {
          workspaceId,
          sourceEntityId,
          targetEntityId,
          relationType,
        },
      },
    });

    if (!relation) return null;
    return {
      ...relation,
      metadata: relation.metadata as Record<string, unknown>,
    };
  }

  async findRelationById(workspaceId: string, id: string): Promise<GraphRelationRecord | null> {
    const relation = await prisma.graphRelation.findUnique({
      where: {
        workspaceId_id: {
          workspaceId,
          id,
        },
      },
    });

    if (!relation) return null;
    return {
      ...relation,
      metadata: relation.metadata as Record<string, unknown>,
    };
  }

  async upsertRelation(input: CreateRelationInput): Promise<GraphRelationRecord> {
    const existing = await this.findRelationByEndpoints(
      input.workspaceId,
      input.sourceEntityId,
      input.targetEntityId,
      input.relationType,
    );

    if (existing) {
      // Weight is synchronized from unique relation_evidence rows via trigger trg_relation_evidence_sync_weight.
      // Confidence is monotonically non-decreasing.
      const updated = await prisma.graphRelation.update({
        where: {
          workspaceId_id: {
            workspaceId: input.workspaceId,
            id: existing.id,
          },
        },
        data: {
          confidence: Math.max(existing.confidence, input.confidence ?? 0.8),
          description: input.description || existing.description,
          metadata: {
            ...existing.metadata,
            ...(input.metadata ?? {}),
          } as Prisma.InputJsonValue,
        },
      });

      return {
        ...updated,
        metadata: updated.metadata as Record<string, unknown>,
      };
    }

    try {
      return await this.createRelation({
        ...input,
        weight: input.weight ?? 1.0,
      });
    } catch (err: any) {
      if (err.code === 'P2002' || err.meta?.code === '23505') {
        const recheck = await this.findRelationByEndpoints(
          input.workspaceId,
          input.sourceEntityId,
          input.targetEntityId,
          input.relationType,
        );
        if (recheck) {
          const updated = await prisma.graphRelation.update({
            where: {
              workspaceId_id: {
                workspaceId: input.workspaceId,
                id: recheck.id,
              },
            },
            data: {
              confidence: Math.max(recheck.confidence, input.confidence ?? 0.8),
              description: input.description || recheck.description,
            },
          });
          return {
            ...updated,
            metadata: updated.metadata as Record<string, unknown>,
          };
        }
      }
      throw err;
    }
  }

  async findMention(
    workspaceId: string,
    chunkId: string,
    entityId: string,
  ): Promise<{ id: string } | null> {
    return prisma.chunkEntityMention.findFirst({
      where: {
        workspaceId,
        chunkId,
        entityId,
      },
      select: { id: true },
    });
  }

  async createMentionIdempotent(input: CreateMentionInput): Promise<{ id: string }> {
    const existing = await this.findMention(input.workspaceId, input.chunkId, input.entityId);
    if (existing) {
      return existing;
    }
    try {
      return await this.createMention(input);
    } catch (err: any) {
      if (err.code === 'P2002' || err.meta?.code === '23505') {
        const recheck = await this.findMention(input.workspaceId, input.chunkId, input.entityId);
        if (recheck) return recheck;
      }
      throw err;
    }
  }

  async findEvidence(
    workspaceId: string,
    relationId: string,
    chunkId: string,
  ): Promise<{ id: string } | null> {
    return prisma.relationEvidence.findUnique({
      where: {
        workspaceId_relationId_chunkId: {
          workspaceId,
          relationId,
          chunkId,
        },
      },
      select: { id: true },
    });
  }

  async createEvidenceIdempotent(input: CreateEvidenceInput, retries = 3): Promise<{ id: string }> {
    const existing = await this.findEvidence(input.workspaceId, input.relationId, input.chunkId);
    if (existing) {
      return existing;
    }
    try {
      return await this.createEvidence(input);
    } catch (err: any) {
      const sqlCode = err.meta?.code || err.code;
      if (sqlCode === 'P2002' || sqlCode === '23505') {
        const recheck = await this.findEvidence(input.workspaceId, input.relationId, input.chunkId);
        if (recheck) return recheck;
      }
      if (
        (sqlCode === '40P01' || sqlCode === '40001' || err.message?.includes('deadlock')) &&
        retries > 0
      ) {
        await new Promise((r) => setTimeout(r, 25 + Math.random() * 50));
        return this.createEvidenceIdempotent(input, retries - 1);
      }
      throw err;
    }
  }
}

export const graphRepository = new GraphRepository();
