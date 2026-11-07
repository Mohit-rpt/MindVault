import { EntityType } from '@prisma/client';

export interface CreateEntityInput {
  workspaceId: string;
  canonicalName: string;
  normalizedName: string;
  entityType?: EntityType;
  description?: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export interface UpdateEntityInput {
  entityType?: EntityType;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateAliasInput {
  workspaceId: string;
  entityId: string;
  alias: string;
  normalizedAlias: string;
  aliasType?: string;
}

export interface CreateRelationInput {
  workspaceId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  description?: string;
  weight?: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateMentionInput {
  workspaceId: string;
  chunkId: string;
  entityId: string;
  mentionText: string;
  startOffset?: number;
  endOffset?: number;
  confidence?: number;
}

export interface CreateEvidenceInput {
  workspaceId: string;
  relationId: string;
  chunkId: string;
  documentId: string;
  evidenceText: string;
  confidence?: number;
}

export interface GraphEntityRecord {
  id: string;
  workspaceId: string;
  canonicalName: string;
  normalizedName: string;
  entityType: EntityType;
  description: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface GraphAliasRecord {
  id: string;
  workspaceId: string;
  entityId: string;
  alias: string;
  normalizedAlias: string;
  aliasType: string;
  createdAt: Date;
}

export interface GraphRelationRecord {
  id: string;
  workspaceId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  description: string | null;
  weight: number;
  confidence: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface IGraphRepository {
  findEntityById(workspaceId: string, id: string): Promise<GraphEntityRecord | null>;
  findEntityByName(workspaceId: string, normalizedName: string): Promise<GraphEntityRecord | null>;
  findEntityByAlias(
    workspaceId: string,
    normalizedAlias: string,
  ): Promise<GraphEntityRecord | null>;
  createEntity(input: CreateEntityInput): Promise<GraphEntityRecord>;
  updateEntity(
    workspaceId: string,
    id: string,
    data: UpdateEntityInput,
  ): Promise<GraphEntityRecord>;
  createAlias(input: CreateAliasInput): Promise<GraphAliasRecord>;
  createRelation(input: CreateRelationInput): Promise<GraphRelationRecord>;
  createMention(input: CreateMentionInput): Promise<{ id: string }>;
  createEvidence(input: CreateEvidenceInput): Promise<{ id: string }>;
  deleteEntity(workspaceId: string, id: string): Promise<boolean>;
  findRelations(workspaceId: string, entityId: string): Promise<GraphRelationRecord[]>;
  findRelationById(workspaceId: string, id: string): Promise<GraphRelationRecord | null>;
  findRelationByEndpoints(
    workspaceId: string,
    sourceEntityId: string,
    targetEntityId: string,
    relationType: string,
  ): Promise<GraphRelationRecord | null>;
  upsertRelation(input: CreateRelationInput): Promise<GraphRelationRecord>;
  findMention(
    workspaceId: string,
    chunkId: string,
    entityId: string,
  ): Promise<{ id: string } | null>;
  createMentionIdempotent(input: CreateMentionInput): Promise<{ id: string }>;
  findEvidence(
    workspaceId: string,
    relationId: string,
    chunkId: string,
  ): Promise<{ id: string } | null>;
  createEvidenceIdempotent(input: CreateEvidenceInput): Promise<{ id: string }>;
}
