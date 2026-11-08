import { createHash } from 'node:crypto';
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

// ---------------------------------------------------------------------------
// Phase 3: Retrieval Engine, Hybrid Search & Intelligence Schemas & Contracts
// ---------------------------------------------------------------------------

export const RetrievalModeEnum = z.enum(['hybrid', 'semantic', 'keyword']);
export type RetrievalMode = z.infer<typeof RetrievalModeEnum>;

export const RetrievalFiltersSchema = z
  .object({
    documentIds: z.array(z.string().min(1)).optional(),
    fileTypes: z.array(z.string().trim().toLowerCase()).optional(),
    pageStart: z.number().int().min(1).optional(),
    pageEnd: z.number().int().min(1).optional(),
  })
  .refine(
    (data) => {
      if (data.pageStart && data.pageEnd) {
        return data.pageStart <= data.pageEnd;
      }
      return true;
    },
    { message: 'pageStart cannot be greater than pageEnd' },
  );
export type RetrievalFilters = z.infer<typeof RetrievalFiltersSchema>;

export const SearchRequestSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, { message: 'Query cannot be empty' })
    .max(1000, { message: 'Query length cannot exceed 1000 characters' }),
  mode: RetrievalModeEnum.default('hybrid'),
  topK: z.coerce.number().int().min(1).max(50).default(10),
  includeContext: z.boolean().default(true),
  maxContextTokens: z.coerce.number().int().min(100).max(16000).default(3000),
  filters: RetrievalFiltersSchema.optional(),
  enableReranking: z.boolean().default(false),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export interface SearchResultItem {
  chunkId: string;
  documentId: string;
  documentName: string;
  content: string;
  chunkIndex: number;
  rank: number;
  score: number;
  retrievalSources: Array<'semantic' | 'keyword'>;
  citationId: string;
  pageStart: number | null;
  pageEnd: number | null;
  tokenCount: number;
  metadata: Record<string, unknown>;
}

export interface ContextSourceItem {
  citationId: string;
  documentId: string;
  documentName: string;
  chunkId: string;
  chunkIndex: number;
  pageNumber: number | null;
  pageRange: string | null;
  section: string | null;
  content: string;
  rank: number;
  score: number;
  retrievalSources: string[];
}

export interface SearchContextDto {
  content: string;
  tokenEstimate: number;
  sources: ContextSourceItem[];
}

export interface SearchTimingMetadata {
  queryProcessingMs: number;
  embeddingGenerationMs?: number;
  semanticSearchMs?: number;
  keywordSearchMs?: number;
  fusionMs?: number;
  rerankingMs?: number;
  contextAssemblyMs?: number;
  totalMs: number;
}

export interface SearchMetadataDto {
  semanticSearchUsed: boolean;
  keywordSearchUsed: boolean;
  rerankingApplied: boolean;
  totalResults: number;
  query: string;
  normalizedQuery: string;
  timings: SearchTimingMetadata;
}

export interface SearchResponseDto {
  query: string;
  mode: RetrievalMode;
  results: SearchResultItem[];
  context?: SearchContextDto;
  metadata: SearchMetadataDto;
}

// Reranker Contracts
export interface RerankerCandidate {
  chunkId: string;
  content: string;
  score: number;
  initialRank: number;
  metadata?: Record<string, unknown>;
}

export interface RerankerResult {
  chunkId: string;
  score: number;
  rank: number;
}

export interface RerankerProvider {
  readonly providerName: string;
  isAvailable(): Promise<boolean>;
  rerank(
    query: string,
    candidates: RerankerCandidate[],
    limit?: number,
  ): Promise<{ results: RerankerResult[]; applied: boolean }>;
}

// ---------------------------------------------------------------------------
// Phase 4: Generative RAG Engine, Evidence Synthesis & Streaming Schemas
// ---------------------------------------------------------------------------

export const GroundingStatusEnum = z.enum([
  'GROUNDED',
  'PARTIALLY_GROUNDED',
  'INSUFFICIENT_EVIDENCE',
  'CITATION_INVALID',
  'VALIDATION_UNAVAILABLE',
]);
export type GroundingStatus = z.infer<typeof GroundingStatusEnum>;

export interface GroundingValidationResult {
  groundingStatus: GroundingStatus;
  citationIdsValid: boolean;
  unknownCitationIds: string[];
  citationsPresent: boolean;
  referencedCitationIds: string[];
  warnings: string[];
}

export const RAGRetrievalOptionsSchema = z.object({
  mode: RetrievalModeEnum.default('hybrid'),
  topK: z.coerce.number().int().min(1).max(50).default(10),
  filters: RetrievalFiltersSchema.optional(),
  enableReranking: z.boolean().default(false),
  maxContextTokens: z.coerce.number().int().min(100).max(16000).default(3000),
});
export type RAGRetrievalOptions = z.infer<typeof RAGRetrievalOptionsSchema>;

export const RAGGenerationOptionsSchema = z.object({
  temperature: z.coerce.number().min(0).max(2).default(0.2),
  maxOutputTokens: z.coerce.number().int().min(50).max(4096).default(1024),
  model: z.string().optional(),
});
export type RAGGenerationOptions = z.infer<typeof RAGGenerationOptionsSchema>;

export const RAGAnswerRequestSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, { message: 'Query cannot be empty' })
    .max(1000, { message: 'Query cannot exceed 1000 characters' }),
  retrieval: RAGRetrievalOptionsSchema.optional().default({}),
  generation: RAGGenerationOptionsSchema.optional().default({}),
  includeContext: z.boolean().default(false),
});
export type RAGAnswerRequest = z.infer<typeof RAGAnswerRequestSchema>;
export type RAGAnswerRequestInput = z.input<typeof RAGAnswerRequestSchema>;

export interface RAGTimingsDto {
  retrievalMs: number;
  contextAssemblyMs: number;
  promptBuildingMs: number;
  timeToFirstTokenMs?: number;
  generationDurationMs: number;
  validationMs: number;
  totalMs: number;
}

export interface RAGMetadataDto {
  provider: string;
  model: string;
  retrievalMode: RetrievalMode;
  totalSources: number;
  timings: RAGTimingsDto;
}

export interface RAGAnswerResponseDto {
  query: string;
  answer: string;
  sources: ContextSourceItem[];
  grounding: GroundingValidationResult;
  context?: SearchContextDto;
  metadata: RAGMetadataDto;
}

// LLM Provider Interfaces
export interface LLMProviderInfo {
  providerName: string;
  model: string;
  maxContextTokens: number;
}

export interface LLMGenerateOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  systemPrompt?: string;
  stopSequences?: string[];
  image?: {
    mimeType: string;
    data: string;
  };
}

export interface LLMGenerateResult {
  text: string;
  promptTokens?: number;
  outputTokens?: number;
  durationMs: number;
  finishReason?: string;
}

export interface LLMStreamChunk {
  text: string;
  isFinished: boolean;
  finishReason?: string;
}

export interface LLMProvider {
  readonly providerName: string;
  readonly modelName: string;
  generate(prompt: string, options?: LLMGenerateOptions): Promise<LLMGenerateResult>;
  generateStream(prompt: string, options?: LLMGenerateOptions): AsyncIterable<LLMStreamChunk>;
  getModelInfo(): Promise<LLMProviderInfo>;
  healthCheck(): Promise<{ ok: boolean; message?: string }>;
}

// Server-Sent Events (SSE) Stream Protocol
export type RAGStreamEvent =
  | { type: 'start'; requestId: string }
  | {
      type: 'retrieval_complete';
      totalSources: number;
      retrievalMode: RetrievalMode;
      timings: { retrievalMs: number };
    }
  | { type: 'sources'; sources: ContextSourceItem[] }
  | { type: 'token'; text: string }
  | { type: 'validation'; grounding: GroundingValidationResult }
  | {
      type: 'done';
      finishReason: string;
      metadata: { totalMs: number; generationDurationMs: number };
    }
  | { type: 'error'; message: string; code?: string };

// ==========================================
// Phase 5: Conversational RAG & Memory Types
// ==========================================

export const ChatSessionStatusEnum = z.enum(['ACTIVE', 'ARCHIVED']);
export type ChatSessionStatus = z.infer<typeof ChatSessionStatusEnum>;

export const ChatMessageRoleEnum = z.enum(['USER', 'ASSISTANT', 'SYSTEM']);
export type ChatMessageRole = z.infer<typeof ChatMessageRoleEnum>;

export const ChatMessageStatusEnum = z.enum([
  'PENDING',
  'STREAMING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export type ChatMessageStatus = z.infer<typeof ChatMessageStatusEnum>;

export interface ChatSessionDto {
  id: string;
  workspaceId: string;
  userId: string;
  title: string;
  status: ChatSessionStatus;
  summary: string | null;
  summaryVersion: number;
  summarizedThroughSeq: number;
  summaryUpdatedAt: string | null;
  messageCount: number;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ChatMessageDto {
  id: string;
  sessionId: string;
  workspaceId: string;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  sequenceNumber: number;
  citations: ContextSourceItem[];
  metadata: Record<string, unknown>;
  tokenEstimate: number;
  createdAt: string;
  completedAt: string | null;
}

export const CreateConversationRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  initialMessage: z.string().trim().min(1).max(4000).optional(),
});
export type CreateConversationRequest = z.infer<typeof CreateConversationRequestSchema>;

export const UpdateConversationRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  status: ChatSessionStatusEnum.optional(),
});
export type UpdateConversationRequest = z.infer<typeof UpdateConversationRequestSchema>;

export const ListConversationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  search: z.string().trim().optional(),
  status: ChatSessionStatusEnum.optional().default('ACTIVE'),
});
export type ListConversationsQuery = z.infer<typeof ListConversationsQuerySchema>;

export const GetMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  beforeSequence: z.coerce.number().int().optional(),
  afterSequence: z.coerce.number().int().optional(),
});
export type GetMessagesQuery = z.infer<typeof GetMessagesQuerySchema>;

export const SendConversationMessageRequestSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, { message: 'Message content cannot be empty' })
    .max(4000, { message: 'Message content cannot exceed 4000 characters' }),
  provider: z.enum(['ollama', 'gemini']).optional(),
  model: z.string().optional(),
  image: z
    .object({
      mimeType: z.string(),
      data: z.string(),
      name: z.string().optional(),
    })
    .optional(),
  retrieval: RAGRetrievalOptionsSchema.optional().default({}),
  generation: RAGGenerationOptionsSchema.optional().default({}),
});
export type SendConversationMessageRequest = z.infer<typeof SendConversationMessageRequestSchema>;
export type SendConversationMessageRequestInput = z.input<
  typeof SendConversationMessageRequestSchema
>;

export type ConversationStreamEvent =
  | {
      type: 'start';
      sessionId: string;
      userMessageId: string;
      assistantMessageId: string;
      sequenceNumber: number;
    }
  | {
      type: 'user_message';
      message: ChatMessageDto;
    }
  | {
      type: 'retrieval_complete';
      totalSources: number;
      retrievalMode: RetrievalMode;
      contextualQuery?: string;
      timings: { retrievalMs: number; contextualizationMs?: number };
    }
  | { type: 'sources'; sources: ContextSourceItem[] }
  | { type: 'token'; text: string }
  | { type: 'validation'; grounding: GroundingValidationResult }
  | {
      type: 'done';
      message: ChatMessageDto;
      finishReason: string;
      metadata?: Record<string, unknown>;
    }
  | { type: 'error'; message: string; code?: string };

// ---------------------------------------------------------------------------
// Phase 6: Knowledge Graph & Entity-Relation Extraction Schemas & Contracts
// ---------------------------------------------------------------------------

export const EntityTypeEnum = z.enum([
  'CONCEPT',
  'TECHNOLOGY',
  'ORGANIZATION',
  'PERSON',
  'LOCATION',
  'EVENT',
  'METRIC',
  'PRODUCT',
  'CUSTOM',
]);
export type EntityType = z.infer<typeof EntityTypeEnum>;

export const ExtractedEntitySchema = z.object({
  name: z.string().trim().min(1).max(255),
  entityType: EntityTypeEnum.default('CONCEPT'),
  description: z.string().trim().max(1000).optional(),
  aliases: z.array(z.string().trim().min(1).max(255)).default([]),
  confidence: z.number().min(0.0).max(1.0).default(0.85),
  sourceText: z.string().trim().max(1000).optional(),
});
export type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;

export const ExtractedRelationSchema = z.object({
  sourceEntity: z.string().trim().min(1).max(255),
  targetEntity: z.string().trim().min(1).max(255),
  relationType: z.string().trim().min(1).max(64).toUpperCase(),
  description: z.string().trim().max(1000).optional(),
  confidence: z.number().min(0.0).max(1.0).default(0.8),
  evidence: z.string().trim().min(1).max(2000),
});
export type ExtractedRelation = z.infer<typeof ExtractedRelationSchema>;

export const KnowledgeExtractionResponseSchema = z.object({
  version: z.string().default('1.0'),
  entities: z.array(ExtractedEntitySchema).max(50).default([]),
  relations: z.array(ExtractedRelationSchema).max(100).default([]),
});
export type KnowledgeExtractionResponse = z.infer<typeof KnowledgeExtractionResponseSchema>;

export interface GraphExtractionJobPayload {
  documentId: string;
  workspaceId: string;
  extractionRunId?: string;
  chunkManifestHash?: string;
  chunkId?: string;
  forceReextract?: boolean;
}

export interface ExtractionValidationFailures {
  unresolvedEndpoints: number;
  selfLoops: number;
  unsupportedRelationType: number;
  lowConfidence: number;
  invalidEvidence: number;
}

export interface ExtractionDiagnostics {
  provider: string;
  model?: string;
  validationFailures: ExtractionValidationFailures;
  retryCount?: number;
}

export interface ChunkExtractionResult {
  chunkId: string;
  documentId: string;
  workspaceId: string;
  entitiesExtracted: number;
  entitiesResolved: number;
  mentionsCreated: number;
  relationsExtracted: number;
  relationsPersisted: number;
  evidenceCreated: number;
  durationMs: number;
  diagnostics?: ExtractionDiagnostics;
}

export interface DocumentGraphExtractionResult {
  documentId: string;
  workspaceId: string;
  totalChunks: number;
  processedChunks: number;
  totalEntities: number;
  totalRelations: number;
  totalEvidence: number;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  durationMs: number;
  errors?: string[];
  diagnostics?: {
    provider: string;
    model?: string;
    totalValidationFailures: ExtractionValidationFailures;
  };
}

// ---------------------------------------------------------------------------
// Phase 6.4: Reliable Background Queue, Run Identity & Manifest Contracts
// ---------------------------------------------------------------------------

export interface PendingDispatch {
  extractionRunId: string; // UUID v4 binding this dispatch to a specific run
  jobId: string; // Deterministic: `graph_${documentId}_${extractionRunId}`
  enqueuedAt: null | string; // null = not yet dispatched; ISO 8601 = confirmed dispatched
  createdAt: string; // ISO 8601 timestamp of intent creation
  attempts: number; // Number of Redis dispatch attempts made
  lastAttemptAt: string | null; // ISO 8601 of most recent dispatch attempt
  lastError: string | null; // Sanitized error from most recent failed dispatch attempt
}

export interface GraphChunkCheckpoint {
  extractionRunId: string; // Binds checkpoint strictly to active run
  chunkManifestHash: string; // SHA-256 of document checksum + ordered chunk content hashes
  lastCompletedChunkIndex: number; // Integer index (0, 1, 2...)
  lastCompletedChunkId: string; // Immutable UUID primary key
  processedChunksCount: number; // processedChunksCount = succeededChunksCount + failedChunksCount
  succeededChunksCount: number; // Successfully extracted chunks
  failedChunksCount: number; // Permanently failed chunks
}

export type GraphTerminalStatus = 'COMPLETED' | 'PARTIAL' | 'FAILED';

export interface GraphFinalizationReceipt {
  terminalStatus: GraphTerminalStatus;
  extractionRunId: string;
  chunkManifestHash: string;
  completedAt: string; // ISO 8601 string
  chunkCount: number;
  processedChunksCount: number;
  succeededChunksCount: number;
  failedChunksCount: number;
}

/**
 * Strengthened Finalization Receipt Validation Invariants (AC-24, §6.4.5)
 */
export function validateFinalizationReceipt(
  receipt: unknown,
  expectedRunId?: string,
  expectedManifestHash?: string,
  expectedChunkCount?: number,
): receipt is GraphFinalizationReceipt {
  if (!receipt || typeof receipt !== 'object') return false;

  const candidate = receipt as Partial<GraphFinalizationReceipt>;
  const {
    terminalStatus,
    extractionRunId,
    chunkManifestHash,
    completedAt,
    chunkCount,
    processedChunksCount,
    succeededChunksCount,
    failedChunksCount,
  } = candidate;

  // 1. Status vocabulary check
  if (!terminalStatus || !['COMPLETED', 'PARTIAL', 'FAILED'].includes(terminalStatus)) return false;

  // 2. Run ID and Manifest Hash verification
  if (typeof extractionRunId !== 'string' || !extractionRunId) return false;
  if (expectedRunId && extractionRunId !== expectedRunId) return false;

  if (typeof chunkManifestHash !== 'string' || !chunkManifestHash) return false;
  if (expectedManifestHash && chunkManifestHash !== expectedManifestHash) return false;

  // 3. Timestamp verification
  if (typeof completedAt !== 'string' || Number.isNaN(Date.parse(completedAt))) return false;

  // 4. Non-negative integer checks
  if (
    typeof chunkCount !== 'number' ||
    !Number.isInteger(chunkCount) ||
    chunkCount < 0 ||
    typeof processedChunksCount !== 'number' ||
    !Number.isInteger(processedChunksCount) ||
    processedChunksCount < 0 ||
    typeof succeededChunksCount !== 'number' ||
    !Number.isInteger(succeededChunksCount) ||
    succeededChunksCount < 0 ||
    typeof failedChunksCount !== 'number' ||
    !Number.isInteger(failedChunksCount) ||
    failedChunksCount < 0
  ) {
    return false;
  }

  // 5. Strict accounting balance
  if (processedChunksCount !== succeededChunksCount + failedChunksCount) return false;
  if (processedChunksCount !== chunkCount) return false;
  if (expectedChunkCount !== undefined && chunkCount !== expectedChunkCount) return false;

  // 6. Status-specific counter consistency
  if (terminalStatus === 'COMPLETED') {
    if (succeededChunksCount !== chunkCount || failedChunksCount !== 0) return false;
  } else if (terminalStatus === 'PARTIAL') {
    if (chunkCount === 0 || succeededChunksCount === 0 || failedChunksCount === 0) return false;
  } else if (terminalStatus === 'FAILED') {
    if (succeededChunksCount !== 0 || failedChunksCount !== chunkCount) return false;
  }

  return true;
}

export type ExtractionErrorType = 'TRANSIENT' | 'PERMANENT' | 'FENCED' | 'DEFERRED';

export interface ManifestChunkInput {
  chunkIndex: number;
  id: string;
  content: string;
}

/**
 * Deterministic chunk manifest hash computation (§6.8.1).
 * chunkManifestHash = sha256(document.checksum + ';' + sum(c.chunkIndex + ':' + c.id + ':' + sha256(c.content)))
 */
export function computeChunkManifestHash(
  documentChecksum: string,
  chunks: ManifestChunkInput[],
): string {
  const sortedChunks = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const chunkParts = sortedChunks.map((c) => {
    const contentHash = createHash('sha256').update(c.content, 'utf8').digest('hex');
    return `${c.chunkIndex}:${c.id}:${contentHash}`;
  });
  const serialized = `${documentChecksum};${chunkParts.join(';')}`;
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}

/**
 * Computes a deterministic 64-bit signed integer advisory lock key (§6.2.4).
 * Matches PostgreSQL trigger: ('x' || substr(md5(workspace_id || ':' || relation_id), 1, 16))::bit(64)::bigint
 */
export function computeRelationLockKey(workspaceId: string, relationId: string): bigint {
  const hex = createHash('md5')
    .update(`${workspaceId}:${relationId}`, 'utf8')
    .digest('hex')
    .slice(0, 16);

  const unsigned = BigInt(`0x${hex}`);
  return unsigned >= 0x8000000000000000n ? unsigned - 0x10000000000000000n : unsigned;
}

/**
 * Sorts relation objects in deterministic ascending numerical signed 64-bit lock order.
 */
export function sortRelationsByLockKey<T extends { lockKey: bigint }>(relations: T[]): T[] {
  return [...relations].sort((a, b) => (a.lockKey < b.lockKey ? -1 : a.lockKey > b.lockKey ? 1 : 0));
}

/**
 * Standard deterministic BullMQ Job ID generator for extraction runs (§6.3.3).
 */
export function formatExtractionJobId(documentId: string, extractionRunId: string): string {
  return `graph_${documentId}_${extractionRunId}`;
}

export const GRAPH_EXTRACTION_QUEUE_NAME = 'graph-extraction';
export const GRAPH_EXTRACTION_JOB_NAME = 'extract-graph';

export const GRAPH_QUEUE_DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 2000,
  },
  removeOnComplete: {
    count: 500,
    age: 86400,
  },
  removeOnFail: {
    count: 200,
    age: 604800,
  },
};

/**
 * Redis Lua Distributed Lease Scripts (§6.5.2)
 */

// 1. Acquire Lease (NX with EX TTL)
export const LUA_ACQUIRE_LEASE_SCRIPT = `
if redis.call("set", KEYS[1], ARGV[1], "NX", "EX", ARGV[2]) then
  return 1
else
  return 0
end
`.trim();

// 2. Compare-and-Expire (Renew only if token matches)
export const LUA_RENEW_LEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("expire", KEYS[1], ARGV[2])
else
  return 0
end
`.trim();

// 3. Compare-and-Delete (Release only if token matches)
export const LUA_RELEASE_LEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`.trim();
