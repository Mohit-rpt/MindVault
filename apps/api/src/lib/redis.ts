/**
 * MindVault — Dedicated API Redis Singleton Module
 *
 * Provides a managed, shared ioredis client for API services (rate limiting,
 * health checks, worker/companion presence probes).
 *
 * Features & Guarantees:
 * - Uses existing ioredis dependency.
 * - Parses env.REDIS_URL using parseRedisUrl() from @mindvault/shared with 'producer' role.
 * - Preserves TLS/SNI configuration and certificate validation for Upstash Redis.
 * - Attaches error listener to prevent unhandled EventEmitter errors from crashing Node.js.
 * - Provides graceful shutdown via closeApiRedisClient().
 * - Supports test override injection via setApiRedisClient().
 */

import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { parseRedisUrl, sanitizeErrorMessage } from '@mindvault/shared';

let apiRedisClient: Redis | null = null;
let testOverrideClient: Redis | null | undefined = undefined;

/**
 * Retrieves or lazily initializes the dedicated API Redis singleton client.
 * In test mode (NODE_ENV === 'test'), returns null unless an override or real connection is forced.
 */
export function getApiRedisClient(force = false): Redis | null {
  if (testOverrideClient !== undefined) {
    return testOverrideClient;
  }

  // Avoid eager unmocked connection in unit tests unless explicitly forced
  if (env.NODE_ENV === 'test' && !force && process.env.FORCE_REAL_REDIS !== 'true') {
    return null;
  }

  if (!apiRedisClient) {
    try {
      const redisUrl = process.env.REDIS_URL || env.REDIS_URL;
      if (!redisUrl) {
        return null;
      }
      const redisOptions = parseRedisUrl(redisUrl, 'producer');
      apiRedisClient = new Redis(redisOptions as any);

      apiRedisClient.on('error', (err: any) => {
        console.warn('API Redis connection warning:', sanitizeErrorMessage(err?.message || 'Redis error'));
      });
    } catch (err: any) {
      console.warn('Failed to initialize API Redis client:', sanitizeErrorMessage(err?.message || 'Init error'));
      return null;
    }
  }

  return apiRedisClient;
}

/**
 * Injects or clears a mock Redis client for testing.
 * Pass undefined to restore default singleton behavior, or null to simulate absent client.
 */
export function setApiRedisClient(client: Redis | null | undefined): void {
  testOverrideClient = client;
}

/**
 * Gracefully shuts down the API Redis singleton connection.
 * Idempotent: safe to call multiple times or when uninitialized.
 */
export async function closeApiRedisClient(): Promise<void> {
  if (apiRedisClient) {
    const client = apiRedisClient;
    apiRedisClient = null;
    try {
      if (client.status !== 'end') {
        await client.quit();
      }
    } catch {
      client.disconnect();
    }
  }
}
