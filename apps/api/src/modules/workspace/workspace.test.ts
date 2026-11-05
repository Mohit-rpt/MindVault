import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { InMemoryDatabaseService, setDatabaseService } from '../../lib/db.js';

describe('Workspace Management & Isolation Module (Phase 1)', () => {
  let app: ReturnType<typeof createApp>;
  let memoryDb: InMemoryDatabaseService;

  let userA: { id: string; email: string; token: string; workspaceId: string };
  let userB: { id: string; email: string; token: string; workspaceId: string };

  beforeEach(async () => {
    memoryDb = new InMemoryDatabaseService();
    setDatabaseService(memoryDb);
    app = createApp();

    // Register User A
    const resA = await request(app).post('/api/auth/register').send({
      name: 'User Alpha',
      email: 'alpha@example.com',
      password: 'alphaPassword123!',
    });
    userA = {
      id: resA.body.data.user.id,
      email: resA.body.data.user.email,
      token: resA.body.data.accessToken,
      workspaceId: resA.body.data.activeWorkspace.id,
    };

    // Register User B
    const resB = await request(app).post('/api/auth/register').send({
      name: 'User Beta',
      email: 'beta@example.com',
      password: 'betaPassword123!',
    });
    userB = {
      id: resB.body.data.user.id,
      email: resB.body.data.user.email,
      token: resB.body.data.accessToken,
      workspaceId: resB.body.data.activeWorkspace.id,
    };
  });

  describe('Workspace Creation & Membership', () => {
    it('should create a workspace with creator automatically designated as OWNER', async () => {
      const res = await request(app)
        .post('/api/workspaces')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          name: 'Research Vault',
          slug: 'research-vault',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Research Vault');
      expect(res.body.data.slug).toBe('research-vault');
      expect(res.body.data.role).toBe('OWNER');

      // Verify creator is listed as member with role OWNER
      const getRes = await request(app)
        .get(`/api/workspaces/${res.body.data.id}`)
        .set('Authorization', `Bearer ${userA.token}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.members).toBeDefined();
      const ownerMember = getRes.body.data.members.find(
        (m: { userId: string }) => m.userId === userA.id,
      );
      expect(ownerMember).toBeDefined();
      expect(ownerMember.role).toBe('OWNER');
    });

    it('should list all workspaces belonging to the authenticated user', async () => {
      const listRes = await request(app)
        .get('/api/workspaces')
        .set('Authorization', `Bearer ${userA.token}`);

      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.data)).toBe(true);
      expect(listRes.body.data.length).toBe(1);
      expect(listRes.body.data[0].id).toBe(userA.workspaceId);
    });
  });

  describe('Role-Based Access Control (RBAC)', () => {
    let sharedWorkspaceId: string;
    let memberToken: string;
    let adminToken: string;

    beforeEach(async () => {
      // User A creates a shared workspace
      const wsRes = await request(app)
        .post('/api/workspaces')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ name: 'Collaborative Lab' });
      sharedWorkspaceId = wsRes.body.data.id;

      // Register Member User
      const mRes = await request(app).post('/api/auth/register').send({
        name: 'Member Charlie',
        email: 'charlie@example.com',
        password: 'charliePassword123!',
      });
      memberToken = mRes.body.data.accessToken;

      // Register Admin User
      const aRes = await request(app).post('/api/auth/register').send({
        name: 'Admin Dave',
        email: 'dave@example.com',
        password: 'davePassword123!',
      });
      adminToken = aRes.body.data.accessToken;

      // Add Charlie as MEMBER in memoryDb
      memoryDb.members.set(`${mRes.body.data.user.id}_${sharedWorkspaceId}`, {
        id: `mem_charlie`,
        userId: mRes.body.data.user.id,
        workspaceId: sharedWorkspaceId,
        role: 'MEMBER',
        joinedAt: new Date(),
      });

      // Add Dave as ADMIN in memoryDb
      memoryDb.members.set(`${aRes.body.data.user.id}_${sharedWorkspaceId}`, {
        id: `mem_dave`,
        userId: aRes.body.data.user.id,
        workspaceId: sharedWorkspaceId,
        role: 'ADMIN',
        joinedAt: new Date(),
      });
    });

    it('MEMBER can view workspace but cannot update or delete it', async () => {
      // MEMBER view -> Allowed
      const viewRes = await request(app)
        .get(`/api/workspaces/${sharedWorkspaceId}`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(viewRes.status).toBe(200);

      // MEMBER update -> Forbidden
      const updateRes = await request(app)
        .patch(`/api/workspaces/${sharedWorkspaceId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ name: 'Member Renamed' });
      expect(updateRes.status).toBe(403);
      expect(updateRes.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');

      // MEMBER delete -> Forbidden
      const deleteRes = await request(app)
        .delete(`/api/workspaces/${sharedWorkspaceId}`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(deleteRes.status).toBe(403);
      expect(deleteRes.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('ADMIN can view and update workspace but cannot delete it', async () => {
      // ADMIN view -> Allowed
      const viewRes = await request(app)
        .get(`/api/workspaces/${sharedWorkspaceId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(viewRes.status).toBe(200);

      // ADMIN update -> Allowed
      const updateRes = await request(app)
        .patch(`/api/workspaces/${sharedWorkspaceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Admin Renamed' });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.name).toBe('Admin Renamed');

      // ADMIN delete -> Forbidden (Only OWNER can delete)
      const deleteRes = await request(app)
        .delete(`/api/workspaces/${sharedWorkspaceId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(deleteRes.status).toBe(403);
      expect(deleteRes.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('OWNER can view, update, and delete workspace', async () => {
      // OWNER update
      const updateRes = await request(app)
        .patch(`/api/workspaces/${sharedWorkspaceId}`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ name: 'Owner Updated' });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.name).toBe('Owner Updated');

      // OWNER delete
      const deleteRes = await request(app)
        .delete(`/api/workspaces/${sharedWorkspaceId}`)
        .set('Authorization', `Bearer ${userA.token}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      // Verify workspace no longer exists
      const viewAfter = await request(app)
        .get(`/api/workspaces/${sharedWorkspaceId}`)
        .set('Authorization', `Bearer ${userA.token}`);
      expect(viewAfter.status).toBe(403);
    });
  });

  describe('Workspace Isolation & IDOR Protection (CRITICAL)', () => {
    it('User B cannot read User A workspace (Cross-Workspace IDOR Prevention)', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${userA.workspaceId}`)
        .set('Authorization', `Bearer ${userB.token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('WORKSPACE_ACCESS_DENIED');
    });

    it('User B cannot modify User A workspace', async () => {
      const res = await request(app)
        .patch(`/api/workspaces/${userA.workspaceId}`)
        .set('Authorization', `Bearer ${userB.token}`)
        .send({ name: 'Hacked by User B' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('WORKSPACE_ACCESS_DENIED');

      // Confirm User A workspace was not altered
      const checkRes = await request(app)
        .get(`/api/workspaces/${userA.workspaceId}`)
        .set('Authorization', `Bearer ${userA.token}`);
      expect(checkRes.body.data.name).not.toBe('Hacked by User B');
    });

    it('User B cannot delete User A workspace', async () => {
      const res = await request(app)
        .delete(`/api/workspaces/${userA.workspaceId}`)
        .set('Authorization', `Bearer ${userB.token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('WORKSPACE_ACCESS_DENIED');

      // Confirm User A workspace still exists
      const checkRes = await request(app)
        .get(`/api/workspaces/${userA.workspaceId}`)
        .set('Authorization', `Bearer ${userA.token}`);
      expect(checkRes.status).toBe(200);
    });
  });
});
