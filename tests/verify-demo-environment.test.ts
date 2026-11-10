/**
 * Unit & Integration Tests for scripts/verify-demo-environment.ts
 */

import { describe, it, expect } from 'vitest';
import {
  redactSecret,
  checkPostgresAndVector,
  checkRedis,
  checkOllama,
  checkGemini,
  renderPreflightReport,
  type PreflightCheckResult,
} from '../scripts/verify-demo-environment.js';

describe('Preflight Verification CLI Suite', () => {
  describe('Secret Redaction Safeguards', () => {
    it('should return [Not Configured] for empty or missing secrets', () => {
      expect(redactSecret(undefined)).toBe('[Not Configured]');
      expect(redactSecret(null)).toBe('[Not Configured]');
      expect(redactSecret('')).toBe('[Not Configured]');
    });

    it('should report secret character count without leaking secret content', () => {
      const secret = 'AIzaSyD-secret-key-1234567890abcdefghijklmnopqrstuvw';
      const redacted = redactSecret(secret);
      expect(redacted).toBe(`[Configured (${secret.length} characters)]`);
      expect(redacted).not.toContain('AIzaSyD');
      expect(redacted).not.toContain('secret-key');
    });
  });

  describe('PostgreSQL & pgvector Diagnostic Checks', () => {
    it('should return FAIL when DATABASE_URL is missing', async () => {
      const { pgCheck, vectorCheck } = await checkPostgresAndVector(undefined);
      expect(pgCheck.status).toBe('FAIL');
      expect(pgCheck.summary).toContain('DATABASE_URL');
      expect(pgCheck.remediation).toBeDefined();
      expect(vectorCheck.status).toBe('FAIL');
    });

    it('should return FAIL with actionable remediation when database is unreachable', async () => {
      const badUrl = 'postgresql://invalid_user:invalid_pwd@localhost:59999/nonexistent';
      const { pgCheck, vectorCheck } = await checkPostgresAndVector(badUrl);
      expect(pgCheck.status).toBe('FAIL');
      expect(pgCheck.remediation).toContain('docker compose up -d postgres');
      expect(vectorCheck.status).toBe('FAIL');
    });
  });

  describe('Redis Diagnostic Checks', () => {
    it('should return FAIL with remediation when Redis port is unreachable', async () => {
      const badRedisUrl = 'redis://localhost:59999';
      const check = await checkRedis(badRedisUrl);
      expect(check.status).toBe('FAIL');
      expect(check.summary).toContain('Connection failed');
      expect(check.remediation).toContain('docker compose up -d redis');
    });
  });

  describe('Ollama Diagnostic Checks', () => {
    it('should return SKIP when Ollama is unreachable and LLM_PROVIDER is not ollama', async () => {
      const check = await checkOllama({
        baseUrl: 'http://localhost:59999',
        activeProvider: 'gemini',
      });
      expect(check.status).toBe('SKIP');
      expect(check.summary).toContain('Optional: LLM_PROVIDER is configured to');
    });

    it('should return WARN with remediation when Ollama is unreachable and LLM_PROVIDER is ollama', async () => {
      const check = await checkOllama({
        baseUrl: 'http://localhost:59999',
        activeProvider: 'ollama',
      });
      expect(check.status).toBe('WARN');
      expect(check.remediation).toContain('ollama serve');
    });
  });

  describe('Gemini Diagnostic Checks', () => {
    it('should return SKIP when GEMINI_API_KEY is missing and LLM_PROVIDER is ollama', async () => {
      const check = await checkGemini({
        apiKey: '',
        activeProvider: 'ollama',
      });
      expect(check.status).toBe('SKIP');
      expect(check.summary).toContain('Not configured');
    });

    it('should return FAIL when GEMINI_API_KEY is missing and LLM_PROVIDER is gemini', async () => {
      const check = await checkGemini({
        apiKey: '',
        activeProvider: 'gemini',
      });
      expect(check.status).toBe('FAIL');
      expect(check.remediation).toContain('Add GEMINI_API_KEY to your .env file');
    });

    it('should never expose key characters even on failure', async () => {
      const fakeKey = 'fake-gemini-key-12345';
      const check = await checkGemini({
        apiKey: fakeKey,
        activeProvider: 'gemini',
      });
      expect(check.summary).not.toContain(fakeKey);
      if (check.remediation) {
        expect(check.remediation).not.toContain(fakeKey);
      }
    });
  });

  describe('Overall Status & Exit Code Logic', () => {
    it('should return BLOCKED and exit code 1 when required infrastructure fails', () => {
      const mockResults: PreflightCheckResult[] = [
        {
          category: 'INFRASTRUCTURE',
          name: 'PostgreSQL Database',
          status: 'FAIL',
          summary: 'Connection refused',
        },
        {
          category: 'INFRASTRUCTURE',
          name: 'pgvector Extension',
          status: 'FAIL',
          summary: 'Cannot verify',
        },
        {
          category: 'INFRASTRUCTURE',
          name: 'Redis Cache & Queue',
          status: 'PASS',
          summary: 'Connected',
        },
        {
          category: 'AI_PROVIDER',
          name: 'Ollama Service',
          status: 'PASS',
          summary: 'Online',
        },
        {
          category: 'AI_PROVIDER',
          name: 'Gemini Provider',
          status: 'SKIP',
          summary: 'Not configured',
        },
        {
          category: 'DEMO_DATA',
          name: 'Showcase Workspace Seed',
          status: 'PASS',
          summary: 'Seeded',
        },
      ];

      const report = renderPreflightReport(mockResults);
      expect(report.overallStatus).toBe('BLOCKED');
      expect(report.exitCode).toBe(1);
    });

    it('should return READY_WITH_WARNINGS and exit code 0 when only optional warnings exist', () => {
      const mockResults: PreflightCheckResult[] = [
        {
          category: 'INFRASTRUCTURE',
          name: 'PostgreSQL Database',
          status: 'PASS',
          summary: 'Connected',
        },
        {
          category: 'INFRASTRUCTURE',
          name: 'pgvector Extension',
          status: 'PASS',
          summary: 'Installed',
        },
        {
          category: 'INFRASTRUCTURE',
          name: 'Redis Cache & Queue',
          status: 'PASS',
          summary: 'Connected',
        },
        {
          category: 'AI_PROVIDER',
          name: 'Ollama Service',
          status: 'WARN',
          summary: 'Ollama offline, demo works offline',
        },
        {
          category: 'AI_PROVIDER',
          name: 'Gemini Provider',
          status: 'SKIP',
          summary: 'Not configured',
        },
        {
          category: 'DEMO_DATA',
          name: 'Showcase Workspace Seed',
          status: 'PASS',
          summary: 'Seeded',
        },
      ];

      const report = renderPreflightReport(mockResults);
      expect(report.overallStatus).toBe('READY_WITH_WARNINGS');
      expect(report.exitCode).toBe(0);
    });

    it('should return READY and exit code 0 when all checks pass', () => {
      const mockResults: PreflightCheckResult[] = [
        {
          category: 'INFRASTRUCTURE',
          name: 'PostgreSQL Database',
          status: 'PASS',
          summary: 'Connected',
        },
        {
          category: 'INFRASTRUCTURE',
          name: 'pgvector Extension',
          status: 'PASS',
          summary: 'Installed',
        },
        {
          category: 'INFRASTRUCTURE',
          name: 'Redis Cache & Queue',
          status: 'PASS',
          summary: 'Connected',
        },
        {
          category: 'AI_PROVIDER',
          name: 'Ollama Service',
          status: 'PASS',
          summary: 'Online with models',
        },
        {
          category: 'AI_PROVIDER',
          name: 'Gemini Provider',
          status: 'PASS',
          summary: 'Reachable',
        },
        {
          category: 'DEMO_DATA',
          name: 'Showcase Workspace Seed',
          status: 'PASS',
          summary: 'Seeded',
        },
      ];

      const report = renderPreflightReport(mockResults);
      expect(report.overallStatus).toBe('READY');
      expect(report.exitCode).toBe(0);
    });
  });
});
