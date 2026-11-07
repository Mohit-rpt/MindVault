-- Migration: 20261107000300_phase_6_trigger_concurrency_hardening
-- Description: Harden relation_evidence weight synchronization trigger with row-level locking (FOR UPDATE)
--              to prevent lost-update race conditions during high-concurrency ingestion.

CREATE OR REPLACE FUNCTION trg_sync_relation_weight_on_evidence_change()
RETURNS TRIGGER AS $$
DECLARE
    target_rel_id TEXT;
    target_ws_id TEXT;
    distinct_chunks INT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        target_rel_id := OLD.relation_id;
        target_ws_id := OLD.workspace_id;
    ELSE
        target_rel_id := NEW.relation_id;
        target_ws_id := NEW.workspace_id;
    END IF;

    -- Explicitly lock parent graph_relations row to serialize concurrent evidence insertions.
    -- This guarantees that COUNT(DISTINCT chunk_id) executes after any in-flight transaction
    -- on the same relation commits, preventing weight undercounting anomalies.
    PERFORM 1 FROM graph_relations
    WHERE id = target_rel_id AND workspace_id = target_ws_id
    FOR UPDATE;

    -- If the parent relation was already deleted (e.g. via cascade), exit cleanly
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

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
