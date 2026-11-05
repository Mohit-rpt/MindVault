import path from 'node:path';
import type {
  DocumentDto,
  DocumentStatus,
  DocumentStatusDto,
  DocumentStorageProvider,
  PaginatedResponse,
} from '@mindvault/shared';
import { LocalFileSystemStorageProvider, defaultStorageProvider } from './document.storage.js';
import type { IDatabaseService, DocumentRecord } from '../../lib/db.js';
import { dbService } from '../../lib/db.js';
import { documentQueue, type IDocumentQueue } from './document.queue.js';
import { AppError } from '../../middleware/errorHandler.js';

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'] as const;

export const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
] as const;

export class DocumentService {
  private customDb?: IDatabaseService;
  private customStorage?: DocumentStorageProvider;
  private customQueue?: IDocumentQueue;

  constructor(db?: IDatabaseService, storage?: DocumentStorageProvider, queue?: IDocumentQueue) {
    this.customDb = db;
    this.customStorage = storage;
    this.customQueue = queue;
  }

  private get db(): IDatabaseService {
    return this.customDb || dbService;
  }

  private get storage(): DocumentStorageProvider {
    return this.customStorage || defaultStorageProvider;
  }

  private get queue(): IDocumentQueue {
    return this.customQueue || documentQueue;
  }

  public async uploadDocument(params: {
    workspaceId: string;
    uploadedById: string;
    originalName: string;
    mimeType: string;
    buffer: Buffer;
  }): Promise<DocumentDto> {
    const { workspaceId, uploadedById, buffer } = params;

    // 1. Sanitize original filename and extract extension
    const rawName = path.basename(params.originalName || 'document.txt');
    const sanitizedName = rawName
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F]/g, '')
      .replace(/[/\\]/g, '_')
      .replace(/\.\./g, '_')
      .trim();

    const ext = path.extname(sanitizedName).toLowerCase();

    // 2. Validate extension
    if (!SUPPORTED_EXTENSIONS.includes(ext as any)) {
      throw new AppError(
        400,
        'UNSUPPORTED_FILE_TYPE',
        `Unsupported file extension '${ext}'. Supported extensions: ${SUPPORTED_EXTENSIONS.join(', ')}`,
      );
    }

    // 3. Validate file size
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new AppError(
        400,
        'FILE_TOO_LARGE',
        `File size (${(buffer.length / (1024 * 1024)).toFixed(2)} MB) exceeds maximum allowed limit of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`,
      );
    }

    if (buffer.length === 0) {
      throw new AppError(400, 'EMPTY_FILE', 'Uploaded file cannot be empty (0 bytes received)');
    }

    // 4. Validate file signatures / magic bytes
    this.validateMagicBytes(buffer, ext);

    // 5. Compute SHA-256 Checksum
    const checksum = LocalFileSystemStorageProvider.computeChecksum(buffer);

    // 6. Check for duplicate upload within this workspace
    const existing = await this.db.findDocumentByChecksum(workspaceId, checksum);
    if (existing && existing.status !== 'FAILED') {
      throw new AppError(
        409,
        'DUPLICATE_DOCUMENT',
        `A document with identical content already exists in this workspace ('${existing.originalName}')`,
      );
    }

    // 7. Generate secure storage key and persist file
    const storageKey = LocalFileSystemStorageProvider.generateStorageKey(ext);
    await this.storage.save(storageKey, buffer);

    // 8. Create Document Record with UPLOADED status
    let docRecord = await this.db.createDocument({
      workspaceId,
      uploadedById,
      originalName: sanitizedName,
      mimeType: params.mimeType,
      extension: ext,
      sizeBytes: BigInt(buffer.length),
      checksum,
      storageKey,
      status: 'UPLOADED',
      metadata: {
        originalMimeType: params.mimeType,
        uploadedAt: new Date().toISOString(),
      },
    });

    // 9. Coordinate BullMQ job enqueue
    await this.queue.enqueue({
      documentId: docRecord.id,
      workspaceId,
      userId: uploadedById,
    });

    // 10. Update status to QUEUED
    docRecord = await this.db.updateDocument(docRecord.id, {
      status: 'QUEUED',
      metadata: {
        ...docRecord.metadata,
        queuedAt: new Date().toISOString(),
      },
    });

    return this.mapToDto(docRecord);
  }

  public async listDocuments(
    workspaceId: string,
    options?: {
      page?: number;
      limit?: number;
      status?: DocumentStatus;
      search?: string;
    },
  ): Promise<PaginatedResponse<DocumentDto>> {
    const page = Math.max(1, options?.page || 1);
    const limit = Math.max(1, Math.min(100, options?.limit || 20));
    const skip = (page - 1) * limit;

    const { items, total } = await this.db.listDocuments(workspaceId, {
      status: options?.status,
      search: options?.search,
      skip,
      take: limit,
    });

    return {
      items: items.map((doc) => this.mapToDto(doc)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  public async getDocumentById(workspaceId: string, documentId: string): Promise<DocumentDto> {
    const doc = await this.db.findDocumentById(documentId);
    if (!doc || doc.workspaceId !== workspaceId) {
      throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');
    }
    return this.mapToDto(doc);
  }

  public async getDocumentStatus(
    workspaceId: string,
    documentId: string,
  ): Promise<DocumentStatusDto> {
    const doc = await this.db.findDocumentById(documentId);
    if (!doc || doc.workspaceId !== workspaceId) {
      throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');
    }

    return {
      id: doc.id,
      status: doc.status,
      processingStage: (doc.metadata as any)?.processingStage,
      chunkCount: doc.chunkCount,
      pageCount: doc.pageCount,
      errorMessage: doc.errorMessage,
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  public async deleteDocument(workspaceId: string, documentId: string): Promise<void> {
    const doc = await this.db.findDocumentById(documentId);
    if (!doc || doc.workspaceId !== workspaceId) {
      throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');
    }

    // 1. Mark status DELETING
    await this.db.updateDocument(documentId, { status: 'DELETING' });

    // 2. Remove physical storage file
    try {
      await this.storage.delete(doc.storageKey);
    } catch (err) {
      console.warn(`Failed to delete storage file for document ${documentId}:`, err);
    }

    // 3. Remove document and associated chunks from database
    await this.db.deleteDocument(documentId);
  }

  public async downloadDocument(
    workspaceId: string,
    documentId: string,
  ): Promise<{ buffer: Buffer; originalName: string; mimeType: string }> {
    const doc = await this.db.findDocumentById(documentId);
    if (!doc || doc.workspaceId !== workspaceId) {
      throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');
    }

    const buffer = await this.storage.read(doc.storageKey);
    return {
      buffer,
      originalName: doc.originalName,
      mimeType: doc.mimeType,
    };
  }

  private validateMagicBytes(buffer: Buffer, ext: string): void {
    if (ext === '.pdf') {
      if (buffer.length < 5 || buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
        throw new AppError(
          400,
          'INVALID_FILE_SIGNATURE',
          'File signature does not match PDF specification (missing %PDF header)',
        );
      }
    } else if (ext === '.docx') {
      if (
        buffer.length < 4 ||
        buffer[0] !== 0x50 ||
        buffer[1] !== 0x4b ||
        buffer[2] !== 0x03 ||
        buffer[3] !== 0x04
      ) {
        throw new AppError(
          400,
          'INVALID_FILE_SIGNATURE',
          'File signature does not match DOCX specification (missing PK zip header)',
        );
      }
    } else if (ext === '.txt' || ext === '.md') {
      // Check for excessive null bytes indicating binary file spoofing as text
      const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
      let nullCount = 0;
      for (let i = 0; i < sample.length; i++) {
        if (sample[i] === 0x00) nullCount++;
      }
      if (nullCount > 2) {
        throw new AppError(
          400,
          'INVALID_FILE_SIGNATURE',
          'Binary file detected: Text/Markdown files cannot contain binary null bytes',
        );
      }
    }
  }

  private mapToDto(doc: DocumentRecord): DocumentDto {
    return {
      id: doc.id,
      workspaceId: doc.workspaceId,
      uploadedById: doc.uploadedById,
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      extension: doc.extension,
      sizeBytes: Number(doc.sizeBytes),
      checksum: doc.checksum,
      status: doc.status,
      errorMessage: doc.errorMessage,
      pageCount: doc.pageCount,
      chunkCount: doc.chunkCount,
      embeddingModel: doc.embeddingModel,
      embeddingDimension: doc.embeddingDimension,
      metadata: doc.metadata,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
      processedAt: doc.processedAt ? doc.processedAt.toISOString() : null,
    };
  }
}
