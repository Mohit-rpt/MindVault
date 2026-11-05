import { Request, Response, NextFunction } from 'express';
import { WorkspaceRole } from '@mindvault/shared';
import { dbService } from '../lib/db.js';

const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  OWNER: 3,
  ADMIN: 2,
  MEMBER: 1,
};

export function authorizeWorkspace(minRole: WorkspaceRole = 'MEMBER') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        meta: { timestamp: new Date().toISOString() },
      });
      return;
    }

    let workspaceId =
      req.params.workspaceId ||
      (req.headers['x-workspace-id'] as string | undefined) ||
      (req.query.workspaceId as string | undefined) ||
      (req.body?.workspaceId as string | undefined);

    if (!workspaceId) {
      if (req.baseUrl.includes('workspaces') && req.params.id) {
        workspaceId = req.params.id;
      } else if (req.baseUrl.includes('documents') && req.params.id) {
        const doc = await dbService.findDocumentById(req.params.id);
        if (doc) {
          workspaceId = doc.workspaceId;
        } else {
          res.status(404).json({
            success: false,
            error: { code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' },
            meta: { timestamp: new Date().toISOString() },
          });
          return;
        }
      }
    }

    if (!workspaceId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_WORKSPACE_ID',
          message:
            'Workspace ID must be provided via URL parameter, query, body, or X-Workspace-ID header',
        },
        meta: { timestamp: new Date().toISOString() },
      });
      return;
    }

    try {
      const member = await dbService.getWorkspaceMember(workspaceId, req.user.id);

      if (!member) {
        // Prevent IDOR by returning 404 or 403
        res.status(403).json({
          success: false,
          error: {
            code: 'WORKSPACE_ACCESS_DENIED',
            message: 'You are not a member of this workspace',
          },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const userRoleRank = ROLE_HIERARCHY[member.role] ?? 0;
      const minRoleRank = ROLE_HIERARCHY[minRole] ?? 1;

      if (userRoleRank < minRoleRank) {
        res.status(403).json({
          success: false,
          error: {
            code: 'INSUFFICIENT_PERMISSIONS',
            message: `This action requires ${minRole} permissions or higher`,
          },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      req.workspaceMember = {
        workspaceId,
        userId: req.user.id,
        role: member.role,
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}
