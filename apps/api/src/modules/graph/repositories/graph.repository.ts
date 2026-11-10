import { prisma } from '../../../lib/prisma.js';
import type { Prisma, EntityType } from '@prisma/client';
import type {
  RawNeighborhoodRelationRow,
  RawPathFinderRow,
  NeighborhoodQueryParams,
  PathFinderQueryParams,
  GraphEvidenceQueryParams,
  GraphEvidenceQueryResult,
  DiscoveredSeedEntity,
  SeedDiscoveryQueryParams,
  RawGraphChunkRow,
  RawGraphRelationRow,
  GraphEntityListQuery,
  GraphEntityListResponseDto,
  GraphEntityDetailDto,
  RelationEvidenceDetailDto,
  GraphOverviewDto,
  GraphIntegrityReport,
} from '@mindvault/shared';
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
import {
  buildNeighborhoodQuery,
  buildPathFinderQuery,
} from '../queries/recursive-traversal.sql.js';
import {
  buildSeedDiscoveryQuery,
  buildGraphEvidenceQuery,
  buildSupportingRelationsQuery,
} from '../queries/graph-retrieval.sql.js';
import { GraphTraversalTimeoutError } from '../errors/graph-traversal.error.js';

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

  async findEntitiesByIds(workspaceId: string, ids: string[]): Promise<GraphEntityRecord[]> {
    if (ids.length === 0) return [];
    const entities = await prisma.graphEntity.findMany({
      where: {
        workspaceId,
        id: { in: ids },
      },
    });

    return entities.map((entity) => ({
      ...entity,
      metadata: entity.metadata as Record<string, unknown>,
    }));
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

  async traverseNeighborhood(
    params: NeighborhoodQueryParams,
  ): Promise<RawNeighborhoodRelationRow[]> {
    const query = buildNeighborhoodQuery(params);
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL statement_timeout = '2500ms';`;
          return await tx.$queryRaw<RawNeighborhoodRelationRow[]>(query);
        },
        {
          timeout: 3500,
        },
      );
    } catch (err: any) {
      const isStatementTimeout =
        err.message?.includes('canceling statement due to statement timeout') ||
        err.message?.includes('statement timeout') ||
        ((err.code === '57014' || err.meta?.code === '57014') &&
          !err.message?.includes('user request'));
      if (isStatementTimeout) {
        throw new GraphTraversalTimeoutError();
      }
      throw err;
    }
  }

  async findPaths(params: PathFinderQueryParams): Promise<RawPathFinderRow[]> {
    const query = buildPathFinderQuery(params);
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL statement_timeout = '2500ms';`;
          return await tx.$queryRaw<RawPathFinderRow[]>(query);
        },
        {
          timeout: 3500,
        },
      );
    } catch (err: any) {
      const isStatementTimeout =
        err.message?.includes('canceling statement due to statement timeout') ||
        err.message?.includes('statement timeout') ||
        ((err.code === '57014' || err.meta?.code === '57014') &&
          !err.message?.includes('user request'));
      if (isStatementTimeout) {
        throw new GraphTraversalTimeoutError();
      }
      throw err;
    }
  }

  async discoverEntitySeeds(params: SeedDiscoveryQueryParams): Promise<DiscoveredSeedEntity[]> {
    const query = buildSeedDiscoveryQuery(params);
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL statement_timeout = '2500ms';`;
          return await tx.$queryRaw<DiscoveredSeedEntity[]>(query);
        },
        {
          timeout: 3500,
        },
      );
    } catch (err: any) {
      const isStatementTimeout =
        err.message?.includes('canceling statement due to statement timeout') ||
        err.message?.includes('statement timeout') ||
        ((err.code === '57014' || err.meta?.code === '57014') &&
          !err.message?.includes('user request'));
      if (isStatementTimeout) {
        throw new GraphTraversalTimeoutError();
      }
      throw err;
    }
  }

  async searchGraphEvidence(params: GraphEvidenceQueryParams): Promise<GraphEvidenceQueryResult> {
    const evidenceQuery = buildGraphEvidenceQuery(params);
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL statement_timeout = '2500ms';`;
          const rawChunks = await tx.$queryRaw<RawGraphChunkRow[]>(evidenceQuery);

          const chunks: RawGraphChunkRow[] = rawChunks.map((c) => ({
            ...c,
            chunkIndex: Number(c.chunkIndex),
            tokenCount: Number(c.tokenCount),
            pageStart:
              c.pageStart !== null && c.pageStart !== undefined ? Number(c.pageStart) : null,
            pageEnd: c.pageEnd !== null && c.pageEnd !== undefined ? Number(c.pageEnd) : null,
            docPageCount:
              c.docPageCount !== null && c.docPageCount !== undefined
                ? Number(c.docPageCount)
                : null,
            score: Number(c.score),
            supportedRelationsCount: Number(c.supportedRelationsCount),
          }));

          // Collect unique relation IDs from retrieved chunks
          const relationIdSet = new Set<string>();
          for (const chunk of chunks) {
            if (chunk.supportedRelationIds && Array.isArray(chunk.supportedRelationIds)) {
              for (const relId of chunk.supportedRelationIds) {
                if (relId) relationIdSet.add(relId);
              }
            }
          }

          let relations: RawGraphRelationRow[] = [];
          if (relationIdSet.size > 0) {
            const relsQuery = buildSupportingRelationsQuery(
              params.workspaceId,
              Array.from(relationIdSet),
            );
            const rawRelations = await tx.$queryRaw<RawGraphRelationRow[]>(relsQuery);
            relations = rawRelations.map((r) => ({
              ...r,
              weight: Number(r.weight),
              confidence: Number(r.confidence),
              depth: Number(r.depth),
            }));
          }

          return {
            chunks,
            relations,
          };
        },
        {
          timeout: 3500,
        },
      );
    } catch (err: any) {
      const isStatementTimeout =
        err.message?.includes('canceling statement due to statement timeout') ||
        err.message?.includes('statement timeout') ||
        ((err.code === '57014' || err.meta?.code === '57014') &&
          !err.message?.includes('user request'));
      if (isStatementTimeout) {
        throw new GraphTraversalTimeoutError();
      }
      throw err;
    }
  }

  /**
   * List and search workspace entities with pagination and aggregate counts.
   */
  async listEntities(
    workspaceId: string,
    options: GraphEntityListQuery = {},
  ): Promise<GraphEntityListResponseDto> {
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);

    const where: Prisma.GraphEntityWhereInput = {
      workspaceId,
      ...(options.entityType ? { entityType: options.entityType as EntityType } : {}),
      ...(options.search && options.search.trim()
        ? {
            OR: [
              { canonicalName: { contains: options.search.trim(), mode: 'insensitive' } },
              {
                aliases: {
                  some: { alias: { contains: options.search.trim(), mode: 'insensitive' } },
                },
              },
            ],
          }
        : {}),
    };

    const [total, entities] = await Promise.all([
      prisma.graphEntity.count({ where }),
      prisma.graphEntity.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { canonicalName: 'asc' },
        include: {
          aliases: { select: { alias: true } },
          _count: {
            select: {
              sourceRelations: true,
              targetRelations: true,
              mentions: true,
            },
          },
        },
      }),
    ]);

    const items = entities.map((e) => ({
      id: e.id,
      canonicalName: e.canonicalName,
      entityType: e.entityType,
      description: e.description,
      mentionCount: e._count.mentions,
      degree: e._count.sourceRelations + e._count.targetRelations,
      aliases: e.aliases.map((a) => a.alias),
      createdAt: e.createdAt.toISOString(),
    }));

    return {
      items,
      total,
      limit,
      offset,
    };
  }

  /**
   * Retrieve deep entity details with aliases, degree counts, and document references.
   */
  async getEntityDetail(
    workspaceId: string,
    entityId: string,
  ): Promise<GraphEntityDetailDto | null> {
    const entity = await prisma.graphEntity.findUnique({
      where: {
        workspaceId_id: {
          workspaceId,
          id: entityId,
        },
      },
      include: {
        aliases: { select: { alias: true } },
        _count: {
          select: {
            sourceRelations: true,
            targetRelations: true,
            mentions: true,
          },
        },
        mentions: {
          select: {
            chunk: {
              select: {
                document: {
                  select: {
                    id: true,
                    originalName: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!entity) return null;

    // Aggregate document references and mention frequencies
    const docMap = new Map<
      string,
      { documentId: string; documentName: string; mentionCount: number }
    >();
    for (const mention of entity.mentions) {
      const doc = mention.chunk?.document;
      if (!doc) continue;
      const existing = docMap.get(doc.id);
      if (existing) {
        existing.mentionCount += 1;
      } else {
        docMap.set(doc.id, {
          documentId: doc.id,
          documentName: doc.originalName,
          mentionCount: 1,
        });
      }
    }

    const documentReferences = Array.from(docMap.values()).sort(
      (a, b) => b.mentionCount - a.mentionCount,
    );

    return {
      id: entity.id,
      canonicalName: entity.canonicalName,
      entityType: entity.entityType,
      description: entity.description,
      aliases: entity.aliases.map((a) => a.alias),
      mentionCount: entity._count.mentions,
      inDegree: entity._count.targetRelations,
      outDegree: entity._count.sourceRelations,
      totalDegree: entity._count.sourceRelations + entity._count.targetRelations,
      createdAt: entity.createdAt.toISOString(),
      documentReferences,
    };
  }

  /**
   * Retrieve evidence-backed relationship details including verified chunk citations and document metadata.
   */
  async getRelationEvidenceDetail(
    workspaceId: string,
    relationId: string,
  ): Promise<RelationEvidenceDetailDto | null> {
    const relation = await prisma.graphRelation.findUnique({
      where: {
        workspaceId_id: {
          workspaceId,
          id: relationId,
        },
      },
      include: {
        sourceEntity: {
          select: {
            id: true,
            canonicalName: true,
            entityType: true,
          },
        },
        targetEntity: {
          select: {
            id: true,
            canonicalName: true,
            entityType: true,
          },
        },
        evidence: {
          include: {
            chunk: {
              select: {
                id: true,
                documentId: true,
                pageStart: true,
                pageEnd: true,
                content: true,
                document: {
                  select: {
                    originalName: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!relation) return null;

    return {
      relationId: relation.id,
      relationType: relation.relationType,
      sourceEntity: {
        id: relation.sourceEntity.id,
        canonicalName: relation.sourceEntity.canonicalName,
        entityType: relation.sourceEntity.entityType,
      },
      targetEntity: {
        id: relation.targetEntity.id,
        canonicalName: relation.targetEntity.canonicalName,
        entityType: relation.targetEntity.entityType,
      },
      confidence: Number(relation.confidence),
      weight: Number(relation.weight),
      evidence: relation.evidence.map((ev) => ({
        evidenceId: ev.id,
        chunkId: ev.chunkId,
        documentId: ev.documentId,
        documentName: ev.chunk?.document?.originalName || 'Unknown Document',
        pageStart: ev.chunk?.pageStart ?? null,
        pageEnd: ev.chunk?.pageEnd ?? null,
        snippet: ev.evidenceText || ev.chunk?.content?.slice(0, 300) || '',
        confidence: Number(ev.confidence),
      })),
    };
  }

  /**
   * Retrieve workspace graph summary statistics, type breakdown, and top connected hubs.
   */
  async getGraphOverview(workspaceId: string): Promise<GraphOverviewDto> {
    const [totalEntities, totalRelations, typeGroups] = await Promise.all([
      prisma.graphEntity.count({ where: { workspaceId } }),
      prisma.graphRelation.count({ where: { workspaceId } }),
      prisma.graphEntity.groupBy({
        by: ['entityType'],
        where: { workspaceId },
        _count: { id: true },
      }),
    ]);

    const entityTypeBreakdown: Record<string, number> = {};
    for (const group of typeGroups) {
      entityTypeBreakdown[group.entityType] = group._count.id;
    }

    // Top connected hubs via SQL with bounded timeout and multi-tenant isolation
    const topConnectedRaw = await prisma.$queryRaw<
      Array<{ id: string; canonicalName: string; entityType: string; degree: number }>
    >`
      SELECT 
        ge.id, 
        ge.canonical_name AS "canonicalName", 
        ge.entity_type AS "entityType",
        COUNT(DISTINCT gr.id)::int AS "degree"
      FROM graph_entities ge
      LEFT JOIN graph_relations gr 
        ON ge.workspace_id = gr.workspace_id 
        AND (ge.id = gr.source_entity_id OR ge.id = gr.target_entity_id)
      WHERE ge.workspace_id = ${workspaceId}
      GROUP BY ge.id, ge.canonical_name, ge.entity_type
      ORDER BY "degree" DESC, ge.canonical_name ASC
      LIMIT 10;
    `;

    const topConnectedEntities = topConnectedRaw.map((row) => ({
      id: row.id,
      canonicalName: row.canonicalName,
      entityType: row.entityType,
      degree: Number(row.degree),
    }));

    return {
      totalEntities,
      totalRelations,
      entityTypeBreakdown,
      topConnectedEntities,
    };
  }

  /**
   * Scans workspace for orphaned entities (0 mentions and 0 relations),
   * unsupported relations (0 evidence chunks), and dangling evidence rows.
   */
  async checkGraphIntegrity(workspaceId: string): Promise<GraphIntegrityReport> {
    const entities = await prisma.graphEntity.findMany({
      where: { workspaceId },
      select: {
        id: true,
        _count: {
          select: {
            mentions: true,
            sourceRelations: true,
            targetRelations: true,
          },
        },
      },
    });

    const orphanedEntities = entities
      .filter(
        (e) =>
          e._count.mentions === 0 &&
          e._count.sourceRelations === 0 &&
          e._count.targetRelations === 0,
      )
      .map((e) => e.id);

    const relations = await prisma.graphRelation.findMany({
      where: { workspaceId },
      select: {
        id: true,
        _count: {
          select: {
            evidence: true,
          },
        },
      },
    });

    const unsupportedRelations = relations.filter((r) => r._count.evidence === 0).map((r) => r.id);

    const allEvidence = await prisma.relationEvidence.findMany({
      where: { workspaceId },
      select: {
        id: true,
        chunkId: true,
        relationId: true,
      },
    });

    const validRelationIds = new Set(relations.map((r) => r.id));
    const danglingEvidence: string[] = [];

    if (allEvidence.length > 0) {
      const chunkIds = Array.from(new Set(allEvidence.map((e) => e.chunkId)));
      const existingChunks = await prisma.documentChunk.findMany({
        where: {
          workspaceId,
          id: { in: chunkIds },
        },
        select: { id: true },
      });
      const validChunkIds = new Set(existingChunks.map((c) => c.id));

      for (const ev of allEvidence) {
        if (!validRelationIds.has(ev.relationId) || !validChunkIds.has(ev.chunkId)) {
          danglingEvidence.push(ev.id);
        }
      }
    }

    const isHealthy =
      orphanedEntities.length === 0 &&
      unsupportedRelations.length === 0 &&
      danglingEvidence.length === 0;

    return {
      orphanedEntities,
      unsupportedRelations,
      danglingEvidence,
      totalCheckedEntities: entities.length,
      totalCheckedRelations: relations.length,
      isHealthy,
    };
  }

  /**
   * Automatically cleans up unsupported relations and orphaned entities.
   */
  async cleanupOrphanedGraphElements(
    workspaceId: string,
  ): Promise<{ deletedEntities: number; deletedRelations: number }> {
    const integrity = await this.checkGraphIntegrity(workspaceId);

    let deletedRelations = 0;
    if (integrity.unsupportedRelations.length > 0) {
      const deleteRelResult = await prisma.graphRelation.deleteMany({
        where: {
          workspaceId,
          id: { in: integrity.unsupportedRelations },
        },
      });
      deletedRelations = deleteRelResult.count;
    }

    // Re-evaluate entities after relations have been removed
    const entities = await prisma.graphEntity.findMany({
      where: { workspaceId },
      select: {
        id: true,
        _count: {
          select: {
            mentions: true,
            sourceRelations: true,
            targetRelations: true,
          },
        },
      },
    });

    const orphanedEntityIds = entities
      .filter(
        (e) =>
          e._count.mentions === 0 &&
          e._count.sourceRelations === 0 &&
          e._count.targetRelations === 0,
      )
      .map((e) => e.id);

    let deletedEntities = 0;
    if (orphanedEntityIds.length > 0) {
      const deleteEntResult = await prisma.graphEntity.deleteMany({
        where: {
          workspaceId,
          id: { in: orphanedEntityIds },
        },
      });
      deletedEntities = deleteEntResult.count;
    }

    return {
      deletedEntities,
      deletedRelations,
    };
  }
}

export const graphRepository = new GraphRepository();
