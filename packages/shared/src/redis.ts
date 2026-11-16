/**
 * MindVault — Shared Redis Utilities & Upstash Infrastructure Contracts
 *
 * Provides centralized URL parsing, TLS SNI configuration, role-specific connection options
 * (producers vs consumers vs lease managers), zero-leak sanitization, and endpoint telemetry.
 */

import net from 'node:net';

export type RedisConnectionRole = 'producer' | 'consumer' | 'lease';

export interface ParsedRedisOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: {
    servername?: string;
    rejectUnauthorized?: boolean;
  };
  maxRetriesPerRequest: number | null;
  connectTimeout: number;
  enableReadyCheck?: boolean;
  lazyConnect?: boolean;
  retryStrategy?: (times: number) => number | void | null;
}

export interface SafeRedisEndpoint {
  host: string;
  port: number;
  isTls: boolean;
}

/**
 * Parses a Redis connection URL (redis:// or rediss://) into connection options
 * tailored for ioredis and BullMQ based on the client's operational role.
 *
 * - producer: bounded retries (3) and short timeout (5s) so API requests fail fast rather than hang.
 * - consumer: maxRetriesPerRequest strictly null (required by BullMQ Worker blocking commands).
 * - lease: bounded retries (3) and short timeout (5s) for deterministic lease acquisition/release.
 */
export function parseRedisUrl(
  url: string,
  role: RedisConnectionRole = 'producer',
): ParsedRedisOptions {
  const trimmed = (url || '').trim();
  if (!trimmed) {
    throw new Error('Redis URL cannot be empty');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (err: any) {
    throw new Error(`Invalid Redis URL format: ${sanitizeErrorMessage(err.message)}`);
  }

  const isTls = parsed.protocol === 'rediss:';
  const isPlain = parsed.protocol === 'redis:';

  if (!isTls && !isPlain) {
    throw new Error(
      `Unsupported Redis protocol "${parsed.protocol}". Expected "redis:" or "rediss:".`,
    );
  }

  const rawHost = parsed.hostname ? parsed.hostname.trim() : '';
  if (!rawHost) {
    throw new Error('Redis URL must include a valid hostname');
  }

  // Normalize IPv6 bracketed hosts: e.g. [::1] -> ::1 for ioredis
  const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;

  let port = 6379;
  if (parsed.port) {
    const parsedPort = parseInt(parsed.port, 10);
    if (isNaN(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      throw new Error(`Invalid Redis port "${parsed.port}". Expected integer between 1 and 65535.`);
    }
    port = parsedPort;
  }

  let username: string | undefined;
  let password: string | undefined;
  try {
    username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
  } catch {
    username = parsed.username || undefined;
  }
  try {
    password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
  } catch {
    password = parsed.password || undefined;
  }

  let db: number | undefined;
  if (parsed.pathname && parsed.pathname !== '/') {
    const rawDb = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname;
    if (!/^\d+$/.test(rawDb)) {
      throw new Error(
        `Invalid Redis database index "${parsed.pathname}". Expected a non-negative integer.`,
      );
    }
    const parsedDb = parseInt(rawDb, 10);
    if (parsedDb < 0 || parsedDb > 65535) {
      throw new Error(`Redis database index out of range (${parsedDb}). Expected 0-65535.`);
    }
    db = parsedDb;
  }

  const baseOptions: ParsedRedisOptions = {
    host,
    port,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(db !== undefined ? { db } : {}),
    maxRetriesPerRequest: null,
    connectTimeout: 10000,
  };

  if (isTls) {
    // Upstash and cloud providers require SNI (servername) for TLS handshakes.
    // RFC 6066: SNI servername must only be set for domain hostnames, not raw IP addresses.
    const isIp = net.isIP(host) !== 0;
    baseOptions.tls = {
      ...(isIp ? {} : { servername: host }),
      rejectUnauthorized: true,
    };
  }

  switch (role) {
    case 'producer':
      return {
        ...baseOptions,
        maxRetriesPerRequest: 3,
        connectTimeout: 5000,
        enableReadyCheck: true,
        retryStrategy: (times: number) => {
          if (times > 3) return null;
          return Math.min(times * 200, 2000);
        },
      };

    case 'lease':
      return {
        ...baseOptions,
        maxRetriesPerRequest: 3,
        connectTimeout: 5000,
        enableReadyCheck: true,
        retryStrategy: (times: number) => {
          if (times > 3) return null;
          return Math.min(times * 200, 2000);
        },
      };

    case 'consumer':
    default:
      return {
        ...baseOptions,
        // BullMQ Worker commands (BRPOPLPUSH / BZPOPMIN) strictly mandate maxRetriesPerRequest: null
        maxRetriesPerRequest: null,
        connectTimeout: 10000,
        enableReadyCheck: false,
        retryStrategy: (times: number) => {
          // Reconnect with capped backoff for long-running consumers
          return Math.min(times * 500, 5000);
        },
      };
  }
}

/**
 * Redacts credentials from a Redis URL string for safe logging and telemetry.
 * E.g. rediss://default:supersecret@endpoint.upstash.io:6379 -> rediss://default:[REDACTED]@endpoint.upstash.io:6379
 */
export function sanitizeRedisUrl(url?: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '[REDACTED]';
    }
    return parsed.toString().replace(/%5BREDACTED%5D/g, '[REDACTED]');
  } catch {
    // Regex fallback if URL is partially malformed
    return url
      .replace(/:\/\/([^:]+):([^@]+)@/g, '://$1:[REDACTED]@')
      .replace(/:\/\/(:)([^@]+)@/g, '://[REDACTED]@');
  }
}

/**
 * Sanitizes arbitrary error messages and log strings, redacting passwords,
 * tokens, API keys, Bearer headers, and embedded Redis connection URLs.
 */
export function sanitizeErrorMessage(msg?: string): string {
  if (!msg) return '';

  return (
    msg
      // Redact embedded Redis URLs with passwords
      .replace(/(rediss?:\/\/[^:]+:)[^@]+(@[^\s"']+)/gi, '$1[REDACTED]$2')
      .replace(/(rediss?:\/\/)[^@\s"']+(@[^\s"']+)/gi, '$1[REDACTED]$2')
      // Redact secret query params and key-value pairs
      .replace(
        /(password|secret|key|token|api_key|apikey|authorization)=([^&\s"']+)/gi,
        '$1=[REDACTED]',
      )
      // Redact Bearer authorization tokens
      .replace(/Bearer\s+[a-zA-Z0-9_\-.]+/gi, 'Bearer [REDACTED]')
      // Redact raw password assignments in connection errors
      .replace(/(AUTH\s+(?:\S+\s+)?)\S+/gi, '$1[REDACTED]')
  );
}

/**
 * Validates Redis configuration according to the runtime environment.
 * In production, REDIS_URL is required and must be a valid rediss:// (TLS) endpoint.
 */
export function validateRedisConfig(
  url?: string,
  nodeEnv?: string,
): { valid: boolean; error?: string } {
  const isProduction = nodeEnv === 'production';
  const trimmed = (url || '').trim();

  if (!trimmed) {
    if (isProduction) {
      return { valid: false, error: 'REDIS_URL is required in production environment' };
    }
    return { valid: true };
  }

  try {
    const parsedOpts = parseRedisUrl(trimmed, 'producer');
    if (isProduction && !parsedOpts.tls) {
      return {
        valid: false,
        error: 'REDIS_URL must use native TLS (rediss://) in production for cloud Redis providers',
      };
    }
    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: `Invalid REDIS_URL: ${sanitizeErrorMessage(err.message)}` };
  }
}

/**
 * Returns safe endpoint host, port, and TLS status without leaking credentials.
 */
export function getSafeRedisEndpoint(url?: string): SafeRedisEndpoint {
  if (!url) {
    return { host: 'localhost', port: 6379, isTls: false };
  }

  try {
    const parsed = new URL(url);
    const rawHost = parsed.hostname ? parsed.hostname.trim() : 'localhost';
    const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
    return {
      host: host || 'localhost',
      port: parsed.port ? parseInt(parsed.port, 10) : 6379,
      isTls: parsed.protocol === 'rediss:',
    };
  } catch {
    return { host: 'unknown', port: 6379, isTls: false };
  }
}

export interface UpstashValidationResult {
  valid: boolean;
  endpoint?: SafeRedisEndpoint;
  error?: string;
}

/**
 * Specifically validates an Upstash Redis URL configuration:
 * - Scheme must be 'rediss://' (native TLS)
 * - Host must end with '.upstash.io'
 * - Port must be 6379 (or explicitly specified)
 * - Password/token must be present
 */
export function validateUpstashRedisUrl(url?: string): UpstashValidationResult {
  if (!url || !url.trim()) {
    return { valid: false, error: 'REDIS_URL is missing or empty' };
  }
  try {
    const trimmed = url.trim();
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'rediss:') {
      return {
        valid: false,
        error: `Invalid Redis scheme "${parsed.protocol}". Upstash Redis requires "rediss://" (native TLS).`,
      };
    }
    const host = parsed.hostname ? parsed.hostname.toLowerCase() : '';
    if (!host.endsWith('.upstash.io')) {
      return {
        valid: false,
        error: `Host "${parsed.hostname}" is not an Upstash Redis endpoint (*.upstash.io).`,
      };
    }
    const port = parsed.port ? parseInt(parsed.port, 10) : 6379;
    if (port !== 6379) {
      return {
        valid: false,
        error: `Invalid port "${port}". Expected port 6379 for Upstash native TCP connections.`,
      };
    }
    if (!parsed.password) {
      return {
        valid: false,
        error: 'Upstash REDIS_URL is missing authentication credentials (password/token).',
      };
    }
    return {
      valid: true,
      endpoint: { host: parsed.hostname, port, isTls: true },
    };
  } catch (err: any) {
    return {
      valid: false,
      error: `Invalid Redis URL format: ${sanitizeErrorMessage(err.message)}`,
    };
  }
}

/**
 * Scans raw .env file content for duplicate definitions of active (uncommented) environment variables.
 * Returns information detailing whether duplicate active lines exist.
 */
export function detectDuplicateEnvKeys(
  envContent: string,
  targetKey = 'REDIS_URL',
): {
  hasDuplicates: boolean;
  count: number;
  lines: number[];
  message?: string;
} {
  const lines = envContent.split(/\r?\n/);
  const matchingLines: number[] = [];
  const regex = new RegExp(`^\\s*${targetKey}\\s*=`, 'i');

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    if (regex.test(trimmed)) {
      matchingLines.push(index + 1);
    }
  });

  const hasDuplicates = matchingLines.length > 1;
  return {
    hasDuplicates,
    count: matchingLines.length,
    lines: matchingLines,
    message: hasDuplicates
      ? `Found ${matchingLines.length} duplicate active definitions for ${targetKey} at lines: ${matchingLines.join(', ')}`
      : undefined,
  };
}
