-- Migration: 20261107000200_phase_6_entity_types_and_weight_sync
-- Description: 1. Add EVENT, METRIC, CUSTOM to EntityType enum (preserving OTHER for backward compatibility)
--              2. Implement trigger on relation_evidence to maintain weight = max(1, count(distinct chunk_id))
--                 synchronized under insertions, reprocessing, and cascade deletions.

-- 1. Alter EntityType Enum
ALTER TYPE "EntityType" ADD VALUE IF NOT EXISTS 'EVENT';
ALTER TYPE "EntityType" ADD VALUE IF NOT EXISTS 'METRIC';
ALTER TYPE "EntityType" ADD VALUE IF NOT EXISTS 'CUSTOM';

-- 2. Relation Weight Synchronization Function & Trigger
CREATE OR REPLACE FUNCTION trg_sync_relation_weight_on_evidence_change()
RETURNS TRIGGER AS $$
DECLARE
    target_ws_id TEXT;
    target_rel_id TEXT;
    unique_chunks INT;
BEGIN
    IF (TG_OP = 'INSERT') THEN
        target_ws_id := NEW."workspace_id";
        target_rel_id := NEW."relation_id";
    ELSE
        target_ws_id := OLD."workspace_id";
        target_rel_id := OLD."relation_id";
    END IF;

    -- Count distinct chunks providing evidence for this relation in this workspace
    SELECT COUNT(DISTINCT "chunk_id") INTO unique_chunks
    FROM "relation_evidence"
    WHERE "workspace_id" = target_ws_id
      AND "relation_id" = target_rel_id;

    -- Update relation weight: max(1, unique_chunks) to respect chk_relation_weight_positive (weight > 0.0)
    -- Even if all evidence chunks are deleted, the topological relation maintains weight 1.0
    UPDATE "graph_relations"
    SET "weight" = GREATEST(1.0, unique_chunks::DOUBLE PRECISION),
        "updated_at" = NOW()
    WHERE "workspace_id" = target_ws_id
      AND "id" = target_rel_id;

    IF (TG_OP = 'INSERT') THEN
        RETURN NEW;
    ELSE
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_relation_evidence_sync_weight ON "relation_evidence";
CREATE TRIGGER trg_relation_evidence_sync_weight
AFTER INSERT OR DELETE ON "relation_evidence"
FOR EACH ROW
EXECUTE FUNCTION trg_sync_relation_weight_on_evidence_change();
