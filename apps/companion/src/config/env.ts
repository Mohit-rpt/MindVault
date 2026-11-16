import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, '../../../../.env');

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config();
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    CLOUD_API_URL: z.string().url().default('http://localhost:3000'),
    COMPANION_POLL_INTERVAL_MS: z
      .string()
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().min(2000).max(60000))
      .default('10000'),
    WORKER_IDLE_TIMEOUT_MS: z
      .string()
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().min(10000).max(3600000))
      .default('300000'), // 5 minutes default
    DEVICE_NAME: z.string().optional(),
    DEVICE_TOKEN: z.string().optional(),
    WORKER_CONCURRENCY: z
      .string()
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().min(1).max(10))
      .default('1'),
    WORKER_STARTUP_TIMEOUT_MS: z
      .string()
      .transform((val) => parseInt(val, 10))
      .default('30000'),
    WORKER_SHUTDOWN_TIMEOUT_MS: z
      .string()
      .transform((val) => parseInt(val, 10))
      .pipe(z.number().min(10000).max(300000))
      .default('60000'), // 60s default for deep extraction
    WORKER_MAX_CRASH_RESTARTS: z
      .string()
      .transform((val) => parseInt(val, 10))
      .default('3'),
    LOG_LEVEL: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).default('INFO'),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production') {
      const url = data.CLOUD_API_URL.toLowerCase();
      if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('0.0.0.0')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CLOUD_API_URL'],
          message:
            'CLOUD_API_URL cannot point to localhost or loopback in production mode. A valid remote HTTPS endpoint is required (§CFG-01).',
        });
      }
      if (!url.startsWith('https://')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CLOUD_API_URL'],
          message: 'CLOUD_API_URL must use encrypted HTTPS scheme in production mode (§CFG-01).',
        });
      }
    }
  });

export type CompanionEnv = z.infer<typeof envSchema>;

let parsedEnv: CompanionEnv;
try {
  parsedEnv = envSchema.parse(process.env);
} catch (err: any) {
  if (err instanceof z.ZodError) {
    console.error('Invalid companion configuration:');
    for (const issue of err.issues) {
      console.error(` - ${issue.path.join('.')}: ${issue.message}`);
    }
  } else {
    console.error('Failed to parse companion environment:', err);
  }
  // Provide safe defaults in non-fatal cases
  parsedEnv = envSchema.parse({});
}

export const env = parsedEnv;
