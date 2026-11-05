import { CreateWorkspaceRequest, UpdateWorkspaceRequest, WorkspaceDto } from '@mindvault/shared';
import { dbService } from '../../lib/db.js';

export class WorkspaceService {
  async createWorkspace(userId: string, data: CreateWorkspaceRequest): Promise<WorkspaceDto> {
    const rawSlug =
      data.slug ||
      data.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    let finalSlug = rawSlug || 'workspace';

    // If slug is taken, append unique random string
    const existing = await dbService.findWorkspaceBySlug(finalSlug);
    if (existing) {
      finalSlug = `${finalSlug}-${Math.random().toString(36).slice(2, 7)}`;
    }

    const { workspace, member } = await dbService.createWorkspace({
      name: data.name.trim(),
      slug: finalSlug,
      ownerId: userId,
    });

    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
      role: member.role,
    };
  }

  async listWorkspaces(userId: string): Promise<WorkspaceDto[]> {
    const workspaces = await dbService.findUserWorkspaces(userId);
    return workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
      role: w.role,
    }));
  }

  async getWorkspace(workspaceId: string, userId: string): Promise<WorkspaceDto> {
    const ws = await dbService.findWorkspaceWithMembers(workspaceId);
    if (!ws) {
      const error = new Error('Workspace not found');
      (error as unknown as { statusCode: number; code: string }).statusCode = 404;
      (error as unknown as { statusCode: number; code: string }).code = 'WORKSPACE_NOT_FOUND';
      throw error;
    }

    const userMembership = ws.members.find((m) => m.userId === userId);
    if (!userMembership) {
      const error = new Error('You do not have access to this workspace');
      (error as unknown as { statusCode: number; code: string }).statusCode = 403;
      (error as unknown as { statusCode: number; code: string }).code = 'WORKSPACE_ACCESS_DENIED';
      throw error;
    }

    return {
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      createdAt: ws.createdAt.toISOString(),
      updatedAt: ws.updatedAt.toISOString(),
      role: userMembership.role,
      members: ws.members.map((m) => ({
        id: m.id,
        userId: m.userId,
        workspaceId: m.workspaceId,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
        user: m.user,
      })),
    };
  }

  async updateWorkspace(workspaceId: string, data: UpdateWorkspaceRequest): Promise<WorkspaceDto> {
    const updated = await dbService.updateWorkspace(workspaceId, {
      name: data.name?.trim(),
      slug: data.slug?.trim().toLowerCase(),
    });

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await dbService.deleteWorkspace(workspaceId);
  }
}

export const workspaceService = new WorkspaceService();
