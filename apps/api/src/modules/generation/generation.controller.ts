/**
 * MindVault — Generation Engine: RAG API Controller
 *
 * Handles non-streaming answer requests and Server-Sent Events (SSE) streaming answers.
 */

import type { Request, Response, NextFunction } from 'express';
import { RAGAnswerRequestSchema } from '@mindvault/shared';
import { AppError } from '../../middleware/errorHandler.js';
import { RAGService } from './services/rag.service.js';

export class GenerationController {
  /**
   * Non-Streaming Answer Endpoint: POST /api/rag/answer
   */
  public static async answer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const workspaceId =
        req.workspaceMember?.workspaceId ||
        req.workspace?.id ||
        (req.headers['x-workspace-id'] as string);

      if (!workspaceId) {
        throw new AppError(
          400,
          'WORKSPACE_REQUIRED',
          'Workspace context is required for RAG answering',
        );
      }

      const parseResult = RAGAnswerRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          `Invalid RAG answer parameters: ${parseResult.error.errors.map((e) => e.message).join(', ')}`,
        );
      }

      const response = await RAGService.generateAnswer(workspaceId, parseResult.data);

      res.status(200).json({
        success: true,
        data: response,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Server-Sent Events (SSE) Streaming Endpoint: POST /api/rag/stream
   */
  public static async stream(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const workspaceId =
        req.workspaceMember?.workspaceId ||
        req.workspace?.id ||
        (req.headers['x-workspace-id'] as string);

      if (!workspaceId) {
        throw new AppError(
          400,
          'WORKSPACE_REQUIRED',
          'Workspace context is required for streaming RAG',
        );
      }

      const parseResult = RAGAnswerRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          `Invalid RAG streaming parameters: ${parseResult.error.errors.map((e) => e.message).join(', ')}`,
        );
      }

      // Configure Server-Sent Events headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Prevents proxy buffering

      // Send initial keep-alive comment
      res.write(': keep-alive\n\n');

      let clientDisconnected = false;
      req.on('close', () => {
        clientDisconnected = true;
      });

      const eventStream = RAGService.generateAnswerStream(workspaceId, parseResult.data);

      for await (const event of eventStream) {
        if (clientDisconnected) {
          break;
        }

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
