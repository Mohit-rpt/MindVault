import { Logger } from '../utils/logger.js';

export interface OllamaValidationOptions {
  baseUrl?: string;
  generationModel?: string;
  embeddingModel?: string;
  timeoutMs?: number;
}

export interface OllamaValidationResult {
  ready: boolean;
  status: 'ONLINE' | 'UNREACHABLE' | 'MODEL_MISSING' | 'SKIPPED';
  installedModels: string[];
  missingModels: string[];
  remediation?: string;
  error?: string;
}

/**
 * Validates local Ollama connectivity and verifies required generation & embedding models exist.
 * Does not download models automatically. Provides clear, actionable remediation.
 */
export async function validateOllamaEnvironment(
  options?: OllamaValidationOptions,
): Promise<OllamaValidationResult> {
  const baseUrl = (
    options?.baseUrl ||
    process.env.OLLAMA_BASE_URL ||
    'http://127.0.0.1:11434'
  ).replace(/\/$/, '');
  const genModel = options?.generationModel || process.env.OLLAMA_GENERATION_MODEL || 'qwen3:0.6b';
  const embedModel = options?.embeddingModel || process.env.EMBEDDING_MODEL || 'nomic-embed-text';
  const timeoutMs = options?.timeoutMs || 3000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        ready: false,
        status: 'UNREACHABLE',
        installedModels: [],
        missingModels: [genModel, embedModel],
        error: `Ollama endpoint responded with HTTP ${response.status}`,
        remediation: `Ensure Ollama is running at ${baseUrl}. Try running 'ollama serve' in PowerShell.`,
      };
    }

    const data = (await response.json()) as { models?: Array<{ name: string }> };
    const installedModels = (data.models || []).map((m) => m.name.toLowerCase());

    const isModelInstalled = (target: string): boolean => {
      const lower = target.toLowerCase();
      return installedModels.some(
        (m) => m === lower || m.startsWith(`${lower}:`) || (lower.includes(':') && m === lower),
      );
    };

    const missingModels: string[] = [];
    if (!isModelInstalled(genModel)) missingModels.push(genModel);
    if (!isModelInstalled(embedModel)) missingModels.push(embedModel);

    if (missingModels.length > 0) {
      const pullCommands = missingModels.map((m) => `ollama pull ${m}`).join(' && ');
      return {
        ready: false,
        status: 'MODEL_MISSING',
        installedModels,
        missingModels,
        remediation: `Missing required Ollama model(s): ${missingModels.join(', ')}. Run: '${pullCommands}' in PowerShell.`,
      };
    }

    return {
      ready: true,
      status: 'ONLINE',
      installedModels,
      missingModels: [],
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isAbort = err.name === 'AbortError';
    const errorMsg = isAbort ? `Connection timed out after ${timeoutMs}ms` : err.message;
    return {
      ready: false,
      status: 'UNREACHABLE',
      installedModels: [],
      missingModels: [genModel, embedModel],
      error: errorMsg,
      remediation: `Ollama is unreachable at ${baseUrl}. Start Ollama on Windows or run 'ollama serve' in PowerShell.`,
    };
  }
}
