import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { DocumentStorageProvider } from '@mindvault/shared';

export class LocalFileSystemStorageProvider implements DocumentStorageProvider {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = path.resolve(
      baseDir ||
        process.env.STORAGE_DIR ||
        path.join(process.cwd(), 'infrastructure', 'storage', 'documents'),
    );
  }

  private resolveSafePath(storageKey: string): string {
    if (!storageKey || typeof storageKey !== 'string') {
      throw new Error('Invalid storage key');
    }
    // Strict path traversal defense
    if (
      storageKey.includes('..') ||
      path.isAbsolute(storageKey) ||
      storageKey.includes('\0') ||
      storageKey.includes('\\')
    ) {
      throw new Error('Path traversal detected in storage key');
    }

    const resolved = path.resolve(this.baseDir, storageKey);
    if (!resolved.startsWith(this.baseDir)) {
      throw new Error('Path traversal attempt blocked');
    }
    return resolved;
  }

  public getAbsolutePath(storageKey: string): string {
    return this.resolveSafePath(storageKey);
  }

  public async save(storageKey: string, buffer: Buffer): Promise<void> {
    const targetPath = this.resolveSafePath(storageKey);
    const parentDir = path.dirname(targetPath);
    await fs.promises.mkdir(parentDir, { recursive: true });
    await fs.promises.writeFile(targetPath, buffer);
  }

  public async read(storageKey: string): Promise<Buffer> {
    const targetPath = this.resolveSafePath(storageKey);
    try {
      return await fs.promises.readFile(targetPath);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error(`File not found in storage: ${storageKey}`);
      }
      throw err;
    }
  }

  public async delete(storageKey: string): Promise<void> {
    const targetPath = this.resolveSafePath(storageKey);
    try {
      await fs.promises.unlink(targetPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  }

  public async exists(storageKey: string): Promise<boolean> {
    try {
      const targetPath = this.resolveSafePath(storageKey);
      await fs.promises.access(targetPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  public static generateStorageKey(extension: string): string {
    const sanitizedExt = extension
      .replace(/^\./, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    const timestamp = Date.now();
    const randomHex = crypto.randomBytes(16).toString('hex');
    return `doc_${timestamp}_${randomHex}.${sanitizedExt}`;
  }

  public static computeChecksum(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }
}

// In-Memory Storage Provider for unit and isolated tests
export class InMemoryStorageProvider implements DocumentStorageProvider {
  private files: Map<string, Buffer> = new Map();

  public async save(storageKey: string, buffer: Buffer): Promise<void> {
    if (storageKey.includes('..') || storageKey.includes('\0') || storageKey.includes('\\')) {
      throw new Error('Path traversal detected in storage key');
    }
    this.files.set(storageKey, Buffer.from(buffer));
  }

  public async read(storageKey: string): Promise<Buffer> {
    const file = this.files.get(storageKey);
    if (!file) throw new Error(`File not found in storage: ${storageKey}`);
    return Buffer.from(file);
  }

  public async delete(storageKey: string): Promise<void> {
    this.files.delete(storageKey);
  }

  public async exists(storageKey: string): Promise<boolean> {
    return this.files.has(storageKey);
  }

  public clear(): void {
    this.files.clear();
  }
}

export let defaultStorageProvider: DocumentStorageProvider = new LocalFileSystemStorageProvider();

export function setStorageProvider(provider: DocumentStorageProvider): void {
  defaultStorageProvider = provider;
}
