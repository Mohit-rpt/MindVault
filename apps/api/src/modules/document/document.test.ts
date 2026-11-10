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

    it('should block cross-workspace access to document with consistent 404 (IDOR & Anti-Enumeration defense)', async () => {
      // Outsider user attempts to access document in Workspace A without workspace ID
      const res = await request(app)
        .get(`/api/documents/${documentId}`)
        .set('Authorization', `Bearer ${outsiderToken}`);

      // Consistent 404 response eliminates the document existence oracle
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DOCUMENT_NOT_FOUND');
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

    it('should reject deletion attempt from outsider with consistent 404', async () => {
      const res = await request(app)
        .delete(`/api/documents/${documentId}`)
        .set('Authorization', `Bearer ${outsiderToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DOCUMENT_NOT_FOUND');
    });
  });

  describe('Tenant Isolation, Anti-Enumeration & Context Synchronization (Milestone 2.1)', () => {
    let docInWorkspaceA: string;
    let docInWorkspaceB: string;

    beforeEach(async () => {
      // Create document in Workspace A (owned by ownerUser)
      const uploadARes = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('workspaceId', workspaceA.id)
        .attach('file', Buffer.from('Workspace A sensitive doc'), 'doc-a.txt');
      docInWorkspaceA = uploadARes.body.data.id;

      // Create document in Workspace B (owned by outsiderUser)
      const uploadBRes = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${outsiderToken}`)
        .field('workspaceId', workspaceB.id)
        .attach('file', Buffer.from('Workspace B sensitive doc'), 'doc-b.txt');
      docInWorkspaceB = uploadBRes.body.data.id;
    });

    it('1. legitimate access to documents in user workspace succeeds with and without header', async () => {
      // With header
      const resWithHeader = await request(app)
        .get(`/api/documents/${docInWorkspaceA}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-workspace-id', workspaceA.id);
      expect(resWithHeader.status).toBe(200);
      expect(resWithHeader.body.data.id).toBe(docInWorkspaceA);

      // Without header (dynamically resolved and verified against user membership)
      const resWithoutHeader = await request(app)
        .get(`/api/documents/${docInWorkspaceA}`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(resWithoutHeader.status).toBe(200);
      expect(resWithoutHeader.body.data.id).toBe(docInWorkspaceA);
    });

    it('2. outsider requesting document in another workspace returns 404 DOCUMENT_NOT_FOUND', async () => {
      const res = await request(app)
        .get(`/api/documents/${docInWorkspaceA}`)
        .set('Authorization', `Bearer ${outsiderToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DOCUMENT_NOT_FOUND');
      expect(res.body.error.message).toBe('Document not found');
    });

    it('3. user requesting nonexistent document ID returns 404 DOCUMENT_NOT_FOUND', async () => {
      const nonexistentId = 'nonexistent-uuid-00000000';
      const res = await request(app)
        .get(`/api/documents/${nonexistentId}`)
        .set('Authorization', `Bearer ${outsiderToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DOCUMENT_NOT_FOUND');
      expect(res.body.error.message).toBe('Document not found');
    });

    it('4. anti-enumeration: foreign document and nonexistent document responses are completely identical', async () => {
      const nonexistentId = '00000000-0000-0000-0000-000000000000';

      const foreignRes = await request(app)
        .get(`/api/documents/${docInWorkspaceA}`)
        .set('Authorization', `Bearer ${outsiderToken}`);

      const nonexistentRes = await request(app)
        .get(`/api/documents/${nonexistentId}`)
        .set('Authorization', `Bearer ${outsiderToken}`);

      expect(foreignRes.status).toBe(nonexistentRes.status);
      expect(foreignRes.status).toBe(404);
      expect(foreignRes.body.error.code).toBe(nonexistentRes.body.error.code);
      expect(foreignRes.body.error.message).toBe(nonexistentRes.body.error.message);
    });

    it('5. member provides own workspace header but targets document in foreign workspace -> returns 404', async () => {
      // memberUser belongs to Workspace A, attempts to read docInWorkspaceB with x-workspace-id = workspaceA
      const res = await request(app)
        .get(`/api/documents/${docInWorkspaceB}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-workspace-id', workspaceA.id);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DOCUMENT_NOT_FOUND');
    });

    it('6. missing workspace identity on list endpoint returns 400', async () => {
      const res = await request(app)
        .get('/api/documents')
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(['MISSING_WORKSPACE_ID', 'WORKSPACE_ID_REQUIRED']).toContain(res.body.error.code);
    });

    it('7. conflicting workspace identity between route param and header returns 400 CONFLICTING_WORKSPACE_ID', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceA.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-workspace-id', workspaceB.id);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONFLICTING_WORKSPACE_ID');
    });

    it('8. context synchronization: authorized header context prevents spoofed query workspaceId from accessing foreign data', async () => {
      // memberUser is authorized in Workspace A via X-Workspace-ID, while query asks for Workspace B
      const res = await request(app)
        .get(`/api/documents?workspaceId=${workspaceB.id}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-workspace-id', workspaceA.id);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Only returns documents from the authorized header workspace A
      const items = res.body.data.items as Array<{ workspaceId: string }>;
      for (const item of items) {
        expect(item.workspaceId).toBe(workspaceA.id);
        expect(item.workspaceId).not.toBe(workspaceB.id);
      }
    });

    it('10. status, download, and delete endpoints return 404 for foreign documents', async () => {
      // Status
      const statusRes = await request(app)
        .get(`/api/documents/${docInWorkspaceA}/status`)
        .set('Authorization', `Bearer ${outsiderToken}`);
      expect(statusRes.status).toBe(404);
      expect(statusRes.body.error.code).toBe('DOCUMENT_NOT_FOUND');

      // Download
      const downloadRes = await request(app)
        .get(`/api/documents/${docInWorkspaceA}/download`)
        .set('Authorization', `Bearer ${outsiderToken}`);
      expect(downloadRes.status).toBe(404);
      expect(downloadRes.body.error.code).toBe('DOCUMENT_NOT_FOUND');

      // Delete
      const deleteRes = await request(app)
        .delete(`/api/documents/${docInWorkspaceA}`)
        .set('Authorization', `Bearer ${outsiderToken}`);
      expect(deleteRes.status).toBe(404);
      expect(deleteRes.body.error.code).toBe('DOCUMENT_NOT_FOUND');
    });
  });
});
