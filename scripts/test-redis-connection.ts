/**
 * MindVault — Upstash Redis & BullMQ Infrastructure Smoke Test CLI
 *
 * Verifies live Redis TCP connectivity, TLS handshake, PING latency,
 * temporary key read/write/delete round-trip, graph lease Lua scripts,
 * and BullMQ queue/job semantics without ever calling FLUSHDB/FLUSHALL.
 *
 * Operational Safeguards:
 * - Native TCP TLS (rediss://) supported with automatic SNI.
 * - Zero secret leakage: Never logs passwords, tokens, or raw connection strings.
 * - Non-destructive: Operates solely on ephemeral namespaced keys with TTLs.
 * - Clean cleanup: Deletes only its own smoke keys; never flushes the database.
 * - Bounded timeouts: Enforces 5000ms socket timeouts to fail fast if unreachable.
 *
 * Usage:
 *   pnpm redis:smoke
 *   REDIS_URL="rediss://default:pwd@endpoint.upstash.io:6379" pnpm redis:smoke
 */

import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import {
  parseRedisUrl,
  sanitizeRedisUrl,
  sanitizeErrorMessage,
  getSafeRedisEndpoint,
  validateUpstashRedisUrl,
  detectDuplicateEnvKeys,
  LUA_ACQUIRE_LEASE_SCRIPT,
  LUA_RENEW_LEASE_SCRIPT,
  LUA_RELEASE_LEASE_SCRIPT,
} from '@mindvault/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Deterministic environment loader with duplicate-key detection
function loadEnv(): { duplicateWarning?: string } {
  const envPath = path.resolve(rootDir, '.env');
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const content = fs.readFileSync(envPath, 'utf8');
  const duplicateCheck = detectDuplicateEnvKeys(content, 'REDIS_URL');
  let duplicateWarning: string | undefined;

  if (duplicateCheck.hasDuplicates) {
    duplicateWarning = `[ WARN ] Multiple active REDIS_URL entries detected in .env on lines: ${duplicateCheck.lines.join(', ')}.`;
  }

  // Parse lines: external process.env overrides, but within .env last line wins
  const envParsed: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      envParsed[key] = val;
    }
  }

  for (const [key, val] of Object.entries(envParsed)) {
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }

  return { duplicateWarning };
}

const { duplicateWarning } = loadEnv();

const rawRedisUrl = process.env.REDIS_URL;

// Guard against missing REDIS_URL — never silently fall back to localhost
if (!rawRedisUrl || !rawRedisUrl.trim()) {
  console.error('========================================================================');
  console.error('MindVault — Upstash Redis & BullMQ Infrastructure Smoke Test');
  console.error('========================================================================');
  console.error('[ FAIL ] REDIS_URL environment variable is missing or empty.');
  console.error('         Configure REDIS_URL in .env:');
  console.error('         REDIS_URL=rediss://default:<TOKEN>@bright-fish-115122.upstash.io:6379\n');
  if (duplicateWarning) console.error(duplicateWarning);
  console.error('========================================================================');
  process.exit(1);
}

const redisUrl = rawRedisUrl.trim();

// Upstash-specific contract validation
const upstashValidation = validateUpstashRedisUrl(redisUrl);
if (!upstashValidation.valid) {
  console.error('========================================================================');
  console.error('MindVault — Upstash Redis & BullMQ Infrastructure Smoke Test');
  console.error('========================================================================');
  console.error('[ FAIL ] Upstash Redis URL configuration failed validation:');
  console.error(`         ${upstashValidation.error}`);
  console.error('         Target URL:', sanitizeRedisUrl(redisUrl));
  console.error('         Localhost or plain redis:// URLs are rejected for production Upstash testing.\n');
  if (duplicateWarning) console.error(duplicateWarning);
  console.error('========================================================================');
  process.exit(1);
}

const endpoint = getSafeRedisEndpoint(redisUrl);
const sanitizedUrl = sanitizeRedisUrl(redisUrl);

console.log('========================================================================');
console.log('MindVault — Upstash Redis & BullMQ Infrastructure Smoke Test');
console.log('========================================================================');
console.log('Provider:    Upstash Redis');
console.log(`Endpoint:    ${endpoint.host}`);
console.log(`Port:        ${endpoint.port}`);
console.log('Protocol:    Native TLS / rediss://');
console.log(`Target URL:  ${sanitizedUrl}`);
console.log(`Timestamp:   ${new Date().toISOString()}`);
if (duplicateWarning) {
  console.log(duplicateWarning);
}
console.log('========================================================================\n');

async function runSmokeTest(): Promise<void> {
  const smokeId = crypto.randomUUID().slice(0, 8);
  const smokeKey = `mindvault:smoke:${smokeId}`;
  const leaseKey = `mindvault:smoke:lease:${smokeId}`;
  const queueName = `mindvault-smoke-queue-${smokeId}`;
  const workerToken = `worker_smoke_${smokeId}`;

  let client: Redis | null = null;
  let testQueue: Queue | null = null;
  let hasErrors = false;

  try {
    // -------------------------------------------------------------------------
    // Step 1: Initialize Managed Redis Client
    // -------------------------------------------------------------------------
    console.log('[1/5] Connecting to Redis...');
    const redisOptions = parseRedisUrl(redisUrl, 'lease');
    client = new Redis({
      ...(redisOptions as any),
      lazyConnect: true,
      connectTimeout: 5000,
    });
    client.on('error', () => {});

    const connectStart = performance.now();
    await client.connect();
    const connectMs = Math.round(performance.now() - connectStart);
    console.log(`  [ PASS ] TCP & TLS handshake established in ${connectMs}ms`);

    // -------------------------------------------------------------------------
    // Step 2: Native PING Latency Probe
    // -------------------------------------------------------------------------
    console.log('[2/5] Probing PING round-trip latency...');
    const pingStart = performance.now();
    const pong = await client.ping();
    const pingMs = Math.round(performance.now() - pingStart);
    if (pong !== 'PONG') {
      throw new Error(`Unexpected PING response: ${pong}`);
    }
    console.log(`  [ PASS ] Redis responded with PONG (${pingMs}ms latency)`);

    // -------------------------------------------------------------------------
    // Step 3: Temporary Key Read / Write / Delete Round-Trip
    // -------------------------------------------------------------------------
    console.log('[3/5] Testing temporary key SET / GET / DEL round-trip...');
    const payload = JSON.stringify({ smokeId, timestamp: Date.now() });
    await client.set(smokeKey, payload, 'EX', 30);
    const retrieved = await client.get(smokeKey);
    if (retrieved !== payload) {
      throw new Error(`Data mismatch on GET: expected ${payload}, got ${retrieved}`);
    }
    await client.del(smokeKey);
    const postDel = await client.get(smokeKey);
    if (postDel !== null) {
      throw new Error('Key was not deleted cleanly');
    }
    console.log('  [ PASS ] Ephemeral key write, read-back, and deletion verified');

    // -------------------------------------------------------------------------
    // Step 4: Knowledge Graph Lease Lua Scripts
    // -------------------------------------------------------------------------
    console.log('[4/5] Testing Knowledge Graph Lease Lua scripts...');
    // A. Acquire lease
    const acquireRes = await client.eval(LUA_ACQUIRE_LEASE_SCRIPT, 1, leaseKey, workerToken, '30');
    if (acquireRes !== 1) {
      throw new Error(`Expected LUA_ACQUIRE_LEASE_SCRIPT to return 1, got ${acquireRes}`);
    }

    // B. Renew lease
    const renewRes = await client.eval(LUA_RENEW_LEASE_SCRIPT, 1, leaseKey, workerToken, '60');
    if (renewRes !== 1) {
      throw new Error(`Expected LUA_RENEW_LEASE_SCRIPT to return 1, got ${renewRes}`);
    }

    // C. Release lease
    const releaseRes = await client.eval(LUA_RELEASE_LEASE_SCRIPT, 1, leaseKey, workerToken);
    if (releaseRes !== 1) {
      throw new Error(`Expected LUA_RELEASE_LEASE_SCRIPT to return 1, got ${releaseRes}`);
    }
    console.log('  [ PASS ] Acquire, renew, and release Lua scripts executed cleanly');

    // -------------------------------------------------------------------------
    // Step 5: BullMQ Queue, Job Add, and Cleanup
    // -------------------------------------------------------------------------
    console.log('[5/5] Testing BullMQ Queue enqueue and job management...');
    const producerOptions = parseRedisUrl(redisUrl, 'producer');
    testQueue = new Queue(queueName, {
      connection: producerOptions as any,
    });

    const job = await testQueue.add('smoke-job', { smokeId, test: true }, {
      jobId: `smoke_job_${smokeId}`,
      removeOnComplete: true,
      removeOnFail: true,
    });

    const retrievedJob = await testQueue.getJob(job.id!);
    if (!retrievedJob) {
      throw new Error(`Could not retrieve enqueued smoke job ${job.id}`);
    }

    await retrievedJob.remove();
    await testQueue.close();
    testQueue = null;
    console.log('  [ PASS ] BullMQ producer queue enqueue, read-back, and removal verified');

    console.log('\n========================================================================');
    console.log('RESULT: REDIS INFRASTRUCTURE FULLY VERIFIED');
    console.log('All 5 diagnostic probes passed. The Redis endpoint is ready for production BullMQ.');
    console.log('========================================================================\n');
  } catch (err: any) {
    hasErrors = true;
    console.error('\n  [ FAIL ] Smoke test encountered an error:');
    console.error(`           ${sanitizeErrorMessage(err.message || String(err))}`);
    console.log('\n========================================================================');
    console.log('RESULT: REDIS SMOKE TEST FAILED');
    console.log('Check the error details above and verify host, port, credentials, and network connectivity.');
    console.log('========================================================================\n');
  } finally {
    // Safe cleanup of any leftover smoke keys without ever calling FLUSHDB
    if (client) {
      try {
        await client.del(smokeKey, leaseKey);
        await client.quit();
      } catch {
        client.disconnect();
      }
    }
    if (testQueue) {
      try {
        await testQueue.close();
      } catch {
        // Ignored during cleanup
      }
    }

    if (hasErrors) {
      process.exit(1);
    }
  }
}

runSmokeTest().catch((err) => {
  console.error('Fatal smoke test error:', sanitizeErrorMessage(err.message));
  process.exit(1);
});
