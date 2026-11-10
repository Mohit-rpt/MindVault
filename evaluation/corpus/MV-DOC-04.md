# API Gateway Routing and Server-Sent Events Protocol Specification

**Document Identifier:** MV-DOC-04 | **Version:** 1.8 | **Classification:** Integration Protocol

## 1. Gateway Routing Architecture and Endpoints

The gateway dispatches incoming POST /api/rag/stream requests to RAGService. RAGService triggers RetrievalService on PostgreSQL document_chunks using hybrid vector and keyword channels. SSE stream lifecycle emits standard events: start -> retrieval_complete -> sources -> token* -> validation -> done.

## 2. Connection Heartbeat and Abort Lifecycle

The gateway dispatches a comment heartbeat (: ping) every 15 seconds to prevent intermediate proxy timeout. Client socket termination propagates an AbortSignal, terminating upstream LLM generators and marking the record CANCELLED.

## 3. Error Envelopes and Ingestion Format Boundaries

Supported extensions: .pdf, .docx, .txt, .md. Spreadsheets must be converted to Markdown tables. Error event envelope emits code FILE_TOO_LARGE and transitions document to FAILED when payload exceeds 25MB boundary.

## 4. Context Assembly Dual Budgeting Limits

Rate limit excess yields 429 Too Many Requests. ContextAssembler drops chunks exceeding maxContextTokens according to the 75% narrative floor and 25% graph ceiling policy. Chunks that do not fit within the token budget are omitted.
