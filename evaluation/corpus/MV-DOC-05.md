# Infrastructure Configuration Reference: Environment Directives

**Document Identifier:** MV-DOC-05 | **Version:** 2.1 | **Classification:** Systems Architecture

## 1. Database and Pool Connection Bounds

DB_POOL_MAX=20 # Maximum concurrent connections per API gateway instance
DB_TIMEOUT_MS=5000 # Database query execution timeout in milliseconds
WORKER_CONCURRENCY=5 # Concurrent background jobs processed per worker node

## 2. Document Payload Boundaries and Extractor Handling

MAX_FILE_SIZE_BYTES=26214400 # 25 Megabytes absolute payload boundary
Extractor error marks document FAILED with errorMessage in PostgreSQL documents table.

## 3. Knowledge Graph Traversal Timeouts and Loop Guards

GRAPH_TIMEOUT_MS=2500 and visited set evaluation prevent cyclic loops during multi-hop path traversal. Multi-hop queries abort after 2500ms to preserve generation response budgets.

## 4. Retrieval Channel Weights and Thresholds

SIMILARITY_FLOOR=0.65 # Minimum cosine similarity required for vector chunk survival
FTS_WEIGHT=1.0 # Multiplier weight for PostgreSQL full-text search channel
