import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { InMemoryDatabaseService, setDatabaseService } from '../../lib/db.js';
import { InMemoryStorageProvider, setStorageProvider } from './document.storage.js';
import { InMemoryDocumentQueue, setDocumentQueue } from './document.queue.js';
import { generateAccessToken } from '../auth/auth.security.js';
import type { UserRecord, WorkspaceRecord } from '../../lib/db.js';

describe('Document API Integration & Security (Phase 2)', () => {
  let app: ReturnType<typeof createApp>;
  let memoryDb: InMemoryDatabaseService;
  let memoryStorage: InMemoryStorageProvider;
  let memoryQueue: InMemoryDocumentQueue;

  // Test entities
  let ownerUser: UserRecord;
  let memberUser: UserRecord;
  let outsiderUser: UserRecord;
  let workspaceA: WorkspaceRecord;
  let workspaceB: WorkspaceRecord;

  let ownerToken: string;
  let memberToken: string;
  let outsiderToken: string;

  const createJwt = (userId: string, email: string) => {
    return generateAccessToken({ id: userId, email, name: 'Test User' });
  };

  beforeEach(async () => {
    memoryDb = new InMemoryDatabaseService();
    setDatabaseService(memoryDb);

    memoryStorage = new InMemoryStorageProvider();
    setStorageProvider(memoryStorage);

    memoryQueue = new InMemoryDocumentQueue();
    setDocumentQueue(memoryQueue);

    app = createApp();

    // 1. Seed Owner User & Workspace A
    ownerUser = await memoryDb.createUser({
      email: 'owner@example.com',
      name: 'Workspace Owner',
      passwordHash: 'hashed_pw',
    });
    const wsResult = await memoryDb.createWorkspace({
      name: 'Engineering Workspace',
      slug: 'engineering-ws',
      ownerId: ownerUser.id,
    });
    workspaceA = wsResult.workspace;

    // 2. Seed Member User in Workspace A
    memberUser = await memoryDb.createUser({
      email: 'member@example.com',
      name: 'Regular Member',
      passwordHash: 'hashed_pw',
    });
    await memoryDb.addWorkspaceMember(workspaceA.id, memberUser.id, 'MEMBER');

    // 3. Seed Outsider User & Workspace B
    outsiderUser = await memoryDb.createUser({
      email: 'outsider@example.com',
      name: 'Outsider User',
      passwordHash: 'hashed_pw',
    });
    const wsBResult = await memoryDb.createWorkspace({
      name: 'Separate Company Space',
      slug: 'separate-space',
      ownerId: outsiderUser.id,
    });
    workspaceB = wsBResult.workspace;

    // JWT tokens
    ownerToken = createJwt(ownerUser.id, ownerUser.email);
    memberToken = createJwt(memberUser.id, memberUser.email);
    outsiderToken = createJwt(outsiderUser.id, outsiderUser.email);
  });

  describe('POST /api/documents/upload', () => {
    it('should successfully upload a valid text document and return 202 Accepted', async () => {
      const content =
        'MindVault system architecture note.\nVector embeddings and background queue.';
      const res = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('workspaceId', workspaceA.id)
        .attach('file', Buffer.from(content, 'utf-8'), 'system-architecture.txt');

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.workspaceId).toBe(workspaceA.id);
      expect(res.body.data.originalName).toBe('system-architecture.txt');
      expect(res.body.data.status).toBe('QUEUED');
      expect(res.body.data.sizeBytes).toBe(Buffer.byteLength(content));

      // Verify job enqueued
      expect(memoryQueue.jobs).toHaveLength(1);
      expect(memoryQueue.jobs[0].documentId).toBe(res.body.data.id);
      expect(memoryQueue.jobs[0].workspaceId).toBe(workspaceA.id);

      // Verify file persisted in storage
      const stored = await memoryDb.findDocumentById(res.body.data.id);
      expect(stored).not.toBeNull();
      const fileExists = await memoryStorage.exists(stored!.storageKey);
      expect(fileExists).toBe(true);
    });

    it('should accept valid PDF file with %PDF magic bytes', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4\n%Fake minimal test PDF stream content');
      const res = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('workspaceId', workspaceA.id)
        .attach('file', pdfBuffer, 'whitepaper.pdf');

      expect(res.status).toBe(202);
      expect(res.body.data.extension).toBe('.pdf');
    });

    it('should reject duplicate file upload within the same workspace (409 Conflict)', async () => {
      const content = 'Duplicate test file content across uploads';
      const fileBuffer = Buffer.from(content, 'utf-8');

      // First upload
      const firstRes = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('workspaceId', workspaceA.id)
        .attach('file', fileBuffer, 'original.txt');
      expect(firstRes.status).toBe(202);

      // Duplicate upload
      const dupRes = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('workspaceId', workspaceA.id)
        .attach('file', fileBuffer, 'duplicate_copy.txt');

      expect(dupRes.status).toBe(409);
      expect(dupRes.body.error.code).toBe('DUPLICATE_DOCUMENT');
    });

    it('should allow identical file in a different workspace (tenant isolation)', async () => {
      const content = 'Shared template file content';
      const fileBuffer = Buffer.from(content, 'utf-8');

      // Upload in Workspace A
      const resA = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('workspaceId', workspaceA.id)
        .attach('file', fileBuffer, 'template.txt');
      expect(resA.status).toBe(202);

      // Upload in Workspace B
      const resB = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${outsiderToken}`)
        .field('workspaceId', workspaceB.id)
        .attach('file', fileBuffer, 'template.txt');
      expect(resB.status).toBe(202);
    });

    it('should reject missing file with 400', async () => {
      const res = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('workspaceId', workspaceA.id);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_FILE_PROVIDED');
    });

    it('should reject unsupported file extensions (.exe) with 400', async () => {
      const res = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('workspaceId', workspaceA.id)
        .attach('file', Buffer.from('malicious binary'), 'malware.exe');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    });

    it('should reject empty files (0 bytes) with 400', async () => {
      const res = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('workspaceId', workspaceA.id)
        .attach('file', Buffer.alloc(0), 'empty.txt');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('EMPTY_FILE');
    });

    it('should reject fake PDF without %PDF header with 400 INVALID_FILE_SIGNATURE', async () => {
      const res = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('workspaceId', workspaceA.id)
        .attach('file', Buffer.from('Not a real PDF stream'), 'spoofed.pdf');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_FILE_SIGNATURE');
    });

    it('should reject unauthenticated upload with 401', async () => {
      const res = await request(app)
        .post('/api/documents/upload')
        .field('workspaceId', workspaceA.id)
        .attach('file', Buffer.from('unauthenticated text'), 'doc.txt');

      expect(res.status).toBe(401);
    });

    it('should reject upload to workspace user is not a member of (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${outsiderToken}`)
        .field('workspaceId', workspaceA.id)
        .attach('file', Buffer.from('unauthorized text'), 'doc.txt');

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('WORKSPACE_ACCESS_DENIED');
    });
  });

  describe('GET /api/documents (List)', () => {
    beforeEach(async () => {
      // Upload two documents in Workspace A
      await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('workspaceId', workspaceA.id)
        .attach('file', Buffer.from('File alpha contents'), 'alpha-report.txt');

      await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('workspaceId', workspaceA.id)
        .attach('file', Buffer.from('File beta contents'), 'beta-notes.md');

      // Upload one document in Workspace B
      await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${outsiderToken}`)
        .field('workspaceId', workspaceB.id)
        .attach('file', Buffer.from('Workspace B private file'), 'outsider-secret.txt');
    });

    it('should list only documents in the requested workspace', async () => {
      const res = await request(app)
        .get('/api/documents')
        .set('Authorization', `Bearer ${memberToken}`)
        .query({ workspaceId: workspaceA.id });

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(2);
      expect(res.body.data.items).toHaveLength(2);

      const names = res.body.data.items.map((d: any) => d.originalName);
      expect(names).toContain('alpha-report.txt');
      expect(names).toContain('beta-notes.md');
      expect(names).not.toContain('outsider-secret.txt');
    });

    it('should filter documents by search keyword', async () => {
      const res = await request(app)
        .get('/api/documents')
        .set('Authorization', `Bearer ${memberToken}`)
        .query({ workspaceId: workspaceA.id, search: 'alpha' });

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].originalName).toBe('alpha-report.txt');
    });

    it('should deny listing documents for non-member workspace', async () => {
      const res = await request(app)
        .get('/api/documents')
        .set('Authorization', `Bearer ${outsiderToken}`)
        .query({ workspaceId: workspaceA.id });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/documents/:id, /:id/status, /:id/download', () => {
    let documentId: string;
    const originalContent = 'Detailed document test stream for MindVault retrieval.';

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('workspaceId', workspaceA.id)
        .attach('file', Buffer.from(originalContent, 'utf-8'), 'knowledge.txt');
      documentId = res.body.data.id;
    });

    it('should fetch document details by ID', async () => {
      const res = await request(app)
        .get(`/api/documents/${documentId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-workspace-id', workspaceA.id);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(documentId);
      expect(res.body.data.originalName).toBe('knowledge.txt');
    });

    it('should fetch document processing status', async () => {
      const res = await request(app)
        .get(`/api/documents/${documentId}/status`)
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-workspace-id', workspaceA.id);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(documentId);
      expect(res.body.data.status).toBe('QUEUED');
    });

    it('should stream and download the original file buffer', async () => {
      const res = await request(app)
        .get(`/api/documents/${documentId}/download`)
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-workspace-id', workspaceA.id);

      expect(res.status).toBe(200);
      expect(res.text).toBe(originalContent);
      expect(res.headers['content-disposition']).toContain('knowledge.txt');
    });

    it('should block cross-workspace access to document (IDOR defense)', async () => {
      // Outsider user attempts to access document in Workspace A
      const res = await request(app)
        .get(`/api/documents/${documentId}`)
        .set('Authorization', `Bearer ${outsiderToken}`);

      // Middleware rejects since outsider is not a member of Workspace A
      expect([403, 404]).toContain(res.status);
    });
  });

  describe('DELETE /api/documents/:id (RBAC & Cascading)', () => {
    let documentId: string;
    let storageKey: string;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('workspaceId', workspaceA.id)
        .attach('file', Buffer.from('Delete test document'), 'to-delete.txt');
      documentId = res.body.data.id;

      const record = await memoryDb.findDocumentById(documentId);
      storageKey = record!.storageKey;
    });

    it('should reject deletion by regular MEMBER (role hierarchy enforcement)', async () => {
      const res = await request(app)
        .delete(`/api/documents/${documentId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-workspace-id', workspaceA.id);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should allow deletion by workspace OWNER and remove physical storage file', async () => {
      expect(await memoryStorage.exists(storageKey)).toBe(true);

      const res = await request(app)
        .delete(`/api/documents/${documentId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceA.id);

      expect(res.status).toBe(200);

      // Verify file deleted from storage
      expect(await memoryStorage.exists(storageKey)).toBe(false);

      // Verify record deleted from database
      const found = await memoryDb.findDocumentById(documentId);
      expect(found).toBeNull();
    });

    it('should reject deletion attempt from outsider', async () => {
      const res = await request(app)
        .delete(`/api/documents/${documentId}`)
        .set('Authorization', `Bearer ${outsiderToken}`);

      expect([403, 404]).toContain(res.status);
    });
  });
});
