import type { Request, Response, NextFunction } from 'express';
import { SearchRequestSchema } from '@mindvault/shared';
import { RetrievalService } from './services/retrieval.service.js';
import { AppError } from '../../middleware/errorHandler.js';

export class RetrievalController {
  public search = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // 1. Enforce authenticated workspace context from authorizeWorkspace middleware
      const workspaceId =
        req.workspaceMember?.workspaceId ||
        req.workspace?.id ||
        (req.body?.workspaceId as string) ||
        (req.headers['x-workspace-id'] as string) ||
        (req.query?.workspaceId as string);

      if (!workspaceId) {
        throw new AppError(
          400,
          'MISSING_WORKSPACE_ID',
          'A valid workspaceId is required in headers (X-Workspace-ID), query, or body',
        );
      }

      // 2. Validate request body against Zod SearchRequestSchema
      const parseResult = SearchRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Invalid search request parameters',
          parseResult.error.flatten(),
        );
      }

      // 3. Execute retrieval pipeline
      const searchResult = await RetrievalService.executeSearch(workspaceId, parseResult.data);

      // 4. Return structured response envelope
      res.status(200).json({
        success: true,
        data: searchResult,
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
