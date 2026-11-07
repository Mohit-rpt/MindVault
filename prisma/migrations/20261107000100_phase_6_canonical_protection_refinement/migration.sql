-- Migration: 20261107000100_phase_6_canonical_protection_refinement
-- Description: Replace pg_trigger_depth() check on DELETE with robust parent-existence verification
--              Prevent nested trigger bypass while preserving foreign key ON DELETE CASCADE.

CREATE OR REPLACE FUNCTION trg_protect_canonical_alias()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        IF OLD."alias_type" = 'CANONICAL' THEN
            -- Check whether parent GraphEntity still exists in this workspace.
            -- During foreign key CASCADE deletion from graph_entities, PostgreSQL deletes
            -- the parent row first, so this check evaluates to FALSE and cascade delete proceeds.
            -- In direct DELETE or deletion invoked by any other nested trigger, the parent
            -- still exists, so this check evaluates to TRUE and blocks deletion with 23505.
            IF EXISTS (
                SELECT 1 FROM "graph_entities"
                WHERE "workspace_id" = OLD."workspace_id"
                  AND "id" = OLD."entity_id"
            ) THEN
                RAISE EXCEPTION 'CANONICAL alias registry entries cannot be directly deleted while parent entity exists'
                    USING ERRCODE = '23505';
            END IF;
        END IF;
        RETURN OLD;

    ELSIF (TG_OP = 'UPDATE') THEN
        IF OLD."alias_type" = 'CANONICAL' THEN
            -- Direct updates from application callers (trigger depth <= 1) are unconditionally prohibited
            IF pg_trigger_depth() <= 1 THEN
                RAISE EXCEPTION 'CANONICAL alias registry entries cannot be directly modified'
                    USING ERRCODE = '23505';
            END IF;

            -- Invariant checks: alias_type, entity_id, and workspace_id cannot change
            IF NEW."alias_type" <> 'CANONICAL' OR NEW."entity_id" <> OLD."entity_id" OR NEW."workspace_id" <> OLD."workspace_id" THEN
                RAISE EXCEPTION 'CANONICAL alias registry entries cannot change alias_type, entity_id, or workspace_id'
                    USING ERRCODE = '23505';
            END IF;

            -- For nested triggers (depth >= 2), only allow if parent GraphEntity exists AND its canonical/normalized names match NEW
            IF NOT EXISTS (
                SELECT 1 FROM "graph_entities"
                WHERE "workspace_id" = NEW."workspace_id"
                  AND "id" = NEW."entity_id"
                  AND "canonical_name" = NEW."alias"
                  AND "normalized_name" = NEW."normalized_alias"
            ) THEN
                RAISE EXCEPTION 'CANONICAL alias registry entries cannot be modified without matching parent entity'
                    USING ERRCODE = '23505';
            END IF;

        ELSIF NEW."alias_type" = 'CANONICAL' THEN
            -- Disallow promoting any non-canonical alias to CANONICAL directly
            RAISE EXCEPTION 'Non-canonical alias cannot be converted to CANONICAL'
                USING ERRCODE = '23505';
        END IF;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
