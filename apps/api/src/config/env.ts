import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load root .env first, then local .env
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

// Phase 1: Authentication & Security Constants
export const KNOWN_INSECURE_SECRETS = new Set([
  'dev_jwt_access_secret_replace_in_production_min_32_chars',
  'dev_cookie_signing_secret_replace_in_prod_min_32_chars',
  'test_jwt_access_secret_deterministic_32_chars',
  'test_cookie_signing_secret_deterministic_32_chars',
  '12345678901234567890123456789012',
  'secret',
  'changeme',
  'password123456789012345678901234',
]);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test', 'staging']).default('development'),
    PORT: z
      .string()
      .default('4000')
      .transform((val) => parseInt(val, 10))
      .refine((val) => !isNaN(val) && val > 0 && val < 65536, {
        message: 'PORT must be a valid port number (1-65535)',
      }),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    DATABASE_URL: z.string().optional(),
    REDIS_URL: z
      .string()
      .optional()
      .transform((val) => {
        if (!val && process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'staging') {
          return 'redis://localhost:6379';
        }
        return val || '';
      })
      .refine(
        (val) => {
          if (process.env.NODE_ENV === 'production') {
            return !!val && val.startsWith('rediss://');
          }
          if (process.env.NODE_ENV === 'staging') {
            return !!val && (val.startsWith('rediss://') || val.startsWith('redis://'));
          }
          return true;
        },
        {
          message: 'REDIS_URL is required in production (rediss://) and staging',
        },
      ),

    // Phase 1: Authentication & Security
    JWT_ACCESS_SECRET: z.string().optional(),
    JWT_ACCESS_EXPIRY: z.string().default('15m'),
    COOKIE_SECRET: z.string().optional(),
    REFRESH_TOKEN_EXPIRY_DAYS: z
      .string()
      .default('7')
      .transform((val) => parseInt(val, 10))
      .refine((val) => !isNaN(val) && val > 0, {
        message: 'REFRESH_TOKEN_EXPIRY_DAYS must be a positive integer',
      }),

    // Optional internal diagnostics token for accessing unsanitized worker telemetry
    INTERNAL_DIAGNOSTICS_TOKEN: z.string().optional(),

    // Phase 4: Generative RAG & LLM Provider Configuration (Gemini Native)
    LLM_PROVIDER: z.enum(['gemini', 'mock']).default('gemini'),
    EMBEDDING_PROVIDER: z.enum(['gemini', 'mock']).default('gemini'),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
    GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-2'),
    DISABLE_VECTOR_SEARCH: z
      .string()
      .default('false')
      .transform((val) => val === 'true'),
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

    // Rate Limiting & Resource Governance (Phase 3 & 4)
    RATE_LIMIT_FAIL_CLOSED: z
      .string()
      .optional()
      .transform((val) => val === 'true')
      .default('true'),
    WORKSPACE_MAX_DOCUMENTS: z
      .string()
      .default('100')
      .transform((val) => parseInt(val, 10)),
    WORKSPACE_MAX_STORAGE_BYTES: z
      .string()
      .default('104857600') // 100MB
      .transform((val) => parseInt(val, 10)),
    USER_MAX_CHAT_MESSAGES_PER_DAY: z
      .string()
      .default('500')
      .transform((val) => parseInt(val, 10)),
  })
  .superRefine((data, ctx) => {
    const isProd = data.NODE_ENV === 'production';
    const isStaging = data.NODE_ENV === 'staging';
    const isRestrictedEnv = isProd || isStaging;

    // Strict Production & Staging Secret Enforcement
    if (isRestrictedEnv) {
      const envLabel = isProd ? 'production' : 'staging';

      if (!data.JWT_ACCESS_SECRET || data.JWT_ACCESS_SECRET.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message:
            `JWT_ACCESS_SECRET is required in ${envLabel} and must be at least 32 characters long`,
        });
      } else if (KNOWN_INSECURE_SECRETS.has(data.JWT_ACCESS_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message:
            `JWT_ACCESS_SECRET cannot use an insecure development/test default secret in ${envLabel}`,
        });
      } else if (data.JWT_ACCESS_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message:
            `JWT_ACCESS_SECRET is required in ${envLabel} and must be at least 32 characters long`,
        });
      }

      if (!data.COOKIE_SECRET || data.COOKIE_SECRET.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['COOKIE_SECRET'],
          message:
            `COOKIE_SECRET is required in ${envLabel} and must be at least 32 characters long`,
        });
      } else if (KNOWN_INSECURE_SECRETS.has(data.COOKIE_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['COOKIE_SECRET'],
          message:
            `COOKIE_SECRET cannot use an insecure development/test default secret in ${envLabel}`,
        });
      } else if (data.COOKIE_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['COOKIE_SECRET'],
          message:
            `COOKIE_SECRET is required in ${envLabel} and must be at least 32 characters long`,
        });
      }

      if (!data.DATABASE_URL || data.DATABASE_URL.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_URL'],
          message: `DATABASE_URL is required in ${envLabel} environment`,
        });
      }

      if (data.LLM_PROVIDER === 'gemini' || data.EMBEDDING_PROVIDER === 'gemini') {
        if (!data.GEMINI_API_KEY || data.GEMINI_API_KEY.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['GEMINI_API_KEY'],
            message: `GEMINI_API_KEY is required in ${envLabel} when Gemini providers are active`,
          });
        }
      }
    } else {
      // Development / Test validation: if supplied, must meet length minimum
      if (data.JWT_ACCESS_SECRET && data.JWT_ACCESS_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'JWT_ACCESS_SECRET must be at least 32 characters long',
        });
      }
      if (data.COOKIE_SECRET && data.COOKIE_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['COOKIE_SECRET'],
          message: 'COOKIE_SECRET must be at least 32 characters long',
        });
      }
    }
  })
  .transform((data) => {
    return {
      ...data,
      JWT_ACCESS_SECRET:
        data.JWT_ACCESS_SECRET && data.JWT_ACCESS_SECRET.trim().length > 0
          ? data.JWT_ACCESS_SECRET.trim()
          : data.NODE_ENV === 'test'
            ? 'test_jwt_access_secret_deterministic_32_chars'
            : data.NODE_ENV === 'production' || data.NODE_ENV === 'staging'
              ? ''
              : 'dev_jwt_access_secret_replace_in_production_min_32_chars',
      COOKIE_SECRET:
        data.COOKIE_SECRET && data.COOKIE_SECRET.trim().length > 0
          ? data.COOKIE_SECRET.trim()
          : data.NODE_ENV === 'test'
            ? 'test_cookie_signing_secret_deterministic_32_chars'
            : data.NODE_ENV === 'production' || data.NODE_ENV === 'staging'
              ? ''
              : 'dev_cookie_signing_secret_replace_in_prod_min_32_chars',
    };
  });

/**
 * Validates arbitrary environment variables without calling process.exit.
 * Used for deterministic testing and configuration verification.
 */
export function validateApiEnv(rawEnv: Record<string, any>) {
  return envSchema.safeParse(rawEnv);
}

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
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

