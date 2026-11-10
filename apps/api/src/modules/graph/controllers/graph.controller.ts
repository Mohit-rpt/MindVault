/**
 * MindVault — Graph Traversal Controller (Phase 6.5)
 *
 * Exposes bounded graph neighborhood retrieval and directed path discovery
 * endpoints with authenticated workspace access, multi-tenant authorization,
 * request validation, and canonical DTO envelopes.
 */

import type { Request, Response, NextFunction } from 'express';
import {
  graphTraversalService,
  GraphTraversalService,
} from '../services/graph-traversal.service.js';
import { AppError } from '../../../middleware/errorHandler.js';
import { InvalidGraphQueryError } from '../errors/graph-traversal.error.js';

export class GraphController {
  constructor(private readonly traversalService: GraphTraversalService = graphTraversalService) {}

  /**
   * GET /api/graph/entities/:id/neighborhood
   * Retrieves a bounded subgraph centered at the specified entity.
   */
  public getNeighborhood = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const workspaceId = this.getWorkspaceId(req);

      const centerEntityId = req.params.id;
      if (!centerEntityId || !centerEntityId.trim()) {
        throw new InvalidGraphQueryError('Center entity ID parameter :id is required');
      }

      const neighborhood = await this.traversalService.getNeighborhood({
        workspaceId,
        centerEntityId,
        query: req.query,
        userId: req.user?.id,
      });

      res.status(200).json({
        success: true,
        data: neighborhood,
        meta: {
          timestamp: new Date().toISOString(),
          workspaceId,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/graph/paths
   * Calculates relationship paths connecting two entities across documents.
   */
  public findPaths = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const workspaceId = this.getWorkspaceId(req);

      const pathResult = await this.traversalService.findPaths({
        workspaceId,
        sourceEntityId: req.body?.sourceEntityId,
        targetEntityId: req.body?.targetEntityId,
        query: req.body,
        userId: req.user?.id,
      });

      res.status(200).json({
        success: true,
        data: pathResult,
        meta: {
          timestamp: new Date().toISOString(),
          workspaceId,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Helper to extract workspaceId from request.
   * Guarantees authorized workspace context takes precedence over client-supplied overrides,
   * preventing cross-workspace tenant confusion and unauthorized parameter injection.
   */
  private getWorkspaceId(req: Request): string {
    const workspaceId =
      req.workspaceMember?.workspaceId ||
      req.workspace?.id ||
      (req.headers['x-workspace-id'] as string) ||
      (req.query?.workspaceId as string) ||
      (req.body?.workspaceId as string);

    if (!workspaceId) {
      throw new AppError(
        400,
        'MISSING_WORKSPACE_ID',
        'A valid workspaceId is required in headers (X-Workspace-ID), query, or body',
      );
    }
    return workspaceId;
  }

  /**
   * GET /api/graph/entities
   * Paginated directory of workspace entities with search and filtering.
   */
  public listEntities = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const workspaceId = this.getWorkspaceId(req);
      const result = await this.traversalService.listEntities({
        workspaceId,
        query: req.query,
        userId: req.user?.id,
      });

      res.status(200).json({
        success: true,
        data: result,
        meta: {
          timestamp: new Date().toISOString(),
          workspaceId,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/graph/entities/:id
   * Deep inspection of entity details, aliases, degree counts, and document mentions.
   */
  public getEntityById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const workspaceId = this.getWorkspaceId(req);
      const entityId = req.params.id;
      if (!entityId || !entityId.trim()) {
        throw new InvalidGraphQueryError('Entity ID parameter :id is required');
      }

      const detail = await this.traversalService.getEntityDetail({
        workspaceId,
        entityId,
        userId: req.user?.id,
      });

      res.status(200).json({
        success: true,
        data: detail,
        meta: {
          timestamp: new Date().toISOString(),
          workspaceId,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/graph/relations/:id/evidence
   * Evidence-backed relationship details with supporting chunk citations and snippets.
   */
  public getRelationEvidence = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const workspaceId = this.getWorkspaceId(req);
      const relationId = req.params.id;
      if (!relationId || !relationId.trim()) {
        throw new InvalidGraphQueryError('Relation ID parameter :id is required');
      }

      const evidence = await this.traversalService.getRelationEvidence({
        workspaceId,
        relationId,
        userId: req.user?.id,
      });

      res.status(200).json({
        success: true,
        data: evidence,
        meta: {
          timestamp: new Date().toISOString(),
          workspaceId,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /api/graph/overview
   * Workspace-scoped knowledge graph summary statistics and top connected hubs.
   */
  public getOverview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const workspaceId = this.getWorkspaceId(req);

      const overview = await this.traversalService.getOverview({
        workspaceId,
        userId: req.user?.id,
      });

      res.status(200).json({
        success: true,
        data: overview,
        meta: {
          timestamp: new Date().toISOString(),
          workspaceId,
        },
      });
    } catch (err) {
      next(err);
    }
  };
}

export const graphController = new GraphController();
