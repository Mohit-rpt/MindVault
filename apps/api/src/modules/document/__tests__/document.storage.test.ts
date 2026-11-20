import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import stream from 'node:stream';
import {
  LocalFileSystemStorageProvider,
  InMemoryStorageProvider,
  S3CompatibleStorageProvider,
  createDocumentStorage,
} from '../document.storage.js';

describe('Sprint 4: Document Storage Architecture Suite', () => {
  const testDir = path.resolve(process.cwd(), 'tmp-test-storage');

  beforeEach(async () => {
    await fs.promises.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('1. LocalFileSystemStorageProvider', () => {
    it('generates secure hierarchical keys when workspaceId and documentId are provided', () => {
      const key = LocalFileSystemStorageProvider.generateStorageKey({
        workspaceId: 'ws-123',
        documentId: 'doc-456',
        extension: '.pdf',
      });
      expect(key).toMatch(/^documents\/ws-123\/doc-456\/doc_\d+_[a-f0-9]{32}\.pdf$/);
    });

    it('generates flat legacy keys when only extension is passed as string', () => {
      const key = LocalFileSystemStorageProvider.generateStorageKey('.txt');
      expect(key).toMatch(/^doc_\d+_[a-f0-9]{32}\.txt$/);
    });

    it('blocks directory traversal attempts in storage keys', async () => {
      const provider = new LocalFileSystemStorageProvider(testDir);
      const invalidKeys = [
        '../secret.txt',
        'documents/../../etc/passwd',
        'C:\\Windows\\system32',
        'doc\0invalid.pdf',
        '/absolute/path/file.txt',
      ];

      for (const badKey of invalidKeys) {
        await expect(provider.save(badKey, Buffer.from('test'))).rejects.toThrow(
          /Path traversal detected in storage key/,
        );
        await expect(provider.read(badKey)).rejects.toThrow(
          /Path traversal detected in storage key/,
        );
      }
    });

    it('saves, reads, and deletes binary buffers safely in nested directories', async () => {
      const provider = new LocalFileSystemStorageProvider(testDir);
      const key = 'documents/ws-test/doc-test/test-file.txt';
      const content = Buffer.from('Hello, Secure Storage!');

      await provider.save(key, content);
      expect(await provider.exists(key)).toBe(true);

      const metadata = await provider.getMetadata(key);
      expect(metadata).not.toBeNull();
      expect(metadata?.contentLength).toBe(content.length);

      const readBack = await provider.read(key);
      expect(readBack.toString()).toBe('Hello, Secure Storage!');

      await provider.delete(key);
      expect(await provider.exists(key)).toBe(false);
    });

    it('supports streaming reads and streaming writes with backpressure', async () => {
      const provider = new LocalFileSystemStorageProvider(testDir);
      const key = 'documents/ws-stream/doc-stream/stream-test.bin';
      const sampleData = Buffer.from('Streaming chunk 1, chunk 2, chunk 3');
      const inStream = stream.Readable.from(sampleData);

      await provider.saveStream(key, inStream);
      expect(await provider.exists(key)).toBe(true);

      const outStream = await provider.readStream(key);
      const chunks: Buffer[] = [];
      for await (const chunk of outStream as any) {
        chunks.push(chunk);
      }
      expect(Buffer.concat(chunks).toString()).toBe('Streaming chunk 1, chunk 2, chunk 3');
    });

    it('supports deleteMany in bulk', async () => {
      const provider = new LocalFileSystemStorageProvider(testDir);
      const k1 = 'documents/ws-bulk/doc-1/f1.txt';
      const k2 = 'documents/ws-bulk/doc-2/f2.txt';

      await provider.save(k1, Buffer.from('file 1'));
      await provider.save(k2, Buffer.from('file 2'));
      expect(await provider.exists(k1)).toBe(true);
      expect(await provider.exists(k2)).toBe(true);

      await provider.deleteMany([k1, k2]);
      expect(await provider.exists(k1)).toBe(false);
      expect(await provider.exists(k2)).toBe(false);
    });
  });

  describe('2. InMemoryStorageProvider', () => {
    it('manages file lifecycle entirely in RAM with stream and metadata support', async () => {
      const memoryProvider = new InMemoryStorageProvider();
      const key = 'test-in-memory.txt';
      const data = Buffer.from('RAM data');

      await memoryProvider.save(key, data, { contentType: 'text/plain' });
      expect(await memoryProvider.exists(key)).toBe(true);

      const meta = await memoryProvider.getMetadata(key);
      expect(meta?.contentLength).toBe(data.length);
      expect(meta?.contentType).toBe('text/plain');

      const streamRead = await memoryProvider.readStream(key);
      const chunks: Buffer[] = [];
      for await (const chunk of streamRead as any) {
        chunks.push(chunk);
      }
      expect(Buffer.concat(chunks).toString()).toBe('RAM data');

      await memoryProvider.delete(key);
      expect(await memoryProvider.exists(key)).toBe(false);
    });
  });

  describe('3. S3CompatibleStorageProvider', () => {
    it('throws descriptive error if bucket name is missing', () => {
      expect(() => new S3CompatibleStorageProvider({ bucket: '' })).toThrow(
        /S3CompatibleStorageProvider requires a non-empty bucket name/,
      );
    });

    it('routes commands through S3 client and handles NoSuchKey errors cleanly', async () => {
      const provider = new S3CompatibleStorageProvider({
        bucket: 'test-bucket',
        endpoint: 'http://localhost:9000',
        region: 'auto',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      });

      // Mock client.send
      const sendMock = vi.fn().mockRejectedValue({
        name: 'NoSuchKey',
        $metadata: { httpStatusCode: 404 },
      });
      (provider as any).client = { send: sendMock };

      expect(await provider.exists('non-existent.pdf')).toBe(false);
      expect(await provider.getMetadata('non-existent.pdf')).toBeNull();
      await expect(provider.read('non-existent.pdf')).rejects.toThrow(
        /File not found in storage: non-existent.pdf/,
      );
    });

    it('correctly maps successful S3 PutObject and GetObject operations', async () => {
      const provider = new S3CompatibleStorageProvider({
        bucket: 'test-bucket',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      });

      const sampleBuffer = Buffer.from('S3 file payload');
      const sendMock = vi.fn().mockImplementation((command) => {
        if (command.constructor.name === 'PutObjectCommand') {
          return Promise.resolve({});
        }
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: stream.Readable.from(sampleBuffer),
            ContentType: 'application/pdf',
          });
        }
        if (command.constructor.name === 'HeadObjectCommand') {
          return Promise.resolve({
            ContentLength: sampleBuffer.length,
            ContentType: 'application/pdf',
            LastModified: new Date(),
          });
        }
        return Promise.resolve({});
      });

      (provider as any).client = { send: sendMock };

      await provider.save('documents/ws/doc/file.pdf', sampleBuffer, {
        contentType: 'application/pdf',
      });
      expect(sendMock).toHaveBeenCalledTimes(1);

      const readResult = await provider.read('documents/ws/doc/file.pdf');
      expect(readResult.toString()).toBe('S3 file payload');

      const meta = await provider.getMetadata('documents/ws/doc/file.pdf');
      expect(meta?.contentLength).toBe(sampleBuffer.length);
      expect(meta?.contentType).toBe('application/pdf');
    });
  });

  describe('4. Storage Factory', () => {
    it('defaults to LocalFileSystemStorageProvider when STORAGE_PROVIDER is local', () => {
      const p = createDocumentStorage();
      expect(p).toBeInstanceOf(LocalFileSystemStorageProvider);
    });
  });
});
