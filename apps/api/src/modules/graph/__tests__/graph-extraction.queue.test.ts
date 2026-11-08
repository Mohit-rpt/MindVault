import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatExtractionJobId,
  computeChunkManifestHash,
  GRAPH_EXTRACTION_QUEUE_NAME,
  GRAPH_EXTRACTION_JOB_NAME,
  GRAPH_QUEUE_DEFAULT_JOB_OPTIONS,
  LUA_ACQUIRE_LEASE_SCRIPT,
  LUA_RENEW_LEASE_SCRIPT,
  LUA_RELEASE_LEASE_SCRIPT,
} from '@mindvault/shared';
import {
  InMemoryGraphExtractionQueue,
  BullMQGraphExtractionQueue,
} from '../queue/graph-extraction.queue.js';

describe('Phase 6.4.1: Queue Deduplication, Manifest Invalidation & Lock Contracts', () => {
  describe('Deterministic Job ID Generation (§6.3.3)', () => {
    it('generates run-bound deterministic job IDs', () => {
      const docId = 'doc-12345';
      const runId = 'run-67890';
      const jobId = formatExtractionJobId(docId, runId);

      expect(jobId).toBe('graph_doc-12345_run-67890');
    });

    it('generates distinct job IDs for different runs of the same document', () => {
      const docId = 'doc-12345';
      const run1 = 'run-aaa';
      const run2 = 'run-bbb';

      const id1 = formatExtractionJobId(docId, run1);
      const id2 = formatExtractionJobId(docId, run2);

      expect(id1).not.toBe(id2);
      expect(id1).toBe('graph_doc-12345_run-aaa');
      expect(id2).toBe('graph_doc-12345_run-bbb');
    });
  });

  describe('Content-Sensitive Chunk Manifest Invalidation (§6.8.1)', () => {
    const documentChecksum = 'doc-checksum-abc123xyz';
    const baseChunks = [
      { chunkIndex: 0, id: 'chk_0', content: 'Introductory overview of distributed systems.' },
      {
        chunkIndex: 1,
        id: 'chk_1',
        content: 'PostgreSQL provides robust row-level locking primitives.',
      },
      {
        chunkIndex: 2,
        id: 'chk_2',
        content: 'BullMQ handles reliable asynchronous job queues in Redis.',
      },
    ];

    it('computes a consistent deterministic SHA-256 hash for identical input', () => {
      const hash1 = computeChunkManifestHash(documentChecksum, baseChunks);
      const hash2 = computeChunkManifestHash(documentChecksum, baseChunks);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // Valid SHA-256 hex string
    });

    it('guarantees invariant output regardless of input chunk array ordering (deterministic sorting by chunkIndex)', () => {
      const shuffledChunks = [baseChunks[2], baseChunks[0], baseChunks[1]];

      const hashOriginal = computeChunkManifestHash(documentChecksum, baseChunks);
      const hashShuffled = computeChunkManifestHash(documentChecksum, shuffledChunks);

      expect(hashShuffled).toBe(hashOriginal);
    });

    it('invalidates manifest hash when chunk content changes while chunk IDs remain unchanged', () => {
      // Simulate modifying text content while preserving identical chunk IDs
      const modifiedChunks = [
        baseChunks[0],
        { chunkIndex: 1, id: 'chk_1', content: 'PostgreSQL provides FOR NO KEY UPDATE locks.' }, // Modified text
        baseChunks[2],
      ];

      const hashBase = computeChunkManifestHash(documentChecksum, baseChunks);
      const hashModified = computeChunkManifestHash(documentChecksum, modifiedChunks);

      expect(hashModified).not.toBe(hashBase);
    });

    it('invalidates manifest hash when document checksum changes', () => {
      const hash1 = computeChunkManifestHash('checksum-v1', baseChunks);
      const hash2 = computeChunkManifestHash('checksum-v2', baseChunks);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Unified Queue Configuration & Defaults (§6.3.7)', () => {
    it('exposes standard queue and job name constants', () => {
      expect(GRAPH_EXTRACTION_QUEUE_NAME).toBe('graph-extraction');
      expect(GRAPH_EXTRACTION_JOB_NAME).toBe('extract-graph');
    });

    it('defines standard retry and retention lifecycles', () => {
      expect(GRAPH_QUEUE_DEFAULT_JOB_OPTIONS.attempts).toBe(3);
      expect(GRAPH_QUEUE_DEFAULT_JOB_OPTIONS.backoff).toEqual({
        type: 'exponential',
        delay: 2000,
      });
      expect(GRAPH_QUEUE_DEFAULT_JOB_OPTIONS.removeOnComplete).toEqual({
        count: 500,
        age: 86400,
      });
      expect(GRAPH_QUEUE_DEFAULT_JOB_OPTIONS.removeOnFail).toEqual({
        count: 200,
        age: 604800,
      });
    });
  });

  describe('Redis Lua Lease Scripts (§6.5.2)', () => {
    it('defines atomic Acquire Lease script with NX and EX', () => {
      expect(LUA_ACQUIRE_LEASE_SCRIPT).toContain(
        'redis.call("set", KEYS[1], ARGV[1], "NX", "EX", ARGV[2])',
      );
    });

    it('defines atomic Compare-and-Expire renewal script', () => {
      expect(LUA_RENEW_LEASE_SCRIPT).toContain('if redis.call("get", KEYS[1]) == ARGV[1] then');
      expect(LUA_RENEW_LEASE_SCRIPT).toContain('return redis.call("expire", KEYS[1], ARGV[2])');
    });

    it('defines atomic Compare-and-Delete release script', () => {
      expect(LUA_RELEASE_LEASE_SCRIPT).toContain('if redis.call("get", KEYS[1]) == ARGV[1] then');
      expect(LUA_RELEASE_LEASE_SCRIPT).toContain('return redis.call("del", KEYS[1])');
    });
  });

  describe('InMemoryGraphExtractionQueue Operations', () => {
    let queue: InMemoryGraphExtractionQueue;

    beforeEach(() => {
      queue = new InMemoryGraphExtractionQueue();
    });

    it('enqueues with deterministic jobId and preserves extractionRunId', async () => {
      const jobId = await queue.enqueue({
        documentId: 'doc-999',
        workspaceId: 'ws-111',
        extractionRunId: 'run-xyz',
        chunkManifestHash: 'manifest-hash-123',
      });

      expect(jobId).toBe('graph_doc-999_run-xyz');
      expect(queue.jobs).toHaveLength(1);
      expect(queue.jobs[0].extractionRunId).toBe('run-xyz');
      expect(queue.jobs[0].chunkManifestHash).toBe('manifest-hash-123');
    });

    it('generates fresh runId when extractionRunId is not provided', async () => {
      const jobId = await queue.enqueue({
        documentId: 'doc-888',
        workspaceId: 'ws-111',
      });

      expect(jobId).toMatch(/^graph_doc-888_[a-f0-9-]+$/);
      expect(queue.jobs[0].extractionRunId).toBeDefined();
    });

    it('supports getJob to check queue presence', async () => {
      const jobId = await queue.enqueue({
        documentId: 'doc-777',
        workspaceId: 'ws-111',
        extractionRunId: 'run-777',
      });

      const foundJob = await queue.getJob(jobId);
      expect(foundJob).not.toBeNull();
      expect(foundJob?.id).toBe(jobId);
      expect(foundJob?.data.documentId).toBe('doc-777');

      const nonExistent = await queue.getJob('non-existent-id');
      expect(nonExistent).toBeNull();
    });

    it('clears state on close', async () => {
      await queue.enqueue({
        documentId: 'doc-1',
        workspaceId: 'ws-1',
      });
      expect(queue.jobs).toHaveLength(1);

      await queue.close();
      expect(queue.jobs).toHaveLength(0);
    });
  });
});
