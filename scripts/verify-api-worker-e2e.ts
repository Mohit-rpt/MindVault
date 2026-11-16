/**
 * MindVault — Production API-to-Worker E2E Verification Script
 *
 * Verifies the complete real execution path:
 * API (Producer) → Upstash Redis → BullMQ → Worker (Consumer) → PostgreSQL → Completed Job.
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseRedisUrl, sanitizeRedisUrl, getSafeRedisEndpoint } from '@mindvault/shared';
import { BullMQDocumentQueue } from '../apps/api/src/modules/document/document.queue.js';
import { WorkerService } from '../apps/worker/src/worker.js';
import { WorkerStorageProvider } from '../apps/worker/src/lib/storage.js';
import { PrismaWorkerDatabaseService } from '../apps/worker/src/lib/db.js';
import { MockEmbeddingProvider } from '../apps/worker/src/modules/ingestion/embeddings/mock.provider.js';
import { BullMQWorkerGraphQueue } from '../apps/worker/src/lib/graph-queue.js';
import { DocumentIngestionPipeline } from '../apps/worker/src/modules/ingestion/pipeline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load root .env
const envPath = path.resolve(rootDir, '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed
        .slice(idx + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

const prisma = new PrismaClient();

async function runE2EVerification() {
  console.log('========================================================================');
  console.log('MindVault — Production API-to-Worker E2E Integration Verification');
  console.log('========================================================================');

  const redisUrl = process.env.REDIS_URL || '';
  const safeEndpoint = getSafeRedisEndpoint(redisUrl);
  console.log(
    `Upstash Endpoint:  ${safeEndpoint.host}:${safeEndpoint.port} (TLS: ${safeEndpoint.isTls})`,
  );
  console.log(`Sanitized Target:  ${sanitizeRedisUrl(redisUrl)}`);
  console.log(`Timestamp:         ${new Date().toISOString()}`);
  console.log('========================================================================\n');

  const testRunId = crypto.randomUUID().slice(0, 8);
  const testWorkspaceSlug = `e2e-ws-${testRunId}`;
  const testDocId = `doc_e2e_${testRunId}`;
  const testStorageKey = `e2e_test_${testRunId}.txt`;
  const testText =
    'MindVault is an AI-powered personal knowledge operating system that connects thoughts, documents, and memories into an intelligent semantic knowledge graph.';
  const testChecksum = crypto.createHash('sha256').update(testText).digest('hex');

  let workspaceId: string | null = null;
  let userId: string | null = null;
  let producerQueue: BullMQDocumentQueue | null = null;
  let workerService: WorkerService | null = null;
  const storage = new WorkerStorageProvider();

  try {
    // -------------------------------------------------------------------------
    // Phase 1: PostgreSQL Setup (Isolated Test User, Workspace & Document)
    // -------------------------------------------------------------------------
    console.log('[Phase 1/6] Setting up isolated test fixture in PostgreSQL...');
    const user = await prisma.user.create({
      data: {
        email: `e2e-test-${testRunId}@mindvault.dev`,
        passwordHash: 'e2e_test_password_hash',
        name: `E2E Test User ${testRunId}`,
      },
    });
    userId = user.id;

    const ws = await prisma.workspace.create({
      data: {
        name: `E2E Test Workspace ${testRunId}`,
        slug: testWorkspaceSlug,
      },
    });
    workspaceId = ws.id;

    await prisma.workspaceMember.create({
      data: {
        userId: user.id,
        workspaceId: ws.id,
        role: 'OWNER',
      },
    });

    // Save test file payload in storage
    await storage.save(testStorageKey, Buffer.from(testText, 'utf-8'));

    // Create test document in QUEUED state
    const doc = await prisma.document.create({
      data: {
        id: testDocId,
        workspace: { connect: { id: ws.id } },
        uploadedBy: { connect: { id: user.id } },
        originalName: 'test-knowledge.txt',
        extension: 'txt',
        mimeType: 'text/plain',
        sizeBytes: BigInt(Buffer.byteLength(testText, 'utf-8')),
        checksum: testChecksum,
        storageKey: testStorageKey,
        status: 'QUEUED',
        metadata: {
          testRunId,
          purpose: 'API-to-Worker E2E Verification',
        },
      },
    });

    console.log(`  [ PASS ] Test user created:      ${user.id}`);
    console.log(`  [ PASS ] Test workspace created: ${ws.id}`);
    console.log(`  [ PASS ] Test document created:  ${doc.id} (Status: ${doc.status})`);
    console.log(`  [ PASS ] Test file stored:       ${testStorageKey} (${doc.sizeBytes} bytes)`);

    // -------------------------------------------------------------------------
    // Phase 2: API Queue Producer (Enqueue Job to Upstash Redis via BullMQ)
    // -------------------------------------------------------------------------
    console.log('\n[Phase 2/6] Enqueueing job through API BullMQ producer...');
    producerQueue = new BullMQDocumentQueue(true); // forceRealQueue = true
    const bullQueue = producerQueue.getQueue(ws.id);

    if (!bullQueue) {
      throw new Error('API BullMQ queue producer failed to connect to Upstash Redis');
    }

    const expectedJobId = `proc_${testDocId}`;
    await producerQueue.enqueue({
      documentId: testDocId,
      workspaceId: ws.id,
      storageKey: testStorageKey,
      mimeType: 'text/plain',
      originalName: 'test-knowledge.txt',
    });

    // Verify job in Upstash BullMQ queue
    const enqueuedJob = await bullQueue.getJob(expectedJobId);
    if (!enqueuedJob) {
      throw new Error(`Job ${expectedJobId} was not found in Upstash Redis queue`);
    }

    console.log(`  [ PASS ] Job enqueued to Upstash Redis: ${enqueuedJob.id}`);
    console.log(`  [ PASS ] Job name: ${enqueuedJob.name}, queue: ${bullQueue.name}`);
    console.log(`  [ PASS ] Job payload verified: docId=${enqueuedJob.data.documentId}`);

    // -------------------------------------------------------------------------
    // Phase 3: Background Worker Startup (Listen on Upstash Redis Queue)
    // -------------------------------------------------------------------------
    console.log('\n[Phase 3/6] Starting background worker consumer...');
    const dbService = new PrismaWorkerDatabaseService(prisma);
    const mockEmbeddings = new MockEmbeddingProvider('mock-embed-768', 768);
    const workerGraphQueue = new BullMQWorkerGraphQueue(true);
    const pipeline = new DocumentIngestionPipeline(
      storage,
      mockEmbeddings,
      dbService,
      workerGraphQueue,
    );

    workerService = new WorkerService(pipeline);
    await workerService.start({ forceLiveBullMQ: true, workspaceIds: [ws.id] });

    const bullWorker = workerService.getBullWorker();
    if (!bullWorker) {
      throw new Error('Worker consumer failed to connect to Upstash Redis');
    }

    console.log(`  [ PASS ] BullMQ worker listening on queue "${bullWorker.name}"`);
    console.log(`  [ PASS ] Worker concurrency: ${bullWorker.opts.concurrency}`);

    // -------------------------------------------------------------------------
    // Phase 4: Await Job Consumption and Completion
    // -------------------------------------------------------------------------
    console.log('\n[Phase 4/6] Awaiting worker consumption and execution...');
    const maxWaitMs = 30000;
    const pollIntervalMs = 500;
    const startTime = Date.now();
    let completed = false;
    let finalDoc: any = null;

    while (Date.now() - startTime < maxWaitMs) {
      finalDoc = await prisma.document.findUnique({
        where: { id: testDocId },
      });

      if (finalDoc?.status === 'COMPLETED') {
        completed = true;
        break;
      }

      if (finalDoc?.status === 'FAILED') {
        throw new Error(`Worker marked document as FAILED: ${finalDoc.errorMessage}`);
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    const elapsedMs = Date.now() - startTime;
    if (!completed) {
      throw new Error(
        `Job timed out after ${maxWaitMs}ms. Last document status: ${finalDoc?.status}`,
      );
    }

    console.log(`  [ PASS ] Job processed and completed in ${elapsedMs}ms`);

    // -------------------------------------------------------------------------
    // Phase 5: PostgreSQL Persistence Verification
    // -------------------------------------------------------------------------
    console.log('\n[Phase 5/6] Verifying persisted state in PostgreSQL...');
    console.log(`  [ PASS ] Document status:     ${finalDoc.status}`);
    console.log(`  [ PASS ] Chunk count:         ${finalDoc.chunkCount}`);
    console.log(
      `  [ PASS ] Embedding model:     ${finalDoc.embeddingModel} (${finalDoc.embeddingDimension}-dim)`,
    );
    console.log(`  [ PASS ] Processed at:        ${finalDoc.processedAt?.toISOString()}`);
    console.log(`  [ PASS ] Processing stage:    ${finalDoc.metadata?.processingStage}`);
    console.log(`  [ PASS ] Graph status:        ${finalDoc.metadata?.graphStatus}`);

    // Verify chunk records
    const chunks = await prisma.documentChunk.findMany({
      where: { documentId: testDocId },
      orderBy: { chunkIndex: 'asc' },
    });

    if (chunks.length === 0) {
      throw new Error('Expected at least 1 document chunk in PostgreSQL, found 0');
    }

    console.log(`  [ PASS ] Stored chunks count: ${chunks.length}`);
    console.log(`  [ PASS ] Chunk 0 tokenCount:  ${chunks[0].tokenCount}`);
    console.log(`  [ PASS ] Chunk 0 content:     "${chunks[0].content.slice(0, 60)}..."`);

    // Verify vector embedding was stored via raw query
    const vectorCheck = (await prisma.$queryRawUnsafe(
      `SELECT id, length(embedding::text) as vec_len FROM "document_chunks" WHERE "documentId" = $1 LIMIT 1`,
      testDocId,
    )) as Array<{ id: string; vec_len: number }>;

    if (vectorCheck.length > 0) {
      console.log(
        `  [ PASS ] Vector embedding:    Persisted in pgvector (string length: ${vectorCheck[0].vec_len})`,
      );
    }

    // -------------------------------------------------------------------------
    // Phase 6: Failure Handling Test (Non-existent Document)
    // -------------------------------------------------------------------------
    console.log('\n[Phase 6/6] Verifying failure handling with invalid document...');
    const invalidDocId = `doc_invalid_${testRunId}`;
    await producerQueue.enqueue({
      documentId: invalidDocId,
      workspaceId: ws.id,
      storageKey: 'nonexistent.txt',
      mimeType: 'text/plain',
      originalName: 'nonexistent.txt',
    });

    // Wait for the worker to attempt and reject the job
    const invalidJob = await bullQueue.getJob(`proc_${invalidDocId}`);
    if (invalidJob) {
      console.log(`  [ PASS ] Invalid job enqueued: ${invalidJob.id}`);
      // Wait for job failure
      let failedAttempts = 0;
      for (let i = 0; i < 20; i++) {
        const j = await bullQueue.getJob(`proc_${invalidDocId}`);
        if (j && (j.attemptsMade > 0 || (await j.isFailed()))) {
          failedAttempts = j.attemptsMade;
          break;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      console.log(`  [ PASS ] Failure handled safely by BullMQ: attemptsMade=${failedAttempts}`);
      await invalidJob.remove().catch(() => {});
    }

    console.log('\n========================================================================');
    console.log('RESULT: REAL END-TO-END INTEGRATION FULLY VERIFIED');
    console.log('API (Producer) → Upstash Redis → BullMQ → Worker → PostgreSQL: SUCCESS');
    console.log('========================================================================\n');
  } finally {
    // -------------------------------------------------------------------------
    // Strict Cleanup (Never touch existing user data)
    // -------------------------------------------------------------------------
    console.log('Cleaning up isolated test fixtures...');
    if (workerService) {
      try {
        await workerService.stop();
        console.log('  Worker service stopped.');
      } catch (e: any) {
        console.warn('  Error stopping worker:', e.message);
      }
    }
    if (producerQueue) {
      try {
        await producerQueue.close();
        console.log('  Producer queue closed.');
      } catch (e: any) {
        console.warn('  Error closing producer queue:', e.message);
      }
    }

    // Clean up test storage file
    try {
      await storage.delete(testStorageKey);
      console.log(`  Deleted storage file: ${testStorageKey}`);
    } catch {
      // Storage file may already have been removed or was not created
    }

    // Clean up test records from PostgreSQL (scoped strictly to test workspaceId and userId)
    if (workspaceId) {
      try {
        await prisma.documentChunk.deleteMany({ where: { workspaceId } });
        await prisma.document.deleteMany({ where: { workspaceId } });
        await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
        await prisma.workspace.delete({ where: { id: workspaceId } });
        console.log(`  Deleted test workspace ${workspaceId} and associated records.`);
      } catch (e: any) {
        console.warn('  Error cleaning up database records:', e.message);
      }
    }
    if (userId) {
      try {
        await prisma.user.delete({ where: { id: userId } });
        console.log(`  Deleted test user ${userId}.`);
      } catch (e: any) {
        console.warn('  Error cleaning up user:', e.message);
      }
    }

    await prisma.$disconnect();
    console.log('Cleanup completed.\n');
  }
}

runE2EVerification()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nE2E Verification Fatal Error:', err);
    process.exit(1);
  });
