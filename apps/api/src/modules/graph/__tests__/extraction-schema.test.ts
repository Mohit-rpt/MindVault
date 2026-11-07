import { describe, it, expect } from 'vitest';
import {
  ExtractedEntitySchema,
  ExtractedRelationSchema,
  KnowledgeExtractionResponseSchema,
} from '@mindvault/shared';

describe('Phase 6.1: Knowledge Extraction Schema & Contract Tests', () => {
  describe('ExtractedEntitySchema', () => {
    it('validates a correct entity object', () => {
      const valid = {
        name: 'PostgreSQL',
        entityType: 'TECHNOLOGY',
        description: 'Open source relational database',
        aliases: ['postgres', 'pgsql'],
        confidence: 0.95,
        sourceText: 'PostgreSQL is an open-source database',
      };

      const result = ExtractedEntitySchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('PostgreSQL');
        expect(result.data.entityType).toBe('TECHNOLOGY');
        expect(result.data.aliases).toHaveLength(2);
      }
    });

    it('rejects an empty name', () => {
      const invalid = {
        name: '   ',
        entityType: 'CONCEPT',
      };
      const result = ExtractedEntitySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects an invalid entityType', () => {
      const invalid = {
        name: 'Invalid Type Entity',
        entityType: 'NON_EXISTENT_TYPE',
      };
      const result = ExtractedEntitySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects confidence out of range (< 0.0 or > 1.0)', () => {
      const tooHigh = {
        name: 'Test Entity',
        entityType: 'CONCEPT',
        confidence: 1.5,
      };
      expect(ExtractedEntitySchema.safeParse(tooHigh).success).toBe(false);

      const tooLow = {
        name: 'Test Entity',
        entityType: 'CONCEPT',
        confidence: -0.2,
      };
      expect(ExtractedEntitySchema.safeParse(tooLow).success).toBe(false);
    });

    it('defaults entityType to CONCEPT and confidence to 0.85 when omitted', () => {
      const minimal = {
        name: 'Algorithmic Search',
      };
      const result = ExtractedEntitySchema.safeParse(minimal);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.entityType).toBe('CONCEPT');
        expect(result.data.confidence).toBe(0.85);
        expect(result.data.aliases).toEqual([]);
      }
    });
  });

  describe('ExtractedRelationSchema', () => {
    it('validates a correct relation object', () => {
      const valid = {
        sourceEntity: 'PostgreSQL',
        targetEntity: 'pgvector',
        relationType: 'SUPPORTS',
        description: 'PostgreSQL supports pgvector extension',
        confidence: 0.9,
        evidence: 'PostgreSQL is an open-source database that supports pgvector extension.',
      };

      const result = ExtractedRelationSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.relationType).toBe('SUPPORTS');
      }
    });

    it('rejects missing sourceEntity or targetEntity', () => {
      const missingSource = {
        targetEntity: 'pgvector',
        relationType: 'SUPPORTS',
        evidence: 'Some evidence quote',
      };
      expect(ExtractedRelationSchema.safeParse(missingSource).success).toBe(false);

      const missingTarget = {
        sourceEntity: 'PostgreSQL',
        relationType: 'SUPPORTS',
        evidence: 'Some evidence quote',
      };
      expect(ExtractedRelationSchema.safeParse(missingTarget).success).toBe(false);
    });

    it('rejects missing evidence', () => {
      const missingEvidence = {
        sourceEntity: 'PostgreSQL',
        targetEntity: 'pgvector',
        relationType: 'SUPPORTS',
      };
      expect(ExtractedRelationSchema.safeParse(missingEvidence).success).toBe(false);
    });

    it('converts relationType to uppercase automatically', () => {
      const lowercase = {
        sourceEntity: 'Node.js',
        targetEntity: 'V8',
        relationType: 'embeds',
        evidence: 'Node.js embeds the V8 JavaScript engine.',
      };
      const result = ExtractedRelationSchema.safeParse(lowercase);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.relationType).toBe('EMBEDS');
      }
    });
  });

  describe('KnowledgeExtractionResponseSchema', () => {
    it('validates a complete response payload', () => {
      const payload = {
        version: '1.0',
        entities: [
          { name: 'Redis', entityType: 'TECHNOLOGY', aliases: ['redis-cache'], confidence: 0.99 },
          { name: 'BullMQ', entityType: 'TECHNOLOGY', aliases: [], confidence: 0.95 },
        ],
        relations: [
          {
            sourceEntity: 'BullMQ',
            targetEntity: 'Redis',
            relationType: 'USES',
            confidence: 0.92,
            evidence: 'BullMQ uses Redis for reliable job persistence.',
          },
        ],
      };

      const result = KnowledgeExtractionResponseSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.entities).toHaveLength(2);
        expect(result.data.relations).toHaveLength(1);
      }
    });

    it('rejects payload with more than 50 entities (overflow safeguard)', () => {
      const tooManyEntities = Array.from({ length: 55 }, (_, i) => ({
        name: `Entity ${i}`,
        entityType: 'CONCEPT',
      }));

      const payload = {
        version: '1.0',
        entities: tooManyEntities,
        relations: [],
      };

      const result = KnowledgeExtractionResponseSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('handles empty entities and relations gracefully with defaults', () => {
      const empty = {};
      const result = KnowledgeExtractionResponseSchema.safeParse(empty);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.entities).toEqual([]);
        expect(result.data.relations).toEqual([]);
        expect(result.data.version).toBe('1.0');
      }
    });
  });
});
