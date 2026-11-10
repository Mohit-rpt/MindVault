/**
 * MindVault — Graph API Routes (Phase 6.5)
 *
 * Mounts:
 * - GET  /api/graph/entities/:id/neighborhood (Bounded neighborhood traversal)
 * - POST /api/graph/paths (Directed multi-hop path discovery)
 *
 * All routes require authentication and MEMBER role in the target workspace.
 */

import { Router } from 'express';
import { authenticate } from '../../../middleware/authenticate.js';
import { authorizeWorkspace } from '../../../middleware/authorizeWorkspace.js';
import { GraphController, graphController } from '../controllers/graph.controller.js';

export function createGraphRouter(controller: GraphController = graphController): Router {
  const router: Router = Router();

  /**
   * GET /api/graph/entities
   * Paginated and searchable entity directory.
   */
  router.get('/entities', authenticate, authorizeWorkspace('MEMBER'), controller.listEntities);

  /**
   * GET /api/graph/entities/:id/neighborhood
   * Retrieves a bounded subgraph centered at the specified entity.
   */
  router.get(
    '/entities/:id/neighborhood',
    authenticate,
    authorizeWorkspace('MEMBER'),
    controller.getNeighborhood,
  );

  /**
   * GET /api/graph/entities/:id
   * Retrieves entity details with degree counts, aliases, and document mentions.
   */
  router.get('/entities/:id', authenticate, authorizeWorkspace('MEMBER'), controller.getEntityById);

  /**
   * GET /api/graph/relations/:id/evidence
   * Retrieves verified evidence chunks and document references supporting a relation.
   */
  router.get(
    '/relations/:id/evidence',
    authenticate,
    authorizeWorkspace('MEMBER'),
    controller.getRelationEvidence,
  );

  /**
   * GET /api/graph/overview
   * Workspace-scoped knowledge graph metrics and hub overview.
   */
  router.get('/overview', authenticate, authorizeWorkspace('MEMBER'), controller.getOverview);

  /**
   * POST /api/graph/paths
   * Calculates relationship paths connecting two entities across multiple documents.
   */
  router.post('/paths', authenticate, authorizeWorkspace('MEMBER'), controller.findPaths);

  return router;
}

export const graphRoutes: Router = createGraphRouter();
