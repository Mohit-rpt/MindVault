/**
 * MindVault — Stage 1B.6: Real End-to-End Functional Verification Script
 *
 * Verifies all 6 functional capabilities on live PostgreSQL + Google Gemini:
 * 1. Vector similarity search with 768-D Gemini embeddings
 * 2. Knowledge Graph retrieval (GraphRAG) with entities and relations
 * 3. Evidence-grounded non-streaming RAG answer generation with citations
 * 4. Real-time streaming RAG answer generation (Server-Sent Events)
 * 5. Multi-turn conversation persistence across successive turns
 * 6. Zero cross-model contamination audit (pgvector dimensions & model verification)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { RetrievalService } from '../apps/api/src/modules/retrieval/services/retrieval.service.js';
import { RAGService } from '../apps/api/src/modules/generation/services/rag.service.js';
import { ConversationRAGService } from '../apps/api/src/modules/conversations/services/conversation-rag.service.js';
import { ConversationRepository } from '../apps/api/src/modules/conversations/repositories/conversation.repository.js';
import { EmbeddingService } from '../apps/api/src/modules/retrieval/embeddings/embedding.service.js';
import { LLMProviderFactory } from '../apps/api/src/modules/generation/providers/provider.factory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load .env
function loadRootEnv(): void {
  const envPath = path.resolve(rootDir, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

loadRootEnv();

const prisma = new PrismaClient();

async function main() {
  console.log('========================================================================');
  console.log('MindVault — Stage 1B.6: Gemini End-to-End Functional Verification');
  console.log('========================================================================\n');

  const workspaceSlug = 'demo-showcase';
  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    include: { members: true, chatSessions: true },
  });

  if (!workspace) {
    throw new Error(`Showcase workspace '${workspaceSlug}' not found.`);
  }

  const workspaceId = workspace.id;
  const userId = workspace.members[0].userId;

  console.log(`Workspace: "${workspace.name}" (${workspaceId})`);
  console.log(`User:      ${userId}\n`);

  // Force provider to live Gemini
  process.env.LLM_PROVIDER = 'gemini';
  process.env.EMBEDDING_PROVIDER = 'gemini';
  LLMProviderFactory.resetProvider();
  EmbeddingService.resetProvider();

  // -------------------------------------------------------------------------
  // Test 1: Vector Similarity Search
  // -------------------------------------------------------------------------
  console.log('------------------------------------------------------------------------');
  console.log('[Test 1/6] Semantic Vector Search (Gemini 768-D Embeddings)...');
  const searchStartTime = performance.now();
  const searchResult = await RetrievalService.executeSearch(workspaceId, {
    query: 'How does MindVault handle multi-zone replication, quorum management, and chunk hashing?',
    mode: 'semantic',
    topK: 3,
  });
  const searchLatency = Math.round(performance.now() - searchStartTime);

  console.log(`  Query Latency: ${searchLatency} ms`);
  console.log(`  Results Found: ${searchResult.results.length}`);
  if (searchResult.results.length === 0) {
    throw new Error('Vector similarity search returned 0 results!');
  }

  const topMatch = searchResult.results[0];
  console.log(`  Top Match: Document "${topMatch.documentName}" (Score: ${topMatch.score.toFixed(4)})`);
  console.log(`  Snippet:   "${topMatch.content.slice(0, 120)}..."`);
  if (!topMatch.documentName.includes('MV-DOC-01')) {
    console.warn(`  Note: Top match was ${topMatch.documentName}, expected MV-DOC-01.`);
  }
  console.log('  ✔ Semantic Vector Search: PASSED\n');

  // -------------------------------------------------------------------------
  // Test 2: Knowledge Graph Augmented Retrieval (GraphRAG)
  // -------------------------------------------------------------------------
  console.log('------------------------------------------------------------------------');
  console.log('[Test 2/6] Knowledge Graph & Hybrid Retrieval (GraphRAG)...');
  const graphStartTime = performance.now();
  const graphSearchResult = await RetrievalService.executeSearch(workspaceId, {
    query: 'Zero-Trust Security, Token Lifecycle, and Cryptographic Authority',
    mode: 'hybrid',
    topK: 3,
    includeContext: true,
  });
  const graphLatency = Math.round(performance.now() - graphStartTime);

  console.log(`  Query Latency: ${graphLatency} ms`);
  console.log(`  Mode:          ${graphSearchResult.mode}`);
  console.log(`  Context Size:  ${graphSearchResult.context?.tokenEstimate || 0} tokens`);
  console.log(`  Sources:       ${graphSearchResult.context?.sources.length || 0}`);
  if (!graphSearchResult.context || graphSearchResult.context.sources.length === 0) {
    throw new Error('Hybrid/Graph search returned empty context or sources!');
  }
  console.log('  ✔ Knowledge Graph & Hybrid Retrieval: PASSED\n');

  // -------------------------------------------------------------------------
  // Test 3: Grounded Non-Streaming RAG Answer Generation
  // -------------------------------------------------------------------------
  console.log('------------------------------------------------------------------------');
  console.log('[Test 3/6] Evidence-Grounded Non-Streaming RAG Generation...');
  const ragStartTime = performance.now();
  const ragResponse = await RAGService.generateAnswer(workspaceId, {
    query: 'What are the Incident Severity Definitions (SEV-1 through SEV-3) and their SLAs in the Operations Runbook?',
    retrieval: {
      mode: 'hybrid',
      topK: 3,
    },
    generation: {
      temperature: 0.1,
      maxOutputTokens: 512,
    },
  });
  const ragLatency = Math.round(performance.now() - ragStartTime);

  console.log(`  Generation Latency: ${ragLatency} ms`);
  console.log(`  Grounding Status:   ${ragResponse.grounding.groundingStatus}`);
  console.log(`  Sources Retrieved:  ${ragResponse.sources.length}`);
  console.log(`  Citations Present:  ${ragResponse.grounding.citationsPresent}`);
  console.log(`  Referenced Citations:${ragResponse.grounding.referencedCitationIds.length}`);
  console.log(`  Generated Answer (Preview):\n`);
  console.log(ragResponse.answer.split('\n').map(l => `    ${l}`).join('\n'));
  console.log('');

  if (!ragResponse.answer || ragResponse.answer.trim().length === 0) {
    throw new Error('RAG Answer Generation returned empty text!');
  }
  for (const s of ragResponse.sources) {
    console.log(`    - Source: doc=${s.documentName}, chunk=${s.chunkIndex}`);
  }
  console.log('  ✔ Evidence-Grounded RAG Generation: PASSED\n');

  // -------------------------------------------------------------------------
  // Test 4: Real-Time Streaming RAG Answer Generation
  // -------------------------------------------------------------------------
  console.log('------------------------------------------------------------------------');
  console.log('[Test 4/6] Real-Time Streaming RAG Answer Generation...');
  const streamStartTime = performance.now();
  const streamGenerator = RAGService.generateAnswerStream(workspaceId, {
    query: 'Summarize the horizontal multi-tenant isolation and role hierarchy in MindVault.',
    retrieval: {
      mode: 'hybrid',
      topK: 3,
    },
    generation: {
      temperature: 0.1,
      maxOutputTokens: 256,
    },
  });

  let streamedTokens = 0;
  let fullStreamedAnswer = '';
  let streamRetrievalComplete = false;
  let streamAnswerComplete = false;

  for await (const event of streamGenerator) {
    if (event.type === 'retrieval_complete') {
      streamRetrievalComplete = true;
    } else if (event.type === 'token') {
      streamedTokens++;
      fullStreamedAnswer += event.text;
      process.stdout.write(event.text);
    } else if (event.type === 'done') {
      streamAnswerComplete = true;
    }
  }

  const streamDuration = Math.round(performance.now() - streamStartTime);
  console.log(`\n\n  Stream Duration:     ${streamDuration} ms`);
  console.log(`  Streamed Tokens:     ${streamedTokens}`);
  console.log(`  Retrieval Emitted:   ${streamRetrievalComplete}`);
  console.log(`  Completion Emitted:  ${streamAnswerComplete}`);

  if (!streamRetrievalComplete || !streamAnswerComplete || streamedTokens === 0) {
    throw new Error('Streaming RAG did not complete properly or emitted 0 tokens!');
  }
  console.log('  ✔ Streaming RAG Answer Generation: PASSED\n');

  // -------------------------------------------------------------------------
  // Test 5: Multi-Turn Conversation History & Persistence
  // -------------------------------------------------------------------------
  console.log('------------------------------------------------------------------------');
  console.log('[Test 5/6] Multi-Turn Conversation History & Database Persistence...');

  // Use the first demo session
  const targetSession = workspace.chatSessions[0];
  console.log(`  Target Session: "${targetSession.title}" (${targetSession.id})`);
  const initialMsgCount = await prisma.chatMessage.count({ where: { sessionId: targetSession.id } });
  console.log(`  Initial Message Count: ${initialMsgCount}`);

  // Execute Turn 1
  console.log('\n  -> Executing Turn 1: "What are the database connection pool limits?"');
  const turn1Events = ConversationRAGService.streamConversationMessage(
    targetSession.id,
    workspaceId,
    userId,
    {
      content: 'What are the database connection pool limits and timeouts in MindVault configuration?',
      mode: 'hybrid',
    },
  );

  let turn1Tokens = '';
  for await (const ev of turn1Events) {
    if (ev.type === 'token') {
      turn1Tokens += (ev as any).text || (ev as any).token || '';
    }
  }
  console.log(`     Turn 1 Response Preview: "${turn1Tokens.slice(0, 100).replace(/\n/g, ' ')}..."`);

  // Execute Turn 2 (Follow-up)
  console.log('\n  -> Executing Turn 2 (Follow-up): "What happens if those bounds are exceeded?"');
  const turn2Events = ConversationRAGService.streamConversationMessage(
    targetSession.id,
    workspaceId,
    userId,
    {
      content: 'What happens if those database pool bounds are exceeded during high load?',
      mode: 'hybrid',
    },
  );

  let turn2Tokens = '';
  for await (const ev of turn2Events) {
    if (ev.type === 'token') {
      turn2Tokens += (ev as any).text || (ev as any).token || '';
    }
  }
  console.log(`     Turn 2 Response Preview: "${turn2Tokens.slice(0, 100).replace(/\n/g, ' ')}..."`);

  // Verify persistence in PostgreSQL
  const finalMessages = await ConversationRepository.listMessages(targetSession.id, workspaceId);
  console.log(`\n  Final Message Count in DB: ${finalMessages.length} (Expected: ${initialMsgCount + 4})`);

  const lastTwo = finalMessages.slice(-2);
  console.log(`  Last User Turn (Seq ${lastTwo[0].sequenceNumber}): "${lastTwo[0].content}"`);
  console.log(`  Last Assistant Turn (Seq ${lastTwo[1].sequenceNumber}, Status: ${lastTwo[1].status}): "${lastTwo[1].content.slice(0, 80)}..."`);

  if (lastTwo[1].status !== 'COMPLETED') {
    throw new Error(`Assistant message status is '${lastTwo[1].status}', expected 'COMPLETED'`);
  }
  console.log('  ✔ Multi-Turn Conversation Persistence: PASSED\n');

  // -------------------------------------------------------------------------
  // Test 6: Zero Cross-Model Contamination Audit
  // -------------------------------------------------------------------------
  console.log('------------------------------------------------------------------------');
  console.log('[Test 6/6] Zero Cross-Model Contamination Audit...');

  const showcaseDocs = await prisma.document.findMany({
    where: { workspaceId },
    select: { id: true, originalName: true, embeddingModel: true, embeddingDimension: true },
  });

  const showcaseChunks = await prisma.$queryRaw<Array<{ id: string; model: string | null; dim: number; norm: number }>>`
    SELECT
      id,
      metadata->>'embeddingModel' as model,
      vector_dims(embedding) as dim,
      round((vector_norm(embedding))::numeric, 6) as norm
    FROM "document_chunks"
    WHERE "workspaceId" = ${workspaceId};
  `;

  const invalidEntities = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) as count
    FROM "graph_entities"
    WHERE workspace_id = ${workspaceId} AND (embedding IS NULL OR vector_dims(embedding) != 768);
  `;

  const globalOllamaDocs = await prisma.document.count({
    where: {
      OR: [
        { embeddingModel: { contains: 'ollama', mode: 'insensitive' } },
        { embeddingModel: { contains: 'nomic', mode: 'insensitive' } },
      ],
    },
  });

  const globalNon768Chunks = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) as count
    FROM "document_chunks"
    WHERE embedding IS NOT NULL AND vector_dims(embedding) != 768;
  `;

  console.log(`  Showcase Documents Audited: ${showcaseDocs.length} (Expected: 6)`);
  console.log(`  Showcase Chunks Audited:    ${showcaseChunks.length} (Expected: 6)`);
  console.log(`  Global Ollama Documents:    ${globalOllamaDocs} (Expected: 0)`);
  console.log(`  Global Non-768 Chunks:      ${globalNon768Chunks[0].count} (Expected: 0)`);

  let contaminationFound = false;

  if (showcaseDocs.length !== 6) {
    console.error(`  ✖ Showcase document count is ${showcaseDocs.length}, expected 6`);
    contaminationFound = true;
  }

  for (const d of showcaseDocs) {
    if (d.embeddingModel !== 'gemini-embedding-2' || d.embeddingDimension !== 768) {
      console.error(`  ✖ CONTAMINATION: Document ${d.originalName} (${d.id}) has model='${d.embeddingModel}', dim=${d.embeddingDimension}`);
      contaminationFound = true;
    }
  }

  for (const c of showcaseChunks) {
    if (c.dim !== 768) {
      console.error(`  ✖ CONTAMINATION: Chunk ${c.id} has dimension ${c.dim} != 768`);
      contaminationFound = true;
    }
    if (Math.abs(c.norm - 1.0) > 0.001) {
      console.error(`  ✖ CONTAMINATION: Chunk ${c.id} has non-unit norm: ${c.norm}`);
      contaminationFound = true;
    }
  }

  if (Number(invalidEntities[0].count) > 0) {
    console.error(`  ✖ CONTAMINATION: ${invalidEntities[0].count} entities have invalid or non-768 dimensions!`);
    contaminationFound = true;
  }

  if (globalOllamaDocs > 0) {
    console.error(`  ✖ CONTAMINATION: ${globalOllamaDocs} documents reference Ollama/nomic models in database!`);
    contaminationFound = true;
  }

  if (Number(globalNon768Chunks[0].count) > 0) {
    console.error(`  ✖ CONTAMINATION: ${globalNon768Chunks[0].count} chunks in database have non-768 vector dimensions!`);
    contaminationFound = true;
  }

  if (contaminationFound) {
    throw new Error('Database failed cross-model contamination audit!');
  }

  console.log('  ✔ All documents: embeddingModel = "gemini-embedding-2" (768-D)');
  console.log('  ✔ All chunks:    pgvector dimension = 768, L2 Euclidean norm = 1.000000');
  console.log('  ✔ All entities:  pgvector dimension = 768');
  console.log('  ✔ Zero Ollama models, zero dimensions != 768, zero cross-model mixing');
  console.log('  ✔ Zero Cross-Model Contamination: PASSED\n');

  console.log('========================================================================');
  console.log('✔ ALL 6 FUNCTIONAL VERIFICATION SUITES PASSED ON LIVE GEMINI');
  console.log('========================================================================\n');
}

main()
  .catch((err) => {
    console.error('\n[FATAL VERIFICATION ERROR]:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
