import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalFileSystemStorageProvider, InMemoryStorageProvider } from './document.storage.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

describe('Document Storage Providers (Phase 2)', () => {
  describe('LocalFileSystemStorageProvider', () => {
    let tempDir: string;
    let storage: LocalFileSystemStorageProvider;

    beforeEach(async () => {
      tempDir = path.join(
        os.tmpdir(),
        `mv-storage-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      );
      await fs.mkdir(tempDir, { recursive: true });
      storage = new LocalFileSystemStorageProvider(tempDir);
    });

    afterEach(async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failure in temp directory
      }
    });

    it('should save a file buffer and retrieve it accurately', async () => {
      const buffer = Buffer.from('MindVault persistent test content', 'utf-8');
      const key = LocalFileSystemStorageProvider.generateStorageKey('.txt');

      await storage.save(key, buffer);

      const exists = await storage.exists(key);
      expect(exists).toBe(true);

      const retrievedBuffer = await storage.read(key);
      expect(retrievedBuffer.toString('utf-8')).toBe('MindVault persistent test content');
    });

    it('should delete a stored file and report exists = false', async () => {
      const buffer = Buffer.from('Temporary content');
      const key = LocalFileSystemStorageProvider.generateStorageKey('.txt');

      await storage.save(key, buffer);
      expect(await storage.exists(key)).toBe(true);

      await storage.delete(key);
      expect(await storage.exists(key)).toBe(false);
    });

    it('should calculate SHA-256 checksum matching native crypto', () => {
      const buffer = Buffer.from('Deterministic checksum content');
      const expectedHash = crypto.createHash('sha256').update(buffer).digest('hex');

      const calculated = LocalFileSystemStorageProvider.computeChecksum(buffer);
      expect(calculated).toBe(expectedHash);
    });

    it('should generate secure storage keys with random hex and correct extension', () => {
      const key = LocalFileSystemStorageProvider.generateStorageKey('.pdf');
      expect(key.startsWith('doc_')).toBe(true);
      expect(key.endsWith('.pdf')).toBe(true);
    });

    it('should block directory traversal attacks (.. traversal attempt)', async () => {
      const maliciousKey = '../../etc/passwd';
      const buffer = Buffer.from('malicious payload');

      await expect(storage.save(maliciousKey, buffer)).rejects.toThrow(/Path traversal detected/);

      await expect(storage.read(maliciousKey)).rejects.toThrow(/Path traversal detected/);

      await expect(storage.delete(maliciousKey)).rejects.toThrow(/Path traversal detected/);
    });
  });

  describe('InMemoryStorageProvider', () => {
    const storage = new InMemoryStorageProvider();

    it('should store and retrieve buffers in memory', async () => {
      const buffer = Buffer.from('In-memory buffer test');
      const key = 'doc_test_123.md';

      await storage.save(key, buffer);
      expect(await storage.exists(key)).toBe(true);

      const retrieved = await storage.read(key);
      expect(retrieved.toString('utf-8')).toBe('In-memory buffer test');

      await storage.delete(key);
      expect(await storage.exists(key)).toBe(false);
    });
  });
});
