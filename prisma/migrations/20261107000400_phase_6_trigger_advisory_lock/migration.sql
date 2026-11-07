-- Migration: 20261107000400_phase_6_trigger_advisory_lock
-- Description: Replace row-level FOR UPDATE lock with transaction-level advisory lock (pg_advisory_xact_lock)
--              Eliminates foreign-key ShareLock upgrade deadlocks while preserving strict serialization.

CREATE OR REPLACE FUNCTION trg_sync_relation_weight_on_evidence_change()
RETURNS TRIGGER AS $$
DECLARE
    target_rel_id TEXT;
    target_ws_id TEXT;
    distinct_chunks INT;
    lock_key BIGINT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        target_rel_id := OLD.relation_id;
        target_ws_id := OLD.workspace_id;
    ELSE
        target_rel_id := NEW.relation_id;
        target_ws_id := NEW.workspace_id;
    END IF;

    -- Compute 64-bit advisory lock key from workspace_id and relation_id.
    -- Advisory xact locks serialize concurrent evidence operations for the same relation
    -- WITHOUT conflicting with PostgreSQL foreign key ShareLocks, eliminating deadlocks.
    lock_key := ('x' || substr(md5(target_ws_id || ':' || target_rel_id), 1, 16))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(lock_key);

    SELECT COUNT(DISTINCT chunk_id)
    INTO distinct_chunks
    FROM relation_evidence
    WHERE relation_id = target_rel_id AND workspace_id = target_ws_id;

    UPDATE graph_relations
    SET weight = GREATEST(1.0, distinct_chunks::DOUBLE PRECISION),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = target_rel_id AND workspace_id = target_ws_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
