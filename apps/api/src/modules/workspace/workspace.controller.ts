import { Request, Response, NextFunction } from 'express';
import {
  CreateWorkspaceSchema,
  UpdateWorkspaceSchema,
  ApiResponse,
  WorkspaceDto,
} from '@mindvault/shared';
import { workspaceService } from './workspace.service.js';

export class WorkspaceController {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const data = CreateWorkspaceSchema.parse(req.body);
      const workspace = await workspaceService.createWorkspace(req.user.id, data);

      const response: ApiResponse<WorkspaceDto> = {
        success: true,
        data: workspace,
        meta: { timestamp: new Date().toISOString() },
      };

      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const workspaces = await workspaceService.listWorkspaces(req.user.id);

      const response: ApiResponse<WorkspaceDto[]> = {
        success: true,
        data: workspaces,
        meta: { timestamp: new Date().toISOString() },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const { id } = req.params;
      const workspace = await workspaceService.getWorkspace(id, req.user.id);

      const response: ApiResponse<WorkspaceDto> = {
        success: true,
        data: workspace,
        meta: { timestamp: new Date().toISOString() },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const data = UpdateWorkspaceSchema.parse(req.body);
      const workspace = await workspaceService.updateWorkspace(id, data);

      const response: ApiResponse<WorkspaceDto> = {
        success: true,
        data: workspace,
        meta: { timestamp: new Date().toISOString() },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      await workspaceService.deleteWorkspace(id);

      const response: ApiResponse<{ message: string }> = {
        success: true,
        data: { message: 'Workspace deleted successfully' },
        meta: { timestamp: new Date().toISOString() },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const workspaceController = new WorkspaceController();
