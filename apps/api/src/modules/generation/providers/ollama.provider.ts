/**
 * MindVault — Generation Engine: Ollama LLM Provider
 *
 * Implements real local text generation and NDJSON streaming via the Ollama HTTP API.
 * Supports qwen3:0.6b, qwen3:1.7b, and other Ollama-compatible completion models.
 */

import type {
  LLMProvider,
  LLMProviderInfo,
  LLMGenerateOptions,
  LLMGenerateResult,
  LLMStreamChunk,
} from '@mindvault/shared';

export interface OllamaProviderOptions {
  baseUrl?: string;
  modelName?: string;
  timeoutMs?: number;
}

export class OllamaProvider implements LLMProvider {
  public readonly providerName = 'ollama';
  public readonly modelName: string;
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;

  constructor(options?: OllamaProviderOptions) {
    this.baseUrl = (
      options?.baseUrl ||
      process.env.OLLAMA_BASE_URL ||
      'http://localhost:11434'
    ).replace(/\/$/, '');
    this.modelName = options?.modelName || process.env.OLLAMA_GENERATION_MODEL || 'qwen3:0.6b';
    this.defaultTimeoutMs =
      options?.timeoutMs || parseInt(process.env.LLM_REQUEST_TIMEOUT || '60000', 10);
  }

  public async getModelInfo(): Promise<LLMProviderInfo> {
    return {
      providerName: this.providerName,
      model: this.modelName,
      maxContextTokens: 40960,
    };
  }

  public async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        return {
          ok: false,
          message: `Ollama returned HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const data = (await response.json()) as { models?: Array<{ name: string; model: string }> };
      const hasModel = (data.models || []).some(
        (m) =>
          m.name === this.modelName ||
          m.model === this.modelName ||
          m.name.startsWith(this.modelName),
      );

      if (!hasModel) {
        return {
          ok: false,
          message: `Model '${this.modelName}' is not installed in local Ollama instance`,
        };
      }

      return { ok: true };
    } catch (err: any) {
      return {
        ok: false,
        message: `Failed to connect to Ollama at ${this.baseUrl}: ${err.message || 'Connection refused'}`,
      };
    }
  }

  public async generate(prompt: string, options?: LLMGenerateOptions): Promise<LLMGenerateResult> {
    const timeoutMs = options?.timeoutMs || this.defaultTimeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startTime = performance.now();

    const onSignalAbort = () => controller.abort();
    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener('abort', onSignalAbort, { once: true });
      }
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          prompt,
          system: options?.systemPrompt,
          stream: false,
          options: {
            temperature: options?.temperature ?? 0.2,
            num_predict: options?.maxTokens ?? 1024,
            stop: options?.stopSequences,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `Ollama generation request failed (HTTP ${response.status}): ${errorText || response.statusText}`,
        );
      }

      const data = (await response.json()) as {
        response: string;
        prompt_eval_count?: number;
        eval_count?: number;
        done_reason?: string;
      };

      const durationMs = Math.round(performance.now() - startTime);

      return {
        text: data.response || '',
        promptTokens: data.prompt_eval_count,
        outputTokens: data.eval_count,
        durationMs,
        finishReason: data.done_reason || 'stop',
      };
    } catch (err: any) {
      if (options?.signal?.aborted) {
        throw new Error('CLIENT_ABORTED');
      }
      if (err.name === 'AbortError') {
        throw new Error(`Ollama generation timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
      if (options?.signal) {
        options.signal.removeEventListener('abort', onSignalAbort);
      }
    }
  }

  public async *generateStream(
    prompt: string,
    options?: LLMGenerateOptions,
  ): AsyncIterable<LLMStreamChunk> {
    const timeoutMs = options?.timeoutMs || this.defaultTimeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const onSignalAbort = () => controller.abort();
    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener('abort', onSignalAbort, { once: true });
      }
    }

    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    try {
      if (options?.signal?.aborted) {
        return;
      }

      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          prompt,
          system: options?.systemPrompt,
          stream: true,
          options: {
            temperature: options?.temperature ?? 0.2,
            num_predict: options?.maxTokens ?? 1024,
            stop: options?.stopSequences,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok || !response.body) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `Ollama stream request failed (HTTP ${response.status}): ${errorText || response.statusText}`,
        );
      }

      // Convert Node web ReadableStream into an async reader
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        if (options?.signal?.aborted) {
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (options?.signal?.aborted) {
            return;
          }

          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const parsed = JSON.parse(trimmed) as {
              response?: string;
              done?: boolean;
              done_reason?: string;
            };

            if (parsed.response) {
              yield {
                text: parsed.response,
                isFinished: Boolean(parsed.done),
                finishReason: parsed.done_reason,
              };
            }

            if (parsed.done) {
              return;
            }
          } catch {
            // Ignore malformed partial chunks and continue
          }
        }
      }

      // Handle any trailing text in buffer
      if (buffer.trim() && !options?.signal?.aborted) {
        try {
          const parsed = JSON.parse(buffer.trim());
          if (parsed.response) {
            yield {
              text: parsed.response,
              isFinished: Boolean(parsed.done),
              finishReason: parsed.done_reason,
            };
          }
        } catch {
          // End of buffer
        }
      }
    } catch (err: any) {
      if (options?.signal?.aborted) {
        return;
      }
      if (err.name === 'AbortError') {
        throw new Error(`Ollama generation stream timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
      if (options?.signal) {
        options.signal.removeEventListener('abort', onSignalAbort);
      }
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          // Ignore cancel errors if stream is closed
        }
        reader.releaseLock();
      }
    }
  }
}
