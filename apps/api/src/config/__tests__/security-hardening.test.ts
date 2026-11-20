import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { validateApiEnv, KNOWN_INSECURE_SECRETS } from '../env.js';
import { createApp } from '../../app.js';
import { setRedisHealthClient } from '../../routes/health.js';

describe('Phase 1 P0: Security Hardening & Environment Validation Suite', () => {
  const baseValidProdEnv = {
    NODE_ENV: 'production',
    PORT: '4000',
    CORS_ORIGIN: 'https://mindvault.app',
    DATABASE_URL: 'postgresql://prod_user:p_w_d_12345@prod-neon.tech/mindvault?sslmode=require',
    REDIS_URL: 'rediss://default:upstash_token_12345@prod-redis.upstash.io:6379',
    JWT_ACCESS_SECRET: 'super_strong_production_jwt_access_secret_64_bytes_entropy_mindvault',
    COOKIE_SECRET: 'super_strong_production_cookie_secret_64_bytes_entropy_mindvault_secure',
    GEMINI_API_KEY: 'AIzaSy_production_secret_key_testing_12345',
    LLM_PROVIDER: 'gemini',
    EMBEDDING_PROVIDER: 'gemini',
  };

  describe('1. Strict Production Secrets Validation (§2.1)', () => {
    it('rejects production startup when JWT_ACCESS_SECRET is missing', () => {
      const { JWT_ACCESS_SECRET, ...envWithoutJwt } = baseValidProdEnv;
      const result = validateApiEnv(envWithoutJwt);

      expect(result.success).toBe(false);
      if (!result.success) {
        const jwtIssue = result.error.issues.find((i) => i.path.includes('JWT_ACCESS_SECRET'));
        expect(jwtIssue).toBeDefined();
        expect(jwtIssue?.message).toContain('JWT_ACCESS_SECRET is required in production');
      }
    });

    it('rejects production startup when JWT_ACCESS_SECRET is shorter than 32 characters', () => {
      const result = validateApiEnv({
        ...baseValidProdEnv,
        JWT_ACCESS_SECRET: 'too_short_secret_20chrs',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const jwtIssue = result.error.issues.find((i) => i.path.includes('JWT_ACCESS_SECRET'));
        expect(jwtIssue?.message).toContain('at least 32 characters long');
      }
    });

    it('rejects production startup when known insecure development fallback JWT secret is supplied', () => {
      for (const insecureSecret of KNOWN_INSECURE_SECRETS) {
        const result = validateApiEnv({
          ...baseValidProdEnv,
          JWT_ACCESS_SECRET: insecureSecret,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          const jwtIssue = result.error.issues.find((i) => i.path.includes('JWT_ACCESS_SECRET'));
          expect(jwtIssue?.message).toContain('cannot use an insecure development/test default secret');
        }
      }
    });

    it('rejects production startup when COOKIE_SECRET is missing', () => {
      const { COOKIE_SECRET, ...envWithoutCookie } = baseValidProdEnv;
      const result = validateApiEnv(envWithoutCookie);

      expect(result.success).toBe(false);
      if (!result.success) {
        const cookieIssue = result.error.issues.find((i) => i.path.includes('COOKIE_SECRET'));
        expect(cookieIssue).toBeDefined();
        expect(cookieIssue?.message).toContain('COOKIE_SECRET is required in production');
      }
    });

    it('rejects production startup when known insecure development fallback cookie secret is supplied', () => {
      for (const insecureSecret of KNOWN_INSECURE_SECRETS) {
        const result = validateApiEnv({
          ...baseValidProdEnv,
          COOKIE_SECRET: insecureSecret,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          const cookieIssue = result.error.issues.find((i) => i.path.includes('COOKIE_SECRET'));
          expect(cookieIssue?.message).toContain('cannot use an insecure development/test default secret');
        }
      }
    });

    it('rejects production startup when DATABASE_URL is missing or empty', () => {
      const result = validateApiEnv({
        ...baseValidProdEnv,
        DATABASE_URL: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const dbIssue = result.error.issues.find((i) => i.path.includes('DATABASE_URL'));
        expect(dbIssue?.message).toContain('DATABASE_URL is required in production environment');
      }
    });

    it('rejects production startup when GEMINI_API_KEY is missing while Gemini provider is active', () => {
      const result = validateApiEnv({
        ...baseValidProdEnv,
        GEMINI_API_KEY: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const geminiIssue = result.error.issues.find((i) => i.path.includes('GEMINI_API_KEY'));
        expect(geminiIssue?.message).toContain('GEMINI_API_KEY is required in production');
      }
    });

    it('passes validation when strong, valid production secrets and configuration are supplied', () => {
      const result = validateApiEnv(baseValidProdEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.JWT_ACCESS_SECRET).toBe(baseValidProdEnv.JWT_ACCESS_SECRET);
        expect(result.data.COOKIE_SECRET).toBe(baseValidProdEnv.COOKIE_SECRET);
        expect(result.data.NODE_ENV).toBe('production');
      }
    });

    it('allows safe development defaults when NODE_ENV=development', () => {
      const result = validateApiEnv({
        NODE_ENV: 'development',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.JWT_ACCESS_SECRET).toBe(
          'dev_jwt_access_secret_replace_in_production_min_32_chars',
        );
        expect(result.data.COOKIE_SECRET).toBe(
          'dev_cookie_signing_secret_replace_in_prod_min_32_chars',
        );
      }
    });

    it('allows safe test defaults when NODE_ENV=test', () => {
      const result = validateApiEnv({
        NODE_ENV: 'test',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.JWT_ACCESS_SECRET).toBe(
          'test_jwt_access_secret_deterministic_32_chars',
        );
        expect(result.data.COOKIE_SECRET).toBe(
          'test_cookie_signing_secret_deterministic_32_chars',
        );
      }
    });
  });

  describe('2. HTTP Security Headers with Helmet (§2.2)', () => {
    const app = createApp();

    it('injects X-Content-Type-Options: nosniff to prevent MIME sniffing', async () => {
      const res = await request(app).get('/api/health/live');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('injects X-Frame-Options: DENY to prevent clickjacking in frames', async () => {
      const res = await request(app).get('/api/health/live');
      expect(res.headers['x-frame-options']).toBe('DENY');
    });

    it('injects X-Download-Options: noopen', async () => {
      const res = await request(app).get('/api/health/live');
      expect(res.headers['x-download-options']).toBe('noopen');
    });

    it('injects X-Permitted-Cross-Domain-Policies: none', async () => {
      const res = await request(app).get('/api/health/live');
      expect(res.headers['x-permitted-cross-domain-policies']).toBe('none');
    });

    it('removes X-Powered-By: Express to obscure technology stack', async () => {
      const res = await request(app).get('/api/health/live');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('sets Cross-Origin-Resource-Policy: cross-origin to allow web frontend SPA access', async () => {
      const res = await request(app).get('/api/health/live');
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });

    it('preserves CORS origin and credential handling headers', async () => {
      const res = await request(app).get('/api/health/live');
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('3. Public Health Telemetry Sanitization (§2.3)', () => {
    const mockHeartbeat = {
      workerId: 'win-worker-desktop-sensitive-hostname',
      status: 'online',
      startedAt: '2026-11-14T10:00:00.000Z',
      lastHeartbeatAt: '2026-11-14T10:05:00.000Z',
      lastJobAt: '2026-11-14T10:04:30.000Z',
      lastJobId: 'proc_doc_sensitive_job_id_123',
      lastDocId: 'doc-secret-file-uuid-456',
      concurrency: 2,
      environment: 'development',
      system: {
        platform: 'win32',
        hostname: 'DEV-PERSONAL-LAPTOP',
        arch: 'x64',
        uptimeSeconds: 84000,
        memory: {
          rssMb: 180,
          heapUsedMb: 95,
          totalSystemRamMb: 16384,
          freeSystemRamMb: 4200,
        },
      },
    };

    beforeEach(() => {
      setRedisHealthClient({
        get: vi.fn().mockResolvedValue(JSON.stringify(mockHeartbeat)),
        ping: vi.fn().mockResolvedValue('PONG'),
      } as any);
    });

    it('public /api/health/worker strips physical hostname and host telemetry', async () => {
      const app = createApp();
      const res = await request(app).get('/api/health/worker');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('online');
      expect(res.body.concurrency).toBe(2);
      expect(res.body.environment).toBe('development');

      // Prohibited physical host disclosures:
      expect(res.body.workerId).toBeUndefined();
      expect(res.body.system).toBeUndefined();
      expect(res.body.lastJobId).toBeUndefined();
      expect(res.body.lastDocId).toBeUndefined();
    });

    it('public /api/health/companion strips physical device ID and system details', async () => {
      const mockCompanionHeartbeat = {
        deviceId: 'dev_sensitive_id_789',
        deviceName: 'Personal Workstation',
        companionStatus: 'connected',
        workerState: 'idle',
        uptimeSeconds: 5000,
        system: {
          platform: 'win32',
          hostname: 'MY-HOME-PC',
        },
      };

      setRedisHealthClient({
        get: vi.fn().mockResolvedValue(JSON.stringify(mockCompanionHeartbeat)),
        ping: vi.fn().mockResolvedValue('PONG'),
      } as any);

      const app = createApp();
      const res = await request(app).get('/api/health/companion');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('online');
      expect(res.body.companionStatus).toBe('connected');
      expect(res.body.workerState).toBe('idle');

      // Prohibited leaks:
      expect(res.body.deviceId).toBeUndefined();
      expect(res.body.deviceName).toBeUndefined();
      expect(res.body.system).toBeUndefined();
    });

    it('allows full diagnostics when internal token matches', async () => {
      const originalToken = process.env.INTERNAL_DIAGNOSTICS_TOKEN;
      process.env.INTERNAL_DIAGNOSTICS_TOKEN = 'secret_admin_diagnostics_token_12345';

      try {
        const app = createApp();
        const res = await request(app)
          .get('/api/health/worker')
          .set('x-diagnostics-token', 'secret_admin_diagnostics_token_12345');

        expect(res.status).toBe(200);
        // Authorized access to diagnostics:
        expect(res.body.workerId).toBe('win-worker-desktop-sensitive-hostname');
        expect(res.body.system).toBeDefined();
        expect(res.body.system.hostname).toBe('DEV-PERSONAL-LAPTOP');
        expect(res.body.lastDocId).toBe('doc-secret-file-uuid-456');
      } finally {
        if (originalToken !== undefined) {
          process.env.INTERNAL_DIAGNOSTICS_TOKEN = originalToken;
        } else {
          delete process.env.INTERNAL_DIAGNOSTICS_TOKEN;
        }
      }
    });
  });
});
