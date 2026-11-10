import { randomUUID } from 'node:crypto';
import { prisma } from '../../../lib/prisma.js';
import { graphRepository } from '../repositories/graph.repository.js';
import {
  buildNeighborhoodQuery,
  buildPathFinderQuery,
} from '../queries/recursive-traversal.sql.js';
import { Prisma } from '@prisma/client';

interface PlanNode {
  'Node Type': string;
  'Total Cost': number;
  'Plan Rows': number;
  'Actual Rows': number;
  'Actual Total Time': number;
  'Shared Hit Blocks': number;
  'Shared Read Blocks': number;
  Plans?: PlanNode[];
  [key: string]: unknown;
}

interface ExplainJsonResult {
  Plan: PlanNode;
  'Planning Time': number;
  'Execution Time': number;
}

async function runBenchmark() {
  console.log('=== MindVault Phase 6.5 Empirical Performance Benchmark ===\n');

  // 1. PostgreSQL Version
  const versionRes = await prisma.$queryRawUnsafe<Array<{ version: string }>>('SELECT version()');
  console.log(`Database Version: ${versionRes[0]?.version}\n`);

  // 2. Setup Test Workspace
  const ws = await prisma.workspace.create({
    data: { name: 'Benchmark Workspace', slug: `bench-${randomUUID()}` },
  });
  const wsId = ws.id;

  const user = await prisma.user.create({
    data: {
      email: `bench-user-${randomUUID()}@mindvault.dev`,
      passwordHash: 'dummy',
      name: 'Benchmark User',
    },
  });

  const doc = await prisma.document.create({
    data: {
      workspaceId: wsId,
      uploadedById: user.id,
      originalName: 'BenchmarkDoc.pdf',
      mimeType: 'application/pdf',
      extension: 'pdf',
      sizeBytes: BigInt(2048),
      checksum: `ck-bench-${randomUUID()}`,
      storageKey: `key-bench-${randomUUID()}`,
    },
  });

  const chunk = await prisma.documentChunk.create({
    data: {
      workspaceId: wsId,
      documentId: doc.id,
      chunkIndex: 0,
      content: 'Benchmark chunk evidence',
      tokenCount: 50,
    },
  });

  console.log(`Created benchmark workspace: ${wsId}`);

  try {
    // -------------------------------------------------------------
    // Topology 1: Linear Chain of 6 Nodes (A -> B -> C -> D -> E -> F)
    // -------------------------------------------------------------
    const chainNodes: string[] = [];
    for (let i = 0; i < 6; i++) {
      const e = await graphRepository.createEntity({
        workspaceId: wsId,
        canonicalName: `Chain Node ${i}`,
        normalizedName: `chain-node-${i}-${randomUUID()}`,
        entityType: 'CONCEPT',
      });
      chainNodes.push(e.id);
    }

    for (let i = 0; i < 5; i++) {
      const r = await graphRepository.createRelation({
        workspaceId: wsId,
        sourceEntityId: chainNodes[i],
        targetEntityId: chainNodes[i + 1],
        relationType: 'LEADS_TO',
        weight: 0.9,
        confidence: 0.95,
      });
      await graphRepository.createEvidence({
        workspaceId: wsId,
        relationId: r.id,
        chunkId: chunk.id,
        documentId: doc.id,
        evidenceText: `Chain evidence ${i} to ${i + 1}`,
      });
    }

    // -------------------------------------------------------------
    // Topology 2: Dense Hub with 60 Outgoing Edges
    // -------------------------------------------------------------
    const hub = await graphRepository.createEntity({
      workspaceId: wsId,
      canonicalName: 'Central Hub',
      normalizedName: `central-hub-${randomUUID()}`,
      entityType: 'CONCEPT',
    });
    const hubId = hub.id;

    for (let i = 0; i < 60; i++) {
      const spoke = await graphRepository.createEntity({
        workspaceId: wsId,
        canonicalName: `Hub Spoke ${i}`,
        normalizedName: `hub-spoke-${i}-${randomUUID()}`,
        entityType: 'CONCEPT',
      });
      const r = await graphRepository.createRelation({
        workspaceId: wsId,
        sourceEntityId: hubId,
        targetEntityId: spoke.id,
        relationType: 'CONNECTS_SPOKE',
        weight: Number((0.5 + (i % 50) * 0.01).toFixed(2)),
        confidence: Number((0.7 + (i % 30) * 0.01).toFixed(2)),
      });
      await graphRepository.createEvidence({
        workspaceId: wsId,
        relationId: r.id,
        chunkId: chunk.id,
        documentId: doc.id,
        evidenceText: `Hub evidence ${i}`,
      });
    }

    // -------------------------------------------------------------
    // Topology 3: Interconnected Grid / Cross edges
    // -------------------------------------------------------------
    const gridNodes: string[] = [];
    for (let i = 0; i < 10; i++) {
      const g = await graphRepository.createEntity({
        workspaceId: wsId,
        canonicalName: `Grid Node ${i}`,
        normalizedName: `grid-node-${i}-${randomUUID()}`,
        entityType: 'CONCEPT',
      });
      gridNodes.push(g.id);
    }
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        if (i !== j && (i + j) % 3 === 0) {
          const r = await graphRepository.createRelation({
            workspaceId: wsId,
            sourceEntityId: gridNodes[i],
            targetEntityId: gridNodes[j],
            relationType: 'INTERACTS',
            weight: 0.8,
            confidence: 0.85,
          });
          await graphRepository.createEvidence({
            workspaceId: wsId,
            relationId: r.id,
            chunkId: chunk.id,
            documentId: doc.id,
            evidenceText: `Grid evidence ${i}->${j}`,
          });
        }
      }
    }

    console.log(
      'Topology populated: 6-node chain, 60-edge hub, and 10-node interconnected mesh.\n',
    );

    // =============================================================
    // BENCHMARK 1: Neighborhood Traversal (depth=3, limit=100)
    // =============================================================
    console.log('--- 1. Neighborhood Traversal (depth=3, limit=100, direction=both) ---');
    const neighQuery = buildNeighborhoodQuery({
      workspaceId: wsId,
      centerEntityId: chainNodes[0],
      maxDepth: 3,
      limit: 100,
      direction: 'both',
    });

    // 1A. Text EXPLAIN (ANALYZE, BUFFERS)
    const neighTextExplain = await prisma.$queryRaw<Array<{ 'QUERY PLAN': string }>>(
      Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, VERBOSE) ${neighQuery}`,
    );
    console.log('Execution Plan:');
    for (const row of neighTextExplain) {
      console.log(row['QUERY PLAN']);
    }

    // 1B. Latency distribution across 10 iterations
    const neighTimes: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      await graphRepository.traverseNeighborhood({
        workspaceId: wsId,
        centerEntityId: chainNodes[0],
        maxDepth: 3,
        limit: 100,
        direction: 'both',
      });
      neighTimes.push(performance.now() - t0);
    }
    neighTimes.sort((a, b) => a - b);
    console.log(`\nLatency across 10 runs (ms):`);
    console.log(`  Min:    ${neighTimes[0].toFixed(2)} ms`);
    console.log(`  Median: ${neighTimes[Math.floor(neighTimes.length / 2)].toFixed(2)} ms`);
    console.log(
      `  Mean:   ${(neighTimes.reduce((a, b) => a + b, 0) / neighTimes.length).toFixed(2)} ms`,
    );
    console.log(`  P95:    ${neighTimes[Math.floor(neighTimes.length * 0.95)].toFixed(2)} ms`);
    console.log(`  Max:    ${neighTimes[neighTimes.length - 1].toFixed(2)} ms\n`);

    // =============================================================
    // BENCHMARK 2: Dense Hub Traversal (60 Outgoing Edges, limit=100)
    // =============================================================
    console.log('--- 2. Dense Hub Traversal (60 Outgoing Edges, depth=2, limit=100) ---');
    const hubQuery = buildNeighborhoodQuery({
      workspaceId: wsId,
      centerEntityId: hubId,
      maxDepth: 2,
      limit: 100,
      direction: 'both',
    });

    const hubTextExplain = await prisma.$queryRaw<Array<{ 'QUERY PLAN': string }>>(
      Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, VERBOSE) ${hubQuery}`,
    );
    console.log('Execution Plan:');
    for (const row of hubTextExplain) {
      console.log(row['QUERY PLAN']);
    }

    const hubTimes: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      await graphRepository.traverseNeighborhood({
        workspaceId: wsId,
        centerEntityId: hubId,
        maxDepth: 2,
        limit: 100,
        direction: 'both',
      });
      hubTimes.push(performance.now() - t0);
    }
    hubTimes.sort((a, b) => a - b);
    console.log(`\nLatency across 10 runs (ms):`);
    console.log(`  Min:    ${hubTimes[0].toFixed(2)} ms`);
    console.log(`  Median: ${hubTimes[Math.floor(hubTimes.length / 2)].toFixed(2)} ms`);
    console.log(
      `  Mean:   ${(hubTimes.reduce((a, b) => a + b, 0) / hubTimes.length).toFixed(2)} ms`,
    );
    console.log(`  P95:    ${hubTimes[Math.floor(hubTimes.length * 0.95)].toFixed(2)} ms`);
    console.log(`  Max:    ${hubTimes[hubTimes.length - 1].toFixed(2)} ms\n`);

    // =============================================================
    // BENCHMARK 3: Directed Path Discovery (maxDepth=4, limit=10)
    // =============================================================
    console.log(
      '--- 3. Directed Path Discovery (maxDepth=4, limit=10, 4 hops: Node 0 -> Node 4) ---',
    );
    const pathQuery = buildPathFinderQuery({
      workspaceId: wsId,
      sourceEntityId: chainNodes[0],
      targetEntityId: chainNodes[4],
      maxDepth: 4,
      limit: 10,
    });

    const pathTextExplain = await prisma.$queryRaw<Array<{ 'QUERY PLAN': string }>>(
      Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, VERBOSE) ${pathQuery}`,
    );
    console.log('Execution Plan:');
    for (const row of pathTextExplain) {
      console.log(row['QUERY PLAN']);
    }

    const pathTimes: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      await graphRepository.findPaths({
        workspaceId: wsId,
        sourceEntityId: chainNodes[0],
        targetEntityId: chainNodes[4],
        maxDepth: 4,
        limit: 10,
      });
      pathTimes.push(performance.now() - t0);
    }
    pathTimes.sort((a, b) => a - b);
    console.log(`\nLatency across 10 runs (ms):`);
    console.log(`  Min:    ${pathTimes[0].toFixed(2)} ms`);
    console.log(`  Median: ${pathTimes[Math.floor(pathTimes.length / 2)].toFixed(2)} ms`);
    console.log(
      `  Mean:   ${(pathTimes.reduce((a, b) => a + b, 0) / pathTimes.length).toFixed(2)} ms`,
    );
    console.log(`  P95:    ${pathTimes[Math.floor(pathTimes.length * 0.95)].toFixed(2)} ms`);
    console.log(`  Max:    ${pathTimes[pathTimes.length - 1].toFixed(2)} ms\n`);
  } finally {
    // Cleanup benchmark workspace
    await prisma.workspace.delete({ where: { id: wsId } });
    await prisma.user.delete({ where: { id: user.id } });
    console.log('Cleaned up benchmark workspace and resources.');
  }
}

runBenchmark()
  .catch((err) => {
    console.error('Benchmark failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
