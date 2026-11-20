import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentService } from '../document.service.js';
import { InMemoryStorageProvider } from '../document.storage.js';

describe('Sprint 4: Upload Security & Magic Byte Validation Suite', () => {
  let service: DocumentService;
  let mockDb: any;
  let mockQueue: any;
  let mockStorage: InMemoryStorageProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage = new InMemoryStorageProvider();
    mockDb = {
      findDocumentByChecksum: vi.fn().mockResolvedValue(null),
      createDocument: vi.fn().mockImplementation((data) => ({
        id: data.id || 'doc-mock-id',
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
        processedAt: null,
      })),
      updateDocument: vi.fn().mockImplementation((id, data) => ({
        id,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
        processedAt: null,
      })),
      findDocumentById: vi.fn(),
    };
    mockQueue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
    };
    service = new DocumentService(mockDb, mockStorage, mockQueue);
  });

  describe('File Signature (Magic Byte) Adversarial Verification', () => {
    it('rejects an executable disguised as a PDF file', async () => {
      // Windows PE executable header: MZ\x90\x00 (0x4D, 0x5A)
      const fakePdfBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);

      await expect(
        service.uploadDocument({
          workspaceId: 'ws-123',
          uploadedById: 'user-456',
          originalName: 'trojan.pdf',
          mimeType: 'application/pdf',
          buffer: fakePdfBuffer,
        }),
      ).rejects.toThrow(/File signature does not match PDF specification/);
    });

    it('rejects an invalid DOCX file missing PK zip signature', async () => {
      const corruptDocx = Buffer.from('NOT_A_ZIP_ARCHIVE');

      await expect(
        service.uploadDocument({
          workspaceId: 'ws-123',
          uploadedById: 'user-456',
          originalName: 'corrupt.docx',
          mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          buffer: corruptDocx,
        }),
      ).rejects.toThrow(/File signature does not match DOCX specification/);
    });

    it('rejects a binary file disguised as markdown containing null bytes', async () => {
      const binaryDisguisedAsMd = Buffer.from([
        0x23, 0x20, 0x54, 0x69, 0x74, 0x6c, 0x65, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);

      await expect(
        service.uploadDocument({
          workspaceId: 'ws-123',
          uploadedById: 'user-456',
          originalName: 'exploit.md',
          mimeType: 'text/markdown',
          buffer: binaryDisguisedAsMd,
        }),
      ).rejects.toThrow(/Binary file detected/);
    });

    it('successfully accepts legitimate PDF with %PDF magic header', async () => {
      const validPdf = Buffer.from('%PDF-1.5 legitimate content here');

      const result = await service.uploadDocument({
        workspaceId: 'ws-123',
        uploadedById: 'user-456',
        originalName: 'valid.pdf',
        mimeType: 'application/pdf',
        buffer: validPdf,
      });

      expect(result.status).toBe('QUEUED');
      expect(mockDb.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          storageKey: expect.stringMatching(/^documents\/ws-123\//),
        }),
      );
      expect(mockQueue.enqueue).toHaveBeenCalledTimes(1);
    });
  });

  describe('Streaming Download Security', () => {
    it('streams document content without buffering entire file in memory', async () => {
      const content = Buffer.from('%PDF-1.4 streamable content');
      await mockStorage.save('documents/ws-1/doc-1/test.pdf', content);

      mockDb.findDocumentById.mockResolvedValueOnce({
        id: 'doc-1',
        workspaceId: 'ws-1',
        storageKey: 'documents/ws-1/doc-1/test.pdf',
        originalName: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: BigInt(content.length),
      });

      const { stream, originalName, mimeType, contentLength } =
        await service.streamDocument('ws-1', 'doc-1');

      expect(originalName).toBe('test.pdf');
      expect(mimeType).toBe('application/pdf');
      expect(contentLength).toBe(content.length);

      const chunks: Buffer[] = [];
      for await (const chunk of stream as any) {
        chunks.push(chunk);
      }
      expect(Buffer.concat(chunks).toString()).toBe('%PDF-1.4 streamable content');
    });

    it('blocks cross-workspace document stream access (IDOR defense)', async () => {
      mockDb.findDocumentById.mockResolvedValueOnce({
        id: 'doc-foreign',
        workspaceId: 'ws-victim',
        storageKey: 'documents/ws-victim/doc-foreign/secret.pdf',
      });

      await expect(
        service.streamDocument('ws-attacker', 'doc-foreign'),
      ).rejects.toThrow(/Document not found/);
    });
  });
});
