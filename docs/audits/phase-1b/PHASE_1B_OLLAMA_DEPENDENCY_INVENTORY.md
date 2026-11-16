# MindVault — Repository-Wide Ollama Dependency Inventory
## Complete Inventory of Ollama, Qwen3, and Nomic-Embed-Text References

**Document Version:** 1.0.0  
**Status:** COMPLETE AUDIT  
**Date:** November 16, 2026  
**Total Identified Occurrences:** 82 distinct code/configuration/script locations across 27 source files

---

## 1. Application Layer: API Gateway (`apps/api`)

| File Path | Function / Block | Current Purpose | Proposed Gemini Replacement / Action |
| :--- | :--- | :--- | :--- |
| `apps/api/src/config/env.ts` (L64-66) | `envSchema` | Defines `LLM_PROVIDER` default (`'ollama'`), `OLLAMA_BASE_URL` (`http://localhost:11434`), and `OLLAMA_GENERATION_MODEL` (`qwen3:0.6b`). | Update `LLM_PROVIDER` default to `'gemini'`. Mark `OLLAMA_*` as deprecated/optional or remove. Add `GEMINI_EMBEDDING_MODEL` default (`gemini-embedding-001`). |
| `apps/api/src/modules/generation/providers/ollama.provider.ts` (Full File) | `OllamaProvider` class | Implements `LLMProvider` using Ollama `/api/generate` with NDJSON streaming. | Deprecate and remove. Default all generative RAG queries to `GeminiProvider`. |
| `apps/api/src/modules/generation/providers/provider.factory.ts` (L22, 33-35) | `LLMProviderFactory.getProvider` | Instantiates `OllamaProvider` when `providerType === 'ollama'` or default. | Change fallback to `GeminiProvider`. Remove `OllamaProvider` instantiation. |
| `apps/api/src/modules/retrieval/embeddings/embedding.service.ts` (L48-122) | `OllamaEmbeddingProvider` | Generates 768d query vector embeddings via Ollama `/api/embeddings`. | Replace with `GeminiEmbeddingProvider` using `@google/genai` `ai.models.embedContent` (`outputDimensionality: 768`). |
| `apps/api/src/modules/retrieval/embeddings/embedding.service.ts` (L135) | `EmbeddingService.getProvider` | Instantiates `OllamaEmbeddingProvider` for non-test runtime. | Instantiate `GeminiEmbeddingProvider` for live mode. |
| `apps/api/src/modules/graph/providers/ollama-extraction.provider.ts` (Full File) | `OllamaExtractionProvider` | Implements `IKnowledgeExtractionProvider` for entity/relation extraction via Ollama. | Deprecate and remove. Standardize on `GeminiExtractionProvider`. |
| `apps/api/src/modules/graph/providers/provider.factory.ts` (L15-28) | `getExtractionProvider` | Fallback logic selects `OllamaExtractionProvider`. | Default to `GeminiExtractionProvider`. Remove Ollama branch. |
| `apps/api/src/modules/graph/evaluation/graph-extraction.eval.runner.ts` (L17, 287-302) | CLI Evaluation Benchmark | Runs extraction eval with `--live-ollama`. | Update CLI flag to `--live-gemini` evaluating `GeminiExtractionProvider`. |
| `apps/api/src/modules/generation/providers/llm.provider.test.ts` (L159) | Unit Test | Asserts fallback model name `mock-qwen-768`. | Update mock model name to `mock-gemini-flash`. |
| `apps/api/src/modules/graph/__tests__/ollama-extraction.provider.test.ts` (Full File) | Unit Tests | Tests Ollama extraction options and parameters (`think`, `temperature`). | Retain as legacy mock test or replace with `gemini-extraction.provider.test.ts`. |

---

## 2. Application Layer: Background Worker (`apps/worker`)

| File Path | Function / Block | Current Purpose | Proposed Gemini Replacement / Action |
| :--- | :--- | :--- | :--- |
| `apps/worker/src/config/env.ts` (L46-49) | `envSchema` | Defines `EMBEDDING_MODEL` (`nomic-embed-text`), `LLM_PROVIDER` (`'ollama'`), `OLLAMA_BASE_URL` (`http://127.0.0.1:11434`), and `OLLAMA_GENERATION_MODEL` (`qwen3:0.6b`). | Update `EMBEDDING_MODEL` default to `gemini-embedding-001`. Update `LLM_PROVIDER` default to `gemini`. Remove obsolete Ollama variables. |
| `apps/worker/src/lib/ollama-validator.ts` (Full File) | `validateOllamaEnvironment` | Probes `http://127.0.0.1:11434/api/tags` to check if Ollama is running and models exist. | Replace with `validateGeminiEnvironment` (verifying `GEMINI_API_KEY` validity via `client.models.list()`). |
| `apps/worker/src/worker.ts` (L24, 276-297) | `WorkerService.start` | Runs startup preflight checking local Ollama status. | Replace with Gemini credential and API connectivity check. |
| `apps/worker/src/modules/ingestion/embeddings/ollama.provider.ts` (Full File) | `OllamaEmbeddingProvider` | Worker embedding provider calling Ollama `/api/embeddings` in batches. | Replace with `GeminiEmbeddingProvider` calling `ai.models.embedContent` with `outputDimensionality: 768`. |
| `apps/worker/src/modules/ingestion/embeddings/index.ts` (L2, 27, 43-49) | `createEmbeddingProvider` | Factory defaulting to `OllamaEmbeddingProvider`. | Default to `GeminiEmbeddingProvider`. |
| `apps/worker/src/modules/graph/providers/ollama-extraction.provider.ts` (Full File) | `OllamaExtractionProvider` | Worker graph extraction provider calling Ollama `/api/generate`. | Deprecate and remove. Worker will use existing `GeminiExtractionProvider`. |
| `apps/worker/src/modules/graph/providers/provider.factory.ts` (L15-28) | Extraction Provider Factory | Factory defaulting to `OllamaExtractionProvider`. | Default to `GeminiExtractionProvider`. |
| `apps/worker/src/modules/ingestion/embeddings/embeddings.test.ts` (L64-75) | Factory Test | Tests `createEmbeddingProvider({ provider: 'ollama' })`. | Update test to verify `provider: 'gemini'`. |
| `apps/worker/src/modules/graph/__tests__/extraction-error.classifier.test.ts` (L77, 99) | Error Classification Test | Tests classification of "Ollama extraction timed out" and "Upstream Ollama is offline". | Update test fixtures to simulate Gemini 429 (`RESOURCE_EXHAUSTED`) and 503 errors. |

---

## 3. Frontend Web Client (`apps/web`)

| File Path | Function / Block | Current Purpose | Proposed Gemini Replacement / Action |
| :--- | :--- | :--- | :--- |
| `apps/web/src/components/assistant/ChatComposer.tsx` (L252) | UI Tooltip | Displays tooltip `"Local Ollama Qwen3: 100% private offline"`. | Update tooltip to reflect cloud AI or generic model badge (e.g. `"Google Gemini 2.5 Flash"`). |
| `apps/web/src/components/settings/SettingsModal.tsx` (L359) | UI Settings Dropdown | Hardcoded option listing `qwen3:0.6b` and local Ollama toggle. | Replace model options with Gemini models (`gemini-2.5-flash`, `gemini-3.5-flash`). Remove local Ollama toggle. |

---

## 4. Shared Contracts & Package Configuration (`packages/shared` & `packages/config`)

| File Path | Function / Block | Current Purpose | Proposed Gemini Replacement / Action |
| :--- | :--- | :--- | :--- |
| `packages/shared/src/types.ts` (L657) | `ChatSessionDtoSchema` | `provider: z.enum(['ollama', 'gemini']).optional()`. | Expand enum to retain `'gemini'`, deprecate `'ollama'` or allow historical `'ollama'` with `'gemini'` as default. |
| `packages/shared/src/types.ts` (L269-274) | `EmbeddingProvider` Interface | Defines `generateEmbedding` and `generateEmbeddings`. | No change required (interface is already model-agnostic). |

---

## 5. Scripts, Diagnostic Tools & Evaluation Harness

| File Path | Function / Block | Current Purpose | Proposed Gemini Replacement / Action |
| :--- | :--- | :--- | :--- |
| `scripts/verify-worker-preflight.ts` (L8, 257-320) | Step `[4/5]` | Checks Ollama online at port 11434, checks `nomic-embed-text` and `qwen3:0.6b`. | Replace step with `[4/5] Checking Google Gemini API Readiness...` verifying `GEMINI_API_KEY`, API quota, and embedding model availability. |
| `scripts/verify-demo-environment.ts` (L8, 334-430, 689) | `checkOllama` | Diagnostic probe checking Ollama connectivity and models. | Deprecate `checkOllama` or replace with `checkGeminiAPI` ensuring `GEMINI_API_KEY` is active. |
| `scripts/start-local-worker.ps1` (L8, 49-62, 83-84) | PowerShell Script | Step 1 checks `http://127.0.0.1:11434/api/tags`. Sets `$env:OLLAMA_BASE_URL`. | Remove Ollama probe. Verify `$env:GEMINI_API_KEY` is present instead. |
| `evaluation/harness/eval-config.ts` (L27, 34) | Benchmark Configuration | Configures `embeddingModel: 'nomic-embed-text'` and `qwen3:0.6b`. | Update benchmark configuration to use `gemini-embedding-001` and `gemini-2.5-flash`. |
| `evaluation/harness/eval-ingestion-runner.ts` (L49) | Ingestion Runner | Helper generating embeddings via local Ollama `nomic-embed-text`. | Update helper to call `GeminiEmbeddingProvider`. |
| `evaluation/harness/eval-generation-runner.ts` (L4) | Generation Runner | Runs live inference against `qwen3:0.6b`. | Update to run evaluation against Gemini Flash. |

---

## 6. Root Integration Tests (`tests/`)

| File Path | Test Suite | Current Purpose | Proposed Gemini Replacement / Action |
| :--- | :--- | :--- | :--- |
| `tests/local-worker-runtime.test.ts` (L2, 22-85) | `Ollama Environment Validator` | Mock tests for `validateOllamaEnvironment` checking port 11434, missing models, and remediation commands. | Replace test suite with `Gemini Environment Validator` checking API key verification and error states. |
| `tests/verify-demo-environment.test.ts` (L10, 61-90, 136, 181, 226) | `Ollama Diagnostic Checks` | Unit tests asserting behavior of `checkOllama` (SKIP, WARN, PASS). | Replace test assertions with Gemini API diagnostic tests. |

---

## 7. Environment & Configuration Files

| File Path | Variable / Block | Current Purpose | Proposed Gemini Replacement / Action |
| :--- | :--- | :--- | :--- |
| `.env.example` (L98-112) | Phase 4 Configuration | Documents `OLLAMA_BASE_URL=http://localhost:11434`, `OLLAMA_GENERATION_MODEL=qwen3:0.6b`, `EMBEDDING_MODEL=nomic-embed-text`. | Remove `OLLAMA_*` variables. Set `LLM_PROVIDER=gemini`, `GEMINI_MODEL=gemini-2.5-flash`, `EMBEDDING_MODEL=gemini-embedding-001`. |
| `.env` | Active Local Environment | Contains developer local config. | *(Read-only rule strictly maintained)* Migration guide will advise adding `GEMINI_API_KEY` and updating `LLM_PROVIDER=gemini`. |

---

## 8. Summary of Deprecation Impact

* **Files to Delete (Dead Code Removal upon implementation):**
  1. `apps/api/src/modules/generation/providers/ollama.provider.ts`
  2. `apps/api/src/modules/graph/providers/ollama-extraction.provider.ts`
  3. `apps/worker/src/lib/ollama-validator.ts`
  4. `apps/worker/src/modules/ingestion/embeddings/ollama.provider.ts`
  5. `apps/worker/src/modules/graph/providers/ollama-extraction.provider.ts`
* **Files to Create (New Gemini Providers):**
  1. `packages/shared/src/gemini/gemini-embedding.provider.ts` (Shared implementation for API and Worker)
* **Files to Update:**
  * Provider factories (`apps/api` and `apps/worker`)
  * Environment schemas (`apps/api` and `apps/worker`)
  * Diagnostics & scripts (`verify-worker-preflight.ts`, `start-local-worker.ps1`, `verify-demo-environment.ts`)
  * Frontend settings & composer UI components
