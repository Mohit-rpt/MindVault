# MindVault — Phase 4 LLM Provider Design

**Date:** 2026-11-06  
**Status:** Implemented & Verified  
**Scope:** Model Provider Abstraction, Ollama Integration, Mock Provider, and Factory Architecture

---

## 1. Provider Abstraction Contract

MindVault enforces strict decoupling between the RAG business logic and external model execution runtimes. The model layer conforms to the `LLMProvider` contract defined in [`packages/shared/src/types.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/packages/shared/src/types.ts#L410):

```typescript
export interface LLMStreamChunk {
  text: string;
  isDone?: boolean;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;

  generate(
    systemPrompt: string,
    userPrompt: string,
    options?: {
      temperature?: number;
      topP?: number;
      maxTokens?: number;
      abortSignal?: AbortSignal;
    },
  ): Promise<{
    text: string;
    tokensGenerated: number;
    latencyMs: number;
  }>;

  generateStream(
    systemPrompt: string,
    userPrompt: string,
    options?: {
      temperature?: number;
      topP?: number;
      maxTokens?: number;
      abortSignal?: AbortSignal;
    },
  ): AsyncIterable<LLMStreamChunk>;
}
```

### Key Design Tenets

1. **Separation from Embeddings:** MindVault uses `nomic-embed-text` exclusively for embeddings (768 dimensions). The generative model (`qwen3:0.6b` / `qwen3:1.7b`) is invoked only during RAG generation.
2. **First-Class Streaming:** Both non-streaming batch completion and asynchronous streaming chunk iterables are mandated.
3. **Cancellation & Abort Signals:** All provider calls accept an optional `AbortSignal` to terminate backend execution when HTTP clients disconnect.
4. **Deterministic Token Metrics:** Output token counts and timing metrics are captured directly from provider response telemetry.

---

## 2. Production Provider: `OllamaProvider`

The [`OllamaProvider`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/providers/ollama.provider.ts) interfaces with locally running or containerized Ollama servers via standard HTTP endpoints:

### Endpoints and Payload Structure

- **Endpoint:** `POST {baseUrl}/api/generate`
- **Request Payload:**
  ```json
  {
    "model": "qwen3:0.6b",
    "prompt": "<system_instructions>\n\n<context_and_query>",
    "stream": true,
    "options": {
      "temperature": 0.2,
      "top_p": 0.9,
      "num_predict": 1024
    }
  }
  ```

### NDJSON Stream Processing

Ollama emits newline-delimited JSON (NDJSON) chunks:

```json
{"model":"qwen3:0.6b","created_at":"...","response":"Back","done":false}
{"model":"qwen3:0.6b","created_at":"...","response":"propagation","done":false}
{"model":"qwen3:0.6b","created_at":"...","response":"","done":true,"eval_count":168,"eval_duration":1985220000}
```

The streaming parser processes raw binary byte chunks using `TextDecoderStream`, buffers partial lines across TCP window boundaries, parses completed JSON objects, and yields text tokens to the caller immediately. When `done: true` is encountered, the generator yields the final chunk and terminates.

---

## 3. Test Provider: `MockLLMProvider`

The [`MockLLMProvider`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/providers/mock.provider.ts) provides a zero-latency, deterministic, offline-capable environment for unit testing, integration testing, and CI pipelines without requiring a running Ollama daemon:

### Deterministic Response Strategies

1. **Corpus Evidence Extraction:** Detects source markers (`[S1]`, `[S2]`) in the formatted prompt. When valid sources exist, it synthesizes an evidence-grounded answer citing the available sources:
   ```text
   Based on the provided documentation [S1], MindVault provides deterministic hybrid retrieval.
   ```
2. **Missing Evidence Protocol:** Detects queries lacking corpus grounding (e.g., questions regarding starships, culinary recipes, or out-of-domain knowledge) and generates an explicit refusal:
   ```text
   I cannot find sufficient evidence in the provided documents to answer your question.
   ```
3. **Adversarial Injection Containment:** Detects prompt injection attempts (e.g., `"IGNORE ALL PREVIOUS INSTRUCTIONS"`) and safely ignores them, refusing to disclose system instructions.
4. **Simulated Streaming:** Emits response words with configurable simulated delays (`chunkDelayMs: 0` for fast tests).

---

## 4. Provider Factory & Lifecycle Management

[`LLMProviderFactory`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/providers/provider.factory.ts) manages provider initialization and lifecycle:

```typescript
export class LLMProviderFactory {
  private static instance: LLMProvider | null = null;

  public static getProvider(): LLMProvider {
    if (!this.instance) {
      if (env.LLM_PROVIDER === 'mock') {
        this.instance = new MockLLMProvider();
      } else if (env.LLM_PROVIDER === 'ollama') {
        this.instance = new OllamaProvider({
          baseUrl: env.OLLAMA_BASE_URL,
          model: env.LLM_MODEL,
        });
      }
    }
    return this.instance;
  }

  public static setProvider(provider: LLMProvider): void {
    this.instance = provider;
  }

  public static resetProvider(): void {
    this.instance = null;
  }
}
```

This singleton pattern ensures that integration tests can dynamically inject `MockLLMProvider` via `LLMProviderFactory.setProvider(...)` and reset the environment cleanly in `afterEach()` hooks without affecting other test suites.
