import { describe, it, expect } from 'vitest';
import { EntityNormalizer } from '../normalizers/entity.normalizer.js';

describe('Phase 6.2: EntityNormalizer Unit Tests', () => {
  describe('normalize()', () => {
    it('normalizes case consistently to lowercase', () => {
      expect(EntityNormalizer.normalize('PostgreSQL')).toBe('postgresql');
      expect(EntityNormalizer.normalize('POSTGRESQL')).toBe('postgresql');
      expect(EntityNormalizer.normalize('postgresql')).toBe('postgresql');
      expect(EntityNormalizer.normalize('Docker Engine')).toBe('docker engine');
    });

    it('collapses repeated internal whitespace and trims outer whitespace', () => {
      expect(EntityNormalizer.normalize('  Machine   Learning  ')).toBe('machine learning');
      expect(EntityNormalizer.normalize('\tVector\t\tSearch\n')).toBe('vector search');
      expect(EntityNormalizer.normalize('Reciprocal   Rank   Fusion')).toBe(
        'reciprocal rank fusion',
      );
    });

    it('handles unicode normalization (NFKC)', () => {
      // Fullwidth Latin characters
      expect(EntityNormalizer.normalize('Ｐｙｔｈｏｎ')).toBe('python');
      // Accented characters preserved cleanly
      expect(EntityNormalizer.normalize('Résumé Parsing')).toBe('résumé parsing');
      expect(EntityNormalizer.normalize('München')).toBe('münchen');
    });

    it('PRESERVES essential technical punctuation (+, #, ., /, -, _)', () => {
      // C++ must NOT become 'c'
      expect(EntityNormalizer.normalize('C++')).toBe('c++');
      expect(EntityNormalizer.normalize('c++')).toBe('c++');

      // C# must NOT become 'c'
      expect(EntityNormalizer.normalize('C#')).toBe('c#');
      expect(EntityNormalizer.normalize('F#')).toBe('f#');

      // Node.js must NOT become 'nodejs' or 'node js'
      expect(EntityNormalizer.normalize('Node.js')).toBe('node.js');
      expect(EntityNormalizer.normalize('Vue.js')).toBe('vue.js');

      // .NET
      expect(EntityNormalizer.normalize('.NET')).toBe('.net');
      expect(EntityNormalizer.normalize('.NET Core')).toBe('.net core');

      // Slash terms (TCP/IP, CI/CD, A/B Testing)
      expect(EntityNormalizer.normalize('TCP/IP')).toBe('tcp/ip');
      expect(EntityNormalizer.normalize('CI/CD')).toBe('ci/cd');
      expect(EntityNormalizer.normalize('A/B Testing')).toBe('a/b testing');

      // Hyphenated and snake_case terms
      expect(EntityNormalizer.normalize('Graph-RAG')).toBe('graph-rag');
      expect(EntityNormalizer.normalize('in-memory')).toBe('in-memory');
      expect(EntityNormalizer.normalize('user_session_id')).toBe('user_session_id');
    });

    it('cleans non-semantic trailing and leading boundary punctuation', () => {
      // Trailing periods from sentence boundaries must match canonical terms
      expect(EntityNormalizer.normalize('PostgreSQL.')).toBe('postgresql');
      expect(EntityNormalizer.normalize('Docker.')).toBe('docker');

      // Boundary hyphens and slashes
      expect(EntityNormalizer.normalize('- Docker -')).toBe('docker');
      expect(EntityNormalizer.normalize('/REST API/')).toBe('rest api');
      expect(EntityNormalizer.normalize('Microservices:')).toBe('microservices');
      expect(EntityNormalizer.normalize('Kubernetes;')).toBe('kubernetes');

      // But preserves leading dot for .NET
      expect(EntityNormalizer.normalize('.NET')).toBe('.net');
    });

    it('strips English possessive suffixes cleanly', () => {
      expect(EntityNormalizer.normalize("Google's")).toBe('google');
      expect(EntityNormalizer.normalize("Docker's")).toBe('docker');
      expect(EntityNormalizer.normalize('Kubernetes’')).toBe('kubernetes');
      expect(EntityNormalizer.normalize("Engineers'")).toBe('engineers');
    });

    it('strips unnecessary wrapping quotes, brackets, and parentheses', () => {
      expect(EntityNormalizer.normalize('"PostgreSQL"')).toBe('postgresql');
      expect(EntityNormalizer.normalize("'Redis'")).toBe('redis');
      expect(EntityNormalizer.normalize('[Node.js]')).toBe('node.js');
      expect(EntityNormalizer.normalize('(BullMQ)')).toBe('bullmq');
      expect(EntityNormalizer.normalize('“Docker”')).toBe('docker');
    });

    it('strips leading English articles for multi-word terms', () => {
      expect(EntityNormalizer.normalize('The V8 Engine')).toBe('v8 engine');
      expect(EntityNormalizer.normalize('A Neural Network')).toBe('neural network');
      expect(EntityNormalizer.normalize('An Algorithm')).toBe('algorithm');
      // But preserves single word if it is "The"
      expect(EntityNormalizer.normalize('The')).toBe('the');
    });

    it('handles empty, null, or invalid non-string inputs safely', () => {
      expect(EntityNormalizer.normalize('')).toBe('');
      expect(EntityNormalizer.normalize('   ')).toBe('');
      expect(EntityNormalizer.normalize(null as any)).toBe('');
      expect(EntityNormalizer.normalize(undefined as any)).toBe('');
    });
  });

  describe('extractDisambiguation()', () => {
    it('extracts primary stem and parenthetical alias', () => {
      expect(EntityNormalizer.extractDisambiguation('PostgreSQL (RDBMS)')).toEqual({
        stem: 'PostgreSQL',
        alias: 'RDBMS',
      });
      expect(EntityNormalizer.extractDisambiguation('Amazon Web Services (AWS)')).toEqual({
        stem: 'Amazon Web Services',
        alias: 'AWS',
      });
      expect(EntityNormalizer.extractDisambiguation('TypeScript (TS)')).toEqual({
        stem: 'TypeScript',
        alias: 'TS',
      });
    });

    it('returns original term as stem when no parenthetical suffix exists', () => {
      expect(EntityNormalizer.extractDisambiguation('Node.js')).toEqual({
        stem: 'Node.js',
      });
      expect(EntityNormalizer.extractDisambiguation('Docker Engine')).toEqual({
        stem: 'Docker Engine',
      });
    });

    it('handles empty, null, or invalid non-string inputs safely', () => {
      expect(EntityNormalizer.extractDisambiguation('')).toEqual({ stem: '' });
      expect(EntityNormalizer.extractDisambiguation(null as any)).toEqual({ stem: '' });
    });
  });

  describe('normalizeRelationType()', () => {
    it('normalizes relation types to uppercase underscored tokens', () => {
      expect(EntityNormalizer.normalizeRelationType('uses')).toBe('USES');
      expect(EntityNormalizer.normalizeRelationType('part of')).toBe('PART_OF');
      expect(EntityNormalizer.normalizeRelationType('depends-on')).toBe('DEPENDS_ON');
      expect(EntityNormalizer.normalizeRelationType('implemented in')).toBe('IMPLEMENTED_IN');
      expect(EntityNormalizer.normalizeRelationType('IS_A')).toBe('IS_A');
    });

    it('canonicalizes synonymous relation types to schema standard vocabulary', () => {
      expect(EntityNormalizer.normalizeRelationType('depends upon')).toBe('DEPENDS_ON');
      expect(EntityNormalizer.normalizeRelationType('relies_on')).toBe('DEPENDS_ON');
      expect(EntityNormalizer.normalizeRelationType('utilizes')).toBe('USES');
      expect(EntityNormalizer.normalizeRelationType('leverages')).toBe('USES');
      expect(EntityNormalizer.normalizeRelationType('component of')).toBe('PART_OF');
      expect(EntityNormalizer.normalizeRelationType('is_part_of')).toBe('PART_OF');
      expect(EntityNormalizer.normalizeRelationType('belongs_to')).toBe('PART_OF');
      expect(EntityNormalizer.normalizeRelationType('communicates with')).toBe('CONNECTS_TO');
      expect(EntityNormalizer.normalizeRelationType('integrates_with')).toBe('CONNECTS_TO');
      expect(EntityNormalizer.normalizeRelationType('persists')).toBe('STORES');
      expect(EntityNormalizer.normalizeRelationType('employed by')).toBe('WORKS_FOR');
      expect(EntityNormalizer.normalizeRelationType('based in')).toBe('LOCATED_IN');
      expect(EntityNormalizer.normalizeRelationType('headquartered_in')).toBe('LOCATED_IN');
    });

    it('defaults to RELATED_TO for empty or invalid types', () => {
      expect(EntityNormalizer.normalizeRelationType('')).toBe('RELATED_TO');
      expect(EntityNormalizer.normalizeRelationType('   ')).toBe('RELATED_TO');
      expect(EntityNormalizer.normalizeRelationType(null as any)).toBe('RELATED_TO');
    });
  });
});
