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

    // 1. Check for route parameter workspace context (e.g., /api/workspaces/:id or :workspaceId)
    const routeWorkspaceId =
      req.params?.workspaceId ||
      (req.baseUrl?.includes('workspaces') && req.params?.id ? req.params.id : undefined);

    const headerWorkspaceId =
      typeof req.headers['x-workspace-id'] === 'string' && req.headers['x-workspace-id'].trim()
        ? req.headers['x-workspace-id'].trim()
        : undefined;

    // 2. Reject conflicting workspace identity between route parameter and X-Workspace-ID header
    if (routeWorkspaceId && headerWorkspaceId && routeWorkspaceId !== headerWorkspaceId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'CONFLICTING_WORKSPACE_ID',
          message:
            'Conflicting workspace identity provided between route parameter and X-Workspace-ID header',
        },
        meta: { timestamp: new Date().toISOString() },
      });
      return;
    }

    // 3. Resolve authoritative workspace ID: route parameter > header > query > body
    let workspaceId: string | undefined =
      routeWorkspaceId ||
      headerWorkspaceId ||
      (typeof req.query?.workspaceId === 'string' && req.query.workspaceId.trim()
        ? req.query.workspaceId.trim()
        : undefined) ||
      (typeof req.body?.workspaceId === 'string' && req.body.workspaceId.trim()
        ? req.body.workspaceId.trim()
        : undefined);

    let isResolvedFromDocument = false;

    // 4. If no explicit workspace identifier was provided, attempt document context resolution
    if (!workspaceId) {
      if (req.baseUrl?.includes('documents') && req.params?.id) {
        const doc = await dbService.findDocumentById(req.params.id);
        if (doc) {
          workspaceId = doc.workspaceId;
          isResolvedFromDocument = true;
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
        // Anti-enumeration: If resolved from document context, return 404 to avoid leaking document existence
        if (isResolvedFromDocument) {
          res.status(404).json({
            success: false,
            error: {
              code: 'DOCUMENT_NOT_FOUND',
              message: 'Document not found',
            },
            meta: { timestamp: new Date().toISOString() },
          });
          return;
        }

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
