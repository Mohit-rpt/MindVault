# MindVault — Architecture Planner & Project Blueprint

**Project Name:** MindVault  
**Project Type:** AI-Powered Personal Knowledge Operating System  
**Architecture Style:** Modular Monolith + Background Workers  
**Development Approach:** Local-First, Provider-Agnostic, Evidence-Grounded  
**Status:** Planning & Architecture Phase  
**Version:** 1.0

---

# 1. Project Overview

## 1.1 What is MindVault?

MindVault is an AI-powered personal knowledge operating system that allows users to collect, organize, understand, connect, search, and interact with their knowledge.

Instead of simply uploading documents and asking questions, MindVault aims to transform disconnected information into a connected, searchable, and continuously useful knowledge system.

Users can provide:

- PDF documents
- Text files and Markdown notes
- Word documents
- Websites and web pages
- Source code and technical documentation
- Images and scanned documents
- Personal notes and conversations

MindVault processes this information, extracts meaningful content, generates embeddings, builds searchable indexes, identifies relationships, and makes the knowledge accessible through an AI interface.

## 1.2 Core Vision

**Build an AI system that doesn't just retrieve information — it understands the user's knowledge, remembers its sources, connects related concepts, and helps the user reason across information.**

## 1.3 Product Philosophy

1. Knowledge belongs to the user.
2. Every important AI answer should be traceable to evidence.
3. The system should admit when it does not know something.
4. User data should remain private and controllable.
5. AI providers should be replaceable.
6. Expensive operations should run asynchronously.
7. Every major feature should be measurable and testable.
8. The architecture should support future expansion without unnecessary complexity.

---

# 2. Project Objectives

## Primary Objectives

- Build a personal knowledge management system.
- Implement a complete Retrieval-Augmented Generation (RAG) pipeline.
- Support document ingestion and processing.
- Implement semantic and keyword-based search.
- Generate AI answers using retrieved evidence.
- Provide accurate source citations.
- Maintain document versions and provenance.
- Support local and hosted AI providers.
- Build a foundation for Graph RAG and agentic workflows.

## Long-Term Objectives

- Knowledge graph construction.
- Long-term memory management.
- Multimodal document understanding.
- Autonomous research workflows.
- Multi-agent orchestration.
- Intelligent knowledge discovery.
- Personalized AI assistance.

---

# 3. Functional Requirements

## 3.1 User Management

- User registration and login.
- Secure authentication.
- Personal workspace.
- Workspace-level data isolation.
- User-controlled data deletion.

## 3.2 Knowledge Management

- Upload documents.
- Create and edit notes.
- Organize information into collections.
- Search documents.
- View document processing status.
- Manage document versions.
- Delete and re-index documents.

## 3.3 AI Chat

- Ask questions about uploaded knowledge.
- Receive evidence-grounded answers.
- View citations and source references.
- Maintain conversation history.
- Support follow-up questions.
- Abstain when evidence is insufficient.

## 3.4 Intelligent Retrieval

- Vector similarity search.
- Full-text search.
- Hybrid retrieval.
- Metadata filtering.
- Result ranking and reranking.
- Query rewriting.
- Multi-document reasoning.

## 3.5 Advanced Intelligence

Planned for later releases:

- Entity extraction.
- Relationship extraction.
- Knowledge graph.
- Long-term memory.
- Graph-based retrieval.
- Agentic research.
- Multimodal understanding.

---

# 4. High-Level System Architecture

MindVault will initially use a modular monolith architecture.

This means the main application will have clearly separated internal modules instead of immediately introducing multiple independent microservices.

Background workers will handle expensive and asynchronous tasks.

## 4.1 Architecture Overview

User Interface
↓
React Frontend
↓
Node.js API Gateway
↓
Authentication & Authorization
↓
Application Services
├── User Management
├── Workspace Management
├── Document Management
├── Conversation Management
├── Search Service
├── RAG Orchestrator
├── Memory Service
└── Knowledge Graph Service
↓
Infrastructure Layer
├── PostgreSQL
├── pgvector
├── Redis
├── Object Storage
└── AI Provider Adapters

Background Processing:

API → Redis / BullMQ → Worker → Document Processing → Embeddings → Database

AI Processing:

User Query → Query Understanding → Retrieval → Ranking → Context Construction → LLM → Citation Verification → Response

---

# 5. Technology Stack

## 5.1 Frontend

| Technology      | Purpose                             |
| --------------- | ----------------------------------- |
| React           | User interface                      |
| TypeScript      | Type safety                         |
| Vite            | Development and build tooling       |
| Tailwind CSS    | Styling                             |
| React Router    | Navigation                          |
| TanStack Query  | Server-state management             |
| Zustand         | Lightweight client-state management |
| Socket.IO / SSE | Streaming and processing updates    |

## 5.2 Backend

| Technology      | Purpose                   |
| --------------- | ------------------------- |
| Node.js         | Runtime                   |
| TypeScript      | Backend language          |
| Express.js      | API framework             |
| Zod             | Input validation          |
| Prisma          | Database access           |
| Socket.IO / SSE | Real-time updates         |
| BullMQ          | Background job processing |

## 5.3 Database and Infrastructure

| Technology     | Purpose                              |
| -------------- | ------------------------------------ |
| PostgreSQL     | Primary database                     |
| pgvector       | Vector storage and similarity search |
| Redis          | Cache, queues, temporary state       |
| Object Storage | Original document storage            |
| Docker Compose | Local infrastructure                 |

Initially, local filesystem storage may be used during development. An S3-compatible storage adapter can be introduced later.

## 5.4 AI Layer

| Component          | Responsibility                     |
| ------------------ | ---------------------------------- |
| LLM Provider       | Answer generation                  |
| Embedding Provider | Vector generation                  |
| Reranker           | Retrieval result ranking           |
| Vision Provider    | Image and document understanding   |
| OCR Engine         | Text extraction from scanned files |

Provider adapters will support local and hosted models.

Initial local AI integration: Ollama.

Hosted providers can be added through separate adapters without changing the core RAG pipeline.

## 5.5 Testing

- Vitest: Unit testing.
- Supertest: API testing.
- Integration tests: Database and infrastructure.
- Playwright: End-to-end testing.
- RAG evaluation datasets: Retrieval and answer quality.

---

# 6. Repository Structure

Planned monorepo structure:

mindvault/
│
├── apps/
│ ├── web/
│ │ └── React + TypeScript frontend
│ │
│ ├── api/
│ │ └── Express + TypeScript backend
│ │
│ └── worker/
│ └── Background job processor
│
├── packages/
│ ├── rag-engine/
│ │ ├── ingestion/
│ │ ├── extraction/
│ │ ├── chunking/
│ │ ├── embeddings/
│ │ ├── retrieval/
│ │ ├── reranking/
│ │ ├── generation/
│ │ └── evaluation/
│ │
│ ├── ai-providers/
│ │ ├── llm/
│ │ ├── embeddings/
│ │ ├── rerankers/
│ │ └── vision/
│ │
│ ├── graph-engine/
│ ├── memory-engine/
│ ├── shared/
│ └── config/
│
├── prisma/
│ ├── schema.prisma
│ └── migrations/
│
├── infrastructure/
│ ├── docker/
│ └── scripts/
│
├── tests/
│ ├── integration/
│ ├── e2e/
│ └── benchmarks/
│
├── docs/
│ ├── ARCHITECTURE_PLANNER.md
│ ├── API_DESIGN.md
│ ├── DATABASE_DESIGN.md
│ ├── RAG_PIPELINE.md
│ └── SECURITY_MODEL.md
│
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
├── .env.example
├── .gitignore
└── README.md

Note: The structure is the target architecture. We will create folders when their implementation phase begins, rather than generating empty folders for every future feature.

---

# 7. Database Architecture

PostgreSQL will be the primary database.

pgvector will store and search embeddings.

## 7.1 Core Entities

| Entity            | Responsibility                      |
| ----------------- | ----------------------------------- |
| users             | User accounts                       |
| workspaces        | Personal or shared knowledge spaces |
| workspace_members | Workspace access                    |
| collections       | Document organization               |
| documents         | Document metadata                   |
| document_versions | Version history                     |
| chunks            | Extracted text segments             |
| embeddings        | Vector representations              |
| conversations     | Chat sessions                       |
| messages          | User and AI messages                |
| citations         | Evidence references                 |
| entities          | Extracted knowledge entities        |
| relationships     | Connections between entities        |
| memories          | Long-term knowledge and preferences |
| memory_sources    | Memory provenance                   |
| jobs              | Background processing records       |
| evaluations       | RAG evaluation results              |
| audit_logs        | Security and activity records       |

## 7.2 Important Database Principles

1. Every document belongs to a workspace.
2. Every document version has a unique identity.
3. Every chunk belongs to a document version.
4. Every embedding belongs to a specific chunk.
5. Every citation references the exact source chunk and version.
6. Workspace permissions must be enforced in database queries.
7. Document deletion must support removing associated indexes and derived data.
8. Important AI-generated memories must preserve their source and confidence.
9. Database migrations must be version-controlled.

pgvector-specific operations may require custom SQL migrations or parameterized SQL queries alongside Prisma.

---

# 8. Document Ingestion Pipeline

Document ingestion converts unstructured files into searchable knowledge.

## Workflow

User Upload
↓
File Validation
↓
Secure File Storage
↓
Create Document Record
↓
Create Background Job
↓
Text Extraction
↓
Text Cleaning and Normalization
↓
Metadata Extraction
↓
Semantic Chunking
↓
Embedding Generation
↓
Vector and Keyword Indexing
↓
Processing Status Update
↓
Document Ready

## 8.1 Supported Initial Formats

MVP:

- PDF
- TXT
- Markdown

Future:

- DOCX
- HTML
- Websites
- Source code
- Images
- Scanned PDFs
- Tables and other multimodal content

## 8.2 Chunking Strategy

Chunking should preserve meaningful context.

Each chunk should contain:

- Chunk ID
- Document ID
- Document version ID
- Chunk text
- Chunk index
- Page number, where available
- Heading or section
- Token count
- Metadata
- Embedding reference

Initial strategy:

- Heading-aware chunking.
- Paragraph-aware boundaries.
- Configurable chunk size.
- Controlled overlap.
- Preservation of page and source metadata.

Avoid splitting meaningful sentences or sections unnecessarily.

## 8.3 Background Processing

BullMQ will manage asynchronous jobs.

Requirements:

- Retry failed jobs.
- Prevent duplicate processing.
- Track processing status.
- Support job cancellation where practical.
- Preserve failure details.
- Make processing resumable.
- Avoid repeating successful extraction when only embedding generation fails.

---

# 9. RAG Architecture

RAG is the central intelligence engine of MindVault.

## 9.1 Basic RAG Workflow

User Question
↓
Query Processing
↓
Embedding Generation
↓
Vector Search
↓
Relevant Chunks
↓
Context Construction
↓
LLM Generation
↓
Citation Validation
↓
Final Answer

## 9.2 Retrieval Architecture

The retrieval system will gradually evolve.

### Level 1: Vector Retrieval

- Convert query into an embedding.
- Search similar document chunks.
- Retrieve top-K results.

### Level 2: Hybrid Retrieval

Run two searches:

1. Semantic vector search.
2. PostgreSQL full-text search.

Combine results using Reciprocal Rank Fusion (RRF).

### Level 3: Advanced Retrieval

- Query rewriting.
- Query decomposition.
- Metadata filtering.
- Cross-encoder reranking.
- Context compression.
- Multi-hop retrieval.
- Graph-based retrieval.

## 9.3 Answer Generation

The generation layer receives:

- User query.
- Retrieved evidence.
- Source metadata.
- Conversation context.
- System instructions.

The model must:

1. Answer using retrieved evidence.
2. Avoid unsupported claims.
3. Attach citations to relevant claims.
4. Distinguish facts from assumptions.
5. State when evidence is insufficient.

## 9.4 Citation Architecture

Each citation must identify:

- Document ID.
- Document version.
- Chunk ID.
- Page number, when available.
- Source location.
- Supporting text.

Citation verification should ensure that the cited source actually supports the associated claim.

---

# 10. AI Provider Architecture

MindVault must not depend on one AI provider.

Use provider interfaces and adapters.

Example:

AI Provider Interface
├── Ollama Adapter
├── OpenAI-Compatible Adapter
├── Other Hosted LLM Adapters
└── Future Provider Adapters

Separate interfaces will exist for:

- Text generation.
- Embedding generation.
- Reranking.
- Vision.
- OCR, where applicable.

## Provider Design Principles

- Provider independence.
- Configurable model selection.
- Environment-based credentials.
- Timeouts and retries.
- Error normalization.
- Token and cost tracking where available.
- No hardcoded API keys.
- Local-first development support.

---

# 11. Knowledge Graph Architecture

Knowledge Graph is a later-stage feature.

It will connect related entities and concepts across documents.

Example:

Document A → Mentions → Machine Learning

Machine Learning → Related To → Neural Networks

Neural Networks → Uses → Backpropagation

## Initial Implementation

Store graph entities and relationships in PostgreSQL.

Each relationship must preserve evidence linking it to its source document and chunk.

Future graph retrieval can identify connections that ordinary vector search may miss.

A specialized graph database will only be considered if actual scale and query requirements justify it.

---

# 12. Memory Architecture

MindVault will eventually support persistent knowledge about the user's work and interactions.

## Memory Categories

### Episodic Memory

Records events and interactions.

Example: A user completed a particular project phase.

### Semantic Memory

Stores established facts and concepts.

Example: A particular document defines a specific technical concept.

### Procedural Memory

Stores preferences and workflows.

Example: A user's preferred method of learning programming.

## Memory Principles

- Preserve source references.
- Track creation and update timestamps.
- Track confidence.
- Support corrections.
- Avoid converting every AI-generated statement into a trusted memory.
- Allow users to inspect and delete memories.
- Respect workspace and privacy boundaries.

---

# 13. Agentic AI Architecture

Agentic capabilities will be introduced only after the core RAG system is reliable.

Potential agents:

| Agent              | Responsibility                   |
| ------------------ | -------------------------------- |
| Query Planner      | Understands complex questions    |
| Retrieval Agent    | Finds relevant evidence          |
| Research Agent     | Performs structured research     |
| Graph Agent        | Explores knowledge relationships |
| Verification Agent | Checks answer grounding          |
| Memory Agent       | Proposes memory updates          |

## Agent Execution Workflow

User Intent
↓
Intent Classification
↓
Task Planning
↓
Permission and Safety Check
↓
Approved Tool Execution
↓
Evidence Collection
↓
Result Verification
↓
Final Response

Agents must operate through explicitly defined tools and permissions.

No unrestricted database access or uncontrolled autonomous actions.

---

# 14. Security and Privacy Architecture

Security is a core requirement, not a final feature.

## Security Requirements

- Password hashing.
- Secure authentication.
- Workspace-level authorization.
- Input validation.
- File type and size validation.
- Secure file storage.
- Rate limiting.
- Secret management.
- Audit logging.
- Private document access.
- Protected database queries.
- Safe error handling.

## RAG-Specific Security

Uploaded documents are untrusted data.

They may contain malicious prompt instructions.

Therefore:

1. Retrieved document text must never override system instructions.
2. Retrieved content must be treated as evidence, not executable instructions.
3. AI-generated tool calls require permission checks.
4. Workspace access must be validated during retrieval.
5. Citations must not expose inaccessible documents.
6. External providers should receive only the data required for the selected operation.

---

# 15. API Architecture

Initial API groups:

## Authentication

- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/logout
- GET /api/auth/me

## Workspaces

- GET /api/workspaces
- POST /api/workspaces
- GET /api/workspaces/:id

## Documents

- POST /api/documents/upload
- GET /api/documents
- GET /api/documents/:id
- DELETE /api/documents/:id
- POST /api/documents/:id/reindex

## Search

- POST /api/search
- GET /api/search/history

## Conversations

- POST /api/conversations
- GET /api/conversations
- GET /api/conversations/:id
- POST /api/conversations/:id/messages

## Jobs

- GET /api/jobs/:id
- GET /api/documents/:id/status

API contracts will be validated with Zod and documented as implementation progresses.

---

# 16. Development Roadmap

Development will happen in controlled phases.

Each phase must have working code, tests, and documented completion criteria.

## Phase 0 — Architecture and Foundation

- Finalize project architecture.
- Create repository.
- Configure monorepo.
- Configure TypeScript.
- Set up frontend and backend skeletons.
- Configure Docker Compose.
- Start PostgreSQL and Redis.
- Establish environment configuration.
- Configure linting and testing.

**Completion:** Project starts locally, infrastructure is healthy, and basic checks pass.

## Phase 1 — Authentication and Workspace

- User registration.
- Login and logout.
- Authentication middleware.
- Workspace creation.
- Authorization.
- Database schema.

**Completion:** Users can securely access their own workspace.

## Phase 2 — Document Ingestion

- Upload API.
- File validation.
- Secure storage.
- PDF/TXT/Markdown extraction.
- Chunking.
- Background job processing.
- Processing status.

**Completion:** Uploaded documents are extracted and converted into structured chunks.

## Phase 3 — Embeddings and Vector Search

- Embedding provider interface.
- Ollama integration.
- Embedding persistence.
- pgvector configuration.
- Similarity search.
- Metadata filtering.

**Completion:** Relevant document chunks can be retrieved using semantic queries.

## Phase 4 — Basic RAG Chat

- Chat interface.
- Query processing.
- Retrieval orchestration.
- Context construction.
- LLM provider integration.
- Answer generation.
- Source citations.
- Conversation history.

**Completion:** Users can ask questions about uploaded documents and receive grounded answers with citations.

## Phase 5 — Advanced Retrieval

- Hybrid search.
- Reciprocal Rank Fusion.
- Query rewriting.
- Reranking.
- Context compression.
- Retrieval evaluation.

**Completion:** Retrieval quality is measured and improved against a baseline.

## Phase 6 — Knowledge Graph

- Entity extraction.
- Relationship extraction.
- Graph storage.
- Source provenance.
- Graph retrieval.
- Multi-hop questions.

**Completion:** The system can retrieve evidence through relationships between concepts.

## Phase 7 — Multimodal Intelligence

- OCR.
- Scanned PDF processing.
- Image understanding.
- Table extraction.
- Multimodal embeddings where useful.

**Completion:** The knowledge system can process more than plain extracted text.

## Phase 8 — Memory and Agentic RAG

- Episodic memory.
- Semantic memory.
- Procedural memory.
- Query planning.
- Research workflows.
- Verification agent.
- Controlled tool execution.

**Completion:** MindVault can execute structured, permission-controlled research workflows.

## Phase 9 — Evaluation, Security and Deployment

- Retrieval benchmarks.
- Citation accuracy evaluation.
- Groundedness evaluation.
- Security testing.
- Performance optimization.
- Deployment.
- Monitoring.
- Documentation.

**Completion:** MindVault is reliable, measurable, secure, and deployable.

---

# 17. Testing and Evaluation Strategy

MindVault must be evaluated using actual test datasets.

## Retrieval Metrics

- Recall@K
- Precision@K
- Mean Reciprocal Rank (MRR)
- Normalized Discounted Cumulative Gain (NDCG)

## Answer Quality

- Faithfulness.
- Answer relevance.
- Citation accuracy.
- Evidence coverage.
- Abstention correctness.

## System Performance

- Upload processing time.
- Embedding generation time.
- Retrieval latency.
- Answer generation latency.
- Job failure rate.
- Resource consumption.

Every major retrieval improvement should be compared against the previous baseline using the same evaluation questions and expected evidence.

No benchmark result should be presented as real unless it has actually been measured.

---

# 18. Important Engineering Decisions

| Decision         | Initial Choice                       | Reason                                    |
| ---------------- | ------------------------------------ | ----------------------------------------- |
| Architecture     | Modular monolith                     | Lower complexity                          |
| Frontend         | React + TypeScript                   | Maintainable UI                           |
| Backend          | Node.js + TypeScript                 | Unified development stack                 |
| Database         | PostgreSQL                           | Relational data and search                |
| Vector database  | pgvector                             | Integrated vector retrieval               |
| Cache and queues | Redis                                | Background processing                     |
| Job processing   | BullMQ                               | Retryable asynchronous jobs               |
| ORM              | Prisma + custom SQL                  | Structured access and vector operations   |
| AI integration   | Provider adapters                    | Avoid vendor lock-in                      |
| Local AI         | Ollama                               | Local-first development                   |
| Storage          | Local initially, S3-compatible later | Simple development and future scalability |
| Deployment       | Docker-based                         | Reproducible infrastructure               |

Python microservices and specialized databases are not required for the initial MVP. They can be introduced when a measurable technical requirement justifies them.

---

# 19. Hardware and Development Constraints

Initial development environment:

- Windows 11.
- 8 GB RAM.
- Intel Core i3, 11th generation.
- VS Code.

Development must remain resource-conscious.

Rules:

- Run PostgreSQL and Redis through Docker.
- Run frontend, API, and worker locally during development.
- Avoid unnecessarily large local AI models.
- Keep document-processing jobs controlled.
- Use small test datasets initially.
- Avoid running all resource-heavy services simultaneously.
- Support hosted AI providers as an alternative to local inference.

---

# 20. Definition of MVP Success

The first complete MindVault MVP is successful when:

1. A user can register and log in.
2. A user can create a personal workspace.
3. A user can upload PDF, TXT, and Markdown files.
4. Documents are processed asynchronously.
5. Extracted text is divided into meaningful chunks.
6. Embeddings are generated and stored.
7. Users can perform semantic search.
8. Users can ask questions about their documents.
9. Answers are grounded in retrieved evidence.
10. Citations identify the correct document and source location.
11. Conversations can be revisited.
12. The system can admit when evidence is insufficient.

The MVP does not require autonomous agents, a knowledge graph, or multimodal processing.

---

# 21. Non-Negotiable Development Rules

1. Understand the architecture before implementing a feature.
2. Build one phase at a time.
3. Do not introduce unnecessary technologies.
4. Keep modules independent and maintainable.
5. Use TypeScript types and runtime validation.
6. Never hardcode API keys or secrets.
7. Every important feature must have tests.
8. Every database change must use migrations.
9. Background jobs must be retryable and safe against duplicate processing.
10. Preserve document provenance and citation accuracy.
11. Enforce permissions inside backend and database operations.
12. Document significant architecture changes.
13. Never claim a feature works until it has been tested.
14. Maintain a working application at the end of each phase.

---

# 22. Project Execution Workflow

Every feature will follow this development cycle:

**Step 1 — Understand**

Understand the problem and why the feature is needed.

**Step 2 — Design**

Define architecture, interfaces, data flow, and dependencies.

**Step 3 — Plan**

Break the feature into small implementation tasks.

**Step 4 — Implement**

Write clean, modular, maintainable code.

**Step 5 — Test**

Run unit, integration, and relevant end-to-end tests.

**Step 6 — Verify**

Confirm that the feature works in the actual application.

**Step 7 — Document**

Update project documentation and architecture decisions.

**Step 8 — Mark Complete**

Record the implementation status and move to the next task.

No phase should be marked complete merely because its code has been written.

---

# 23. Final Project Vision

MindVault starts as a personal RAG-based knowledge management system.

It gradually evolves into a connected intelligence platform that can:

- Understand personal knowledge.
- Search across different information sources.
- Connect related concepts.
- Remember useful information with provenance.
- Perform multi-step research.
- Verify its own answers.
- Support multiple AI providers.
- Work locally or through hosted infrastructure.

**The ultimate goal is not to build another chatbot. The goal is to build a trustworthy AI knowledge operating system.**

---

**Document Status:** Initial Architecture Blueprint  
**Current Development Phase:** Phase 0 — Foundation  
**Next Milestone:** Repository Setup and Infrastructure Foundation
