import { Prisma } from '@prisma/client';
import type { GraphEvidenceQueryParams, SeedDiscoveryQueryParams } from '@mindvault/shared';

/**
 * Builds the parameterized PostgreSQL query for Graph Seed Discovery.
 * Combines exact lexical matching (canonical names + alias registry)
 * with optional dense vector cosine similarity against entity embeddings.
 *
 * Multi-tenant safety:
 * - Strictly enforces workspace_id = $1 across all branches.
 * - Caps results at maxSeeds (default 5, clamped [1..10]).
 */
export function buildSeedDiscoveryQuery(params: SeedDiscoveryQueryParams): Prisma.Sql {
  const { workspaceId, ngrams, queryVector, maxSeeds } = params;
  const clampedMaxSeeds = Math.min(Math.max(maxSeeds ?? 5, 1), 10);

  const hasNgrams = ngrams && ngrams.length > 0;
  const hasVector = queryVector && queryVector.length > 0;

  const lexicalBranch = hasNgrams
    ? Prisma.sql`
        SELECT 
            e.id AS "entityId",
            e.canonical_name AS "canonicalName",
            e.entity_type::text AS "entityType",
            1.0::double precision AS "seedScore",
            'LEXICAL'::text AS "matchStrategy"
        FROM graph_entities e
        WHERE e.workspace_id = ${workspaceId}
          AND e.normalized_name = ANY(ARRAY[${Prisma.join(ngrams)}]::text[])

        UNION ALL

        SELECT 
            a.entity_id AS "entityId",
            e.canonical_name AS "canonicalName",
            e.entity_type::text AS "entityType",
            0.95::double precision AS "seedScore",
            'ALIAS'::text AS "matchStrategy"
        FROM graph_entity_aliases a
        JOIN graph_entities e ON a.entity_id = e.id AND e.workspace_id = ${workspaceId}
        WHERE a.workspace_id = ${workspaceId}
          AND a.normalized_alias = ANY(ARRAY[${Prisma.join(ngrams)}]::text[])
      `
    : Prisma.sql`
        SELECT 
            NULL::text AS "entityId",
            NULL::text AS "canonicalName",
            NULL::text AS "entityType",
            0.0::double precision AS "seedScore",
            NULL::text AS "matchStrategy"
        WHERE false
      `;

  const semanticBranch = hasVector
    ? Prisma.sql`
        SELECT 
            e.id AS "entityId",
            e.canonical_name AS "canonicalName",
            e.entity_type::text AS "entityType",
            (1.0 - (e.embedding <=> ${`[${queryVector.join(',')}]`}::vector))::double precision AS "seedScore",
            'SEMANTIC'::text AS "matchStrategy"
        FROM graph_entities e
        WHERE e.workspace_id = ${workspaceId}
          AND e.embedding IS NOT NULL
          AND (1.0 - (e.embedding <=> ${`[${queryVector.join(',')}]`}::vector)) >= 0.70
        ORDER BY e.embedding <=> ${`[${queryVector.join(',')}]`}::vector ASC
        LIMIT ${clampedMaxSeeds}
      `
    : Prisma.sql`
        SELECT 
            NULL::text AS "entityId",
            NULL::text AS "canonicalName",
            NULL::text AS "entityType",
            0.0::double precision AS "seedScore",
            NULL::text AS "matchStrategy"
        WHERE false
      `;

  return Prisma.sql`
    WITH combined_seeds AS (
        ${lexicalBranch}
        UNION ALL
        ${semanticBranch}
    ),
    deduplicated_seeds AS (
        SELECT DISTINCT ON ("entityId")
            "entityId",
            "canonicalName",
            "entityType",
            "seedScore",
            "matchStrategy"
        FROM combined_seeds
        WHERE "entityId" IS NOT NULL
        ORDER BY "entityId", "seedScore" DESC, "canonicalName" ASC
    )
    SELECT 
        "entityId",
        "canonicalName",
        "entityType",
        "seedScore",
        "matchStrategy"
    FROM deduplicated_seeds
    ORDER BY "seedScore" DESC, "canonicalName" ASC, "entityId" ASC
    LIMIT ${clampedMaxSeeds};
  `;
}

/**
 * Builds the parameterized PostgreSQL recursive CTE query for Graph Evidence Chunk Retrieval.
 * Compliant with Phase 6.6 Architecture Blueprint Section 2.2 and Final Readiness Audit.
 *
 * Safety & Bound Invariants:
 * 1. Multi-tenant workspace isolation ($1) across all anchor, recursive, and join CTEs.
 * 2. Anchor Member: Depth 1 relations capped at LIMIT 50.
 * 3. Frontier Restriction: Recursive member restricts frontier parents to top 10 distinct neighbors by salience.
 * 4. Lateral Fan-Out: Lateral query expands each frontier parent with LIMIT 10 (max 100 recursive relations).
 * 5. Hard Intermediate Ceiling: deduplicated_relations groups by relation_id with hard LIMIT 150 before joining evidence.
 * 6. Evidence Separation: Strategy 1 joins relation_evidence; Strategy 2 joins chunk_entity_mentions.
 * 7. Score Combination: LEAST(1.0, max_score + sum_{raw_score < max_score} 0.2 * raw_score).
 * 8. Column Quoting: Properly quotes document_chunks ("documentId", "workspaceId") and documents ("originalName").
 * 9. Outer Response Bound: Result set capped at LEAST(GREATEST($3::int, 1), 50).
 */
export function buildGraphEvidenceQuery(params: GraphEvidenceQueryParams): Prisma.Sql {
  const { workspaceId, seedEntityIds } = params;
  const clampedTopK = Math.min(Math.max(params.topK ?? 20, 1), 50);
  const minConfidence = params.minConfidence ?? 0.6;
  const minWeight = params.minWeight ?? 0.5;

  if (!seedEntityIds || seedEntityIds.length === 0) {
    return Prisma.sql`
      SELECT 
        NULL::text AS "chunkId",
        NULL::text AS "documentId",
        NULL::text AS "workspaceId",
        0::int AS "chunkIndex",
        NULL::text AS "content",
        0::int AS "tokenCount",
        NULL::int AS "pageStart",
        NULL::int AS "pageEnd",
        '{}'::jsonb AS "metadata",
        NOW() AS "createdAt",
        NULL::text AS "docOriginalName",
        NULL::text AS "docExtension",
        NULL::text AS "docStatus",
        NULL::int AS "docPageCount",
        0.0::double precision AS "score",
        0::bigint AS "supportedRelationsCount",
        ARRAY[]::text[] AS "supportedRelationIds",
        ARRAY[]::text[] AS "relationTypes"
      WHERE false;
    `;
  }

  const seedIdsArray = Prisma.sql`ARRAY[${Prisma.join(seedEntityIds)}]::text[]`;

  return Prisma.sql`
WITH RECURSIVE graph_expansion AS (
    -- 1. Anchor Member: Depth 1 relations connected to discovered seeds
    SELECT 
        r.id AS relation_id,
        r.source_entity_id,
        r.target_entity_id,
        CASE 
            WHEN r.source_entity_id = ANY(${seedIdsArray}) THEN r.target_entity_id 
            ELSE r.source_entity_id 
        END AS neighbor_id,
        r.relation_type,
        r.weight,
        r.confidence,
        ARRAY[r.source_entity_id, r.target_entity_id]::text[] AS path,
        1 AS depth
    FROM (
        SELECT r.*
        FROM graph_relations r
        WHERE r.workspace_id = ${workspaceId}
          AND (r.source_entity_id = ANY(${seedIdsArray}) OR r.target_entity_id = ANY(${seedIdsArray}))
          AND r.confidence >= ${minConfidence}
          AND r.weight >= ${minWeight}
        ORDER BY r.confidence DESC, r.weight DESC, r.id ASC
        LIMIT 50 -- Global anchor ceiling
    ) r

    UNION ALL

    -- 2. Recursive Member: Depth 2 expansion with restricted frontier and lateral limit
    SELECT 
        cand.id AS relation_id,
        cand.source_entity_id,
        cand.target_entity_id,
        CASE 
            WHEN cand.source_entity_id = ge.neighbor_id THEN cand.target_entity_id 
            ELSE cand.source_entity_id 
        END AS neighbor_id,
        cand.relation_type,
        (cand.weight * ge.weight) AS weight,
        LEAST(cand.confidence, ge.confidence) AS confidence,
        (ge.path || CASE 
            WHEN cand.source_entity_id = ge.neighbor_id THEN cand.target_entity_id 
            ELSE cand.source_entity_id 
        END)::text[] AS path,
        ge.depth + 1 AS depth
    FROM (
        -- Remediation B: Globally rank deduplicated neighbors by salience before LIMIT 10
        SELECT 
            neighbor_id,
            weight,
            confidence,
            path,
            depth
        FROM (
            SELECT DISTINCT ON (neighbor_id)
                neighbor_id,
                weight,
                confidence,
                path,
                depth
            FROM graph_expansion
            WHERE depth = 1
            ORDER BY neighbor_id, confidence DESC, weight DESC
        ) dedup_frontier
        ORDER BY confidence DESC, weight DESC, neighbor_id ASC
        LIMIT 10
    ) ge
    JOIN LATERAL (
        SELECT r2.*
        FROM graph_relations r2
        WHERE r2.workspace_id = ${workspaceId}
          AND (r2.source_entity_id = ge.neighbor_id OR r2.target_entity_id = ge.neighbor_id)
          AND NOT (
            CASE 
                WHEN r2.source_entity_id = ge.neighbor_id THEN r2.target_entity_id 
                ELSE r2.source_entity_id 
            END = ANY(ge.path)
          )
          AND r2.confidence >= ${minConfidence}
          AND r2.weight >= ${minWeight}
        ORDER BY r2.confidence DESC, r2.weight DESC, r2.id ASC
        LIMIT 10 -- Per-frontier lateral limit (10 parents x 10 = max 100 relations)
    ) cand ON true
    WHERE ge.depth < 2 -- Clamped strictly to max 2 hops
      AND array_length(ge.path, 1) <= 3
),
deduplicated_relations AS (
    -- Remediation C: Globally rank deduplicated relations by depth/salience before LIMIT 150
    SELECT 
        relation_id,
        source_entity_id,
        target_entity_id,
        relation_type,
        weight,
        confidence,
        depth
    FROM (
        SELECT DISTINCT ON (relation_id)
            relation_id,
            source_entity_id,
            target_entity_id,
            relation_type,
            weight,
            confidence,
            depth
        FROM graph_expansion
        ORDER BY relation_id, depth ASC, confidence DESC, weight DESC
    ) dedup_rels
    ORDER BY depth ASC, confidence DESC, weight DESC, relation_id ASC
    LIMIT 150
),
chunk_evidence_candidates AS (
    -- Strategy 1: Chunks that substantiate traversed relations (Relationship Evidence)
    SELECT 
        re.chunk_id,
        re.document_id,
        -- Score: W_rel * C_rel * E_ev * (1 / depth)
        (dr.weight * dr.confidence * COALESCE(re.confidence, 0.85) * (1.0 / dr.depth))::double precision AS raw_score,
        'RELATION_EVIDENCE' AS provenance_type,
        dr.relation_id,
        dr.relation_type,
        dr.source_entity_id,
        dr.target_entity_id,
        dr.depth
    FROM deduplicated_relations dr
    JOIN relation_evidence re ON dr.relation_id = re.relation_id AND re.workspace_id = ${workspaceId}

    UNION ALL

    -- Strategy 2: Chunks that directly mention seed entities (Direct Entity Mention)
    SELECT 
        cem.chunk_id,
        c."documentId" AS document_id,
        -- Score: C_mention * 0.75 (dampened)
        (COALESCE(cem.confidence, 0.90) * 0.75)::double precision AS raw_score,
        'ENTITY_MENTION' AS provenance_type,
        NULL AS relation_id,
        NULL AS relation_type,
        cem.entity_id AS source_entity_id,
        NULL AS target_entity_id,
        1 AS depth
    FROM chunk_entity_mentions cem
    JOIN document_chunks c ON cem.chunk_id = c.id AND c."workspaceId" = ${workspaceId}
    WHERE cem.workspace_id = ${workspaceId}
      AND cem.entity_id = ANY(${seedIdsArray})
),
-- Remediation D: Deduplicate evidence per chunk by distinct provenance identity to prevent duplicate records inflating score
deduplicated_chunk_evidence AS (
    SELECT 
        chunk_id,
        document_id,
        provenance_type,
        relation_id,
        relation_type,
        source_entity_id,
        MAX(raw_score) AS raw_score
    FROM chunk_evidence_candidates
    GROUP BY chunk_id, document_id, provenance_type, relation_id, relation_type, source_entity_id
),
aggregated_chunk_scores AS (
    -- Combine multiple relations supporting the same chunk
    -- Formula: min(1.0, 0.8 * S_max + 0.2 * SUM(S_i))
    SELECT 
        dce.chunk_id,
        dce.document_id,
        LEAST(1.0::double precision, 
            0.8::double precision * MAX(dce.raw_score) + 0.2::double precision * SUM(dce.raw_score)
        ) AS final_graph_score,
        COUNT(DISTINCT dce.relation_id) AS supported_relations_count,
        ARRAY_AGG(DISTINCT dce.relation_id) FILTER (WHERE dce.relation_id IS NOT NULL) AS supported_relation_ids,
        ARRAY_AGG(DISTINCT dce.relation_type) FILTER (WHERE dce.relation_type IS NOT NULL) AS relation_types
    FROM deduplicated_chunk_evidence dce
    GROUP BY dce.chunk_id, dce.document_id
)
SELECT 
    c.id AS "chunkId",
    c."documentId" AS "documentId",
    c."workspaceId" AS "workspaceId",
    c."chunkIndex" AS "chunkIndex",
    c.content,
    c."tokenCount" AS "tokenCount",
    c."pageStart" AS "pageStart",
    c."pageEnd" AS "pageEnd",
    c.metadata,
    c."createdAt" AS "createdAt",
    d."originalName" AS "docOriginalName",
    d.extension AS "docExtension",
    d.status AS "docStatus",
    d."pageCount" AS "docPageCount",
    acs.final_graph_score AS "score",
    acs.supported_relations_count AS "supportedRelationsCount",
    COALESCE(acs.supported_relation_ids, ARRAY[]::text[]) AS "supportedRelationIds",
    COALESCE(acs.relation_types, ARRAY[]::text[]) AS "relationTypes"
FROM aggregated_chunk_scores acs
JOIN document_chunks c ON acs.chunk_id = c.id AND c."workspaceId" = ${workspaceId}
JOIN documents d ON acs.document_id = d.id AND d."workspaceId" = ${workspaceId}
WHERE d.status = 'COMPLETED'
ORDER BY acs.final_graph_score DESC, c."chunkIndex" ASC, c.id ASC
LIMIT ${clampedTopK};
  `;
}

/**
 * Builds query to resolve supporting relation triples for retrieved graph chunks.
 */
export function buildSupportingRelationsQuery(
  workspaceId: string,
  relationIds: string[],
): Prisma.Sql {
  if (!relationIds || relationIds.length === 0) {
    return Prisma.sql`
      SELECT 
        NULL::text AS "relationId",
        NULL::text AS "sourceEntityId",
        NULL::text AS "sourceCanonicalName",
        NULL::text AS "targetEntityId",
        NULL::text AS "targetCanonicalName",
        NULL::text AS "relationType",
        0.0::double precision AS "weight",
        0.0::double precision AS "confidence",
        1::int AS "depth",
        ARRAY[]::text[] AS "evidenceChunkIds"
      WHERE false;
    `;
  }

  const relationIdsArray = Prisma.sql`ARRAY[${Prisma.join(relationIds)}]::text[]`;

  return Prisma.sql`
    SELECT 
        r.id AS "relationId",
        r.source_entity_id AS "sourceEntityId",
        se.canonical_name AS "sourceCanonicalName",
        r.target_entity_id AS "targetEntityId",
        te.canonical_name AS "targetCanonicalName",
        r.relation_type AS "relationType",
        r.weight,
        r.confidence,
        1::int AS "depth",
        COALESCE(ARRAY_AGG(DISTINCT re.chunk_id) FILTER (WHERE re.chunk_id IS NOT NULL), ARRAY[]::text[]) AS "evidenceChunkIds"
    FROM graph_relations r
    JOIN graph_entities se ON r.source_entity_id = se.id AND se.workspace_id = ${workspaceId}
    JOIN graph_entities te ON r.target_entity_id = te.id AND te.workspace_id = ${workspaceId}
    LEFT JOIN relation_evidence re ON r.id = re.relation_id AND re.workspace_id = ${workspaceId}
    WHERE r.workspace_id = ${workspaceId}
      AND r.id = ANY(${relationIdsArray})
    GROUP BY r.id, r.source_entity_id, se.canonical_name, r.target_entity_id, te.canonical_name, r.relation_type, r.weight, r.confidence
    ORDER BY r.confidence DESC, r.weight DESC, r.id ASC;
  `;
}
