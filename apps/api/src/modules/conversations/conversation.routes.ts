/**
 * MindVault — Conversation API Routes
 *
 * Mounts:
 * - POST   /api/conversations (Create conversation)
 * - GET    /api/conversations (List user conversations)
 * - GET    /api/conversations/:sessionId (Get conversation details)
 * - GET    /api/conversations/:sessionId/messages (Get message history)
 * - PATCH  /api/conversations/:sessionId (Update title/status)
 * - POST   /api/conversations/:sessionId/archive (Archive conversation)
 * - DELETE /api/conversations/:sessionId (Delete conversation)
 * - POST   /api/conversations/:sessionId/messages/stream (SSE streaming chat)
 *
 * All routes require authentication and MEMBER role in the target workspace.
 */

import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorizeWorkspace } from '../../middleware/authorizeWorkspace.js';
import { ConversationController } from './conversation.controller.js';

export function createConversationRouter(): Router {
  const router: Router = Router();

  // Create conversation
  router.post('/', authenticate, authorizeWorkspace('MEMBER'), ConversationController.create);

  // List conversations
  router.get('/', authenticate, authorizeWorkspace('MEMBER'), ConversationController.list);

  // Get conversation metadata
  router.get('/:sessionId', authenticate, authorizeWorkspace('MEMBER'), ConversationController.get);

  // Get message history
  router.get(
    '/:sessionId/messages',
    authenticate,
    authorizeWorkspace('MEMBER'),
    ConversationController.getMessages,
  );

  // Update conversation
  router.patch(
    '/:sessionId',
    authenticate,
    authorizeWorkspace('MEMBER'),
    ConversationController.update,
  );

  // Archive conversation
  router.post(
    '/:sessionId/archive',
    authenticate,
    authorizeWorkspace('MEMBER'),
    ConversationController.archive,
  );

  // Delete conversation
  router.delete(
    '/:sessionId',
    authenticate,
    authorizeWorkspace('MEMBER'),
    ConversationController.delete,
  );

  // Stream conversational response via SSE
  router.post(
    '/:sessionId/messages/stream',
    authenticate,
    authorizeWorkspace('MEMBER'),
    ConversationController.streamMessage,
  );

  return router;
}
