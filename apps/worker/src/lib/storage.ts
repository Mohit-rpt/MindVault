import fs from 'node:fs';
import path from 'node:path';
import type { DocumentStorageProvider } from '@mindvault/shared';

export class WorkerStorageProvider implements DocumentStorageProvider {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = path.resolve(
      baseDir ||
        process.env.STORAGE_DIR ||
        path.join(process.cwd(), 'infrastructure', 'storage', 'documents'),
    );
  }

  private resolveSafePath(storageKey: string): string {
    if (
      !storageKey ||
      storageKey.includes('..') ||
      path.isAbsolute(storageKey) ||
      storageKey.includes('\0') ||
      storageKey.includes('\\')
    ) {
      throw new Error('Path traversal detected in storage key');
    }
    const resolved = path.resolve(this.baseDir, storageKey);
    if (!resolved.startsWith(this.baseDir)) {
      throw new Error('Path traversal blocked');
    }
    return resolved;
  }

  async save(storageKey: string, buffer: Buffer): Promise<void> {
    const targetPath = this.resolveSafePath(storageKey);
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.writeFile(targetPath, buffer);
  }

  async read(storageKey: string): Promise<Buffer> {
    const targetPath = this.resolveSafePath(storageKey);
    return fs.promises.readFile(targetPath);
  }

  async delete(storageKey: string): Promise<void> {
    const targetPath = this.resolveSafePath(storageKey);
    try {
      await fs.promises.unlink(targetPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      const targetPath = this.resolveSafePath(storageKey);
      await fs.promises.access(targetPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}
