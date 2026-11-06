import { Router } from 'express';
import { RetrievalController } from './retrieval.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorizeWorkspace } from '../../middleware/authorizeWorkspace.js';

export function createRetrievalRouter(
  controller: RetrievalController = new RetrievalController(),
): Router {
  const router: Router = Router();

  /**
   * POST /api/retrieval/search
   * Primary hybrid retrieval endpoint with multi-tenant isolation.
   */
  router.post('/search', authenticate, authorizeWorkspace('MEMBER'), controller.search);

  return router;
}

export const retrievalRoutes: Router = createRetrievalRouter();
