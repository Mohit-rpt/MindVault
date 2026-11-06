import { prisma } from './prisma.js';
import {
  WorkspaceRole,
  DocumentStatus,
  ChatSessionStatus,
  ChatMessageRole,
  ChatMessageStatus,
} from '@mindvault/shared';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceMemberRecord {
  id: string;
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  joinedAt: Date;
  user?: {
    id: string;
    name: string;
    email: string;
  };
}

export interface SessionRecord {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  user?: UserRecord;
}

export interface DocumentRecord {
  id: string;
  workspaceId: string;
  uploadedById: string;
  originalName: string;
  mimeType: string;
  extension: string;
  sizeBytes: bigint;
  checksum: string;
  storageKey: string;
  status: DocumentStatus;
  errorMessage: string | null;
  pageCount: number | null;
  chunkCount: number;
  embeddingModel: string | null;
  embeddingDimension: number | null;
  metadata: any;
  createdAt: Date;
  updatedAt: Date;
  processedAt: Date | null;
  uploadedBy?: {
    id: string;
    name: string;
    email: string;
  };
}

export interface DocumentChunkRecord {
  id: string;
  documentId: string;
  workspaceId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageStart: number | null;
  pageEnd: number | null;
  metadata: any;
  embedding?: number[] | null;
  createdAt: Date;
}

export interface SearchChunkResult {
  chunk: DocumentChunkRecord;
  document: {
    id: string;
    originalName: string;
    extension: string;
    status: DocumentStatus;
    pageCount?: number | null;
  };
  score: number;
  distance?: number;
}

export interface ChatSessionRecord {
  id: string;
  workspaceId: string;
  userId: string;
  title: string;
  status: ChatSessionStatus;
  summary: string | null;
  summaryVersion: number;
  summarizedThroughSeq: number;
  summaryUpdatedAt: Date | null;
  messageCount: number;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface ChatMessageRecord {
  id: string;
  sessionId: string;
  workspaceId: string;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  sequenceNumber: number;
  citations: any;
  metadata: any;
  tokenEstimate: number;
  createdAt: Date;
  completedAt: Date | null;
}

export interface IDatabaseService {
  // User operations
  createUser(data: { name: string; email: string; passwordHash: string }): Promise<UserRecord>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;

  // Workspace operations
  createWorkspace(data: {
    name: string;
    slug: string;
    ownerId: string;
  }): Promise<{ workspace: WorkspaceRecord; member: WorkspaceMemberRecord }>;
  findWorkspaceById(id: string): Promise<WorkspaceRecord | null>;
  findWorkspaceBySlug(slug: string): Promise<WorkspaceRecord | null>;
  findUserWorkspaces(userId: string): Promise<Array<WorkspaceRecord & { role: WorkspaceRole }>>;
  findWorkspaceWithMembers(
    workspaceId: string,
  ): Promise<(WorkspaceRecord & { members: WorkspaceMemberRecord[] }) | null>;
  updateWorkspace(
    workspaceId: string,
    data: { name?: string; slug?: string },
  ): Promise<WorkspaceRecord>;
  deleteWorkspace(workspaceId: string): Promise<void>;
  getWorkspaceMember(workspaceId: string, userId: string): Promise<WorkspaceMemberRecord | null>;

  // Session operations
  createSession(data: {
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<SessionRecord>;
  findSessionByHash(refreshTokenHash: string): Promise<SessionRecord | null>;
  updateSessionHash(sessionId: string, newHash: string, newExpiresAt: Date): Promise<SessionRecord>;
  revokeSession(sessionId: string): Promise<void>;
  revokeAllUserSessions(userId: string): Promise<void>;
  listActiveSessions(userId: string): Promise<SessionRecord[]>;

  // Document operations (Phase 2)
  createDocument(data: {
    id?: string;
    workspaceId: string;
    uploadedById: string;
    originalName: string;
    mimeType: string;
    extension: string;
    sizeBytes: bigint;
    checksum: string;
    storageKey: string;
    status?: DocumentStatus;
    metadata?: Record<string, unknown>;
  }): Promise<DocumentRecord>;
  findDocumentById(id: string): Promise<DocumentRecord | null>;
  findDocumentByChecksum(workspaceId: string, checksum: string): Promise<DocumentRecord | null>;
  listDocuments(
    workspaceId: string,
    options?: {
      status?: DocumentStatus;
      search?: string;
      skip?: number;
      take?: number;
    },
  ): Promise<{ items: DocumentRecord[]; total: number }>;
  updateDocument(
    id: string,
    data: {
      status?: DocumentStatus;
      errorMessage?: string | null;
      pageCount?: number | null;
      chunkCount?: number;
      embeddingModel?: string | null;
      embeddingDimension?: number | null;
      processedAt?: Date | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<DocumentRecord>;
  deleteDocument(id: string): Promise<void>;

  // Chunk operations (Phase 2)
  createDocumentChunks(
    chunks: Array<{
      id?: string;
      documentId: string;
      workspaceId: string;
      chunkIndex: number;
      content: string;
      tokenCount: number;
      pageStart?: number | null;
      pageEnd?: number | null;
      metadata?: Record<string, unknown>;
      embedding?: number[];
    }>,
  ): Promise<void>;
  getDocumentChunks(documentId: string): Promise<DocumentChunkRecord[]>;
  deleteDocumentChunks(documentId: string): Promise<void>;

  // Retrieval operations (Phase 3)
  searchVectorChunks(
    workspaceId: string,
    queryVector: number[],
    options?: {
      topK?: number;
      documentIds?: string[];
      fileTypes?: string[];
      pageStart?: number;
      pageEnd?: number;
    },
  ): Promise<SearchChunkResult[]>;

  searchKeywordChunks(
    workspaceId: string,
    queryText: string,
    options?: {
      topK?: number;
      documentIds?: string[];
      fileTypes?: string[];
      pageStart?: number;
      pageEnd?: number;
    },
  ): Promise<SearchChunkResult[]>;

  // Conversation operations (Phase 5)
  createChatSession(data: {
    id?: string;
    workspaceId: string;
    userId: string;
    title?: string;
  }): Promise<ChatSessionRecord>;
  findChatSessionById(id: string, workspaceId: string): Promise<ChatSessionRecord | null>;
  listChatSessions(params: {
    workspaceId: string;
    userId: string;
    limit?: number;
    cursor?: string;
    search?: string;
    status?: ChatSessionStatus;
  }): Promise<ChatSessionRecord[]>;
  updateChatSession(
    id: string,
    workspaceId: string,
    data: {
      title?: string;
      status?: ChatSessionStatus;
      summary?: string | null;
      summaryVersion?: number;
      summarizedThroughSeq?: number;
      summaryUpdatedAt?: Date | null;
      messageCount?: number;
      lastMessageAt?: Date;
      archivedAt?: Date | null;
    },
  ): Promise<ChatSessionRecord>;
  deleteChatSession(id: string, workspaceId: string): Promise<void>;

  createChatMessage(data: {
    id?: string;
    sessionId: string;
    workspaceId: string;
    role: ChatMessageRole;
    content: string;
    status?: ChatMessageStatus;
    sequenceNumber?: number;
    citations?: any;
    metadata?: any;
    tokenEstimate?: number;
  }): Promise<ChatMessageRecord>;
  findChatMessageById(id: string, sessionId: string): Promise<ChatMessageRecord | null>;
  updateChatMessage(
    id: string,
    sessionId: string,
    data: {
      content?: string;
      status?: ChatMessageStatus;
      citations?: any;
      metadata?: any;
      tokenEstimate?: number;
      completedAt?: Date | null;
    },
  ): Promise<ChatMessageRecord>;
  listChatMessages(
    sessionId: string,
    workspaceId: string,
    params?: {
      limit?: number;
      beforeSequence?: number;
      afterSequence?: number;
    },
  ): Promise<ChatMessageRecord[]>;
  getNextMessageSequence(sessionId: string): Promise<number>;
  getRecentMessagesForContext(
    sessionId: string,
    workspaceId: string,
    limit?: number,
  ): Promise<ChatMessageRecord[]>;
}

// ---------------------------------------------------------------------------
// Prisma Implementation
// ---------------------------------------------------------------------------
export class PrismaDatabaseService implements IDatabaseService {
  async createUser(data: {
    name: string;
    email: string;
    passwordHash: string;
  }): Promise<UserRecord> {
    return prisma.user.create({ data });
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    return prisma.user.findUnique({ where: { email } });
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  async createWorkspace(data: {
    name: string;
    slug: string;
    ownerId: string;
  }): Promise<{ workspace: WorkspaceRecord; member: WorkspaceMemberRecord }> {
    return prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: data.name,
          slug: data.slug,
        },
      });

      const member = await tx.workspaceMember.create({
        data: {
          userId: data.ownerId,
          workspaceId: workspace.id,
          role: 'OWNER',
        },
      });

      return {
        workspace,
        member: {
          ...member,
          role: member.role as WorkspaceRole,
        },
      };
    });
  }

  async findWorkspaceById(id: string): Promise<WorkspaceRecord | null> {
    return prisma.workspace.findUnique({ where: { id } });
  }

  async findWorkspaceBySlug(slug: string): Promise<WorkspaceRecord | null> {
    return prisma.workspace.findUnique({ where: { slug } });
  }

  async findUserWorkspaces(
    userId: string,
  ): Promise<Array<WorkspaceRecord & { role: WorkspaceRole }>> {
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { joinedAt: 'asc' },
    });

    return memberships.map((m) => ({
      ...m.workspace,
      role: m.role as WorkspaceRole,
    }));
  }

  async findWorkspaceWithMembers(
    workspaceId: string,
  ): Promise<(WorkspaceRecord & { members: WorkspaceMemberRecord[] }) | null> {
    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    });

    if (!ws) return null;

    return {
      ...ws,
      members: ws.members.map((m) => ({
        ...m,
        role: m.role as WorkspaceRole,
      })),
    };
  }

  async updateWorkspace(
    workspaceId: string,
    data: { name?: string; slug?: string },
  ): Promise<WorkspaceRecord> {
    return prisma.workspace.update({
      where: { id: workspaceId },
      data,
    });
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await prisma.workspace.delete({ where: { id: workspaceId } });
  }

  async getWorkspaceMember(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMemberRecord | null> {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: { userId, workspaceId },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
    if (!member) return null;
    return {
      ...member,
      role: member.role as WorkspaceRole,
    };
  }

  async createSession(data: {
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<SessionRecord> {
    return prisma.session.create({ data });
  }

  async findSessionByHash(refreshTokenHash: string): Promise<SessionRecord | null> {
    return prisma.session.findUnique({
      where: { refreshTokenHash },
      include: { user: true },
    });
  }

  async updateSessionHash(
    sessionId: string,
    newHash: string,
    newExpiresAt: Date,
  ): Promise<SessionRecord> {
    return prisma.session.update({
      where: { id: sessionId },
      data: {
        refreshTokenHash: newHash,
        expiresAt: newExpiresAt,
      },
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    await prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async listActiveSessions(userId: string): Promise<SessionRecord[]> {
    return prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createDocument(data: {
    id?: string;
    workspaceId: string;
    uploadedById: string;
    originalName: string;
    mimeType: string;
    extension: string;
    sizeBytes: bigint;
    checksum: string;
    storageKey: string;
    status?: DocumentStatus;
    metadata?: Record<string, unknown>;
  }): Promise<DocumentRecord> {
    const doc = await prisma.document.create({
      data: {
        id: data.id,
        workspaceId: data.workspaceId,
        uploadedById: data.uploadedById,
        originalName: data.originalName,
        mimeType: data.mimeType,
        extension: data.extension,
        sizeBytes: data.sizeBytes,
        checksum: data.checksum,
        storageKey: data.storageKey,
        status: data.status || 'UPLOADED',
        metadata: (data.metadata as any) || {},
      },
    });
    return doc as unknown as DocumentRecord;
  }

  async findDocumentById(id: string): Promise<DocumentRecord | null> {
    const doc = await prisma.document.findUnique({
      where: { id },
      include: {
        uploadedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });
    return (doc as unknown as DocumentRecord) || null;
  }

  async findDocumentByChecksum(
    workspaceId: string,
    checksum: string,
  ): Promise<DocumentRecord | null> {
    const doc = await prisma.document.findFirst({
      where: {
        workspaceId,
        checksum,
        status: { not: 'FAILED' },
      },
      include: {
        uploadedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });
    return (doc as unknown as DocumentRecord) || null;
  }

  async listDocuments(
    workspaceId: string,
    options?: {
      status?: DocumentStatus;
      search?: string;
      skip?: number;
      take?: number;
    },
  ): Promise<{ items: DocumentRecord[]; total: number }> {
    const where: any = { workspaceId };
    if (options?.status) {
      where.status = options.status;
    }
    if (options?.search) {
      where.originalName = { contains: options.search, mode: 'insensitive' };
    }

    const [total, items] = await Promise.all([
      prisma.document.count({ where }),
      prisma.document.findMany({
        where,
        skip: options?.skip || 0,
        take: options?.take || 20,
        orderBy: { createdAt: 'desc' },
        include: {
          uploadedBy: {
            select: { id: true, name: true, email: true },
          },
        },
      }),
    ]);

    return {
      items: items as unknown as DocumentRecord[],
      total,
    };
  }

  async updateDocument(
    id: string,
    data: {
      status?: DocumentStatus;
      errorMessage?: string | null;
      pageCount?: number | null;
      chunkCount?: number;
      embeddingModel?: string | null;
      embeddingDimension?: number | null;
      processedAt?: Date | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<DocumentRecord> {
    const doc = await prisma.document.update({
      where: { id },
      data: {
        ...data,
        metadata: data.metadata ? (data.metadata as any) : undefined,
      },
    });
    return doc as unknown as DocumentRecord;
  }

  async deleteDocument(id: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.documentChunk.deleteMany({ where: { documentId: id } });
      await tx.document.delete({ where: { id } });
    });
  }

  async createDocumentChunks(
    chunks: Array<{
      id?: string;
      documentId: string;
      workspaceId: string;
      chunkIndex: number;
      content: string;
      tokenCount: number;
      pageStart?: number | null;
      pageEnd?: number | null;
      metadata?: Record<string, unknown>;
      embedding?: number[];
    }>,
  ): Promise<void> {
    if (chunks.length === 0) return;
    const documentId = chunks[0].documentId;

    await prisma.$transaction(async (tx) => {
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
              metadata: (chunk.metadata as any) || {},
            },
          });
        }
      }
    });
  }

  async getDocumentChunks(documentId: string): Promise<DocumentChunkRecord[]> {
    const chunks = await prisma.documentChunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: 'asc' },
    });
    return chunks as unknown as DocumentChunkRecord[];
  }

  async deleteDocumentChunks(documentId: string): Promise<void> {
    await prisma.documentChunk.deleteMany({ where: { documentId } });
  }

  async searchVectorChunks(
    workspaceId: string,
    queryVector: number[],
    options?: {
      topK?: number;
      documentIds?: string[];
      fileTypes?: string[];
      pageStart?: number;
      pageEnd?: number;
    },
  ): Promise<SearchChunkResult[]> {
    const topK = Math.min(Math.max(options?.topK || 10, 1), 50);
    const vectorStr = `[${queryVector.join(',')}]`;

    let conditions = `c."workspaceId" = $1 AND d."workspaceId" = $1 AND d."status" = 'COMPLETED' AND c."embedding" IS NOT NULL`;
    const params: any[] = [workspaceId, vectorStr, topK];
    let paramIndex = 4;

    if (options?.documentIds && options.documentIds.length > 0) {
      conditions += ` AND c."documentId" = ANY($${paramIndex}::text[])`;
      params.push(options.documentIds);
      paramIndex++;
    }

    if (options?.fileTypes && options.fileTypes.length > 0) {
      conditions += ` AND LOWER(d."extension") = ANY($${paramIndex}::text[])`;
      params.push(options.fileTypes.map((ft) => ft.toLowerCase().replace(/^\./, '')));
      paramIndex++;
    }

    if (options?.pageStart !== undefined && options?.pageStart !== null) {
      conditions += ` AND (c."pageEnd" IS NULL OR c."pageEnd" >= $${paramIndex})`;
      params.push(options.pageStart);
      paramIndex++;
    }

    if (options?.pageEnd !== undefined && options?.pageEnd !== null) {
      conditions += ` AND (c."pageStart" IS NULL OR c."pageStart" <= $${paramIndex})`;
      params.push(options.pageEnd);
      paramIndex++;
    }

    const query = `
      SELECT 
        c."id", c."documentId", c."workspaceId", c."chunkIndex", c."content", c."tokenCount",
        c."pageStart", c."pageEnd", c."metadata", c."createdAt",
        d."originalName" AS "docOriginalName", d."extension" AS "docExtension",
        d."status" AS "docStatus", d."pageCount" AS "docPageCount",
        (1 - (c."embedding" <=> $2::vector)) AS "similarity",
        (c."embedding" <=> $2::vector) AS "distance"
      FROM "document_chunks" c
      JOIN "documents" d ON c."documentId" = d."id"
      WHERE ${conditions}
      ORDER BY c."embedding" <=> $2::vector ASC
      LIMIT $3
    `;

    const rows = (await prisma.$queryRawUnsafe(query, ...params)) as any[];

    return rows.map((row) => ({
      chunk: {
        id: row.id,
        documentId: row.documentId,
        workspaceId: row.workspaceId,
        chunkIndex: row.chunkIndex,
        content: row.content,
        tokenCount: row.tokenCount,
        pageStart: row.pageStart,
        pageEnd: row.pageEnd,
        metadata: row.metadata,
        createdAt: row.createdAt,
      },
      document: {
        id: row.documentId,
        originalName: row.docOriginalName,
        extension: row.docExtension,
        status: row.docStatus,
        pageCount: row.docPageCount,
      },
      score: Math.max(0, Math.min(1, Number(row.similarity) || 0)),
      distance: Number(row.distance) || 0,
    }));
  }

  async searchKeywordChunks(
    workspaceId: string,
    queryText: string,
    options?: {
      topK?: number;
      documentIds?: string[];
      fileTypes?: string[];
      pageStart?: number;
      pageEnd?: number;
    },
  ): Promise<SearchChunkResult[]> {
    const topK = Math.min(Math.max(options?.topK || 10, 1), 50);

    let conditions = `c."workspaceId" = $1 AND d."workspaceId" = $1 AND d."status" = 'COMPLETED'`;
    const params: any[] = [workspaceId, queryText, topK];
    let paramIndex = 4;

    if (options?.documentIds && options.documentIds.length > 0) {
      conditions += ` AND c."documentId" = ANY($${paramIndex}::text[])`;
      params.push(options.documentIds);
      paramIndex++;
    }

    if (options?.fileTypes && options.fileTypes.length > 0) {
      conditions += ` AND LOWER(d."extension") = ANY($${paramIndex}::text[])`;
      params.push(options.fileTypes.map((ft) => ft.toLowerCase().replace(/^\./, '')));
      paramIndex++;
    }

    if (options?.pageStart !== undefined && options?.pageStart !== null) {
      conditions += ` AND (c."pageEnd" IS NULL OR c."pageEnd" >= $${paramIndex})`;
      params.push(options.pageStart);
      paramIndex++;
    }

    if (options?.pageEnd !== undefined && options?.pageEnd !== null) {
      conditions += ` AND (c."pageStart" IS NULL OR c."pageStart" <= $${paramIndex})`;
      params.push(options.pageEnd);
      paramIndex++;
    }

    const query = `
      SELECT 
        c."id", c."documentId", c."workspaceId", c."chunkIndex", c."content", c."tokenCount",
        c."pageStart", c."pageEnd", c."metadata", c."createdAt",
        d."originalName" AS "docOriginalName", d."extension" AS "docExtension",
        d."status" AS "docStatus", d."pageCount" AS "docPageCount",
        ts_rank_cd(c."search_vector", websearch_to_tsquery('english', $2)) AS "rankScore"
      FROM "document_chunks" c
      JOIN "documents" d ON c."documentId" = d."id"
      WHERE ${conditions}
        AND (
          c."search_vector" @@ websearch_to_tsquery('english', $2)
          OR c."search_vector" @@ plainto_tsquery('english', $2)
        )
      ORDER BY "rankScore" DESC
      LIMIT $3
    `;

    try {
      const rows = (await prisma.$queryRawUnsafe(query, ...params)) as any[];
      return rows.map((row) => ({
        chunk: {
          id: row.id,
          documentId: row.documentId,
          workspaceId: row.workspaceId,
          chunkIndex: row.chunkIndex,
          content: row.content,
          tokenCount: row.tokenCount,
          pageStart: row.pageStart,
          pageEnd: row.pageEnd,
          metadata: row.metadata,
          createdAt: row.createdAt,
        },
        document: {
          id: row.documentId,
          originalName: row.docOriginalName,
          extension: row.docExtension,
          status: row.docStatus,
          pageCount: row.docPageCount,
        },
        score: Number(row.rankScore) || 0,
      }));
    } catch {
      return [];
    }
  }

  // Conversation operations (Phase 5)
  async createChatSession(data: {
    id?: string;
    workspaceId: string;
    userId: string;
    title?: string;
  }): Promise<ChatSessionRecord> {
    return prisma.chatSession.create({
      data: {
        id: data.id,
        workspaceId: data.workspaceId,
        userId: data.userId,
        title: data.title || 'New Conversation',
      },
    }) as unknown as Promise<ChatSessionRecord>;
  }

  async findChatSessionById(id: string, workspaceId: string): Promise<ChatSessionRecord | null> {
    return prisma.chatSession.findFirst({
      where: { id, workspaceId },
    }) as unknown as Promise<ChatSessionRecord | null>;
  }

  async listChatSessions(params: {
    workspaceId: string;
    userId: string;
    limit?: number;
    cursor?: string;
    search?: string;
    status?: ChatSessionStatus;
  }): Promise<ChatSessionRecord[]> {
    const where: any = {
      workspaceId: params.workspaceId,
      userId: params.userId,
      ...(params.status ? { status: params.status } : {}),
      ...(params.search ? { title: { contains: params.search, mode: 'insensitive' } } : {}),
    };

    return prisma.chatSession.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      take: params.limit || 20,
      ...(params.cursor ? { skip: 1, cursor: { id: params.cursor } } : {}),
    }) as unknown as Promise<ChatSessionRecord[]>;
  }

  async updateChatSession(
    id: string,
    workspaceId: string,
    data: {
      title?: string;
      status?: ChatSessionStatus;
      summary?: string | null;
      summaryVersion?: number;
      summarizedThroughSeq?: number;
      summaryUpdatedAt?: Date | null;
      messageCount?: number;
      lastMessageAt?: Date;
      archivedAt?: Date | null;
    },
  ): Promise<ChatSessionRecord> {
    return prisma.chatSession.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    }) as unknown as Promise<ChatSessionRecord>;
  }

  async deleteChatSession(id: string, workspaceId: string): Promise<void> {
    await prisma.chatSession.deleteMany({
      where: { id, workspaceId },
    });
  }

  async createChatMessage(data: {
    id?: string;
    sessionId: string;
    workspaceId: string;
    role: ChatMessageRole;
    content: string;
    status?: ChatMessageStatus;
    sequenceNumber?: number;
    citations?: any;
    metadata?: any;
    tokenEstimate?: number;
  }): Promise<ChatMessageRecord> {
    const seq =
      data.sequenceNumber !== undefined
        ? data.sequenceNumber
        : await this.getNextMessageSequence(data.sessionId);
    const msg = await prisma.chatMessage.create({
      data: {
        id: data.id,
        sessionId: data.sessionId,
        workspaceId: data.workspaceId,
        role: data.role,
        content: data.content,
        status: data.status || 'PENDING',
        sequenceNumber: seq,
        citations: data.citations || [],
        metadata: data.metadata || {},
        tokenEstimate: data.tokenEstimate || 0,
      },
    });

    await prisma.chatSession
      .update({
        where: { id: data.sessionId },
        data: {
          messageCount: { increment: 1 },
          lastMessageAt: msg.createdAt,
        },
      })
      .catch(() => {});

    return msg as unknown as ChatMessageRecord;
  }

  async findChatMessageById(id: string, sessionId: string): Promise<ChatMessageRecord | null> {
    return prisma.chatMessage.findFirst({
      where: { id, sessionId },
    }) as unknown as Promise<ChatMessageRecord | null>;
  }

  async updateChatMessage(
    id: string,
    sessionId: string,
    data: {
      content?: string;
      status?: ChatMessageStatus;
      citations?: any;
      metadata?: any;
      tokenEstimate?: number;
      completedAt?: Date | null;
    },
  ): Promise<ChatMessageRecord> {
    return prisma.chatMessage.update({
      where: { id },
      data,
    }) as unknown as Promise<ChatMessageRecord>;
  }

  async listChatMessages(
    sessionId: string,
    workspaceId: string,
    params?: {
      limit?: number;
      beforeSequence?: number;
      afterSequence?: number;
    },
  ): Promise<ChatMessageRecord[]> {
    const where: any = { sessionId, workspaceId };
    if (params?.beforeSequence !== undefined) {
      where.sequenceNumber = { lt: params.beforeSequence };
    } else if (params?.afterSequence !== undefined) {
      where.sequenceNumber = { gt: params.afterSequence };
    }

    return prisma.chatMessage.findMany({
      where,
      orderBy: { sequenceNumber: 'asc' },
      take: params?.limit || 50,
    }) as unknown as Promise<ChatMessageRecord[]>;
  }

  async getNextMessageSequence(sessionId: string): Promise<number> {
    const last = await prisma.chatMessage.findFirst({
      where: { sessionId },
      orderBy: { sequenceNumber: 'desc' },
      select: { sequenceNumber: true },
    });
    return (last?.sequenceNumber ?? 0) + 1;
  }

  async getRecentMessagesForContext(
    sessionId: string,
    workspaceId: string,
    limit: number = 10,
  ): Promise<ChatMessageRecord[]> {
    const messages = await prisma.chatMessage.findMany({
      where: {
        sessionId,
        workspaceId,
        status: 'COMPLETED',
      },
      orderBy: { sequenceNumber: 'desc' },
      take: limit,
    });
    return (messages as unknown as ChatMessageRecord[]).reverse();
  }
}

// ---------------------------------------------------------------------------
// In-Memory Implementation (For zero-dependency automated testing & verification)
// ---------------------------------------------------------------------------
export class InMemoryDatabaseService implements IDatabaseService {
  public users: Map<string, UserRecord> = new Map();
  public workspaces: Map<string, WorkspaceRecord> = new Map();
  public members: Map<string, WorkspaceMemberRecord> = new Map();
  public sessions: Map<string, SessionRecord> = new Map();
  public documents: Map<string, DocumentRecord> = new Map();
  public chunks: Map<string, DocumentChunkRecord> = new Map();
  public chatSessions: Map<string, ChatSessionRecord> = new Map();
  public chatMessages: Map<string, ChatMessageRecord> = new Map();

  async createUser(data: {
    name: string;
    email: string;
    passwordHash: string;
  }): Promise<UserRecord> {
    const existing = await this.findUserByEmail(data.email);
    if (existing) {
      throw new Error('User already exists');
    }
    const user: UserRecord = {
      id: `usr_${Math.random().toString(36).slice(2, 11)}`,
      name: data.name,
      email: data.email,
      passwordHash: data.passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    for (const user of this.users.values()) {
      if (user.email.toLowerCase() === email.toLowerCase()) {
        return user;
      }
    }
    return null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) || null;
  }

  async createWorkspace(data: {
    name: string;
    slug: string;
    ownerId: string;
  }): Promise<{ workspace: WorkspaceRecord; member: WorkspaceMemberRecord }> {
    const existingSlug = await this.findWorkspaceBySlug(data.slug);
    if (existingSlug) {
      throw new Error('Workspace slug already taken');
    }

    const workspace: WorkspaceRecord = {
      id: `ws_${Math.random().toString(36).slice(2, 11)}`,
      name: data.name,
      slug: data.slug,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.workspaces.set(workspace.id, workspace);

    const user = this.users.get(data.ownerId);
    const member: WorkspaceMemberRecord = {
      id: `mem_${Math.random().toString(36).slice(2, 11)}`,
      userId: data.ownerId,
      workspaceId: workspace.id,
      role: 'OWNER',
      joinedAt: new Date(),
      user: user ? { id: user.id, name: user.name, email: user.email } : undefined,
    };
    this.members.set(`${data.ownerId}_${workspace.id}`, member);

    return { workspace, member };
  }

  async addWorkspaceMember(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole = 'MEMBER',
  ): Promise<WorkspaceMemberRecord> {
    const member: WorkspaceMemberRecord = {
      id: `mem_${Math.random().toString(36).slice(2, 11)}`,
      userId,
      workspaceId,
      role,
      joinedAt: new Date(),
    };
    this.members.set(`${userId}_${workspaceId}`, member);
    return member;
  }

  async findWorkspaceById(id: string): Promise<WorkspaceRecord | null> {
    return this.workspaces.get(id) || null;
  }

  async findWorkspaceBySlug(slug: string): Promise<WorkspaceRecord | null> {
    for (const ws of this.workspaces.values()) {
      if (ws.slug === slug) return ws;
    }
    return null;
  }

  async findUserWorkspaces(
    userId: string,
  ): Promise<Array<WorkspaceRecord & { role: WorkspaceRole }>> {
    const result: Array<WorkspaceRecord & { role: WorkspaceRole }> = [];
    for (const member of this.members.values()) {
      if (member.userId === userId) {
        const ws = this.workspaces.get(member.workspaceId);
        if (ws) {
          result.push({ ...ws, role: member.role });
        }
      }
    }
    return result;
  }

  async findWorkspaceWithMembers(
    workspaceId: string,
  ): Promise<(WorkspaceRecord & { members: WorkspaceMemberRecord[] }) | null> {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) return null;

    const members: WorkspaceMemberRecord[] = [];
    for (const member of this.members.values()) {
      if (member.workspaceId === workspaceId) {
        const u = this.users.get(member.userId);
        members.push({
          ...member,
          user: u ? { id: u.id, name: u.name, email: u.email } : undefined,
        });
      }
    }

    return { ...ws, members };
  }

  async updateWorkspace(
    workspaceId: string,
    data: { name?: string; slug?: string },
  ): Promise<WorkspaceRecord> {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) throw new Error('Workspace not found');

    if (data.slug && data.slug !== ws.slug) {
      const existing = await this.findWorkspaceBySlug(data.slug);
      if (existing) throw new Error('Workspace slug already taken');
    }

    const updated: WorkspaceRecord = {
      ...ws,
      name: data.name ?? ws.name,
      slug: data.slug ?? ws.slug,
      updatedAt: new Date(),
    };
    this.workspaces.set(workspaceId, updated);
    return updated;
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    this.workspaces.delete(workspaceId);
    for (const [key, member] of this.members.entries()) {
      if (member.workspaceId === workspaceId) {
        this.members.delete(key);
      }
    }
  }

  async getWorkspaceMember(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMemberRecord | null> {
    const member = this.members.get(`${userId}_${workspaceId}`);
    if (!member) return null;

    const u = this.users.get(userId);
    return {
      ...member,
      user: u ? { id: u.id, name: u.name, email: u.email } : undefined,
    };
  }

  async createSession(data: {
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<SessionRecord> {
    const session: SessionRecord = {
      id: `ses_${Math.random().toString(36).slice(2, 11)}`,
      userId: data.userId,
      refreshTokenHash: data.refreshTokenHash,
      expiresAt: data.expiresAt,
      revokedAt: null,
      createdAt: new Date(),
      user: this.users.get(data.userId),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async findSessionByHash(refreshTokenHash: string): Promise<SessionRecord | null> {
    for (const session of this.sessions.values()) {
      if (session.refreshTokenHash === refreshTokenHash) {
        return {
          ...session,
          user: this.users.get(session.userId),
        };
      }
    }
    return null;
  }

  async updateSessionHash(
    sessionId: string,
    newHash: string,
    newExpiresAt: Date,
  ): Promise<SessionRecord> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error('Session not found');
    const updated: SessionRecord = {
      ...s,
      refreshTokenHash: newHash,
      expiresAt: newExpiresAt,
    };
    this.sessions.set(sessionId, updated);
    return updated;
  }

  async revokeSession(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (s) {
      this.sessions.set(sessionId, { ...s, revokedAt: new Date() });
    }
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    for (const [id, s] of this.sessions.entries()) {
      if (s.userId === userId && !s.revokedAt) {
        this.sessions.set(id, { ...s, revokedAt: new Date() });
      }
    }
  }

  async listActiveSessions(userId: string): Promise<SessionRecord[]> {
    const now = new Date();
    const result: SessionRecord[] = [];
    for (const s of this.sessions.values()) {
      if (s.userId === userId && !s.revokedAt && s.expiresAt > now) {
        result.push(s);
      }
    }
    return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async createDocument(data: {
    id?: string;
    workspaceId: string;
    uploadedById: string;
    originalName: string;
    mimeType: string;
    extension: string;
    sizeBytes: bigint;
    checksum: string;
    storageKey: string;
    status?: DocumentStatus;
    metadata?: Record<string, unknown>;
  }): Promise<DocumentRecord> {
    const doc: DocumentRecord = {
      id: data.id || `doc_${Math.random().toString(36).slice(2, 11)}`,
      workspaceId: data.workspaceId,
      uploadedById: data.uploadedById,
      originalName: data.originalName,
      mimeType: data.mimeType,
      extension: data.extension,
      sizeBytes: data.sizeBytes,
      checksum: data.checksum,
      storageKey: data.storageKey,
      status: data.status || 'UPLOADED',
      errorMessage: null,
      pageCount: null,
      chunkCount: 0,
      embeddingModel: null,
      embeddingDimension: null,
      metadata: data.metadata || {},
      createdAt: new Date(),
      updatedAt: new Date(),
      processedAt: null,
    };
    this.documents.set(doc.id, doc);
    return doc;
  }

  async findDocumentById(id: string): Promise<DocumentRecord | null> {
    const doc = this.documents.get(id);
    if (!doc) return null;
    const user = this.users.get(doc.uploadedById);
    return {
      ...doc,
      uploadedBy: user ? { id: user.id, name: user.name, email: user.email } : undefined,
    };
  }

  async findDocumentByChecksum(
    workspaceId: string,
    checksum: string,
  ): Promise<DocumentRecord | null> {
    for (const doc of this.documents.values()) {
      if (doc.workspaceId === workspaceId && doc.checksum === checksum && doc.status !== 'FAILED') {
        return doc;
      }
    }
    return null;
  }

  async listDocuments(
    workspaceId: string,
    options?: {
      status?: DocumentStatus;
      search?: string;
      skip?: number;
      take?: number;
    },
  ): Promise<{ items: DocumentRecord[]; total: number }> {
    let docs = Array.from(this.documents.values()).filter(
      (d) => d.workspaceId === workspaceId && d.status !== 'DELETING',
    );
    if (options?.status) {
      docs = docs.filter((d) => d.status === options.status);
    }
    if (options?.search) {
      const q = options.search.toLowerCase();
      docs = docs.filter((d) => d.originalName.toLowerCase().includes(q));
    }
    docs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = docs.length;
    const skip = options?.skip || 0;
    const take = options?.take || 20;
    const items = docs.slice(skip, skip + take).map((doc) => {
      const user = this.users.get(doc.uploadedById);
      return {
        ...doc,
        uploadedBy: user ? { id: user.id, name: user.name, email: user.email } : undefined,
      };
    });
    return { items, total };
  }

  async updateDocument(
    id: string,
    data: {
      status?: DocumentStatus;
      errorMessage?: string | null;
      pageCount?: number | null;
      chunkCount?: number;
      embeddingModel?: string | null;
      embeddingDimension?: number | null;
      processedAt?: Date | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<DocumentRecord> {
    const doc = this.documents.get(id);
    if (!doc) throw new Error('Document not found');
    const updated: DocumentRecord = {
      ...doc,
      ...data,
      metadata: data.metadata ? { ...doc.metadata, ...data.metadata } : doc.metadata,
      updatedAt: new Date(),
    };
    this.documents.set(id, updated);
    return updated;
  }

  async deleteDocument(id: string): Promise<void> {
    this.documents.delete(id);
    for (const [chkId, chk] of this.chunks.entries()) {
      if (chk.documentId === id) {
        this.chunks.delete(chkId);
      }
    }
  }

  async createDocumentChunks(
    chunks: Array<{
      id?: string;
      documentId: string;
      workspaceId: string;
      chunkIndex: number;
      content: string;
      tokenCount: number;
      pageStart?: number | null;
      pageEnd?: number | null;
      metadata?: Record<string, unknown>;
      embedding?: number[];
    }>,
  ): Promise<void> {
    if (chunks.length === 0) return;
    const documentId = chunks[0].documentId;
    // Clear existing chunks for idempotency
    for (const [chkId, chk] of this.chunks.entries()) {
      if (chk.documentId === documentId) {
        this.chunks.delete(chkId);
      }
    }
    for (const chunk of chunks) {
      const chkId = chunk.id || `chk_${Math.random().toString(36).slice(2, 11)}`;
      const record: DocumentChunkRecord = {
        id: chkId,
        documentId: chunk.documentId,
        workspaceId: chunk.workspaceId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        pageStart: chunk.pageStart || null,
        pageEnd: chunk.pageEnd || null,
        metadata: chunk.metadata || {},
        embedding: chunk.embedding || null,
        createdAt: new Date(),
      };
      this.chunks.set(chkId, record);
    }
  }

  async getDocumentChunks(documentId: string): Promise<DocumentChunkRecord[]> {
    const result: DocumentChunkRecord[] = [];
    for (const chk of this.chunks.values()) {
      if (chk.documentId === documentId) {
        result.push(chk);
      }
    }
    return result.sort((a, b) => a.chunkIndex - b.chunkIndex);
  }

  async deleteDocumentChunks(documentId: string): Promise<void> {
    for (const [chkId, chk] of this.chunks.entries()) {
      if (chk.documentId === documentId) {
        this.chunks.delete(chkId);
      }
    }
  }

  async searchVectorChunks(
    workspaceId: string,
    queryVector: number[],
    options?: {
      topK?: number;
      documentIds?: string[];
      fileTypes?: string[];
      pageStart?: number;
      pageEnd?: number;
    },
  ): Promise<SearchChunkResult[]> {
    const topK = Math.min(Math.max(options?.topK || 10, 1), 50);
    const results: SearchChunkResult[] = [];

    const normQuery = Math.sqrt(queryVector.reduce((sum, v) => sum + v * v, 0));

    for (const chunk of this.chunks.values()) {
      if (chunk.workspaceId !== workspaceId) continue;
      const doc = this.documents.get(chunk.documentId);
      if (!doc || doc.workspaceId !== workspaceId || doc.status !== 'COMPLETED') continue;

      if (options?.documentIds && options.documentIds.length > 0) {
        if (!options.documentIds.includes(chunk.documentId)) continue;
      }

      if (options?.fileTypes && options.fileTypes.length > 0) {
        const normalizedTypes = options.fileTypes.map((t) => t.toLowerCase().replace(/^\./, ''));
        if (!normalizedTypes.includes(doc.extension.toLowerCase())) continue;
      }

      if (options?.pageStart !== undefined && options?.pageStart !== null) {
        if (chunk.pageEnd !== null && chunk.pageEnd < options.pageStart) continue;
      }

      if (options?.pageEnd !== undefined && options?.pageEnd !== null) {
        if (chunk.pageStart !== null && chunk.pageStart > options.pageEnd) continue;
      }

      if (!chunk.embedding || chunk.embedding.length === 0) continue;

      // Cosine similarity
      let dotProduct = 0;
      let normChunk = 0;
      for (let i = 0; i < queryVector.length; i++) {
        const v = chunk.embedding[i] || 0;
        dotProduct += v * queryVector[i];
        normChunk += v * v;
      }
      normChunk = Math.sqrt(normChunk);
      const similarity = normQuery > 0 && normChunk > 0 ? dotProduct / (normQuery * normChunk) : 0;
      const clampedSim = Math.max(0, Math.min(1, similarity));

      results.push({
        chunk,
        document: {
          id: doc.id,
          originalName: doc.originalName,
          extension: doc.extension,
          status: doc.status,
          pageCount: doc.pageCount,
        },
        score: clampedSim,
        distance: 1 - clampedSim,
      });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  async searchKeywordChunks(
    workspaceId: string,
    queryText: string,
    options?: {
      topK?: number;
      documentIds?: string[];
      fileTypes?: string[];
      pageStart?: number;
      pageEnd?: number;
    },
  ): Promise<SearchChunkResult[]> {
    const topK = Math.min(Math.max(options?.topK || 10, 1), 50);
    const results: SearchChunkResult[] = [];
    const normQuery = queryText.toLowerCase().trim();
    if (!normQuery) return [];

    const queryTerms = normQuery
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9]/gi, ''))
      .filter((t) => t.length > 0);

    for (const chunk of this.chunks.values()) {
      if (chunk.workspaceId !== workspaceId) continue;
      const doc = this.documents.get(chunk.documentId);
      if (!doc || doc.workspaceId !== workspaceId || doc.status !== 'COMPLETED') continue;

      if (options?.documentIds && options.documentIds.length > 0) {
        if (!options.documentIds.includes(chunk.documentId)) continue;
      }

      if (options?.fileTypes && options.fileTypes.length > 0) {
        const normalizedTypes = options.fileTypes.map((t) => t.toLowerCase().replace(/^\./, ''));
        if (!normalizedTypes.includes(doc.extension.toLowerCase())) continue;
      }

      if (options?.pageStart !== undefined && options?.pageStart !== null) {
        if (chunk.pageEnd !== null && chunk.pageEnd < options.pageStart) continue;
      }

      if (options?.pageEnd !== undefined && options?.pageEnd !== null) {
        if (chunk.pageStart !== null && chunk.pageStart > options.pageEnd) continue;
      }

      const lowerContent = chunk.content.toLowerCase();
      let matchScore = 0;
      let matchedTerms = 0;

      // Exact phrase match bonus
      if (lowerContent.includes(normQuery)) {
        matchScore += 2.0;
      }

      for (const term of queryTerms) {
        const termRegex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        const matches = lowerContent.match(termRegex);
        if (matches && matches.length > 0) {
          matchedTerms++;
          matchScore += Math.log(1 + matches.length);
        } else if (lowerContent.includes(term)) {
          matchedTerms += 0.5;
          matchScore += 0.3;
        }
      }

      if (matchedTerms > 0 || matchScore > 0) {
        results.push({
          chunk,
          document: {
            id: doc.id,
            originalName: doc.originalName,
            extension: doc.extension,
            status: doc.status,
            pageCount: doc.pageCount,
          },
          score: matchScore,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  // Conversation operations (Phase 5)
  async createChatSession(data: {
    id?: string;
    workspaceId: string;
    userId: string;
    title?: string;
  }): Promise<ChatSessionRecord> {
    const session: ChatSessionRecord = {
      id: data.id || `session_${Math.random().toString(36).slice(2, 11)}`,
      workspaceId: data.workspaceId,
      userId: data.userId,
      title: data.title || 'New Conversation',
      status: 'ACTIVE',
      summary: null,
      summaryVersion: 0,
      summarizedThroughSeq: 0,
      summaryUpdatedAt: null,
      messageCount: 0,
      lastMessageAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    };
    this.chatSessions.set(session.id, session);
    return session;
  }

  async findChatSessionById(id: string, workspaceId: string): Promise<ChatSessionRecord | null> {
    const session = this.chatSessions.get(id);
    if (!session || session.workspaceId !== workspaceId) return null;
    return session;
  }

  async listChatSessions(params: {
    workspaceId: string;
    userId: string;
    limit?: number;
    cursor?: string;
    search?: string;
    status?: ChatSessionStatus;
  }): Promise<ChatSessionRecord[]> {
    let sessions = Array.from(this.chatSessions.values()).filter((s) => {
      if (s.workspaceId !== params.workspaceId || s.userId !== params.userId) return false;
      if (params.status && s.status !== params.status) return false;
      if (params.search && !s.title.toLowerCase().includes(params.search.toLowerCase()))
        return false;
      return true;
    });

    sessions.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());

    if (params.cursor) {
      const idx = sessions.findIndex((s) => s.id === params.cursor);
      if (idx !== -1) {
        sessions = sessions.slice(idx + 1);
      }
    }

    return sessions.slice(0, params.limit || 20);
  }

  async updateChatSession(
    id: string,
    workspaceId: string,
    data: {
      title?: string;
      status?: ChatSessionStatus;
      summary?: string | null;
      summaryVersion?: number;
      summarizedThroughSeq?: number;
      summaryUpdatedAt?: Date | null;
      messageCount?: number;
      lastMessageAt?: Date;
      archivedAt?: Date | null;
    },
  ): Promise<ChatSessionRecord> {
    const session = await this.findChatSessionById(id, workspaceId);
    if (!session) throw new Error('Chat session not found');

    const updated: ChatSessionRecord = {
      ...session,
      ...data,
      updatedAt: new Date(),
    };
    this.chatSessions.set(id, updated);
    return updated;
  }

  async deleteChatSession(id: string, workspaceId: string): Promise<void> {
    const session = await this.findChatSessionById(id, workspaceId);
    if (!session) return;

    this.chatSessions.delete(id);
    for (const [msgId, msg] of this.chatMessages.entries()) {
      if (msg.sessionId === id) {
        this.chatMessages.delete(msgId);
      }
    }
  }

  async createChatMessage(data: {
    id?: string;
    sessionId: string;
    workspaceId: string;
    role: ChatMessageRole;
    content: string;
    status?: ChatMessageStatus;
    sequenceNumber?: number;
    citations?: any;
    metadata?: any;
    tokenEstimate?: number;
  }): Promise<ChatMessageRecord> {
    const seq =
      data.sequenceNumber !== undefined
        ? data.sequenceNumber
        : await this.getNextMessageSequence(data.sessionId);

    const message: ChatMessageRecord = {
      id: data.id || `msg_${Math.random().toString(36).slice(2, 11)}`,
      sessionId: data.sessionId,
      workspaceId: data.workspaceId,
      role: data.role,
      content: data.content,
      status: data.status || 'PENDING',
      sequenceNumber: seq,
      citations: data.citations || [],
      metadata: data.metadata || {},
      tokenEstimate: data.tokenEstimate || 0,
      createdAt: new Date(),
      completedAt: null,
    };
    this.chatMessages.set(message.id, message);

    const session = this.chatSessions.get(data.sessionId);
    if (session) {
      session.messageCount += 1;
      session.lastMessageAt = message.createdAt;
      session.updatedAt = message.createdAt;
    }

    return message;
  }

  async findChatMessageById(id: string, sessionId: string): Promise<ChatMessageRecord | null> {
    const msg = this.chatMessages.get(id);
    if (!msg || msg.sessionId !== sessionId) return null;
    return msg;
  }

  async updateChatMessage(
    id: string,
    sessionId: string,
    data: {
      content?: string;
      status?: ChatMessageStatus;
      citations?: any;
      metadata?: any;
      tokenEstimate?: number;
      completedAt?: Date | null;
    },
  ): Promise<ChatMessageRecord> {
    const msg = await this.findChatMessageById(id, sessionId);
    if (!msg) throw new Error('Chat message not found');

    const updated: ChatMessageRecord = {
      ...msg,
      ...data,
    };
    this.chatMessages.set(id, updated);
    return updated;
  }

  async listChatMessages(
    sessionId: string,
    workspaceId: string,
    params?: {
      limit?: number;
      beforeSequence?: number;
      afterSequence?: number;
    },
  ): Promise<ChatMessageRecord[]> {
    let messages = Array.from(this.chatMessages.values()).filter(
      (m) => m.sessionId === sessionId && m.workspaceId === workspaceId,
    );

    if (params?.beforeSequence !== undefined) {
      messages = messages.filter((m) => m.sequenceNumber < params.beforeSequence!);
    } else if (params?.afterSequence !== undefined) {
      messages = messages.filter((m) => m.sequenceNumber > params.afterSequence!);
    }

    messages.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    return messages.slice(0, params?.limit || 50);
  }

  async getNextMessageSequence(sessionId: string): Promise<number> {
    let maxSeq = 0;
    for (const msg of this.chatMessages.values()) {
      if (msg.sessionId === sessionId && msg.sequenceNumber > maxSeq) {
        maxSeq = msg.sequenceNumber;
      }
    }
    return maxSeq + 1;
  }

  async getRecentMessagesForContext(
    sessionId: string,
    workspaceId: string,
    limit: number = 10,
  ): Promise<ChatMessageRecord[]> {
    const completed = Array.from(this.chatMessages.values())
      .filter(
        (m) =>
          m.sessionId === sessionId && m.workspaceId === workspaceId && m.status === 'COMPLETED',
      )
      .sort((a, b) => b.sequenceNumber - a.sequenceNumber)
      .slice(0, limit);

    return completed.reverse();
  }

  clear(): void {
    this.users.clear();
    this.workspaces.clear();
    this.members.clear();
    this.sessions.clear();
    this.documents.clear();
    this.chunks.clear();
    this.chatSessions.clear();
    this.chatMessages.clear();
  }
}

// Global active database service instance
// Uses Prisma by default, or can be swapped to InMemory for test suites
export let dbService: IDatabaseService = new PrismaDatabaseService();

export function setDatabaseService(service: IDatabaseService): void {
  dbService = service;
}
