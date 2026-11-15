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
      workspace?: {
        id: string;
        name?: string;
        role?: WorkspaceRole;
      };
      companionDevice?: {
        id: string;
        userId: string;
        deviceName: string;
        platform: string;
      };
    }
  }
}
