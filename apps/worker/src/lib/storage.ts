import fs from 'node:fs';
import path from 'node:path';
import type { DocumentStorageProvider } from '@mindvault/shared';

function findWorkspaceRoot(startDir: string): string {
  let curr = startDir;
  while (curr !== path.dirname(curr)) {
    if (fs.existsSync(path.join(curr, 'pnpm-workspace.yaml'))) {
      return curr;
    }
    curr = path.dirname(curr);
  }
  return process.cwd();
}

export class WorkerStorageProvider implements DocumentStorageProvider {
  private baseDir: string;

  constructor(baseDir?: string) {
    const rootDir = findWorkspaceRoot(process.cwd());
    if (baseDir) {
      this.baseDir = path.isAbsolute(baseDir) ? baseDir : path.resolve(rootDir, baseDir);
    } else if (process.env.STORAGE_DIR) {
      this.baseDir = path.isAbsolute(process.env.STORAGE_DIR)
        ? process.env.STORAGE_DIR
        : path.resolve(rootDir, process.env.STORAGE_DIR);
    } else {
      this.baseDir = path.resolve(rootDir, 'infrastructure', 'storage', 'documents');
    }
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
