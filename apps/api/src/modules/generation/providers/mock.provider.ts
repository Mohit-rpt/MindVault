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
    _options?: LLMGenerateOptions,
  ): AsyncIterable<LLMStreamChunk> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    const text = this.generateDeterministicResponse(prompt);
    // Break into deterministic word tokens
    const tokens = text.match(/\S+|\s+/g) || [text];

    for (let i = 0; i < tokens.length; i++) {
      if (this.streamDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.streamDelayMs));
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
