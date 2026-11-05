import { prisma } from './prisma.js';
import { WorkspaceRole, DocumentStatus } from '@mindvault/shared';

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

  clear(): void {
    this.users.clear();
    this.workspaces.clear();
    this.members.clear();
    this.sessions.clear();
    this.documents.clear();
    this.chunks.clear();
  }
}

// Global active database service instance
// Uses Prisma by default, or can be swapped to InMemory for test suites
export let dbService: IDatabaseService = new PrismaDatabaseService();

export function setDatabaseService(service: IDatabaseService): void {
  dbService = service;
}
