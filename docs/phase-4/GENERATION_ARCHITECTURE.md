# MindVault — Phase 4 Generation Architecture

**Date:** 2026-11-06  
**Status:** Implemented & Verified  
**Scope:** Architecture, Component Decomposition, Data Flow, and Telemetry

---

## 1. Architectural Philosophy

MindVault Phase 4 transforms the retrieval platform into an evidence-grounded generative assistant. Rather than allowing a Large Language Model (LLM) to fabricate answers from its parameter weights or produce unverified claims, MindVault enforces an **evidence-first generation protocol**:

1. **Retrieval Precedes Generation:** An LLM is never invoked without prior execution of tenant-isolated hybrid retrieval.
2. **Zero-Evidence Short-Circuit:** When retrieval produces zero matching chunks, the pipeline refuses generation early, saving compute and preventing hallucinations.
3. **Structured Citation Anchoring:** The LLM is constrained to reference evidence chunks using explicit bracketed keys (`[S1]`, `[S2]`).
4. **Post-Generation Validation:** Output text is deterministically parsed by [`CitationValidatorService`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/services/citation-validator.service.ts) and evaluated by [`GroundingService`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/services/grounding.service.ts) before completion is signaled.
5. **Bidirectional Streaming Protocol:** Full Server-Sent Events (SSE) support delivers immediate token responsiveness to the user interface alongside structured source and telemetry metadata.

---

## 2. High-Level Component Decomposition

```mermaid
flowchart TD
    subgraph Frontend ["apps/web (KnowledgeAssistant)"]
        UI_Composer[ChatComposer]
        UI_Stream[StreamingAnswer]
        UI_Sources[SourcePanel]
        UI_Badge[GroundingBadge]
        UI_Telemetry[RAGTelemetry]
    end

    subgraph API ["apps/api (Express Gateway)"]
        Router["/api/rag Router"]
        AuthGuard[authenticateToken & requireWorkspaceMember]
        Controller[GenerationController]
    end

    subgraph GenerationModule ["apps/api/src/modules/generation"]
        RAGService[RAGService]
        PromptBuilder[Prompt Engineering Module]
        Validator[CitationValidatorService]
        Grounding[GroundingService]
        Factory[LLMProviderFactory]
    end

    subgraph RetrievalModule ["apps/api/src/modules/retrieval"]
        RetrievalSvc[RetrievalService]
        HybridEngine[HybridSearchEngine]
        ContextAsm[ContextAssembler]
    end

    subgraph Providers ["Model Execution Layer"]
        Ollama[OllamaProvider: qwen3:0.6b]
        Mock[MockLLMProvider: Unit & Eval]
    end

    UI_Composer -->|POST /api/rag/stream| Router
    Router --> AuthGuard
    AuthGuard --> Controller
    Controller --> RAGService
    RAGService -->|1. executeSearch| RetrievalSvc
    RetrievalSvc --> HybridEngine
    HybridEngine --> ContextAsm
    ContextAsm -->|Retrieved Context & Sources| RAGService
    RAGService -->|2. assemblePrompts| PromptBuilder
    RAGService -->|3. getProvider| Factory
    Factory --> Ollama
    Factory --> Mock
    Ollama -->|4. NDJSON Stream| RAGService
    RAGService -->|5. validateCitations| Validator
    RAGService -->|6. evaluateGrounding| Grounding
    RAGService -->|7. SSE Events: metadata, token, done| UI_Stream
    UI_Stream --> UI_Sources
    UI_Stream --> UI_Badge
    UI_Stream --> UI_Telemetry
```

---

## 3. End-to-End Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Browser
    participant API as GenerationController
    participant RAG as RAGService
    participant Search as RetrievalService
    participant LLM as OllamaProvider (qwen3:0.6b)
    participant Val as CitationValidator
    participant Gnd as GroundingService

    User->>API: POST /api/rag/stream { query, workspaceId, topK: 5 }
    Note over API: Authenticate & Authorize Workspace
    API->>RAG: streamAnswer(workspaceId, request, onChunk)

    rect rgb(240, 245, 255)
        Note over RAG,Search: Phase 1: Tenant Retrieval
        RAG->>Search: executeSearch(workspaceId, { query, topK: 5, includeContext: true })
        Search-->>RAG: SearchResponse (results, context, metadata)
    end

    RAG->>User: SSE Event: metadata { sources, retrievalMs, tokenEstimate }

    rect rgb(245, 255, 245)
        Note over RAG,LLM: Phase 2: Generation Stream
        RAG->>LLM: generateStream(systemPrompt, userPrompt, { temperature: 0.2 })
        loop Every Streamed Token
            LLM-->>RAG: LLMStreamChunk { text: "token " }
            RAG->>User: SSE Event: token { text: "token " }
        end
    end

    rect rgb(255, 248, 240)
        Note over RAG,Gnd: Phase 3: Post-Generation Validation
        RAG->>Val: validateCitations(fullAnswerText, context.sources)
        Val-->>RAG: CitationValidationResult (valid, unknown, unused)
        RAG->>Gnd: evaluateGrounding(fullAnswerText, citationResult, hasEvidence)
        Gnd-->>RAG: GroundingValidationResult (status, score, warnings)
    end

    RAG->>User: SSE Event: done { answer, citations, grounding, telemetry }
    User-->>User: Render verified sources and grounding badge
```

---

## 4. Telemetry Structure & Latency Attribution

Every non-streaming response and streaming `done` payload provides structured timing telemetry conforming to [`RAGTelemetryDto`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/packages/shared/src/types.ts):

| Field             | Type     | Description                                                                                                        |
| :---------------- | :------- | :----------------------------------------------------------------------------------------------------------------- |
| `retrievalMs`     | `number` | Time taken for query normalization, embedding generation, vector distance calculation, FTS ranking, and RRF fusion |
| `generationMs`    | `number` | Time taken for LLM prompt processing, inference, and response streaming                                            |
| `totalMs`         | `number` | Total wall-clock time from request ingress to response finalization                                                |
| `tokensGenerated` | `number` | Count of output tokens emitted by the LLM provider                                                                 |
| `provider`        | `string` | Identifier of active backend (e.g. `ollama`, `mock`)                                                               |
| `model`           | `string` | Concrete model version utilized (e.g. `qwen3:0.6b`, `mock-deterministic`)                                          |

---

## 5. Module File Structure

All Phase 4 backend generation components are encapsulated inside [`apps/api/src/modules/generation/`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation):

- [`generation.routes.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/generation.routes.ts): REST routing with JWT authentication and workspace membership middleware.
- [`generation.controller.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/generation.controller.ts): Input schema validation, SSE stream management, and HTTP error normalization.
- [`services/rag.service.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/services/rag.service.ts): High-level RAG orchestration, prompt binding, and validation coordination.
- [`services/citation-validator.service.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/services/citation-validator.service.ts): Deterministic regex citation parser and source cross-referencer.
- [`services/grounding.service.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/services/grounding.service.ts): Grounding status classifier and hallucination detector.
- [`prompts/system.prompt.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/prompts/system.prompt.ts): Strict evidence adherence instructions and anti-injection guards.
- [`prompts/rag.prompt.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/prompts/rag.prompt.ts): Contextual user prompt template with untrusted evidence boundaries.
- [`providers/llm.provider.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/providers/llm.provider.ts): Base interface contract.
- [`providers/ollama.provider.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/providers/ollama.provider.ts): Production Ollama HTTP & SSE client.
- [`providers/mock.provider.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/providers/mock.provider.ts): Deterministic mock provider for tests and benchmarking.
- [`providers/provider.factory.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/providers/provider.factory.ts): Singleton factory managing provider instances.
