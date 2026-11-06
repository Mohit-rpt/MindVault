-- MindVault Phase 3: Full-Text Search Migration
-- Adds PostgreSQL text search indexing and tsvector capabilities for DocumentChunk

-- 1. Add generated tsvector column for fast full-text searching (stored and auto-updated on insert/update)
ALTER TABLE "document_chunks" 
ADD COLUMN IF NOT EXISTS "search_vector" tsvector 
GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;

-- 2. Create GIN index on search_vector column for sub-millisecond keyword lookup
CREATE INDEX IF NOT EXISTS "document_chunks_search_vector_idx" 
ON "document_chunks" USING gin ("search_vector");

-- 3. Create functional GIN index directly on to_tsvector('english', content) for queries using expression matching
CREATE INDEX IF NOT EXISTS "document_chunks_content_fts_idx" 
ON "document_chunks" USING gin (to_tsvector('english', "content"));
