import { z } from 'zod';

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
