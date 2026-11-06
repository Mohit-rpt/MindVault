import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load root .env first, then local .env
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z
    .string()
    .default('4000')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0 && val < 65536, {
      message: 'PORT must be a valid port number (1-65535)',
    }),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),

  // Phase 1: Authentication & Security
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters long' })
    .default('dev_jwt_access_secret_replace_in_production_min_32_chars'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  COOKIE_SECRET: z
    .string()
    .min(32, { message: 'COOKIE_SECRET must be at least 32 characters long' })
    .default('dev_cookie_signing_secret_replace_in_prod_min_32_chars'),
  REFRESH_TOKEN_EXPIRY_DAYS: z
    .string()
    .default('7')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0, {
      message: 'REFRESH_TOKEN_EXPIRY_DAYS must be a positive integer',
    }),

  // Phase 4: Generative RAG & LLM Provider Configuration
  LLM_PROVIDER: z.enum(['ollama', 'gemini', 'mock']).default('ollama'),
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  OLLAMA_GENERATION_MODEL: z.string().default('qwen3:0.6b'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
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
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
