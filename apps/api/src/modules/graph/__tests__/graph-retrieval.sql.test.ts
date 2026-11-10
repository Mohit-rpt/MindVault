import { describe, it, expect } from 'vitest';
import {
  buildSeedDiscoveryQuery,
  buildGraphEvidenceQuery,
  buildSupportingRelationsQuery,
} from '../queries/graph-retrieval.sql.js';
import { GraphTraversalTimeoutError } from '../errors/graph-traversal.error.js';

describe('Task 6.6.1 Unit Tests: SQL Query Builders & Contracts', () => {
  const dummyWorkspaceId = '11111111-1111-1111-1111-111111111111';
  const dummyEntityA = '22222222-2222-2222-2222-222222222222';
  const dummyEntityB = '33333333-3333-3333-3333-333333333333';
  const dummyRelAB = '44444444-4444-4444-4444-444444444444';

  describe('buildSeedDiscoveryQuery', () => {
    it('compiles lexical canonical and alias matching clauses with workspace isolation', () => {
      const query = buildSeedDiscoveryQuery({
        workspaceId: dummyWorkspaceId,
        ngrams: ['postgresql', 'wal'],
        maxSeeds: 5,
      });

      expect(query.sql).toContain('WHERE e.workspace_id =');
      expect(query.sql).toContain('WHERE a.workspace_id =');
      expect(query.sql).toContain('normalized_name = ANY(ARRAY[');
      expect(query.sql).toContain('normalized_alias = ANY(ARRAY[');
      expect(query.sql).toContain('DISTINCT ON ("entityId")');
      expect(query.sql).toContain('LIMIT');
    });

    it('compiles vector similarity branch when queryVector is provided', () => {
      const query = buildSeedDiscoveryQuery({
        workspaceId: dummyWorkspaceId,
        ngrams: ['postgresql'],
        queryVector: [0.1, 0.2, 0.3],
        maxSeeds: 3,
      });

      expect(query.sql).toContain('e.embedding <=>');
      expect(query.sql).toContain('::vector');
      expect(query.sql).toContain('\'SEMANTIC\'::text AS "matchStrategy"');
    });

    it('handles empty ngrams safely without syntax errors', () => {
      const query = buildSeedDiscoveryQuery({
        workspaceId: dummyWorkspaceId,
        ngrams: [],
        maxSeeds: 5,
      });

      expect(query.sql).toContain('WHERE false');
    });
  });

  describe('buildGraphEvidenceQuery', () => {
    it('compiles all 9 safety limits and structural invariants', () => {
      const query = buildGraphEvidenceQuery({
        workspaceId: dummyWorkspaceId,
        seedEntityIds: [dummyEntityA, dummyEntityB],
        topK: 25,
        minConfidence: 0.65,
        minWeight: 0.55,
      });

      // 1. Recursive CTE structure
      expect(query.sql).toContain('WITH RECURSIVE graph_expansion AS');
      // 2. Anchor ceiling LIMIT 50
      expect(query.sql).toContain('LIMIT 50 -- Global anchor ceiling');
      // 3. Frontier restriction (top 10 distinct neighbors)
      expect(query.sql).toContain('SELECT DISTINCT ON (neighbor_id)');
      expect(query.sql).toContain('WHERE depth = 1');
      expect(query.sql).toContain('LIMIT 10');
      // 4. Lateral limit (10 per frontier parent)
      expect(query.sql).toContain('JOIN LATERAL');
      expect(query.sql).toContain('LIMIT 10 -- Per-frontier lateral limit');
      // 5. Depth clamp strictly < 2
      expect(query.sql).toContain('ge.depth < 2');
      expect(query.sql).toContain('array_length(ge.path, 1) <= 3');
      // 6. Hard global intermediate ceiling: LIMIT 150 before evidence join
      expect(query.sql).toContain('deduplicated_relations AS');
      expect(query.sql).toContain('DISTINCT ON (relation_id)');
      expect(query.sql).toContain('LIMIT 150');
      // 7. Evidence separation (RELATION_EVIDENCE vs ENTITY_MENTION)
      expect(query.sql).toContain("'RELATION_EVIDENCE' AS provenance_type");
      expect(query.sql).toContain("'ENTITY_MENTION' AS provenance_type");
      // 8. Proper column quoting for document_chunks
      expect(query.sql).toContain('c."documentId" AS document_id');
      expect(query.sql).toContain('c."workspaceId" =');
      expect(query.sql).toContain('d."workspaceId" =');
      expect(query.sql).toContain("d.status = 'COMPLETED'");
      // 9. Score combination and outer top-K limit
      expect(query.sql).toContain('LEAST(1.0::double precision');
      expect(query.sql).toContain('LIMIT');
    });

    it('returns empty result query when seedEntityIds is empty', () => {
      const query = buildGraphEvidenceQuery({
        workspaceId: dummyWorkspaceId,
        seedEntityIds: [],
      });

      expect(query.sql).toContain('WHERE false');
    });
  });

  describe('buildSupportingRelationsQuery', () => {
    it('compiles query with entity joins and evidence aggregation', () => {
      const query = buildSupportingRelationsQuery(dummyWorkspaceId, [dummyRelAB]);

      expect(query.sql).toContain('FROM graph_relations r');
      expect(query.sql).toContain('se.canonical_name AS "sourceCanonicalName"');
      expect(query.sql).toContain('te.canonical_name AS "targetCanonicalName"');
      expect(query.sql).toContain('ARRAY_AGG(DISTINCT re.chunk_id)');
      expect(query.sql).toContain('r.workspace_id =');
    });

    it('returns empty query when relationIds is empty', () => {
      const query = buildSupportingRelationsQuery(dummyWorkspaceId, []);

      expect(query.sql).toContain('WHERE false');
    });
  });

  describe('GraphTraversalTimeoutError', () => {
    it('instantiates with 504 status and GRAPH_TRAVERSAL_TIMEOUT code', () => {
      const err = new GraphTraversalTimeoutError();
      expect(err.statusCode).toBe(504);
      expect(err.code).toBe('GRAPH_TRAVERSAL_TIMEOUT');
      expect(err.message).toContain('Graph traversal exceeded the 2500ms safety timeout');
    });
  });
});
