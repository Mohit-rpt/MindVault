import { z } from 'zod';

// Service Health Envelopes
export const ServiceStatusSchema = z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']);
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

export const HealthCheckResponseSchema = z.object({
  status: ServiceStatusSchema,
  service: z.string(),
  version: z.string(),
  timestamp: z.string(),
  uptime: z.number(),
  dependencies: z.record(
    z.string(),
    z.object({
      status: ServiceStatusSchema,
      latencyMs: z.number().optional(),
      message: z.string().optional(),
    }),
  ),
});
export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    timestamp: string;
    requestId?: string;
  };
}

// ---------------------------------------------------------------------------
// Phase 1: Authentication & Workspace Schemas & Contracts
// ---------------------------------------------------------------------------

export const WorkspaceRoleEnum = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleEnum>;

// User Types
export interface UserDto {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

// Auth Request Schemas
export const RegisterRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { message: 'Name must be at least 2 characters long' })
    .max(100, { message: 'Name cannot exceed 100 characters' }),
  email: z.string().trim().toLowerCase().email({ message: 'Must be a valid email address' }),
  password: z
    .string()
    .min(8, { message: 'Password must be at least 8 characters long' })
    .max(128, { message: 'Password cannot exceed 128 characters' }),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email({ message: 'Must be a valid email address' }),
  password: z.string().min(1, { message: 'Password is required' }),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

// Auth Response Types
export interface AuthResponseData {
  user: UserDto;
  accessToken: string;
  activeWorkspace?: WorkspaceDto;
}

// Session Types
export interface SessionDto {
  id: string;
  createdAt: string;
  expiresAt: string;
  isCurrent?: boolean;
}

// Workspace Schemas & Types
export const CreateWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { message: 'Workspace name must be at least 2 characters' })
    .max(100, { message: 'Workspace name cannot exceed 100 characters' }),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, {
      message: 'Slug can only contain lowercase alphanumeric characters and hyphens',
    })
    .min(2, { message: 'Slug must be at least 2 characters' })
    .max(100, { message: 'Slug cannot exceed 100 characters' })
    .optional(),
});
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceSchema>;

export const UpdateWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { message: 'Workspace name must be at least 2 characters' })
    .max(100, { message: 'Workspace name cannot exceed 100 characters' })
    .optional(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, {
      message: 'Slug can only contain lowercase alphanumeric characters and hyphens',
    })
    .min(2, { message: 'Slug must be at least 2 characters' })
    .max(100, { message: 'Slug cannot exceed 100 characters' })
    .optional(),
});
export type UpdateWorkspaceRequest = z.infer<typeof UpdateWorkspaceSchema>;

export interface WorkspaceMemberDto {
  id: string;
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  joinedAt: string;
  user?: {
    id: string;
    name: string;
    email: string;
  };
}

export interface WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  role?: WorkspaceRole;
  members?: WorkspaceMemberDto[];
}

// ---------------------------------------------------------------------------
// Phase 2: Document Ingestion & Chunking Schemas & Contracts
// ---------------------------------------------------------------------------

export const DocumentStatusEnum = z.enum([
  'UPLOADED',
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'DELETING',
]);
export type DocumentStatus = z.infer<typeof DocumentStatusEnum>;

export interface DocumentDto {
  id: string;
  workspaceId: string;
  uploadedById: string;
  originalName: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  checksum: string;
  status: DocumentStatus;
  errorMessage?: string | null;
  pageCount?: number | null;
  chunkCount: number;
  embeddingModel?: string | null;
  embeddingDimension?: number | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  processedAt?: string | null;
}

export interface DocumentChunkDto {
  id: string;
  documentId: string;
  workspaceId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageStart?: number | null;
  pageEnd?: number | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface DocumentStatusDto {
  id: string;
  status: DocumentStatus;
  processingStage?: string;
  chunkCount: number;
  pageCount?: number | null;
  errorMessage?: string | null;
  updatedAt: string;
}

export const DocumentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: DocumentStatusEnum.optional(),
  search: z.string().trim().optional(),
});
export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>;

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Ingestion Pipeline Interfaces
export interface DocumentStorageProvider {
  save(storageKey: string, buffer: Buffer): Promise<void>;
  read(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface ExtractionResult {
  extractedText: string;
  pageCount?: number;
  pages?: ExtractedPage[];
  metadata?: Record<string, unknown>;
  warnings?: string[];
}

export interface ChunkingOptions {
  targetTokens?: number;
  maxTokens?: number;
  overlapTokens?: number;
}

export interface ChunkItem {
  chunkIndex: number;
  totalChunks?: number;
  content: string;
  tokenCount: number;
  startChar?: number;
  endChar?: number;
  heading?: string;
  section?: string;
  pageStart?: number | null;
  pageEnd?: number | null;
  metadata?: Record<string, unknown>;
}

export interface EmbeddingProvider {
  readonly modelName: string;
  readonly dimension: number;
  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddings(texts: string[]): Promise<number[][]>;
}

export interface ProcessDocumentJobPayload {
  documentId: string;
  workspaceId: string;
  userId: string;
}
