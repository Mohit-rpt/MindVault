/**
 * MindVault — Graph Traversal Service (Phase 6.5)
 *
 * Implements bounded multi-hop neighborhood expansion and path discovery
 * with strict multi-tenant authorization, parameter boundaries, and
 * deterministic DTO mapping.
 */

import {
  GraphNeighborhoodQuerySchema,
  PathFinderRequestSchema,
  GraphEntityListQuerySchema,
  type GraphNeighborhoodQuery,
  type GraphNeighborhoodDto,
  type GraphNeighborhoodNodeDto,
  type GraphNeighborhoodEdgeDto,
  type RawNeighborhoodRelationRow,
  type GraphPathDto,
  type GraphDiscoveredPathDto,
  type GraphPathNodeDto,
  type GraphPathRelationDto,
  type RawPathFinderRow,
  type GraphEntityListQuery,
  type GraphEntityListResponseDto,
  type GraphEntityDetailDto,
  type RelationEvidenceDetailDto,
  type GraphOverviewDto,
} from '@mindvault/shared';
import { prisma } from '../../../lib/prisma.js';
import { dbService } from '../../../lib/db.js';
import { graphRepository, type GraphRepository } from '../repositories/graph.repository.js';
import type { IGraphRepository } from '../repositories/graph.repository.interface.js';
import {
  InvalidGraphQueryError,
  ForbiddenWorkspaceError,
  EntityNotFoundError,
  RelationNotFoundError,
} from '../errors/graph-traversal.error.js';

export interface GetNeighborhoodOptions {
  workspaceId: string;
  centerEntityId: string;
  query?: unknown;
  userId?: string;
}

export interface FindPathsOptions {
  workspaceId: string;
  sourceEntityId: string;
  targetEntityId: string;
  query?: unknown;
  userId?: string;
}

export interface ListEntitiesOptions {
  workspaceId: string;
  query?: unknown;
  userId?: string;
}

export interface GetEntityDetailOptions {
  workspaceId: string;
  entityId: string;
  userId?: string;
}

export interface GetRelationEvidenceOptions {
  workspaceId: string;
  relationId: string;
  userId?: string;
}

export interface GetOverviewOptions {
  workspaceId: string;
  userId?: string;
}

export class GraphTraversalService {
  constructor(private readonly graphRepo: IGraphRepository = graphRepository) {}

  /**
   * Retrieves a bounded multi-hop subgraph neighborhood centered around a target entity.
   *
   * Enforces:
   * 1. Schema validation (1 <= depth <= 3, 5 <= limit <= 100, direction in ['both', 'outgoing', 'incoming'])
   * 2. Workspace membership authorization (if userId is provided)
   * 3. Workspace existence verification
   * 4. Center entity existence within the specified workspace
   * 5. Defensive depth/limit parameter clamping
   * 6. Safe execution of repository SQL traversal with 2500ms statement timeout
   * 7. Deterministic mapping to GraphNeighborhoodDto including subgraph degree calculation
   * 8. Safe empty neighborhood handling (center entity returned with degree 0)
   */
  public async getNeighborhood(
    workspaceIdOrOptions: string | GetNeighborhoodOptions,
    centerEntityIdArg?: string,
    queryArg?: unknown,
    userIdArg?: string,
  ): Promise<GraphNeighborhoodDto> {
    let workspaceId: string;
    let centerEntityId: string;
    let rawQuery: unknown;
    let userId: string | undefined;

    if (typeof workspaceIdOrOptions === 'object' && workspaceIdOrOptions !== null) {
      workspaceId = workspaceIdOrOptions.workspaceId;
      centerEntityId = workspaceIdOrOptions.centerEntityId;
      rawQuery = workspaceIdOrOptions.query;
      userId = workspaceIdOrOptions.userId;
    } else {
      workspaceId = workspaceIdOrOptions;
      centerEntityId = centerEntityIdArg!;
      rawQuery = queryArg;
      userId = userIdArg;
    }

    // 1. Validate required identifier inputs
    if (!workspaceId || typeof workspaceId !== 'string' || !workspaceId.trim()) {
      throw new InvalidGraphQueryError('Workspace ID is required');
    }
    if (!centerEntityId || typeof centerEntityId !== 'string' || !centerEntityId.trim()) {
      throw new InvalidGraphQueryError('Center entity ID is required');
    }

    // 2. Validate query options against approved Zod schema
    const parsed = GraphNeighborhoodQuerySchema.safeParse(rawQuery ?? {});
    if (!parsed.success) {
      const issueSummary = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ');
      throw new InvalidGraphQueryError(
        `Invalid neighborhood query parameters: ${issueSummary}`,
        parsed.error.issues,
      );
    }

    const { direction } = parsed.data;
    // Defensive clamping on validated depth (1..3) and limit (5..100)
    const effectiveDepth = Math.min(Math.max(parsed.data.depth, 1), 3);
    const effectiveLimit = Math.min(Math.max(parsed.data.limit, 5), 100);

    // 3. Authorization: Verify user workspace membership (if userId provided)
    if (userId) {
      const member = await dbService.getWorkspaceMember(workspaceId, userId);
      if (!member) {
        throw new ForbiddenWorkspaceError(
          `User '${userId}' is not a member of workspace '${workspaceId}'`,
        );
      }
    } else {
      // Verify workspace exists in the system
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true },
      });
      if (!workspace) {
        throw new ForbiddenWorkspaceError(`Workspace '${workspaceId}' not found or access denied`);
      }
    }

    // 4. Verify center entity exists in the authenticated workspace
    const centerEntity = await this.graphRepo.findEntityById(workspaceId, centerEntityId);
    if (!centerEntity) {
      throw new EntityNotFoundError(centerEntityId);
    }

    // 5. Execute bounded SQL traversal via repository
    const rows = await this.graphRepo.traverseNeighborhood({
      workspaceId,
      centerEntityId: centerEntity.id,
      direction,
      maxDepth: effectiveDepth,
      limit: effectiveLimit,
    });

    // 6. Map raw repository rows to GraphNeighborhoodDto
    return this.mapToNeighborhoodDto(centerEntity, rows, effectiveDepth);
  }

  /**
   * Maps raw database traversal rows into the canonical GraphNeighborhoodDto structure.
   */
  private mapToNeighborhoodDto(
    centerEntity: {
      id: string;
      canonicalName: string;
      entityType: string;
      description: string | null;
    },
    rows: RawNeighborhoodRelationRow[],
    depth: number,
  ): GraphNeighborhoodDto {
    // 1. Map edges preserving direction, confidence, weight, and evidence counts
    const edges: GraphNeighborhoodEdgeDto[] = rows.map((r) => ({
      id: r.relation_id,
      source: r.source_id,
      target: r.target_id,
      label: r.relation_type,
      description: r.relation_description ?? null,
      weight: Number(r.weight),
      confidence: Number(r.confidence),
      evidenceCount: Number(r.evidence_count),
    }));

    // 2. Map nodes with center entity initialized at depth 0
    const nodeMap = new Map<string, GraphNeighborhoodNodeDto>();

    nodeMap.set(centerEntity.id, {
      id: centerEntity.id,
      label: centerEntity.canonicalName,
      entityType: centerEntity.entityType,
      description: centerEntity.description ?? null,
      degree: 0,
      depth: 0,
    });

    for (const row of rows) {
      // Source node
      const existingSource = nodeMap.get(row.source_id);
      if (!existingSource) {
        nodeMap.set(row.source_id, {
          id: row.source_id,
          label: row.source_name,
          entityType: row.source_type,
          description: row.source_description ?? null,
          degree: 0,
          depth: row.depth,
        });
      } else if (row.source_id !== centerEntity.id) {
        existingSource.depth = Math.min(existingSource.depth, row.depth);
      }

      // Target node
      const existingTarget = nodeMap.get(row.target_id);
      if (!existingTarget) {
        nodeMap.set(row.target_id, {
          id: row.target_id,
          label: row.target_name,
          entityType: row.target_type,
          description: row.target_description ?? null,
          degree: 0,
          depth: row.depth,
        });
      } else if (row.target_id !== centerEntity.id) {
        existingTarget.depth = Math.min(existingTarget.depth, row.depth);
      }
    }

    // 3. Calculate degree centrality in the returned subgraph
    for (const edge of edges) {
      const sNode = nodeMap.get(edge.source);
      if (sNode) sNode.degree += 1;
      const tNode = nodeMap.get(edge.target);
      if (tNode) tNode.degree += 1;
    }

    // 4. Deterministic node ordering: Center entity first (depth 0),
    // then sorted by depth ASC, degree DESC, label ASC, id ASC
    const nodes = Array.from(nodeMap.values()).sort((a, b) => {
      if (a.id === centerEntity.id) return -1;
      if (b.id === centerEntity.id) return 1;
      if (a.depth !== b.depth) return a.depth - b.depth;
      if (a.degree !== b.degree) return b.degree - a.degree;
      const labelComp = a.label.localeCompare(b.label);
      if (labelComp !== 0) return labelComp;
      return a.id.localeCompare(b.id);
    });

    return {
      centerEntityId: centerEntity.id,
      depth,
      totalNodes: nodes.length,
      totalEdges: edges.length,
      nodes,
      edges,
    };
  }

  /**
   * Discovers bounded directed paths between two entities within a workspace.
   *
   * Enforces:
   * 1. Schema validation (1 <= maxDepth <= 4, 1 <= limit <= 10, valid UUIDs)
   * 2. Workspace membership authorization (if userId is provided)
   * 3. Workspace existence verification
   * 4. Source & target entity existence within the specified workspace (prevents cross-tenant IDOR)
   * 5. Defensive depth/limit parameter clamping
   * 6. Safe execution of repository SQL path discovery with 2500ms statement timeout
   * 7. Clean handling of identical source & target entities (returns 0 paths found)
   * 8. Clean handling of disconnected entities (empty paths array)
   * 9. Deterministic mapping to GraphPathDto with entity and relation resolution
   */
  public async findPaths(
    workspaceIdOrOptions: string | FindPathsOptions,
    sourceEntityIdArg?: string,
    targetEntityIdArg?: string,
    queryArg?: unknown,
    userIdArg?: string,
  ): Promise<GraphPathDto> {
    let workspaceId: string;
    let sourceEntityId: string;
    let targetEntityId: string;
    let rawQuery: unknown;
    let userId: string | undefined;

    if (typeof workspaceIdOrOptions === 'object' && workspaceIdOrOptions !== null) {
      workspaceId = workspaceIdOrOptions.workspaceId;
      sourceEntityId = workspaceIdOrOptions.sourceEntityId;
      targetEntityId = workspaceIdOrOptions.targetEntityId;
      rawQuery = workspaceIdOrOptions.query;
      userId = workspaceIdOrOptions.userId;
    } else {
      workspaceId = workspaceIdOrOptions;
      sourceEntityId = sourceEntityIdArg!;
      targetEntityId = targetEntityIdArg!;
      rawQuery = queryArg;
      userId = userIdArg;
    }

    // 1. Validate required identifier inputs
    if (!workspaceId || typeof workspaceId !== 'string' || !workspaceId.trim()) {
      throw new InvalidGraphQueryError('Workspace ID is required');
    }
    if (!sourceEntityId || typeof sourceEntityId !== 'string' || !sourceEntityId.trim()) {
      throw new InvalidGraphQueryError('Source entity ID is required');
    }
    if (!targetEntityId || typeof targetEntityId !== 'string' || !targetEntityId.trim()) {
      throw new InvalidGraphQueryError('Target entity ID is required');
    }

    // 2. Validate query options against approved Zod schema
    const rawParams =
      typeof rawQuery === 'object' && rawQuery !== null
        ? (rawQuery as Record<string, unknown>)
        : {};
    const inputToValidate = {
      sourceEntityId: rawParams.sourceEntityId ?? sourceEntityId,
      targetEntityId: rawParams.targetEntityId ?? targetEntityId,
      maxDepth: rawParams.maxDepth,
      limit: rawParams.limit,
    };
    const parsed = PathFinderRequestSchema.safeParse(inputToValidate);
    if (!parsed.success) {
      const issueSummary = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ');
      throw new InvalidGraphQueryError(
        `Invalid path finder parameters: ${issueSummary}`,
        parsed.error.issues,
      );
    }

    // Defensive clamping on validated maxDepth (1..4) and limit (1..10)
    const effectiveMaxDepth = Math.min(Math.max(parsed.data.maxDepth, 1), 4);
    const effectiveLimit = Math.min(Math.max(parsed.data.limit, 1), 10);

    // 3. Authorization: Verify user workspace membership (if userId provided)
    if (userId) {
      const member = await dbService.getWorkspaceMember(workspaceId, userId);
      if (!member) {
        throw new ForbiddenWorkspaceError(
          `User '${userId}' is not a member of workspace '${workspaceId}'`,
        );
      }
    } else {
      // Verify workspace exists in the system
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true },
      });
      if (!workspace) {
        throw new ForbiddenWorkspaceError(`Workspace '${workspaceId}' not found or access denied`);
      }
    }

    // 4. Verify source and target entities exist in the authenticated workspace
    const [sourceEntity, targetEntity] = await Promise.all([
      this.graphRepo.findEntityById(workspaceId, sourceEntityId),
      this.graphRepo.findEntityById(workspaceId, targetEntityId),
    ]);

    if (!sourceEntity) {
      throw new EntityNotFoundError(sourceEntityId);
    }
    if (!targetEntity) {
      throw new EntityNotFoundError(targetEntityId);
    }

    // 5. Short-circuit: Identical source and target entities
    if (sourceEntityId === targetEntityId) {
      return {
        sourceEntityId: sourceEntity.id,
        targetEntityId: targetEntity.id,
        pathsFound: 0,
        paths: [],
      };
    }

    // 6. Execute bounded SQL path discovery via repository
    const rows = await this.graphRepo.findPaths({
      workspaceId,
      sourceEntityId: sourceEntity.id,
      targetEntityId: targetEntity.id,
      maxDepth: effectiveMaxDepth,
      limit: effectiveLimit,
    });

    if (rows.length === 0) {
      return {
        sourceEntityId: sourceEntity.id,
        targetEntityId: targetEntity.id,
        pathsFound: 0,
        paths: [],
      };
    }

    // 7. Resolve entity names for intermediate nodes across discovered paths
    const entityNameMap = new Map<string, string>();
    entityNameMap.set(sourceEntity.id, sourceEntity.canonicalName);
    entityNameMap.set(targetEntity.id, targetEntity.canonicalName);

    const allEntityIds = new Set<string>();
    for (const row of rows) {
      for (const id of row.entity_path) {
        allEntityIds.add(id);
      }
    }

    const missingIds = Array.from(allEntityIds).filter((id) => !entityNameMap.has(id));
    if (missingIds.length > 0) {
      if (typeof this.graphRepo.findEntitiesByIds === 'function') {
        const intermediateEntities = await this.graphRepo.findEntitiesByIds(
          workspaceId,
          missingIds,
        );
        for (const ent of intermediateEntities) {
          entityNameMap.set(ent.id, ent.canonicalName);
        }
      } else {
        const lookups = await Promise.all(
          missingIds.map((id) => this.graphRepo.findEntityById(workspaceId, id)),
        );
        for (const ent of lookups) {
          if (ent) entityNameMap.set(ent.id, ent.canonicalName);
        }
      }
    }

    // 8. Map to canonical GraphDiscoveredPathDto list
    const paths: GraphDiscoveredPathDto[] = rows.map((row) => ({
      depth: Number(row.depth),
      weight: Number(row.weight),
      confidence: Number(row.confidence),
      pathEntities: row.entity_path.map((id) => ({
        id,
        name: entityNameMap.get(id) ?? id,
      })),
      pathRelations: row.relation_path.map((relId, idx) => ({
        id: relId,
        type: row.type_path[idx] ?? '',
      })),
    }));

    return {
      sourceEntityId: sourceEntity.id,
      targetEntityId: targetEntity.id,
      pathsFound: paths.length,
      paths,
    };
  }

  /**
   * Helper to verify workspace authorization and membership.
   */
  private async authorizeWorkspace(workspaceId: string, userId?: string): Promise<void> {
    if (!workspaceId || typeof workspaceId !== 'string' || !workspaceId.trim()) {
      throw new InvalidGraphQueryError('Workspace ID is required');
    }
    if (userId) {
      const member = await dbService.getWorkspaceMember(workspaceId, userId);
      if (!member) {
        throw new ForbiddenWorkspaceError(
          `User '${userId}' is not a member of workspace '${workspaceId}'`,
        );
      }
    } else {
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true },
      });
      if (!workspace) {
        throw new ForbiddenWorkspaceError(`Workspace '${workspaceId}' not found or access denied`);
      }
    }
  }

  /**
   * Paginated and searchable entity directory.
   */
  public async listEntities(options: ListEntitiesOptions): Promise<GraphEntityListResponseDto> {
    await this.authorizeWorkspace(options.workspaceId, options.userId);

    const parsed = GraphEntityListQuerySchema.safeParse(options.query ?? {});
    if (!parsed.success) {
      const issueSummary = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ');
      throw new InvalidGraphQueryError(
        `Invalid entity list query parameters: ${issueSummary}`,
        parsed.error.issues,
      );
    }

    return this.graphRepo.listEntities(options.workspaceId, parsed.data);
  }

  /**
   * Deep entity inspection with degree counts, aliases, and document references.
   */
  public async getEntityDetail(options: GetEntityDetailOptions): Promise<GraphEntityDetailDto> {
    await this.authorizeWorkspace(options.workspaceId, options.userId);

    if (!options.entityId || typeof options.entityId !== 'string' || !options.entityId.trim()) {
      throw new InvalidGraphQueryError('Entity ID is required');
    }

    const detail = await this.graphRepo.getEntityDetail(options.workspaceId, options.entityId);
    if (!detail) {
      throw new EntityNotFoundError(options.entityId);
    }

    return detail;
  }

  /**
   * Evidence-backed relationship inspection with chunk citations and document references.
   */
  public async getRelationEvidence(
    options: GetRelationEvidenceOptions,
  ): Promise<RelationEvidenceDetailDto> {
    await this.authorizeWorkspace(options.workspaceId, options.userId);

    if (
      !options.relationId ||
      typeof options.relationId !== 'string' ||
      !options.relationId.trim()
    ) {
      throw new InvalidGraphQueryError('Relation ID is required');
    }

    const detail = await this.graphRepo.getRelationEvidenceDetail(
      options.workspaceId,
      options.relationId,
    );
    if (!detail) {
      throw new RelationNotFoundError(options.relationId);
    }

    return detail;
  }

  /**
   * Workspace-scoped graph metrics and hub overview.
   */
  public async getOverview(options: GetOverviewOptions): Promise<GraphOverviewDto> {
    await this.authorizeWorkspace(options.workspaceId, options.userId);

    return this.graphRepo.getGraphOverview(options.workspaceId);
  }
}

export const graphTraversalService = new GraphTraversalService();
