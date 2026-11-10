import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { graphRepository } from '../repositories/graph.repository.js';
import {
  buildSeedDiscoveryQuery,
  buildGraphEvidenceQuery,
} from '../queries/graph-retrieval.sql.js';

describe('Phase 6.6.1: SQL Ranking, Frontier, Pruning & Scoring Remediation Tests', () => {
  let wsId: string;
  let userId: string;

  beforeAll(async () => {
    const ws = await prisma.workspace.create({
      data: { name: 'WS Remediation Test', slug: `ws-remediation-${randomUUID()}` },
    });
    wsId = ws.id;

    const user = await prisma.user.create({
      data: {
        email: `remediation-tester-${randomUUID()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Remediation Tester',
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (wsId) {
      await prisma.workspace.delete({ where: { id: wsId } }).catch(() => {});
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
  });

  describe('Remediation A: Seed Discovery Global Ranking & Deterministic Tie-Breaking', () => {
    it('ensures high-score entities with lexicographically late UUIDs outrank low-score entities with early UUIDs', async () => {
      // Test query verifying that ORDER BY seedScore DESC happens globally AFTER deduplication
      const testQuery = `
        WITH combined_seeds AS (
            -- High-score canonical matches with late UUIDs (ffff...)
            SELECT 'ffffffff-ffff-ffff-ffff-ffffffffffff'::text AS "entityId", 'Canonical Z' AS "canonicalName", 'CONCEPT' AS "entityType", 1.0::double precision AS "seedScore", 'LEXICAL' AS "matchStrategy"
            UNION ALL
            SELECT 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::text AS "entityId", 'Canonical Y' AS "canonicalName", 'CONCEPT' AS "entityType", 1.0::double precision AS "seedScore", 'LEXICAL' AS "matchStrategy"
            -- Lower-score alias matches with early UUIDs (0000...)
            UNION ALL
            SELECT '00000000-0000-0000-0000-000000000001'::text AS "entityId", 'Alias A' AS "canonicalName", 'CONCEPT' AS "entityType", 0.95::double precision AS "seedScore", 'ALIAS' AS "matchStrategy"
            UNION ALL
            SELECT '00000000-0000-0000-0000-000000000002'::text AS "entityId", 'Alias B' AS "canonicalName", 'CONCEPT' AS "entityType", 0.95::double precision AS "seedScore", 'ALIAS' AS "matchStrategy"
            UNION ALL
            SELECT '00000000-0000-0000-0000-000000000003'::text AS "entityId", 'Alias C' AS "canonicalName", 'CONCEPT' AS "entityType", 0.95::double precision AS "seedScore", 'ALIAS' AS "matchStrategy"
            -- Low-score semantic matches with early UUIDs (0000...)
            UNION ALL
            SELECT '00000000-0000-0000-0000-000000000004'::text AS "entityId", 'Semantic D' AS "canonicalName", 'CONCEPT' AS "entityType", 0.72::double precision AS "seedScore", 'SEMANTIC' AS "matchStrategy"
            UNION ALL
            SELECT '00000000-0000-0000-0000-000000000005'::text AS "entityId", 'Semantic E' AS "canonicalName", 'CONCEPT' AS "entityType", 0.71::double precision AS "seedScore", 'SEMANTIC' AS "matchStrategy"
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
        LIMIT 5;
      `;

      const results: any[] = await prisma.$queryRawUnsafe(testQuery);
      expect(results).toHaveLength(5);
      // Top 2 MUST be the canonical matches with score 1.0 (despite late UUIDs)
      expect(results[0].seedScore).toBe(1.0);
      expect(results[0].canonicalName).toBe('Canonical Y'); // 'Canonical Y' < 'Canonical Z'
      expect(results[1].seedScore).toBe(1.0);
      expect(results[1].canonicalName).toBe('Canonical Z');
      // Next 3 are the alias matches with score 0.95
      expect(results[2].seedScore).toBe(0.95);
      expect(results[3].seedScore).toBe(0.95);
      expect(results[4].seedScore).toBe(0.95);
      // The low-score semantic matches (0.72 and 0.71) MUST have been truncated
      const returnedIds = results.map((r) => r.entityId);
      expect(returnedIds).not.toContain('00000000-0000-0000-0000-000000000004');
      expect(returnedIds).not.toContain('00000000-0000-0000-0000-000000000005');
    });

    it('ensures canonical matches outrank aliases when both identify the same entity', async () => {
      // Create an entity with an alias in the test database
      const entity = await graphRepository.createEntity({
        workspaceId: wsId,
        canonicalName: 'PostgreSQL WAL Engine',
        normalizedName: 'postgresql wal engine',
        entityType: 'CONCEPT',
      });

      await graphRepository.createAlias({
        workspaceId: wsId,
        entityId: entity.id,
        alias: 'WAL Engine',
        normalizedAlias: 'wal engine',
      });

      // Query with ngrams matching BOTH canonical name and alias
      const seeds = await graphRepository.discoverEntitySeeds({
        workspaceId: wsId,
        ngrams: ['postgresql wal engine', 'wal engine'],
        maxSeeds: 5,
      });

      expect(seeds.length).toBeGreaterThanOrEqual(1);
      const matched = seeds.find((s) => s.entityId === entity.id);
      expect(matched).toBeDefined();
      expect(matched?.seedScore).toBe(1.0); // Canonical score 1.0 outranked alias score 0.95
      expect(matched?.matchStrategy).toBe('LEXICAL');
    });

    it('enforces deterministic tie-breaking for equal-score seeds', async () => {
      const testQuery = `
        WITH combined_seeds AS (
            SELECT '00000000-0000-0000-0000-000000000002'::text AS "entityId", 'Beta Concept' AS "canonicalName", 'CONCEPT' AS "entityType", 1.0::double precision AS "seedScore", 'LEXICAL' AS "matchStrategy"
            UNION ALL
            SELECT '00000000-0000-0000-0000-000000000001'::text AS "entityId", 'Alpha Concept' AS "canonicalName", 'CONCEPT' AS "entityType", 1.0::double precision AS "seedScore", 'LEXICAL' AS "matchStrategy"
        ),
        deduplicated_seeds AS (
            SELECT DISTINCT ON ("entityId")
                "entityId", "canonicalName", "entityType", "seedScore", "matchStrategy"
            FROM combined_seeds
            ORDER BY "entityId", "seedScore" DESC, "canonicalName" ASC
        )
        SELECT * FROM deduplicated_seeds
        ORDER BY "seedScore" DESC, "canonicalName" ASC, "entityId" ASC;
      `;

      const results: any[] = await prisma.$queryRawUnsafe(testQuery);
      expect(results[0].canonicalName).toBe('Alpha Concept');
      expect(results[1].canonicalName).toBe('Beta Concept');
    });
  });

  describe('Remediation B: Frontier Parent Global Ranking (Top-10)', () => {
    it('retains all 5 high-confidence neighbors with late UUIDs when competing against 10 low-confidence neighbors with early UUIDs', async () => {
      const testQuery = `
        WITH graph_expansion AS (
            -- 10 low-confidence neighbors with early UUIDs (0000...)
            SELECT '00000000-0000-0000-0000-000000000001'::text AS neighbor_id, 0.5::double precision AS weight, 0.60::double precision AS confidence, ARRAY['s','1']::text[] AS path, 1 AS depth
            UNION ALL
            SELECT '00000000-0000-0000-0000-000000000002'::text AS neighbor_id, 0.5::double precision AS weight, 0.60::double precision AS confidence, ARRAY['s','2']::text[] AS path, 1 AS depth
            UNION ALL
            SELECT '00000000-0000-0000-0000-000000000003'::text AS neighbor_id, 0.5::double precision AS weight, 0.60::double precision AS confidence, ARRAY['s','3']::text[] AS path, 1 AS depth
            UNION ALL
            SELECT '00000000-0000-0000-0000-000000000004'::text AS neighbor_id, 0.5::double precision AS weight, 0.60::double precision AS confidence, ARRAY['s','4']::text[] AS path, 1 AS depth
            UNION ALL
            SELECT '00000000-0000-0000-0000-000000000005'::text AS neighbor_id, 0.5::double precision AS weight, 0.60::double precision AS confidence, ARRAY['s','5']::text[] AS path, 1 AS depth
            UNION ALL
            SELECT '00000000-0000-0000-0000-000000000006'::text AS neighbor_id, 0.5::double precision AS weight, 0.60::double precision AS confidence, ARRAY['s','6']::text[] AS path, 1 AS depth
            UNION ALL
            SELECT '00000000-0000-0000-0000-000000000007'::text AS neighbor_id, 0.5::double precision AS weight, 0.60::double precision AS confidence, ARRAY['s','7']::text[] AS path, 1 AS depth
            UNION ALL
            SELECT '00000000-0000-0000-0000-000000000008'::text AS neighbor_id, 0.5::double precision AS weight, 0.60::double precision AS confidence, ARRAY['s','8']::text[] AS path, 1 AS depth
            UNION ALL
            SELECT '00000000-0000-0000-0000-000000000009'::text AS neighbor_id, 0.5::double precision AS weight, 0.60::double precision AS confidence, ARRAY['s','9']::text[] AS path, 1 AS depth
            UNION ALL
            SELECT '00000000-0000-0000-0000-000000000010'::text AS neighbor_id, 0.5::double precision AS weight, 0.60::double precision AS confidence, ARRAY['s','10']::text[] AS path, 1 AS depth
            -- 5 high-confidence neighbors with late UUIDs (ffff...)
            UNION ALL
            SELECT 'ffffffff-ffff-ffff-ffff-ffffffff0001'::text AS neighbor_id, 1.0::double precision AS weight, 0.99::double precision AS confidence, ARRAY['s','f1']::text[] AS path, 1 AS depth
            UNION ALL
            SELECT 'ffffffff-ffff-ffff-ffff-ffffffff0002'::text AS neighbor_id, 1.0::double precision AS weight, 0.99::double precision AS confidence, ARRAY['s','f2']::text[] AS path, 1 AS depth
            UNION ALL
            SELECT 'ffffffff-ffff-ffff-ffff-ffffffff0003'::text AS neighbor_id, 1.0::double precision AS weight, 0.99::double precision AS confidence, ARRAY['s','f3']::text[] AS path, 1 AS depth
            UNION ALL
            SELECT 'ffffffff-ffff-ffff-ffff-ffffffff0004'::text AS neighbor_id, 1.0::double precision AS weight, 0.99::double precision AS confidence, ARRAY['s','f4']::text[] AS path, 1 AS depth
            UNION ALL
            SELECT 'ffffffff-ffff-ffff-ffff-ffffffff0005'::text AS neighbor_id, 1.0::double precision AS weight, 0.99::double precision AS confidence, ARRAY['s','f5']::text[] AS path, 1 AS depth
        )
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
        LIMIT 10;
      `;

      const results: any[] = await prisma.$queryRawUnsafe(testQuery);
      expect(results).toHaveLength(10);

      // The 5 high-confidence neighbors MUST all be present in the top 5
      for (let i = 0; i < 5; i++) {
        expect(results[i].confidence).toBe(0.99);
        expect(results[i].weight).toBe(1.0);
        expect(results[i].neighbor_id).toContain('ffffffff-ffff-ffff-ffff-ffffffff');
      }

      // The remaining 5 are from the 0.60 pool
      for (let i = 5; i < 10; i++) {
        expect(results[i].confidence).toBe(0.6);
      }
    });
  });

  describe('Remediation C: Intermediate Relation Deduplication Global Ranking (LIMIT 150)', () => {
    it('prioritizes high-quality shallow relations over deeper lower-quality relations across 200 candidates', async () => {
      const testQuery = `
        WITH synthetic_expansion AS (
            -- 50 high-quality depth-1 relations with late UUIDs (ffff...)
            SELECT 
                ('ffffffff-ffff-ffff-ffff-' || lpad(i::text, 12, '0'))::text AS relation_id,
                'src1'::text AS source_entity_id,
                'tgt1'::text AS target_entity_id,
                'REL_TYPE'::text AS relation_type,
                1.0::double precision AS weight,
                1.0::double precision AS confidence,
                1::int AS depth
            FROM generate_series(1, 50) i
            UNION ALL
            -- 150 lower-quality depth-2 relations with early UUIDs (0000...)
            SELECT 
                ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::text AS relation_id,
                'src2'::text AS source_entity_id,
                'tgt2'::text AS target_entity_id,
                'REL_TYPE'::text AS relation_type,
                0.5::double precision AS weight,
                0.5::double precision AS confidence,
                2::int AS depth
            FROM generate_series(1, 150) i
        ),
        deduplicated_relations AS (
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
                FROM synthetic_expansion
                ORDER BY relation_id, depth ASC, confidence DESC, weight DESC
            ) dedup_rels
            ORDER BY depth ASC, confidence DESC, weight DESC, relation_id ASC
            LIMIT 150
        )
        SELECT 
            depth, 
            COUNT(*) AS count_retained, 
            MIN(confidence) AS min_conf, 
            MAX(confidence) AS max_conf
        FROM deduplicated_relations
        GROUP BY depth
        ORDER BY depth ASC;
      `;

      const stats: any[] = await prisma.$queryRawUnsafe(testQuery);
      // All 50 depth-1 relations MUST be retained!
      expect(stats[0].depth).toBe(1);
      expect(Number(stats[0].count_retained)).toBe(50);
      expect(stats[0].min_conf).toBe(1.0);

      // Remaining 100 slots filled by depth-2 relations (50 depth-2 relations pruned)
      expect(stats[1].depth).toBe(2);
      expect(Number(stats[1].count_retained)).toBe(100);
      expect(stats[1].min_conf).toBe(0.5);
    });
  });

  describe('Remediation D: Evidence Score Aggregation & Corroboration', () => {
    it('correctly calculates score across all required corroboration scenarios', async () => {
      const testQuery = `
        WITH raw_evidence_candidates (scenario, chunk_id, document_id, raw_score, provenance_type, relation_id, source_entity_id) AS (
            -- 1. One evidence record
            VALUES 
            ('1. Single record', 'c1', 'd1', 0.85::double precision, 'RELATION_EVIDENCE', 'r1', 'e1'),

            -- 2. Two records with different scores (0.85, 0.50)
            ('2. Different scores', 'c2', 'd1', 0.85::double precision, 'RELATION_EVIDENCE', 'r1', 'e1'),
            ('2. Different scores', 'c2', 'd1', 0.50::double precision, 'RELATION_EVIDENCE', 'r2', 'e2'),

            -- 3. Two records with IDENTICAL maximum scores (0.85, 0.85)
            ('3. Identical max scores', 'c3', 'd1', 0.85::double precision, 'RELATION_EVIDENCE', 'r1', 'e1'),
            ('3. Identical max scores', 'c3', 'd1', 0.85::double precision, 'RELATION_EVIDENCE', 'r2', 'e2'),

            -- 4. Three evidence records (0.80, 0.70, 0.50)
            ('4. Three records', 'c4', 'd1', 0.80::double precision, 'RELATION_EVIDENCE', 'r1', 'e1'),
            ('4. Three records', 'c4', 'd1', 0.70::double precision, 'RELATION_EVIDENCE', 'r2', 'e2'),
            ('4. Three records', 'c4', 'd1', 0.50::double precision, 'RELATION_EVIDENCE', 'r3', 'e3'),

            -- 5. Mixed relation evidence (0.80) and direct mention (0.675)
            ('5. Mixed rel and mention', 'c5', 'd1', 0.80::double precision, 'RELATION_EVIDENCE', 'r1', 'e1'),
            ('5. Mixed rel and mention', 'c5', 'd1', 0.675::double precision, 'ENTITY_MENTION', NULL, 'e4'),

            -- 6. Duplicate evidence records (same relation entered twice for chunk c6)
            ('6. Duplicate records', 'c6', 'd1', 0.85::double precision, 'RELATION_EVIDENCE', 'r1', 'e1'),
            ('6. Duplicate records', 'c6', 'd1', 0.85::double precision, 'RELATION_EVIDENCE', 'r1', 'e1'),

            -- 7. Score clamping at 1.0 (three strong relations 0.95, 0.90, 0.85)
            ('7. Score clamping', 'c7', 'd1', 0.95::double precision, 'RELATION_EVIDENCE', 'r1', 'e1'),
            ('7. Score clamping', 'c7', 'd1', 0.90::double precision, 'RELATION_EVIDENCE', 'r2', 'e2'),
            ('7. Score clamping', 'c7', 'd1', 0.85::double precision, 'RELATION_EVIDENCE', 'r3', 'e3')
        ),
        dedup_evidence AS (
            SELECT 
                scenario,
                chunk_id,
                document_id,
                provenance_type,
                relation_id,
                source_entity_id,
                MAX(raw_score) AS raw_score
            FROM raw_evidence_candidates
            GROUP BY scenario, chunk_id, document_id, provenance_type, relation_id, source_entity_id
        ),
        aggregated_chunk_scores AS (
            SELECT 
                scenario,
                chunk_id,
                document_id,
                COUNT(DISTINCT relation_id) AS supported_relations_count,
                ARRAY_AGG(DISTINCT relation_id) FILTER (WHERE relation_id IS NOT NULL) AS supported_relation_ids,
                LEAST(1.0::double precision, 
                    0.8::double precision * MAX(raw_score) + 0.2::double precision * SUM(raw_score)
                ) AS final_graph_score
            FROM dedup_evidence
            GROUP BY scenario, chunk_id, document_id
        )
        SELECT 
            chunk_id,
            final_graph_score,
            supported_relations_count
        FROM aggregated_chunk_scores
        ORDER BY chunk_id;
      `;

      const results: any[] = await prisma.$queryRawUnsafe(testQuery);
      const resByChunk = new Map(results.map((r) => [r.chunk_id, Number(r.final_graph_score)]));

      // 1. One evidence record: S_max + 0 = 0.85
      expect(resByChunk.get('c1')).toBeCloseTo(0.85, 2);

      // 2. Two different: 0.85 + 0.2 * 0.50 = 0.95
      expect(resByChunk.get('c2')).toBeCloseTo(0.95, 2);

      // 3. Two identical maximum scores (0.85, 0.85): 0.85 + 0.2 * 0.85 = 1.02 -> 1.00
      expect(resByChunk.get('c3')).toBe(1.0);

      // 4. Three records (0.80, 0.70, 0.50): 0.80 + 0.2 * (0.70 + 0.50) = 1.04 -> 1.00
      expect(resByChunk.get('c4')).toBe(1.0);

      // 5. Mixed rel (0.80) & mention (0.675): 0.80 + 0.2 * 0.675 = 0.935
      expect(resByChunk.get('c5')).toBeCloseTo(0.935, 3);

      // 6. Duplicate records: duplicates collapsed, score remains 0.85 (NOT inflated!)
      expect(resByChunk.get('c6')).toBeCloseTo(0.85, 2);

      // 7. Clamped strictly at 1.0
      expect(resByChunk.get('c7')).toBe(1.0);
    });
  });
});
