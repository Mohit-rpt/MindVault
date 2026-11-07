-- =========================================================================
-- MindVault Migration: Phase 6.0 Knowledge Graph & Database Foundation
-- Multi-Tenant Composite Referential Integrity & Unified Alias Registry
-- =========================================================================

-- 1. Document-to-Workspace Referential Integrity & Compound Keys on Existing Tables
CREATE UNIQUE INDEX "documents_workspaceId_id_key" ON "documents"("workspaceId", "id");

ALTER TABLE "document_chunks" DROP CONSTRAINT IF EXISTS "document_chunks_documentId_fkey";

ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_workspaceId_documentId_fkey" 
    FOREIGN KEY ("workspaceId", "documentId") 
    REFERENCES "documents"("workspaceId", "id") 
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "document_chunks_workspaceId_id_key" ON "document_chunks"("workspaceId", "id");
CREATE UNIQUE INDEX "document_chunks_workspaceId_documentId_id_key" ON "document_chunks"("workspaceId", "documentId", "id");

-- 2. EntityType Enum
CREATE TYPE "EntityType" AS ENUM (
    'TECHNOLOGY',
    'CONCEPT',
    'PERSON',
    'ORGANIZATION',
    'PRODUCT',
    'LOCATION',
    'OTHER'
);

-- 3. Canonical Graph Entities
CREATE TABLE "graph_entities" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "entity_type" "EntityType" NOT NULL DEFAULT 'CONCEPT',
    "description" TEXT,
    "embedding" vector(768),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "graph_entities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "graph_entities_workspace_id_id_key" UNIQUE ("workspace_id", "id"),
    CONSTRAINT "graph_entities_workspace_id_normalized_name_key" UNIQUE ("workspace_id", "normalized_name"),
    CONSTRAINT "graph_entities_workspace_id_fkey" FOREIGN KEY ("workspace_id") 
        REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "graph_entities_workspace_id_idx" ON "graph_entities"("workspace_id");
CREATE INDEX "graph_entities_workspace_id_normalized_name_idx" ON "graph_entities"("workspace_id", "normalized_name");
CREATE INDEX "graph_entities_workspace_id_entity_type_idx" ON "graph_entities"("workspace_id", "entity_type");
CREATE INDEX "graph_entities_embedding_idx" ON "graph_entities" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- 4. Unified Graph Entity Aliases Registry
CREATE TABLE "graph_entity_aliases" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "alias" VARCHAR(255) NOT NULL,
    "normalized_alias" VARCHAR(255) NOT NULL,
    "alias_type" VARCHAR(32) NOT NULL DEFAULT 'SYNONYM',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "graph_entity_aliases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "graph_entity_aliases_workspace_id_normalized_alias_key" UNIQUE ("workspace_id", "normalized_alias"),
    CONSTRAINT "graph_entity_aliases_workspace_id_fkey" FOREIGN KEY ("workspace_id") 
        REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "graph_entity_aliases_workspace_id_entity_id_fkey" FOREIGN KEY ("workspace_id", "entity_id") 
        REFERENCES "graph_entities"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "graph_entity_aliases_workspace_id_normalized_alias_idx" ON "graph_entity_aliases"("workspace_id", "normalized_alias");
CREATE INDEX "graph_entity_aliases_workspace_id_entity_id_idx" ON "graph_entity_aliases"("workspace_id", "entity_id");

-- 5. Directed Semantic Graph Relations
CREATE TABLE "graph_relations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "source_entity_id" TEXT NOT NULL,
    "target_entity_id" TEXT NOT NULL,
    "relation_type" VARCHAR(64) NOT NULL,
    "description" TEXT,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "graph_relations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "graph_relations_workspace_id_id_key" UNIQUE ("workspace_id", "id"),
    CONSTRAINT "graph_relations_workspace_id_source_target_type_key" UNIQUE ("workspace_id", "source_entity_id", "target_entity_id", "relation_type"),
    CONSTRAINT "chk_graph_relation_no_self_loop" CHECK ("source_entity_id" <> "target_entity_id"),
    CONSTRAINT "chk_graph_relation_confidence" CHECK ("confidence" >= 0.0 AND "confidence" <= 1.0),
    CONSTRAINT "chk_graph_relation_weight" CHECK ("weight" > 0.0),
    CONSTRAINT "graph_relations_workspace_id_fkey" FOREIGN KEY ("workspace_id") 
        REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "graph_relations_workspace_id_source_entity_id_fkey" FOREIGN KEY ("workspace_id", "source_entity_id") 
        REFERENCES "graph_entities"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "graph_relations_workspace_id_target_entity_id_fkey" FOREIGN KEY ("workspace_id", "target_entity_id") 
        REFERENCES "graph_entities"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "graph_relations_workspace_id_idx" ON "graph_relations"("workspace_id");
CREATE INDEX "graph_relations_workspace_id_source_entity_id_idx" ON "graph_relations"("workspace_id", "source_entity_id");
CREATE INDEX "graph_relations_workspace_id_target_entity_id_idx" ON "graph_relations"("workspace_id", "target_entity_id");
CREATE INDEX "graph_relations_workspace_id_relation_type_idx" ON "graph_relations"("workspace_id", "relation_type");

-- 6. Chunk Entity Mentions
CREATE TABLE "chunk_entity_mentions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "mention_text" VARCHAR(255) NOT NULL,
    "start_offset" INTEGER,
    "end_offset" INTEGER,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chunk_entity_mentions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_chunk_entity_mention_confidence" CHECK ("confidence" >= 0.0 AND "confidence" <= 1.0),
    CONSTRAINT "chunk_entity_mentions_workspace_id_fkey" FOREIGN KEY ("workspace_id") 
        REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chunk_entity_mentions_workspace_id_chunk_id_fkey" FOREIGN KEY ("workspace_id", "chunk_id") 
        REFERENCES "document_chunks"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chunk_entity_mentions_workspace_id_entity_id_fkey" FOREIGN KEY ("workspace_id", "entity_id") 
        REFERENCES "graph_entities"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "chunk_entity_mentions_workspace_id_idx" ON "chunk_entity_mentions"("workspace_id");
CREATE INDEX "chunk_entity_mentions_chunk_id_idx" ON "chunk_entity_mentions"("chunk_id");
CREATE INDEX "chunk_entity_mentions_entity_id_idx" ON "chunk_entity_mentions"("entity_id");
CREATE INDEX "chunk_entity_mentions_workspace_id_entity_id_chunk_id_idx" ON "chunk_entity_mentions"("workspace_id", "entity_id", "chunk_id");

-- 7. Verifiable Relation Evidence
CREATE TABLE "relation_evidence" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "relation_id" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "evidence_text" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relation_evidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "relation_evidence_workspace_id_relation_id_chunk_id_key" UNIQUE ("workspace_id", "relation_id", "chunk_id"),
    CONSTRAINT "chk_relation_evidence_confidence" CHECK ("confidence" >= 0.0 AND "confidence" <= 1.0),
    CONSTRAINT "relation_evidence_workspace_id_fkey" FOREIGN KEY ("workspace_id") 
        REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "relation_evidence_workspace_id_relation_id_fkey" FOREIGN KEY ("workspace_id", "relation_id") 
        REFERENCES "graph_relations"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "relation_evidence_workspace_id_document_id_chunk_id_fkey" FOREIGN KEY ("workspace_id", "document_id", "chunk_id") 
        REFERENCES "document_chunks"("workspaceId", "documentId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "relation_evidence_workspace_id_idx" ON "relation_evidence"("workspace_id");
CREATE INDEX "relation_evidence_relation_id_idx" ON "relation_evidence"("relation_id");
CREATE INDEX "relation_evidence_chunk_id_idx" ON "relation_evidence"("chunk_id");
CREATE INDEX "relation_evidence_document_id_idx" ON "relation_evidence"("document_id");

-- 8. Automatic Synchronization of Canonical Name into graph_entity_aliases
CREATE OR REPLACE FUNCTION trg_sync_entity_canonical_alias()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        INSERT INTO "graph_entity_aliases" (
            "id", "workspace_id", "entity_id", "alias", "normalized_alias", "alias_type", "created_at"
        ) VALUES (
            gen_random_uuid()::text, NEW."workspace_id", NEW."id", NEW."canonical_name", NEW."normalized_name", 'CANONICAL', NOW()
        );
        RETURN NEW;
    ELSIF (TG_OP = 'UPDATE') THEN
        IF (NEW."normalized_name" <> OLD."normalized_name" OR NEW."canonical_name" <> OLD."canonical_name") THEN
            UPDATE "graph_entity_aliases"
            SET "alias" = NEW."canonical_name",
                "normalized_alias" = NEW."normalized_name"
            WHERE "workspace_id" = OLD."workspace_id" 
              AND "entity_id" = OLD."id" 
              AND "alias_type" = 'CANONICAL';
        END IF;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_entities_sync_canonical_alias
AFTER INSERT OR UPDATE OF "canonical_name", "normalized_name" ON "graph_entities"
FOR EACH ROW
EXECUTE FUNCTION trg_sync_entity_canonical_alias();

-- 9. Protect CANONICAL Entries from Direct Modification / Deletion While Parent Exists
CREATE OR REPLACE FUNCTION trg_protect_canonical_alias()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        IF OLD."alias_type" = 'CANONICAL' AND pg_trigger_depth() <= 1 THEN
            RAISE EXCEPTION 'CANONICAL alias registry entries cannot be directly deleted while parent entity exists'
                USING ERRCODE = '23505';
        END IF;
        RETURN OLD;
    ELSIF (TG_OP = 'UPDATE') THEN
        IF OLD."alias_type" = 'CANONICAL' AND pg_trigger_depth() <= 1 THEN
            RAISE EXCEPTION 'CANONICAL alias registry entries cannot be directly modified'
                USING ERRCODE = '23505';
        END IF;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_graph_entity_aliases_protect_canonical
BEFORE DELETE OR UPDATE ON "graph_entity_aliases"
FOR EACH ROW
EXECUTE FUNCTION trg_protect_canonical_alias();

-- 10. Disallow Non-Canonical Alias Identical to Entity's Own Canonical Name
CREATE OR REPLACE FUNCTION trg_validate_non_canonical_alias()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."alias_type" <> 'CANONICAL' THEN
        IF EXISTS (
            SELECT 1 FROM "graph_entities" 
            WHERE "workspace_id" = NEW."workspace_id" 
              AND "id" = NEW."entity_id" 
              AND "normalized_name" = NEW."normalized_alias"
        ) THEN
            RAISE EXCEPTION 'Alias "%" cannot be identical to the entity''s own canonical name',
                NEW."normalized_alias"
                USING ERRCODE = '23505';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_graph_entity_aliases_validate_alias
BEFORE INSERT OR UPDATE ON "graph_entity_aliases"
FOR EACH ROW
EXECUTE FUNCTION trg_validate_non_canonical_alias();
