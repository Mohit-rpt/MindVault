import { Prisma } from '@prisma/client';
import type { NeighborhoodQueryParams, PathFinderQueryParams } from '@mindvault/shared';

/**
 * Builds the parameterized PostgreSQL recursive CTE query for bounded neighborhood traversal.
 * Compliant with Phase 6.5 Final Architecture Audit Section 13.6.1.
 *
 * Safety constraints compiled directly into SQL:
 * 1. Multi-tenant workspace isolation ($1::text) across all CTE members, joins, and evidence lookups.
 * 2. SQL-enforced depth clamping: gw.depth < LEAST(GREATEST($4::int, 1), 3).
 * 3. Array length cycle guard: array_length(gw.path, 1) <= 4.
 * 4. Cycle containment: NOT (target_entity_id = ANY(gw.path)).
 * 5. Intermediate expansion ceiling: candidate lateral JOIN capped at LIMIT 15.
 * 6. Two-stage deduplication: Stage 1 DISTINCT ON (gw.relation_id) with deterministic ranking,
 *    Stage 2 global salience ordering (depth ASC, confidence DESC, weight DESC, relation_id ASC).
 * 7. Response budget cap: outer query capped at LIMIT LEAST(GREATEST($5::int, 5), 100).
 */
export function buildNeighborhoodQuery(params: NeighborhoodQueryParams): Prisma.Sql {
  const workspaceId = params.workspaceId;
  const centerEntityId = params.centerEntityId;
  const direction = params.direction ?? 'both';
  const depth = params.maxDepth ?? 1;
  const limit = params.limit ?? 30;

  return Prisma.sql`
WITH RECURSIVE graph_walk AS (
    -- Anchor Member: Immediate relations from center entity bounded by user limit [5..100]
    SELECT
        r.id AS relation_id,
        r.source_entity_id,
        r.target_entity_id,
        CASE 
            WHEN r.source_entity_id = ${centerEntityId} THEN r.target_entity_id 
            ELSE r.source_entity_id 
        END AS next_entity_id,
        r.relation_type,
        r.description,
        r.weight,
        r.confidence,
        ARRAY[r.source_entity_id, r.target_entity_id]::text[] AS path,
        1 AS depth
    FROM (
        SELECT r.*
        FROM graph_relations r
        WHERE r.workspace_id = ${workspaceId}
          AND (
            (${direction}::text = 'both' OR ${direction}::text = 'outgoing') AND r.source_entity_id = ${centerEntityId}
            OR
            (${direction}::text = 'both' OR ${direction}::text = 'incoming') AND r.target_entity_id = ${centerEntityId}
          )
        ORDER BY r.confidence DESC, r.weight DESC, r.id ASC
        LIMIT LEAST(GREATEST(${limit}::int, 5), 100)
    ) r

    UNION ALL

    -- Recursive Member: Expand neighbors with hard ceiling K_fanout <= 15 and SQL-enforced depth clamp [1, 3]
    SELECT
        cand.relation_id,
        cand.source_entity_id,
        cand.target_entity_id,
        cand.next_entity_id,
        cand.relation_type,
        cand.description,
        cand.weight * gw.weight AS weight,
        LEAST(cand.confidence, gw.confidence) AS confidence,
        gw.path || cand.next_entity_id,
        gw.depth + 1 AS depth
    FROM graph_walk gw
    JOIN LATERAL (
        SELECT * FROM (
            SELECT
                r.id AS relation_id,
                r.source_entity_id,
                r.target_entity_id,
                r.target_entity_id AS next_entity_id,
                r.relation_type,
                r.description,
                r.weight,
                r.confidence
            FROM graph_relations r
            WHERE (${direction}::text = 'both' OR ${direction}::text = 'outgoing')
              AND r.workspace_id = ${workspaceId}
              AND r.source_entity_id = gw.next_entity_id
              AND NOT (r.target_entity_id = ANY(gw.path))

            UNION ALL

            SELECT
                r.id AS relation_id,
                r.source_entity_id,
                r.target_entity_id,
                r.source_entity_id AS next_entity_id,
                r.relation_type,
                r.description,
                r.weight,
                r.confidence
            FROM graph_relations r
            WHERE (${direction}::text = 'both' OR ${direction}::text = 'incoming')
              AND r.workspace_id = ${workspaceId}
              AND r.target_entity_id = gw.next_entity_id
              AND NOT (r.source_entity_id = ANY(gw.path))
        ) edges
        ORDER BY edges.confidence DESC, edges.weight DESC, edges.relation_id ASC
        LIMIT 15
    ) cand ON true
    WHERE gw.depth < LEAST(GREATEST(${depth}::int, 1), 3)
      AND array_length(gw.path, 1) <= 4
),
deduplicated_relations AS (
    SELECT DISTINCT ON (gw.relation_id)
        gw.relation_id,
        gw.depth,
        gw.source_entity_id,
        gw.target_entity_id,
        gw.relation_type,
        gw.description,
        gw.weight,
        gw.confidence
    FROM graph_walk gw
    ORDER BY gw.relation_id, gw.depth ASC, gw.confidence DESC, gw.weight DESC
)
SELECT
    dr.relation_id,
    dr.depth,
    s.id AS source_id,
    s.canonical_name AS source_name,
    s.entity_type::text AS source_type,
    s.description AS source_description,
    dr.relation_type,
    dr.description AS relation_description,
    t.id AS target_id,
    t.canonical_name AS target_name,
    t.entity_type::text AS target_type,
    t.description AS target_description,
    dr.weight,
    dr.confidence,
    (
        SELECT COUNT(*)::int
        FROM relation_evidence re
        WHERE re.relation_id = dr.relation_id
          AND re.workspace_id = ${workspaceId}
    ) AS evidence_count
FROM deduplicated_relations dr
JOIN graph_entities s ON s.id = dr.source_entity_id AND s.workspace_id = ${workspaceId}
JOIN graph_entities t ON t.id = dr.target_entity_id AND t.workspace_id = ${workspaceId}
ORDER BY
    dr.depth ASC,
    dr.confidence DESC,
    dr.weight DESC,
    dr.relation_id ASC
LIMIT LEAST(GREATEST(${limit}::int, 5), 100);
`;
}

/**
 * Builds the parameterized PostgreSQL recursive CTE query for bounded path discovery between two entities.
 * Compliant with Phase 6.5 Final Architecture Audit Section 13.6.2.
 *
 * Safety constraints compiled directly into SQL:
 * 1. Multi-tenant workspace isolation ($1::text) across anchor and lateral candidate queries.
 * 2. SQL-enforced depth clamping: pf.depth < LEAST(GREATEST($4::int, 1), 4).
 * 3. Array length path node cap: array_length(pf.entity_path, 1) <= 5.
 * 4. Cycle containment: NOT (target_entity_id = ANY(pf.entity_path)).
 * 5. Destination short-circuit: pf.target_entity_id <> $3 in recursive member.
 * 6. Intermediate expansion ceiling: candidate lateral JOIN capped at LIMIT 15.
 * 7. Destination filter: pf.target_entity_id = $3 in outer SELECT.
 * 8. Deterministic tie-breaking: pf.entity_path ASC, pf.relation_path ASC native-array order.
 * 9. Path budget cap: LIMIT LEAST(GREATEST($5::int, 1), 10).
 */
export function buildPathFinderQuery(params: PathFinderQueryParams): Prisma.Sql {
  const workspaceId = params.workspaceId;
  const sourceEntityId = params.sourceEntityId;
  const targetEntityId = params.targetEntityId;
  const maxDepth = params.maxDepth ?? 3;
  const limit = params.limit ?? 5;

  return Prisma.sql`
WITH RECURSIVE path_finder AS (
    SELECT
        r.id AS relation_id,
        r.source_entity_id,
        r.target_entity_id,
        r.relation_type,
        r.weight,
        r.confidence,
        ARRAY[r.source_entity_id, r.target_entity_id]::text[] AS entity_path,
        ARRAY[r.id]::text[] AS relation_path,
        ARRAY[r.relation_type]::text[] AS type_path,
        1 AS depth
    FROM (
        SELECT r.*
        FROM graph_relations r
        WHERE r.workspace_id = ${workspaceId}
          AND r.source_entity_id = ${sourceEntityId}
        ORDER BY r.confidence DESC, r.weight DESC, r.id ASC
        LIMIT 15
    ) r

    UNION ALL

    SELECT
        cand.relation_id,
        cand.source_entity_id,
        cand.target_entity_id,
        cand.relation_type,
        cand.weight * pf.weight AS weight,
        LEAST(cand.confidence, pf.confidence) AS confidence,
        pf.entity_path || cand.target_entity_id,
        pf.relation_path || cand.relation_id,
        pf.type_path || cand.relation_type,
        pf.depth + 1 AS depth
    FROM path_finder pf
    JOIN LATERAL (
        SELECT r.id AS relation_id, r.source_entity_id, r.target_entity_id,
               r.relation_type, r.weight, r.confidence
        FROM graph_relations r
        WHERE r.workspace_id = ${workspaceId}
          AND r.source_entity_id = pf.target_entity_id
          AND NOT (r.target_entity_id = ANY(pf.entity_path))
        ORDER BY r.confidence DESC, r.weight DESC, r.id ASC
        LIMIT 15
    ) cand ON true
    WHERE pf.depth < LEAST(GREATEST(${maxDepth}::int, 1), 4)
      AND array_length(pf.entity_path, 1) <= 5
      AND pf.target_entity_id <> ${targetEntityId}
)
SELECT
    pf.relation_id,
    pf.entity_path,
    pf.relation_path,
    pf.type_path,
    pf.depth,
    pf.weight,
    pf.confidence
FROM path_finder pf
WHERE pf.target_entity_id = ${targetEntityId}
ORDER BY
    pf.depth ASC,
    pf.confidence DESC,
    pf.weight DESC,
    pf.entity_path ASC,
    pf.relation_path ASC
LIMIT LEAST(GREATEST(${limit}::int, 1), 10);
`;
}
