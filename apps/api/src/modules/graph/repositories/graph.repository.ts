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
}

export const graphRepository = new GraphRepository();
