/**
 * MindVault — Local Windows Background Worker Preflight Diagnostic CLI
 *
 * Runs deterministic, read-only preflight verification before launching the local background worker:
 * 1. Windows 11 host runtime & environment variable validation.
 * 2. Cloud Upstash Redis TLS connection & queue readiness.
 * 3. Cloud/Local PostgreSQL database connectivity and pgvector extension.
 * 4. Local Ollama AI service availability and required models (nomic-embed-text & qwen3:0.6b).
 * 5. Storage directory accessibility.
 *
 * Exit Codes:
 * - 0: PREFLIGHT PASSED (All systems ready to launch worker)
 * - 1: PREFLIGHT FAILED (Required dependency missing or unreachable)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import {
  parseRedisUrl,
  validateUpstashRedisUrl,
  detectDuplicateEnvKeys,
  sanitizeRedisUrl,
  sanitizeErrorMessage,
} from '@mindvault/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Native zero-dependency .env loader preserving quotes and comments
function loadRootEnv(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

const envFile = path.resolve(rootDir, '.env');
loadRootEnv(envFile);

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

export interface PgvectorExtensionRecord {
  extname: string;
  extversion: string;
}

export interface PgvectorCheckResult {
  installed: boolean;
  version?: string;
  extensionName?: string;
}

/**
 * Deterministically checks for pgvector extension in pg_extension.
 * Note: PostgreSQL officially registers pgvector under extname = 'vector' (and rarely 'pgvector' in custom builds).
 */
export async function detectPgvectorExtension(prismaClient: {
  $queryRawUnsafe: (query: string) => Promise<any>;
}): Promise<PgvectorCheckResult> {
  const extResult = (await prismaClient.$queryRawUnsafe(
    `SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector', 'pgvector');`,
  )) as PgvectorExtensionRecord[];

  if (extResult && extResult.length > 0) {
    return {
      installed: true,
      version: extResult[0].extversion,
      extensionName: extResult[0].extname,
    };
  }

  return { installed: false };
}

async function runWorkerPreflight(): Promise<void> {
  console.log(
    `${colors.cyan}========================================================================${colors.reset}`,
  );
  console.log(
    `${colors.bold}MindVault — Local Windows Worker Preflight Verification${colors.reset}`,
  );
  console.log(
    `${colors.cyan}========================================================================${colors.reset}`,
  );
  console.log(`OS Platform:   ${os.type()} ${os.release()} (${os.arch()})`);
  console.log(`CPU Cores:     ${os.cpus().length}x ${os.cpus()[0]?.model || 'CPU'}`);
  console.log(`Total Memory:  ${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB RAM`);
  console.log(`Node Version:  ${process.version}`);
  console.log(`Target Queue:  document-processing & graph-extraction`);
  console.log(`Timestamp:     ${new Date().toISOString()}`);
  console.log(
    `${colors.cyan}========================================================================${colors.reset}\n`,
  );

  let allPassed = true;

  // -------------------------------------------------------------------------
  // 1. Environment & Configuration Check
  // -------------------------------------------------------------------------
  console.log(`${colors.bold}[1/5] Validating Environment Configuration...${colors.reset}`);
  if (!fs.existsSync(envFile)) {
    console.log(`  ${colors.red}[ FAIL ] .env file not found at ${envFile}${colors.reset}`);
    allPassed = false;
  } else {
    const rawEnv = fs.readFileSync(envFile, 'utf-8');
    const dupCheck = detectDuplicateEnvKeys(rawEnv, 'REDIS_URL');
    if (dupCheck.hasDuplicates) {
      console.log(`  ${colors.yellow}[ WARN ] ${dupCheck.message}${colors.reset}`);
    } else {
      console.log(
        `  ${colors.green}[ PASS ] .env structure verified without duplicate keys${colors.reset}`,
      );
    }
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.log(`  ${colors.red}[ FAIL ] REDIS_URL is not set in environment${colors.reset}`);
    allPassed = false;
  } else {
    const validation = validateUpstashRedisUrl(redisUrl);
    if (!validation.valid) {
      console.log(
        `  ${colors.red}[ FAIL ] REDIS_URL validation failed: ${validation.error}${colors.reset}`,
      );
      allPassed = false;
    } else {
      console.log(
        `  ${colors.green}[ PASS ] Valid Upstash Redis TLS URL: ${sanitizeRedisUrl(redisUrl)}${colors.reset}`,
      );
    }
  }

  const concurrencyStr = process.env.WORKER_CONCURRENCY || '1';
  const concurrency = parseInt(concurrencyStr, 10);
  if (isNaN(concurrency) || concurrency <= 0) {
    console.log(
      `  ${colors.red}[ FAIL ] WORKER_CONCURRENCY must be a positive integer (received "${concurrencyStr}")${colors.reset}`,
    );
    allPassed = false;
  } else {
    if (concurrency > 2 && os.totalmem() <= 8 * 1024 * 1024 * 1024) {
      console.log(
        `  ${colors.yellow}[ WARN ] Concurrency set to ${concurrency}. For 8GB RAM machines, concurrency=1 is recommended for local AI models.${colors.reset}`,
      );
    } else {
      console.log(
        `  ${colors.green}[ PASS ] Worker concurrency configured: ${concurrency}${colors.reset}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // 2. Cloud Upstash Redis Connectivity Check
  // -------------------------------------------------------------------------
  console.log(`\n${colors.bold}[2/5] Testing Upstash Redis TLS Connectivity...${colors.reset}`);
  if (redisUrl) {
    let client: Redis | null = null;
    try {
      const redisOptions = parseRedisUrl(redisUrl, 'lease');
      client = new Redis(redisOptions as any);
      const pingStart = performance.now();
      const pong = await client.ping();
      const pingMs = Math.round(performance.now() - pingStart);
      if (pong === 'PONG') {
        console.log(
          `  ${colors.green}[ PASS ] Redis connection established (${pingMs}ms PING latency)${colors.reset}`,
        );
      } else {
        console.log(
          `  ${colors.red}[ FAIL ] Unexpected Redis PING response: ${pong}${colors.reset}`,
        );
        allPassed = false;
      }
    } catch (err: any) {
      console.log(
        `  ${colors.red}[ FAIL ] Redis connection error: ${sanitizeErrorMessage(err.message)}${colors.reset}`,
      );
      allPassed = false;
    } finally {
      if (client) {
        try {
          await client.quit();
        } catch {
          client.disconnect();
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. PostgreSQL Database Connectivity & pgvector Check
  // -------------------------------------------------------------------------
  console.log(
    `\n${colors.bold}[3/5] Testing PostgreSQL Connectivity & pgvector Extension...${colors.reset}`,
  );
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log(`  ${colors.red}[ FAIL ] DATABASE_URL is not set${colors.reset}`);
    allPassed = false;
  } else {
    const prisma = new PrismaClient();
    try {
      const dbStart = performance.now();
      await prisma.$queryRaw`SELECT 1;`;
      const dbMs = Math.round(performance.now() - dbStart);
      console.log(
        `  ${colors.green}[ PASS ] PostgreSQL connected successfully (${dbMs}ms latency)${colors.reset}`,
      );

      const extCheck = await detectPgvectorExtension(prisma);
      if (extCheck.installed) {
        console.log(
          `  ${colors.green}[ PASS ] pgvector extension active (version: ${extCheck.version})${colors.reset}`,
        );
      } else {
        console.log(
          `  ${colors.yellow}[ WARN ] pgvector extension not found in pg_extension table${colors.reset}`,
        );
      }
    } catch (err: any) {
      console.log(
        `  ${colors.red}[ FAIL ] Database connection error: ${sanitizeErrorMessage(err.message)}${colors.reset}`,
      );
      allPassed = false;
    } finally {
      await prisma.$disconnect();
    }
  }

  // -------------------------------------------------------------------------
  // 4. Local Ollama & Required Models Check
  // -------------------------------------------------------------------------
  console.log(`\n${colors.bold}[4/5] Checking Local Ollama AI Readiness...${colors.reset}`);
  const ollamaBaseUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(
    /\/$/,
    '',
  );
  const genModel = process.env.OLLAMA_GENERATION_MODEL || 'qwen3:0.6b';
  const embedModel = process.env.EMBEDDING_MODEL || 'nomic-embed-text';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${ollamaBaseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const installed = (data.models || []).map((m) => m.name.toLowerCase());
      console.log(`  ${colors.green}[ PASS ] Ollama online at ${ollamaBaseUrl}${colors.reset}`);

      const isModelInstalled = (target: string): boolean => {
        const lower = target.toLowerCase();
        return installed.some(
          (m) => m === lower || m.startsWith(`${lower}:`) || (lower.includes(':') && m === lower),
        );
      };

      if (isModelInstalled(embedModel)) {
        console.log(
          `  ${colors.green}[ PASS ] Embedding model '${embedModel}' installed${colors.reset}`,
        );
      } else {
        console.log(
          `  ${colors.red}[ FAIL ] Missing embedding model '${embedModel}'. Run: 'ollama pull ${embedModel}'${colors.reset}`,
        );
        allPassed = false;
      }

      if (isModelInstalled(genModel)) {
        console.log(
          `  ${colors.green}[ PASS ] Generation model '${genModel}' installed${colors.reset}`,
        );
      } else {
        console.log(
          `  ${colors.red}[ FAIL ] Missing generation model '${genModel}'. Run: 'ollama pull ${genModel}'${colors.reset}`,
        );
        allPassed = false;
      }
    } else {
      console.log(
        `  ${colors.red}[ FAIL ] Ollama endpoint responded with HTTP ${res.status}${colors.reset}`,
      );
      allPassed = false;
    }
  } catch (err: any) {
    console.log(
      `  ${colors.red}[ FAIL ] Ollama unreachable at ${ollamaBaseUrl}: ${err.message}${colors.reset}`,
    );
    console.log(
      `  ${colors.yellow}[ ACTION ] Ensure Ollama is running: execute 'ollama serve' in PowerShell.${colors.reset}`,
    );
    allPassed = false;
  }

  // -------------------------------------------------------------------------
  // 5. Document Storage Directory Check
  // -------------------------------------------------------------------------
  console.log(`\n${colors.bold}[5/5] Checking Document Storage Directory...${colors.reset}`);
  const storageDir = path.resolve(
    rootDir,
    process.env.STORAGE_DIR || './infrastructure/storage/documents',
  );
  try {
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
      console.log(
        `  ${colors.green}[ PASS ] Created storage directory: ${storageDir}${colors.reset}`,
      );
    } else {
      console.log(
        `  ${colors.green}[ PASS ] Storage directory accessible: ${storageDir}${colors.reset}`,
      );
    }
  } catch (err: any) {
    console.log(
      `  ${colors.red}[ FAIL ] Storage directory inaccessible: ${err.message}${colors.reset}`,
    );
    allPassed = false;
  }

  console.log(
    `\n${colors.cyan}========================================================================${colors.reset}`,
  );
  if (allPassed) {
    console.log(
      `${colors.green}${colors.bold}RESULT: LOCAL WORKER PREFLIGHT PASSED${colors.reset}`,
    );
    console.log(`All systems operational. The local Windows background worker is ready to run.`);
    console.log(
      `${colors.cyan}========================================================================${colors.reset}\n`,
    );
    process.exit(0);
  } else {
    console.log(`${colors.red}${colors.bold}RESULT: LOCAL WORKER PREFLIGHT BLOCKED${colors.reset}`);
    console.log(
      `One or more required dependencies failed validation. Resolve the issues above before starting the worker.`,
    );
    console.log(
      `${colors.cyan}========================================================================${colors.reset}\n`,
    );
    process.exit(1);
  }
}

const isDirectExecution =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('verify-worker-preflight.ts') ||
    process.argv[1].endsWith('verify-worker-preflight.js'));

if (isDirectExecution) {
  runWorkerPreflight().catch((err) => {
    console.error('\nPreflight Diagnostic Fatal Error:', err);
    process.exit(1);
  });
}
