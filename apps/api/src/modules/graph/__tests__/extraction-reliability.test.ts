import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { graphRepository } from '../repositories/graph.repository.js';
import {
  RelationResolver,
  APPROVED_RELATION_TYPES,
  validateEvidenceInChunk,
} from '../resolvers/relation.resolver.js';
import { EntityNormalizer } from '../normalizers/entity.normalizer.js';
import { GraphExtractionService } from '../services/graph-extraction.service.js';
import { MockExtractionProvider } from '../providers/mock-extraction.provider.js';

describe('Phase 6.3: Extraction Reliability & Controlled Triples Suite', () => {
  let wsId: string;
  let docId: string;
  let chunkId: string;
  let relationResolver: RelationResolver;

  beforeAll(async () => {
    relationResolver = new RelationResolver(graphRepository);

    // Create Workspace
    const ws = await prisma.workspace.create({
      data: {
        name: 'Extraction Reliability WS',
        slug: `extract-rel-${Date.now()}`,
      },
    });
    wsId = ws.id;

    // Create User
    const user = await prisma.user.create({
      data: {
        email: `reliability-${Date.now()}@mindvault.dev`,
        passwordHash: 'dummy',
        name: 'Reliability Tester',
      },
    });

    // Create Document
    const doc = await prisma.document.create({
      data: {
        workspaceId: wsId,
        uploadedById: user.id,
        originalName: 'Reliability_Doc.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: BigInt(2048),
        checksum: `chk-rel-${Date.now()}`,
        storageKey: `key-rel-${Date.now()}`,
      },
    });
    docId = doc.id;

    const chunk = await prisma.documentChunk.create({
      data: {
        documentId: docId,
        workspaceId: wsId,
        chunkIndex: 0,
        content:
          'TypeScript extends JavaScript functionality and compiles to standard ECMAScript code.',
        tokenCount: 12,
      },
    });
    chunkId = chunk.id;
  });

  afterAll(async () => {
    if (wsId) {
      await prisma.workspace.delete({ where: { id: wsId } });
    }
  });

  describe('1. Controlled Directed Triples & Schema Validation', () => {
    const entityMap = new Map<string, string>([
      ['typescript', 'ent-ts-id'],
      ['javascript', 'ent-js-id'],
    ]);
    const chunkText =
      'TypeScript extends JavaScript functionality and compiles to standard ECMAScript code.';

    it('rejects self-loops with SELF_LOOP failure reason', () => {
      const result = relationResolver.validateWithDetails(
        {
          sourceEntity: 'TypeScript',
          targetEntity: 'TypeScript', // Self-loop
          relationType: 'USES',
          evidence: 'TypeScript extends JavaScript functionality',
          confidence: 0.9,
        },
        entityMap,
        chunkText,
      );

      expect(result.isValid).toBe(false);
      expect(result.failureReason).toBe('SELF_LOOP');
      expect(
        relationResolver.validate(
          {
            sourceEntity: 'TypeScript',
            targetEntity: 'TypeScript',
            relationType: 'USES',
            evidence: 'TypeScript extends JavaScript functionality',
            confidence: 0.9,
          },
          entityMap,
          chunkText,
        ),
      ).toBeNull();
    });

    it('rejects unlinked / unresolved endpoints with UNRESOLVED_ENDPOINT failure reason', () => {
      const result = relationResolver.validateWithDetails(
        {
          sourceEntity: 'TypeScript',
          targetEntity: 'UnresolvedGhostLibrary',
          relationType: 'USES',
          evidence: 'TypeScript extends JavaScript functionality',
          confidence: 0.9,
        },
        entityMap,
        chunkText,
      );

      expect(result.isValid).toBe(false);
      expect(result.failureReason).toBe('UNRESOLVED_ENDPOINT');
    });

    it('normalizes recognized synonyms to canonical approved vocabulary', () => {
      const synonymsToTest: Array<{ raw: string; expected: string }> = [
        { raw: 'based on', expected: 'DEPENDS_ON' },
        { raw: 'created_by', expected: 'DEVELOPED' },
        { raw: 'includes', expected: 'CONTAINS' },
        { raw: 'extends', expected: 'IMPLEMENTS' },
        { raw: 'linked to', expected: 'CONNECTS_TO' },
        { raw: 'utilizes', expected: 'USES' },
        { raw: 'compiles_to', expected: 'PRODUCES' },
        { raw: 'compared to', expected: 'SIMILAR_TO' },
      ];

      for (const { raw, expected } of synonymsToTest) {
        const normalized = EntityNormalizer.normalizeRelationType(raw);
        expect(normalized).toBe(expected);
        expect(APPROVED_RELATION_TYPES.has(normalized)).toBe(true);
      }
    });

    it('rejects unapproved / arbitrary relation predicates with UNSUPPORTED_RELATION_TYPE', () => {
      const result = relationResolver.validateWithDetails(
        {
          sourceEntity: 'TypeScript',
          targetEntity: 'JavaScript',
          relationType: 'ARBITRARY_HALLUCINATED_VERB_XYZ',
          evidence: 'TypeScript extends JavaScript functionality',
          confidence: 0.9,
        },
        entityMap,
        chunkText,
      );

      expect(result.isValid).toBe(false);
      expect(result.failureReason).toBe('UNSUPPORTED_RELATION_TYPE');
    });

    it('rejects low confidence relations (< 0.5) with LOW_CONFIDENCE', () => {
      const result = relationResolver.validateWithDetails(
        {
          sourceEntity: 'TypeScript',
          targetEntity: 'JavaScript',
          relationType: 'EXTENDS', // normalized to IMPLEMENTS
          evidence: 'TypeScript extends JavaScript functionality',
          confidence: 0.42, // Under 0.5 threshold
        },
        entityMap,
        chunkText,
      );

      expect(result.isValid).toBe(false);
      expect(result.failureReason).toBe('LOW_CONFIDENCE');
    });

    it('strictly validates evidence grounding and rejects fabricated continuations', () => {
      // 1. Exact valid substring passes
      expect(
        validateEvidenceInChunk('TypeScript extends JavaScript functionality', chunkText),
      ).toBe(true);

      // 2. Whitespace variation and outer quotes pass
      expect(
        validateEvidenceInChunk('"TypeScript   extends   JavaScript  functionality"', chunkText),
      ).toBe(true);

      // 3. Allowed trailing punctuation passes
      expect(
        validateEvidenceInChunk('TypeScript extends JavaScript functionality.', chunkText),
      ).toBe(true);

      // 4. Fabricated continuation rejected
      expect(
        validateEvidenceInChunk(
          'TypeScript extends JavaScript functionality and replaces Python completely in web browsers.',
          chunkText,
        ),
      ).toBe(false);

      // 5. Completely absent evidence rejected
      const missingResult = relationResolver.validateWithDetails(
        {
          sourceEntity: 'TypeScript',
          targetEntity: 'JavaScript',
          relationType: 'IMPLEMENTS',
          evidence: 'Non-existent claim about completely unrelated technology.',
          confidence: 0.9,
        },
        entityMap,
        chunkText,
      );
      expect(missingResult.isValid).toBe(false);
      expect(missingResult.failureReason).toBe('INVALID_EVIDENCE');
    });

    it('preserves directional semantics for directed relations and canonicalizes symmetric ones', () => {
      // Directed: source -> target preserved exactly
      const directed = relationResolver.validateWithDetails(
        {
          sourceEntity: 'TypeScript',
          targetEntity: 'JavaScript',
          relationType: 'USES',
          evidence: 'TypeScript extends JavaScript functionality',
          confidence: 0.9,
        },
        entityMap,
        chunkText,
      );
      expect(directed.isValid).toBe(true);
      expect(directed.validated?.sourceEntityId).toBe('ent-ts-id');
      expect(directed.validated?.targetEntityId).toBe('ent-js-id');

      // Symmetric: endpoints ordered deterministically
      const symmetric = relationResolver.validateWithDetails(
        {
          sourceEntity: 'TypeScript', // 'ent-ts-id'
          targetEntity: 'JavaScript', // 'ent-js-id' ('ent-js-id' < 'ent-ts-id')
          relationType: 'SIMILAR_TO',
          evidence: 'TypeScript extends JavaScript functionality',
          confidence: 0.9,
        },
        entityMap,
        chunkText,
      );
      expect(symmetric.isValid).toBe(true);
      expect(symmetric.validated?.sourceEntityId).toBe('ent-js-id');
      expect(symmetric.validated?.targetEntityId).toBe('ent-ts-id');
    });
  });

  describe('2. Extraction Diagnostics & Observability', () => {
    it('returns structured validation breakdown in ChunkExtractionResult without leaking secrets', async () => {
      const mockProvider = new MockExtractionProvider();
      // Configure canned response with a mix of valid, self-loop, unsupported, and ungrounded relations
      mockProvider.setDefaultResponse({
        version: '1.0',
        entities: [
          { name: 'TypeScript', entityType: 'TECHNOLOGY', aliases: [], confidence: 0.95 },
          { name: 'JavaScript', entityType: 'TECHNOLOGY', aliases: [], confidence: 0.95 },
        ],
        relations: [
          // 1. Valid relation
          {
            sourceEntity: 'TypeScript',
            targetEntity: 'JavaScript',
            relationType: 'EXTENDS', // mapped to IMPLEMENTS
            evidence: 'TypeScript extends JavaScript functionality',
            confidence: 0.9,
          },
          // 2. Self-loop
          {
            sourceEntity: 'TypeScript',
            targetEntity: 'TypeScript',
            relationType: 'USES',
            evidence: 'TypeScript extends JavaScript functionality',
            confidence: 0.9,
          },
          // 3. Unresolved endpoint
          {
            sourceEntity: 'TypeScript',
            targetEntity: 'PhantomLibrary',
            relationType: 'USES',
            evidence: 'TypeScript extends JavaScript functionality',
            confidence: 0.9,
          },
          // 4. Unsupported relation type
          {
            sourceEntity: 'TypeScript',
            targetEntity: 'JavaScript',
            relationType: 'XYZ_INVALID_RELATION',
            evidence: 'TypeScript extends JavaScript functionality',
            confidence: 0.9,
          },
          // 5. Low confidence
          {
            sourceEntity: 'TypeScript',
            targetEntity: 'JavaScript',
            relationType: 'USES',
            evidence: 'TypeScript extends JavaScript functionality',
            confidence: 0.25,
          },
          // 6. Invalid ungrounded evidence
          {
            sourceEntity: 'TypeScript',
            targetEntity: 'JavaScript',
            relationType: 'USES',
            evidence: 'Completely fabricated sentence not in chunk.',
            confidence: 0.9,
          },
        ],
      });

      const service = new GraphExtractionService({
        graphRepo: graphRepository,
        provider: mockProvider,
      });

      const content =
        'TypeScript extends JavaScript functionality and compiles to standard ECMAScript code.';
      const result = await service.extractFromChunk(wsId, docId, chunkId, content);

      expect(result.relationsExtracted).toBe(6);
      expect(result.relationsPersisted).toBe(1); // Only 1 valid relation persisted
      expect(result.diagnostics).toBeDefined();
      expect(result.diagnostics?.provider).toBe('mock');

      // Verify exact failure breakdown counts
      const failures = result.diagnostics!.validationFailures;
      expect(failures.selfLoops).toBe(1);
      expect(failures.unresolvedEndpoints).toBe(1);
      expect(failures.unsupportedRelationType).toBe(1);
      expect(failures.lowConfidence).toBe(1);
      expect(failures.invalidEvidence).toBe(1);
    });

    it('aggregates validation failures across all chunks in DocumentGraphExtractionResult', async () => {
      const mockProvider = new MockExtractionProvider();
      mockProvider.setDefaultResponse({
        version: '1.0',
        entities: [{ name: 'TypeScript', entityType: 'TECHNOLOGY', aliases: [], confidence: 0.95 }],
        relations: [
          {
            sourceEntity: 'TypeScript',
            targetEntity: 'TypeScript', // self-loop
            relationType: 'USES',
            evidence: 'TypeScript extends JavaScript functionality',
            confidence: 0.9,
          },
        ],
      });

      const service = new GraphExtractionService({
        graphRepo: graphRepository,
        provider: mockProvider,
      });

      const docResult = await service.extractDocument(wsId, docId);

      expect(docResult.status).toBe('COMPLETED');
      expect(docResult.diagnostics).toBeDefined();
      expect(docResult.diagnostics?.totalValidationFailures.selfLoops).toBeGreaterThanOrEqual(1);
    });
  });
});
