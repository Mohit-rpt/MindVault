import fs from 'node:fs';
import path from 'node:path';
import stream from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import type { DocumentStorageProvider, StorageObjectMetadata } from '@mindvault/shared';
import { env } from '../config/env.js';

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

async function streamToBuffer(readable: NodeJS.ReadableStream): Promise<Buffer> {
  if (typeof (readable as any)?.transformToByteArray === 'function') {
    const bytes = await (readable as any).transformToByteArray();
    return Buffer.from(bytes);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of readable as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class WorkerStorageProvider implements DocumentStorageProvider {
  private baseDir: string;

  constructor(baseDir?: string) {
    const rootDir = findWorkspaceRoot(process.cwd());
    if (baseDir) {
      this.baseDir = path.isAbsolute(baseDir) ? baseDir : path.resolve(rootDir, baseDir);
    } else if (process.env.STORAGE_DIR || env.STORAGE_DIR) {
      const dir = process.env.STORAGE_DIR || env.STORAGE_DIR!;
      this.baseDir = path.isAbsolute(dir) ? dir : path.resolve(rootDir, dir);
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

  async save(
    storageKey: string,
    buffer: Buffer,
    _metadata?: { contentType?: string },
  ): Promise<void> {
    const targetPath = this.resolveSafePath(storageKey);
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.writeFile(targetPath, buffer);
  }

  async saveStream(
    storageKey: string,
    sourceStream: NodeJS.ReadableStream,
    _metadata?: { contentType?: string; contentLength?: number },
  ): Promise<void> {
    const targetPath = this.resolveSafePath(storageKey);
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    const writeStream = fs.createWriteStream(targetPath);
    await pipeline(sourceStream, writeStream);
  }

  async read(storageKey: string): Promise<Buffer> {
    const targetPath = this.resolveSafePath(storageKey);
    return fs.promises.readFile(targetPath);
  }

  async readStream(storageKey: string): Promise<NodeJS.ReadableStream> {
    const targetPath = this.resolveSafePath(storageKey);
    return fs.createReadStream(targetPath);
  }

  async delete(storageKey: string): Promise<void> {
    const targetPath = this.resolveSafePath(storageKey);
    try {
      await fs.promises.unlink(targetPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async deleteMany(storageKeys: string[]): Promise<void> {
    await Promise.all(storageKeys.map((key) => this.delete(key)));
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

  async getMetadata(storageKey: string): Promise<StorageObjectMetadata | null> {
    try {
      const targetPath = this.resolveSafePath(storageKey);
      const stat = await fs.promises.stat(targetPath);
      return {
        contentLength: stat.size,
        lastModified: stat.mtime,
      };
    } catch {
      return null;
    }
  }
}

export class WorkerS3StorageProvider implements DocumentStorageProvider {
  private client: S3Client;
  private bucket: string;

  constructor(config: {
    endpoint?: string;
    bucket: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    forcePathStyle?: boolean;
  }) {
    this.bucket = config.bucket;
    const clientConfig: S3ClientConfig = {
      region: config.region || 'auto',
      forcePathStyle: config.forcePathStyle ?? true,
    };
    if (config.endpoint) clientConfig.endpoint = config.endpoint;
    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }
    this.client = new S3Client(clientConfig);
  }

  async save(
    storageKey: string,
    buffer: Buffer,
    metadata?: { contentType?: string },
  ): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      Body: buffer,
      ContentType: metadata?.contentType || 'application/octet-stream',
    });
    await this.client.send(command);
  }

  async saveStream(
    storageKey: string,
    sourceStream: NodeJS.ReadableStream,
    metadata?: { contentType?: string; contentLength?: number },
  ): Promise<void> {
    const buffer = await streamToBuffer(sourceStream);
    await this.save(storageKey, buffer, metadata);
  }

  async read(storageKey: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });
    try {
      const response = await this.client.send(command);
      if (!response.Body) {
        throw new Error(`Empty body received from object storage for key: ${storageKey}`);
      }
      return await streamToBuffer(response.Body as NodeJS.ReadableStream);
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        throw new Error(`File not found in storage: ${storageKey}`);
      }
      throw err;
    }
  }

  async readStream(storageKey: string): Promise<NodeJS.ReadableStream> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });
    try {
      const response = await this.client.send(command);
      if (!response.Body) {
        throw new Error(`Empty body received from object storage for key: ${storageKey}`);
      }
      return response.Body as NodeJS.ReadableStream;
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        throw new Error(`File not found in storage: ${storageKey}`);
      }
      throw err;
    }
  }

  async delete(storageKey: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });
    try {
      await this.client.send(command);
    } catch (err: any) {
      if (err.name !== 'NoSuchKey' && err.$metadata?.httpStatusCode !== 404) {
        throw err;
      }
    }
  }

  async deleteMany(storageKeys: string[]): Promise<void> {
    if (storageKeys.length === 0) return;
    const command = new DeleteObjectsCommand({
      Bucket: this.bucket,
      Delete: {
        Objects: storageKeys.map((Key) => ({ Key })),
        Quiet: true,
      },
    });
    await this.client.send(command);
  }

  async exists(storageKey: string): Promise<boolean> {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });
    try {
      await this.client.send(command);
      return true;
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  async getMetadata(storageKey: string): Promise<StorageObjectMetadata | null> {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });
    try {
      const response = await this.client.send(command);
      return {
        contentLength: response.ContentLength || 0,
        contentType: response.ContentType,
        lastModified: response.LastModified,
      };
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }
}

export function createWorkerStorage(): DocumentStorageProvider {
  const providerType = process.env.STORAGE_PROVIDER || env.STORAGE_PROVIDER || 'local';
  if (providerType === 's3' || providerType === 'r2') {
    const bucket = process.env.STORAGE_BUCKET || env.STORAGE_BUCKET;
    if (!bucket) {
      throw new Error(`STORAGE_BUCKET is required when STORAGE_PROVIDER=${providerType}`);
    }
    return new WorkerS3StorageProvider({
      bucket,
      endpoint: process.env.STORAGE_ENDPOINT || env.STORAGE_ENDPOINT,
      region: process.env.STORAGE_REGION || env.STORAGE_REGION || 'auto',
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID || env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY || env.STORAGE_SECRET_ACCESS_KEY,
      forcePathStyle:
        process.env.STORAGE_FORCE_PATH_STYLE === 'true' || env.STORAGE_FORCE_PATH_STYLE === true,
    });
  }
  return new WorkerStorageProvider();
}
