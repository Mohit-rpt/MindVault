import { PrismaClient } from '@prisma/client';
import type { IngestionDatabaseService } from '../modules/ingestion/pipeline.js';

export class PrismaWorkerDatabaseService implements IngestionDatabaseService {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || new PrismaClient();
  }

  async findDocumentById(id: string): Promise<any> {
    return this.prisma.document.findUnique({
      where: { id },
    });
  }

  async updateDocument(id: string, data: any): Promise<any> {
    return this.prisma.document.update({
      where: { id },
      data,
    });
  }

  async createDocumentChunks(chunks: any[]): Promise<void> {
    if (chunks.length === 0) return;
    const documentId = chunks[0].documentId;

    await this.prisma.$transaction(async (tx) => {
      await tx.documentChunk.deleteMany({ where: { documentId } });
      for (const chunk of chunks) {
        const chunkId = chunk.id || `chk_${Math.random().toString(36).slice(2, 11)}`;
        if (chunk.embedding && chunk.embedding.length > 0) {
          const vectorStr = `[${chunk.embedding.join(',')}]`;
          await tx.$executeRaw`
            INSERT INTO "document_chunks" ("id", "documentId", "workspaceId", "chunkIndex", "content", "tokenCount", "pageStart", "pageEnd", "metadata", "embedding", "createdAt")
            VALUES (${chunkId}, ${chunk.documentId}, ${chunk.workspaceId}, ${chunk.chunkIndex}, ${chunk.content}, ${chunk.tokenCount}, ${chunk.pageStart}, ${chunk.pageEnd}, ${JSON.stringify(chunk.metadata || {})}::jsonb, ${vectorStr}::vector, NOW())
          `;
        } else {
          await tx.documentChunk.create({
            data: {
              id: chunkId,
              documentId: chunk.documentId,
              workspaceId: chunk.workspaceId,
              chunkIndex: chunk.chunkIndex,
              content: chunk.content,
              tokenCount: chunk.tokenCount,
              pageStart: chunk.pageStart,
              pageEnd: chunk.pageEnd,
              metadata: chunk.metadata || {},
            },
          });
        }
      }
    });
  }
}
