import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { isLocalRedis, getSafeRedisEndpoint } from '@mindvault/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load root .env first, then local .env
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test', 'staging']).default('development'),
    REDIS_URL: z.string().optional(),
    DEV_ALLOW_REMOTE_REDIS: z
      .string()
      .default('false')
      .transform((val) => val === 'true'),
    WORKER_CONCURRENCY: z
      .string()
      .default('1')
      .transform((v) => parseInt(v, 10))
      .refine((v) => !isNaN(v) && v > 0, {
        message: 'WORKER_CONCURRENCY must be a positive number',
      }),
    WORKER_TYPE: z.enum(['local', 'cloud', 'all']).default('all'),
    AUTHORIZED_WORKSPACE_ID: z.string().optional(),
    DATABASE_URL: z.string().optional(),

    // Ingestion & Graph AI Configuration (Gemini Native)
    EMBEDDING_MODEL: z.string().default('gemini-embedding-2'),
    EMBEDDING_PROVIDER: z.enum(['gemini', 'mock']).default('gemini'),
    LLM_PROVIDER: z.enum(['gemini', 'mock']).default('gemini'),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
    GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-2'),
    GEMINI_EMBEDDING_RPM_LIMIT: z
      .string()
      .default('300')
      .transform((val) => parseInt(val, 10))
      .refine((val) => !isNaN(val) && val > 0, {
        message: 'GEMINI_EMBEDDING_RPM_LIMIT must be a positive integer',
      }),
    GEMINI_EMBEDDING_TPM_LIMIT: z
      .string()
      .default('1000000')
      .transform((val) => parseInt(val, 10))
      .refine((val) => !isNaN(val) && val > 0, {
        message: 'GEMINI_EMBEDDING_TPM_LIMIT must be a positive integer',
      }),
    LLM_REQUEST_TIMEOUT: z
      .string()
      .default('60000')
      .transform((val) => parseInt(val, 10))
      .refine((val) => !isNaN(val) && val > 0, {
        message: 'LLM_REQUEST_TIMEOUT must be a positive integer',
      }),
    LLM_MAX_OUTPUT_TOKENS: z
      .string()
      .default('1024')
      .transform((val) => parseInt(val, 10))
      .refine((val) => !isNaN(val) && val > 0, {
        message: 'LLM_MAX_OUTPUT_TOKENS must be a positive integer',
      }),
    LLM_TEMPERATURE: z
      .string()
      .default('0.2')
      .transform((val) => parseFloat(val))
      .refine((val) => !isNaN(val) && val >= 0 && val <= 2, {
        message: 'LLM_TEMPERATURE must be a number between 0 and 2',
      }),

    // Storage Configuration (Phase 1)
    STORAGE_PROVIDER: z.enum(['local', 's3', 'r2']).default('local'),
    STORAGE_DIR: z.string().optional(),
    STORAGE_ENDPOINT: z.string().optional(),
    STORAGE_BUCKET: z.string().optional(),
    STORAGE_REGION: z.string().default('auto'),
    STORAGE_ACCESS_KEY_ID: z.string().optional(),
    STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
    STORAGE_FORCE_PATH_STYLE: z
      .string()
      .optional()
      .transform((val) => val === 'true'),
  })
  .superRefine((data, ctx) => {
    const isProd = data.NODE_ENV === 'production';
    const isStaging = data.NODE_ENV === 'staging';
    const isDev = data.NODE_ENV === 'development';

    // Production safety requirements
    if (isProd) {
      if (!data.REDIS_URL || data.REDIS_URL.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['REDIS_URL'],
          message: 'REDIS_URL is required in production and must start with rediss:// (native TLS)',
        });
      } else if (!data.REDIS_URL.startsWith('rediss://')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['REDIS_URL'],
          message: 'REDIS_URL is required in production and must start with rediss:// (native TLS)',
        });
      }

      if (data.LLM_PROVIDER === 'gemini' || data.EMBEDDING_PROVIDER === 'gemini') {
        if (!data.GEMINI_API_KEY || data.GEMINI_API_KEY.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['GEMINI_API_KEY'],
            message:
              'GEMINI_API_KEY is required in production for background ingestion and graph extraction',
          });
        }
      }
    } else if (isStaging) {
      if (!data.REDIS_URL || data.REDIS_URL.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['REDIS_URL'],
          message: 'REDIS_URL is required in staging',
        });
      }
      if (data.LLM_PROVIDER === 'gemini' || data.EMBEDDING_PROVIDER === 'gemini') {
        if (!data.GEMINI_API_KEY || data.GEMINI_API_KEY.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['GEMINI_API_KEY'],
            message:
              'GEMINI_API_KEY is required in staging when Gemini providers are active',
          });
        }
      }
    }

    // Local Worker Safety Guard (§P0):
    // When running in development mode, connecting to a remote/cloud Redis (TLS or external host)
    // is strictly prohibited unless explicitly authorized via DEV_ALLOW_REMOTE_REDIS=true.
    if (isDev && data.REDIS_URL && data.REDIS_URL.trim().length > 0) {
      if (!isLocalRedis(data.REDIS_URL) && !data.DEV_ALLOW_REMOTE_REDIS) {
        const safeEndpoint = getSafeRedisEndpoint(data.REDIS_URL);
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['REDIS_URL'],
          message: `CRITICAL SECURITY GUARD: Worker in development mode attempted to connect to remote/cloud Redis (${safeEndpoint.host}:${safeEndpoint.port}). Processing production or cloud queues from a local development environment is prohibited to prevent accidental processing of production jobs. If this is intentional for remote staging testing, you must set DEV_ALLOW_REMOTE_REDIS=true.`,
        });
      }
    }
  })
  .transform((data) => {
    return {
      ...data,
      REDIS_URL:
        data.REDIS_URL && data.REDIS_URL.trim().length > 0
          ? data.REDIS_URL.trim()
          : data.NODE_ENV !== 'production' && data.NODE_ENV !== 'staging'
            ? 'redis://localhost:6379'
            : '',
    };
  });

/**
 * Validates arbitrary worker environment variables without calling process.exit.
 * Used for deterministic testing and configuration verification.
 */
export function validateWorkerEnv(rawEnv: Record<string, any>) {
  return envSchema.safeParse(rawEnv);
}

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid worker environment configuration:');
  parsed.error.issues.forEach((issue) => {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  });
  if (process.env.NODE_ENV !== 'test') {
    process.exit(1);
  }
}

export const env = parsed.success
  ? parsed.data
  : ({} as z.infer<typeof envSchema>);

