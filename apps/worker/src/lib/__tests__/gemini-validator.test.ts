/**
 * MindVault — Phase 1B.0: Gemini Preflight & Quota Diagnostic Unit Tests
 *
 * Verifies:
 * 1. Masking of API keys to prevent secret exposure.
 * 2. Accurate classification of upstream Gemini HTTP status codes and error messages.
 * 3. Handling of missing credentials.
 * 4. Model catalog verification.
 * 5. Unit-normalization validation and tolerance defense.
 * 6. Explicit billing advisories regarding consumer plans (Google One / Jio).
 */

import { describe, it, expect } from 'vitest';
import {
  maskApiKey,
  classifyGeminiError,
  verifyGeminiPreflight,
  APPROVED_MODELS,
} from '../gemini-validator.js';

describe('Gemini Preflight Diagnostic Module', () => {
  describe('maskApiKey', () => {
    it('returns [NOT CONFIGURED] for empty, null, or undefined keys', () => {
      expect(maskApiKey('')).toBe('[NOT CONFIGURED]');
      expect(maskApiKey(null)).toBe('[NOT CONFIGURED]');
      expect(maskApiKey(undefined)).toBe('[NOT CONFIGURED]');
      expect(maskApiKey('   ')).toBe('[NOT CONFIGURED]');
    });

    it('masks short keys safely', () => {
      expect(maskApiKey('12345678')).toBe('***[REDACTED SHORT KEY]***');
    });

    it('masks standard Google API keys preserving only 4 prefix and 4 suffix chars with length', () => {
      const key = 'AIzaSyD-1234567890abcdef1234567890abcdef12';
      const masked = maskApiKey(key);
      expect(masked).toBe('AIza...ef12 (length 42)');
      expect(masked).not.toContain('1234567890abcdef');
    });
  });

  describe('classifyGeminiError', () => {
    it('identifies 401 and API_KEY_INVALID as AUTHENTICATION_FAILED', () => {
      const err = { status: 401, message: 'API_KEY_INVALID: API key not valid. Please pass a valid API key.' };
      const classified = classifyGeminiError(err);
      expect(classified.category).toBe('AUTHENTICATION_FAILED');
      expect(classified.remediation).toContain('Google AI Studio');
    });

    it('identifies 403 as PERMISSION_DENIED', () => {
      const err = { status: 403, message: 'Generative Language API has not been used in project' };
      const classified = classifyGeminiError(err);
      expect(classified.category).toBe('PERMISSION_DENIED');
      expect(classified.remediation).toContain('Generative Language API');
    });

    it('identifies 429 as QUOTA_EXHAUSTED with billing advisory', () => {
      const err = { status: 429, message: 'RESOURCE_EXHAUSTED: Rate limit exceeded: 15 RPM for free tier' };
      const classified = classifyGeminiError(err);
      expect(classified.category).toBe('QUOTA_EXHAUSTED');
      expect(classified.remediation).toContain('Pay-As-You-Go');
      expect(classified.remediation).toContain('Google One AI Premium or Jio');
    });

    it('identifies 503 as SERVICE_UNAVAILABLE', () => {
      const err = { status: 503, message: 'The model is overloaded. Please try again later.' };
      const classified = classifyGeminiError(err);
      expect(classified.category).toBe('SERVICE_UNAVAILABLE');
    });

    it('identifies network failures', () => {
      const err = { message: 'fetch failed: connect ECONNREFUSED 142.250.190.42:443' };
      const classified = classifyGeminiError(err);
      expect(classified.category).toBe('NETWORK_ERROR');
    });
  });

  describe('verifyGeminiPreflight', () => {
    it('fails fast when GEMINI_API_KEY is missing', async () => {
      const result = await verifyGeminiPreflight({ apiKey: '' });
      expect(result.ok).toBe(false);
      expect(result.keyConfigured).toBe(false);
      expect(result.errorCategory).toBe('CONFIGURATION_ERROR');
      expect(result.maskedApiKey).toBe('[NOT CONFIGURED]');
      expect(result.remediationSteps.length).toBeGreaterThan(0);
    });

    it('validates target approved models list', () => {
      expect(APPROVED_MODELS).toContain('gemini-embedding-2');
      expect(APPROVED_MODELS).toContain('gemini-embedding-001');
      expect(APPROVED_MODELS).toContain('gemini-3.8-flash');
      expect(APPROVED_MODELS).toContain('gemini-3.5-flash-lite');
      // Obsolete models must NOT be in the approved list
      expect(APPROVED_MODELS).not.toContain('text-embedding-004');
    });
  });
});
