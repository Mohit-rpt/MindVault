/**
 * MindVault — Generation Engine: RAG API Routes
 *
 * Mounts:
 * - POST /api/rag/answer (Non-streaming)
 * - POST /api/rag/stream (Server-Sent Events streaming)
 *
 * All endpoints are guarded by authenticate and authorizeWorkspace('MEMBER').
 */

import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorizeWorkspace } from '../../middleware/authorizeWorkspace.js';
import { GenerationController } from './generation.controller.js';

export function createGenerationRouter(): Router {
  const router: Router = Router();

  // Non-streaming RAG answer endpoint
  router.post('/answer', authenticate, authorizeWorkspace('MEMBER'), GenerationController.answer);

  // Server-Sent Events (SSE) streaming RAG answer endpoint
  router.post('/stream', authenticate, authorizeWorkspace('MEMBER'), GenerationController.stream);

  return router;
}
