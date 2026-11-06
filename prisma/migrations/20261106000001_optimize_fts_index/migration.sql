-- MindVault: Optimize Full-Text Search Index
-- Drops redundant expression index now that c."search_vector" column and GIN index are active

DROP INDEX IF EXISTS "document_chunks_content_fts_idx";
