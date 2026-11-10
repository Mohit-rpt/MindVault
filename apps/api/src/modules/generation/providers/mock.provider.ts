/**
 * MindVault — Generation Engine: Mock LLM Provider
 *
 * Deterministic provider for unit, integration, and security testing.
 * Never performs network requests or GPU computation.
 */

import type {
  LLMProvider,
  LLMProviderInfo,
  LLMGenerateOptions,
  LLMGenerateResult,
  LLMStreamChunk,
} from '@mindvault/shared';

export interface MockProviderOptions {
  modelName?: string;
  defaultResponse?: string;
  streamDelayMs?: number;
  shouldFail?: boolean;
  failureMessage?: string;
}

export class MockLLMProvider implements LLMProvider {
  public readonly providerName = 'mock';
  public readonly modelName: string;
  private defaultResponse: string | null = null;
  private streamDelayMs: number;
  private shouldFail: boolean;
  private failureMessage: string;

  constructor(options?: MockProviderOptions) {
    this.modelName = options?.modelName || 'mock-qwen-768';
    this.defaultResponse = options?.defaultResponse || null;
    this.streamDelayMs = options?.streamDelayMs || 0;
    this.shouldFail = options?.shouldFail || false;
    this.failureMessage = options?.failureMessage || 'Simulated Mock LLM failure';
  }

  public setSimulatedResponse(response: string | null): void {
    this.defaultResponse = response;
  }

  public setStreamDelay(delayMs: number): void {
    this.streamDelayMs = delayMs;
  }

  public setSimulatedFailure(shouldFail: boolean, message?: string): void {
    this.shouldFail = shouldFail;
    if (message) this.failureMessage = message;
  }

  public async getModelInfo(): Promise<LLMProviderInfo> {
    return {
      providerName: this.providerName,
      model: this.modelName,
      maxContextTokens: 40960,
    };
  }

  public async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    if (this.shouldFail) {
      return { ok: false, message: this.failureMessage };
    }
    return { ok: true };
  }

  private generateDeterministicResponse(prompt: string): string {
    if (this.defaultResponse) {
      return this.defaultResponse;
    }

    // Inspect prompt to generate an honest grounded response
    const lowerPrompt = prompt.toLowerCase();

    // Handle summarization prompts
    if (
      lowerPrompt.includes('conversation summarizer') ||
      lowerPrompt.includes('generate a concise, neutral summary')
    ) {
      return 'The user asked about neural networks, machine learning paradigms, and follow-up architectural questions.';
    }

    // Handle query reformulation prompts
    if (lowerPrompt.includes('reformulate the latest question')) {
      if (lowerPrompt.includes('drawbacks') && lowerPrompt.includes('pgvector')) {
        return 'drawbacks of pgvector for embeddings';
      }
      if (lowerPrompt.includes('compare') && lowerPrompt.includes('rabbitmq')) {
        return 'How does BullMQ compare to RabbitMQ?';
      }
      if (lowerPrompt.includes('gin') && lowerPrompt.includes('full-text')) {
        return 'What is a PostgreSQL GIN index used for in full-text search?';
      }
      if (lowerPrompt.includes('gradients') && lowerPrompt.includes('learning rate')) {
        return 'how does learning rate affect gradients in neural networks?';
      }
      if (lowerPrompt.includes('prisma migrations')) {
        return 'Prisma migrations in production';
      }
      if (lowerPrompt.includes('why?') || lowerPrompt.includes('user question: why')) {
        return 'Why use hybrid vector and keyword search?';
      }
      if (lowerPrompt.includes('rrf') || lowerPrompt.includes('reciprocal rank fusion')) {
        return 'Tell me more about Reciprocal Rank Fusion (RRF) technique and its formula.';
      }
      if (lowerPrompt.includes('session keys')) {
        return 'Where does Redis store session keys?';
      }
      if (lowerPrompt.includes('limitations')) {
        return 'limitations of neural network architecture';
      }
      if (lowerPrompt.includes('example')) {
        return 'real-world example of supervised learning';
      }
      const match = prompt.match(/User Question:\s*([^\n]+)/i);
      return match ? match[1].trim() : 'contextualized search query';
    }

    const hasEvidence = prompt.includes('--- SOURCE [S1]');
    const isInsufficient =
      lowerPrompt.includes('unsupported') ||
      lowerPrompt.includes('no-evidence') ||
      lowerPrompt.includes('starship') ||
      lowerPrompt.includes('soufflé') ||
      lowerPrompt.includes('system override') ||
      lowerPrompt.includes('warp drive') ||
      !hasEvidence;

    if (isInsufficient) {
      return 'Based on the provided documents, there is insufficient evidence to answer your question.';
    }

    // Synthesize response with valid citation references
    return (
      'Based on the provided documents, supervised learning infer functions from labeled training data [S1]. ' +
      'In addition, neural network parameters are optimized via backpropagation and gradient calculation [S2].'
    );
  }

  public async generate(prompt: string, _options?: LLMGenerateOptions): Promise<LLMGenerateResult> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    const text = this.generateDeterministicResponse(prompt);

    return {
      text,
      promptTokens: Math.ceil(prompt.length / 4),
      outputTokens: Math.ceil(text.length / 4),
      durationMs: 15,
      finishReason: 'stop',
    };
  }

  public async *generateStream(
    prompt: string,
    options?: LLMGenerateOptions,
  ): AsyncIterable<LLMStreamChunk> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    if (options?.signal?.aborted) {
      return;
    }

    const text = this.generateDeterministicResponse(prompt);
    // Break into deterministic word tokens
    const tokens = text.match(/\S+|\s+/g) || [text];

    for (let i = 0; i < tokens.length; i++) {
      if (options?.signal?.aborted) {
        return;
      }

      if (this.streamDelayMs > 0) {
        await new Promise<void>((resolve, reject) => {
          if (options?.signal?.aborted) {
            return reject(new Error('CLIENT_ABORTED'));
          }

          const onAbort = () => {
            clearTimeout(timer);
            options?.signal?.removeEventListener('abort', onAbort);
            reject(new Error('CLIENT_ABORTED'));
          };

          const timer = setTimeout(() => {
            options?.signal?.removeEventListener('abort', onAbort);
            resolve();
          }, this.streamDelayMs);

          options?.signal?.addEventListener('abort', onAbort, { once: true });
        }).catch((err) => {
          if (options?.signal?.aborted || err.message === 'CLIENT_ABORTED') {
            return;
          }
          throw err;
        });

        if (options?.signal?.aborted) {
          return;
        }
      }

      const isLast = i === tokens.length - 1;
      yield {
        text: tokens[i],
        isFinished: isLast,
        finishReason: isLast ? 'stop' : undefined,
      };
    }
  }
}
