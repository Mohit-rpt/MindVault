import { WorkspaceRole } from '@mindvault/shared';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
      };
      workspaceMember?: {
        workspaceId: string;
        userId: string;
        role: WorkspaceRole;
      };
    }
  }
}
