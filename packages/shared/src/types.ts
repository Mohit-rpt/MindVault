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
