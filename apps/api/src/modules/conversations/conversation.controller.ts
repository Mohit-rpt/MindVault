/**
 * MindVault — Conversation API Controller
 *
 * Exposes REST endpoints for conversation lifecycle management and SSE streaming:
 * - POST /api/conversations (Create)
 * - GET /api/conversations (List)
 * - GET /api/conversations/:sessionId (Get details)
 * - GET /api/conversations/:sessionId/messages (Get message history)
 * - PATCH /api/conversations/:sessionId (Rename / update)
 * - POST /api/conversations/:sessionId/archive (Archive)
 * - DELETE /api/conversations/:sessionId (Delete)
 * - POST /api/conversations/:sessionId/messages/stream (SSE stream response)
 */

import type { Request, Response, NextFunction } from 'express';
import {
  CreateConversationRequestSchema,
  UpdateConversationRequestSchema,
  ListConversationsQuerySchema,
  GetMessagesQuerySchema,
  SendConversationMessageRequestSchema,
} from '@mindvault/shared';
import { AppError } from '../../middleware/errorHandler.js';
import { ConversationRepository } from './repositories/conversation.repository.js';
import { ConversationRAGService } from './services/conversation-rag.service.js';

function getWorkspaceAndUser(req: Request): { workspaceId: string; userId: string } {
  const workspaceId =
    req.workspaceMember?.workspaceId ||
    req.workspace?.id ||
    (req.headers['x-workspace-id'] as string);

  const userId = req.user?.id;

  if (!workspaceId) {
    throw new AppError(400, 'WORKSPACE_REQUIRED', 'Workspace context is required');
  }

  if (!userId) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required');
  }

  return { workspaceId, userId };
}

export class ConversationController {
  /**
   * POST /api/conversations — Create conversation
   */
  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { workspaceId, userId } = getWorkspaceAndUser(req);
      const parseResult = CreateConversationRequestSchema.safeParse(req.body);

      if (!parseResult.success) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          `Invalid conversation payload: ${parseResult.error.errors.map((e) => e.message).join(', ')}`,
        );
      }

      const session = await ConversationRepository.createSession(
        workspaceId,
        userId,
        parseResult.data.title,
      );

      // If initial message provided, persist it as first turn
      if (parseResult.data.initialMessage) {
        await ConversationRepository.createMessage({
          sessionId: session.id,
          workspaceId,
          role: 'USER',
          content: parseResult.data.initialMessage,
          status: 'COMPLETED',
        });
      }

      res.status(201).json({
        success: true,
        data: session,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/conversations — List conversations
   */
  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { workspaceId, userId } = getWorkspaceAndUser(req);
      const parseResult = ListConversationsQuerySchema.safeParse(req.query);

      if (!parseResult.success) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          `Invalid query parameters: ${parseResult.error.errors.map((e) => e.message).join(', ')}`,
        );
      }

      const sessions = await ConversationRepository.listSessions(
        workspaceId,
        userId,
        parseResult.data,
      );

      res.status(200).json({
        success: true,
        data: sessions,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/conversations/:sessionId — Get conversation metadata
   */
  public static async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { workspaceId, userId } = getWorkspaceAndUser(req);
      const { sessionId } = req.params;

      const session = await ConversationRepository.findSessionById(sessionId, workspaceId);
      if (!session) {
        throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
      }

      if (session.userId !== userId) {
        throw new AppError(403, 'FORBIDDEN', 'Access to conversation is forbidden');
      }

      res.status(200).json({
        success: true,
        data: session,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/conversations/:sessionId/messages — Get message history
   */
  public static async getMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { workspaceId, userId } = getWorkspaceAndUser(req);
      const { sessionId } = req.params;

      const session = await ConversationRepository.findSessionById(sessionId, workspaceId);
      if (!session) {
        throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
      }

      if (session.userId !== userId) {
        throw new AppError(403, 'FORBIDDEN', 'Access to conversation is forbidden');
      }

      const parseResult = GetMessagesQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          `Invalid pagination query: ${parseResult.error.errors.map((e) => e.message).join(', ')}`,
        );
      }

      const messages = await ConversationRepository.listMessages(
        sessionId,
        workspaceId,
        parseResult.data,
      );

      res.status(200).json({
        success: true,
        data: messages,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/conversations/:sessionId — Update title or status
   */
  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { workspaceId, userId } = getWorkspaceAndUser(req);
      const { sessionId } = req.params;

      const session = await ConversationRepository.findSessionById(sessionId, workspaceId);
      if (!session) {
        throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
      }

      if (session.userId !== userId) {
        throw new AppError(403, 'FORBIDDEN', 'Access to conversation is forbidden');
      }

      const parseResult = UpdateConversationRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          `Invalid update payload: ${parseResult.error.errors.map((e) => e.message).join(', ')}`,
        );
      }

      const updated = await ConversationRepository.updateSession(sessionId, workspaceId, {
        ...(parseResult.data.title ? { title: parseResult.data.title } : {}),
        ...(parseResult.data.status ? { status: parseResult.data.status } : {}),
      });

      res.status(200).json({
        success: true,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/conversations/:sessionId/archive — Archive conversation
   */
  public static async archive(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { workspaceId, userId } = getWorkspaceAndUser(req);
      const { sessionId } = req.params;

      const session = await ConversationRepository.findSessionById(sessionId, workspaceId);
      if (!session) {
        throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
      }

      if (session.userId !== userId) {
        throw new AppError(403, 'FORBIDDEN', 'Access to conversation is forbidden');
      }

      const updated = await ConversationRepository.updateSession(sessionId, workspaceId, {
        status: 'ARCHIVED',
        archivedAt: new Date(),
      });

      res.status(200).json({
        success: true,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/conversations/:sessionId — Delete conversation
   */
  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { workspaceId, userId } = getWorkspaceAndUser(req);
      const { sessionId } = req.params;

      const session = await ConversationRepository.findSessionById(sessionId, workspaceId);
      if (!session) {
        throw new AppError(404, 'NOT_FOUND', 'Conversation not found');
      }

      if (session.userId !== userId) {
        throw new AppError(403, 'FORBIDDEN', 'Access to conversation is forbidden');
      }

      await ConversationRepository.deleteSession(sessionId, workspaceId);

      res.status(200).json({
        success: true,
        data: { id: sessionId, deleted: true },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/conversations/:sessionId/messages/stream — SSE Stream conversational answer
   */
  public static async streamMessage(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { workspaceId, userId } = getWorkspaceAndUser(req);
      const { sessionId } = req.params;

      const parseResult = SendConversationMessageRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          `Invalid message parameters: ${parseResult.error.errors.map((e) => e.message).join(', ')}`,
        );
      }

      // Configure SSE response headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      res.write(': keep-alive\n\n');

      const abortController = new AbortController();
      let clientDisconnected = false;

      req.on('close', () => {
        clientDisconnected = true;
        abortController.abort();
      });

      const eventStream = ConversationRAGService.streamConversationMessage(
        sessionId,
        workspaceId,
        userId,
        parseResult.data,
        abortController.signal,
      );

      for await (const event of eventStream) {
        if (clientDisconnected) break;

        const payload = JSON.stringify(event);
        res.write(`event: ${event.type}\ndata: ${payload}\n\n`);

        if (event.type === 'done' || event.type === 'error') {
          break;
        }
      }

      res.end();
    } catch (err) {
      next(err);
    }
  }
}
