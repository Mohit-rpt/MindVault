/**
 * MindVault — Phase 1B.0: Gemini API Preflight & Quota Diagnostic Module
 *
 * Verifies:
 * 1. Safe credential handling with zero secret leakage in logs or reports.
 * 2. Model access for approved Phase 1B models:
 *    - gemini-embedding-2 (Primary embedding)
 *    - gemini-embedding-001 (Fallback embedding)
 *    - gemini-3.8-flash (Primary generation / graph extraction)
 *    - gemini-3.5-flash-lite (High-volume extraction fallback)
 * 3. Error classification: Authentication (401), Permission (403), Quota (429), Transient (503).
 * 4. Explicit warnings regarding consumer plans (Google One / Jio) vs Developer API billing.
 */

import { GoogleGenAI } from '@google/genai';

export interface PreflightCheckResult {
  ok: boolean;
  timestamp: string;
  maskedApiKey: string;
  keyConfigured: boolean;
  modelsFound: string[];
  modelsMissing: string[];
  embeddingProbeSuccess: boolean;
  embeddingDimension?: number;
  embeddingNorm?: number;
  detectedTier: 'paid_tier' | 'free_tier_limited' | 'unknown';
  errorCategory?:
    | 'AUTHENTICATION_FAILED'
    | 'PERMISSION_DENIED'
    | 'QUOTA_EXHAUSTED'
    | 'SERVICE_UNAVAILABLE'
    | 'MODEL_NOT_FOUND'
    | 'NETWORK_ERROR'
    | 'CONFIGURATION_ERROR';
  errorMessage?: string;
  warnings: string[];
  remediationSteps: string[];
}

export interface PreflightOptions {
  apiKey?: string;
  primaryEmbeddingModel?: string;
  requiredModels?: string[];
  probeEmbedding?: boolean;
}

export const APPROVED_MODELS = [
  'gemini-embedding-2',
  'gemini-embedding-001',
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
];

/**
 * Safely masks an API key to prevent credential exposure in logs, terminal outputs, or artifacts.
 * Example: 'AIzaSyD-1234567890abcdef1234567890' -> 'AIza...7890 (length 39)'
 */
export function maskApiKey(apiKey?: string | null): string {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    return '[NOT CONFIGURED]';
  }
  const clean = apiKey.trim();
  if (clean.length <= 8) {
    return '***[REDACTED SHORT KEY]***';
  }
  const prefix = clean.slice(0, 4);
  const suffix = clean.slice(-4);
  return `${prefix}...${suffix} (length ${clean.length})`;
}

/**
 * Classifies upstream Gemini API errors into actionable operational categories.
 */
export function classifyGeminiError(error: any): {
  category: PreflightCheckResult['errorCategory'];
  message: string;
  remediation: string;
} {
  const msg = error?.message || error?.toString() || 'Unknown error';
  const status = error?.status || error?.statusCode || error?.code;

  if (
    status === 401 ||
    msg.includes('API_KEY_INVALID') ||
    msg.includes('API key not valid') ||
    msg.includes('unauthenticated')
  ) {
    return {
      category: 'AUTHENTICATION_FAILED',
      message: 'Gemini API authentication failed: The provided API key is invalid or revoked.',
      remediation: 'Generate a new API key in Google AI Studio (https://aistudio.google.com/) and update GEMINI_API_KEY in .env.',
    };
  }

  if (
    status === 403 ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('permission') ||
    msg.includes('access not configured')
  ) {
    return {
      category: 'PERMISSION_DENIED',
      message: 'Gemini API permission denied: The project or key does not have access to the Generative Language API.',
      remediation: 'Ensure the Generative Language API is enabled for your Google Cloud project and the API key has permission to call it.',
    };
  }

  if (
    status === 429 ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('quota') ||
    msg.includes('rate limit')
  ) {
    return {
      category: 'QUOTA_EXHAUSTED',
      message: 'Gemini API rate limit or quota exhausted (HTTP 429).',
      remediation: 'Attach a billing account to your Google Cloud project to enable Pay-As-You-Go Tier (up to 1,500 RPM for embeddings). Note: Google One AI Premium or Jio subscriptions do NOT provide Developer API quota.',
    };
  }

  if (status === 503 || msg.includes('UNAVAILABLE') || msg.includes('overloaded')) {
    return {
      category: 'SERVICE_UNAVAILABLE',
      message: 'Google Gemini service is temporarily overloaded or unavailable (HTTP 503).',
      remediation: 'Transient cloud error. Retry with exponential backoff.',
    };
  }

  if (
    msg.includes('ENOTFOUND') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('fetch failed')
  ) {
    return {
      category: 'NETWORK_ERROR',
      message: 'Network connectivity failure: Unable to reach Google API endpoints (generativelanguage.googleapis.com).',
      remediation: 'Verify internet connectivity and firewall/proxy rules allowing outbound HTTPS traffic to Google Cloud.',
    };
  }

  return {
    category: 'CONFIGURATION_ERROR',
    message: `Gemini API invocation error: ${msg}`,
    remediation: 'Inspect error details and verify model configuration parameters.',
  };
}

/**
 * Runs a deterministic preflight diagnostic probe against Google Gemini API.
 */
export async function verifyGeminiPreflight(
  options: PreflightOptions = {},
): Promise<PreflightCheckResult> {
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY || '';
  const requiredModels = options.requiredModels || APPROVED_MODELS;
  const primaryEmbeddingModel = options.primaryEmbeddingModel || 'gemini-embedding-2';
  const shouldProbeEmbedding = options.probeEmbedding !== false;

  const result: PreflightCheckResult = {
    ok: false,
    timestamp: new Date().toISOString(),
    maskedApiKey: maskApiKey(apiKey),
    keyConfigured: !!apiKey && apiKey.trim().length > 0,
    modelsFound: [],
    modelsMissing: [],
    embeddingProbeSuccess: false,
    detectedTier: 'unknown',
    warnings: [],
    remediationSteps: [],
  };

  if (!result.keyConfigured) {
    result.errorCategory = 'CONFIGURATION_ERROR';
    result.errorMessage = 'GEMINI_API_KEY is not configured in environment variables.';
    result.remediationSteps.push(
      'Set GEMINI_API_KEY in .env or provide it via environment before running migration.',
    );
    return result;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    // 1. Probe model catalog accessibility
    try {
      const modelPager = await ai.models.list();
      const accessibleModels: string[] = [];
      for await (const model of modelPager) {
        if (model.name) {
          // Normalize name: e.g. 'models/gemini-embedding-2' -> 'gemini-embedding-2'
          const normalized = model.name.replace(/^models\//, '');
          accessibleModels.push(normalized);
        }
      }

      result.modelsFound = requiredModels.filter((req) =>
        accessibleModels.some((acc) => acc.includes(req) || req.includes(acc)),
      );
      result.modelsMissing = requiredModels.filter(
        (req) => !result.modelsFound.includes(req),
      );

      if (result.modelsMissing.length > 0) {
        result.warnings.push(
          `Some approved models were not found in catalog: ${result.modelsMissing.join(', ')}`,
        );
      }
    } catch (listErr: any) {
      // Some API key scopes allow embedContent but restrict models.list
      result.warnings.push(`Model catalog listing returned warning: ${listErr?.message || String(listErr)}`);
    }

    // 2. Probe embedding generation with dimensionality truncation
    if (shouldProbeEmbedding) {
      try {
        const probeText = 'MindVault Phase 1B.0 Preflight Probe';
        const response: any = await ai.models.embedContent({
          model: primaryEmbeddingModel,
          contents: probeText,
          config: {
            outputDimensionality: 768,
          },
        });

        const values = response.embedding?.values || response.embeddings?.[0]?.values;
        if (!values || !Array.isArray(values)) {
          throw new Error('API returned empty or non-array embedding values.');
        }

        result.embeddingDimension = values.length;
        if (values.length !== 768) {
          throw new Error(`Dimensionality mismatch: expected 768, got ${values.length}`);
        }

        // Verify Euclidean unit norm
        const norm = Math.sqrt(values.reduce((sum: number, v: number) => sum + v * v, 0));
        result.embeddingNorm = norm;
        if (Math.abs(norm - 1.0) > 1e-4) {
          result.warnings.push(
            `Embedding norm drift detected: ${norm.toFixed(6)} (expected 1.0 ± 1e-4). Provider auto-renormalization defense required.`,
          );
        }

        result.embeddingProbeSuccess = true;
        result.detectedTier = 'paid_tier'; // Successfully completed embedding without immediate 429
      } catch (embedErr: any) {
        const classified = classifyGeminiError(embedErr);
        result.errorCategory = classified.category;
        result.errorMessage = classified.message;
        result.remediationSteps.push(classified.remediation);

        if (classified.category === 'QUOTA_EXHAUSTED') {
          result.detectedTier = 'free_tier_limited';
          result.warnings.push(
            'CRITICAL: Rate limit exceeded during probe. Your API key may be on Google AI Studio Free Tier (strictly capped at 15 RPM). A Pay-As-You-Go billing account is required for background migration.',
          );
        }
        return result;
      }
    }

    // Billing subscription clarification warning (Mandatory requirement)
    result.warnings.push(
      'BILLING ADVISORY: Consumer subscriptions (Google One AI Premium, Jio AI) apply exclusively to consumer apps and do NOT grant Developer API quota. Developer API calls require Google Cloud Pay-As-You-Go billing.',
    );

    result.ok = result.embeddingProbeSuccess || result.modelsFound.length > 0;
    return result;
  } catch (err: any) {
    const classified = classifyGeminiError(err);
    result.errorCategory = classified.category;
    result.errorMessage = classified.message;
    result.remediationSteps.push(classified.remediation);
    return result;
  }
}

/**
 * Validates Google Gemini environment configuration offline (zero API calls).
 */
export function validateGeminiEnvironment(options: { apiKey?: string; model?: string } = {}): {
  ready: boolean;
  status: 'READY' | 'MISSING_API_KEY' | 'INVALID_MODEL';
  maskedKey: string;
  missingRequirements: string[];
  remediation?: string;
} {
  const apiKey = options.apiKey?.trim();
  const model = options.model?.trim() || 'gemini-embedding-2';

  if (!apiKey) {
    return {
      ready: false,
      status: 'MISSING_API_KEY',
      maskedKey: maskApiKey(apiKey),
      missingRequirements: ['GEMINI_API_KEY'],
      remediation: 'Add GEMINI_API_KEY to your .env file from Google AI Studio.',
    };
  }

  if (!APPROVED_MODELS.includes(model)) {
    return {
      ready: false,
      status: 'INVALID_MODEL',
      maskedKey: maskApiKey(apiKey),
      missingRequirements: [`Approved model: ${model}`],
      remediation: `Configure an approved embedding model: ${APPROVED_MODELS.join(', ')}`,
    };
  }

  return {
    ready: true,
    status: 'READY',
    maskedKey: maskApiKey(apiKey),
    missingRequirements: [],
  };
}
