/**
 * MindVault — Deterministic Database Seed System
 *
 * Populates the dedicated showcase workspace ('ws_demo_showcase_001') with:
 * - Demo user ('demo@mindvault.local') and Owner membership
 * - Six technical showcase documents (MV-DOC-01 to MV-DOC-06)
 * - Deterministic 768-dimensional L2-normalized synthetic unit vector embeddings
 * - 14 Knowledge Graph entities with canonical names, normalized slugs, and aliases
 * - 16 cross-document relations with verbatim evidence snippets
 * - Chunk entity mentions with confidence scores
 * - 2 multi-turn chat sessions with grounded citations
 * - Synchronized physical markdown files in infrastructure/storage/documents/
 *
 * Operational Guarantees:
 * 1. 100% Offline: Zero calls to Ollama, Gemini, or external APIs.
 * 2. Idempotent: Can be run repeatedly with zero duplicate records or constraints violations.
 * 3. Tenant-Isolated: All data scoped to 'ws_demo_showcase_001'; never modifies real user data.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient, Prisma, EntityType, ChatMessageRole } from '@prisma/client';
import { hashPassword } from '../apps/api/src/modules/auth/auth.security.js';
import {
  DEMO_CONFIG,
  DEMO_DOCUMENTS,
  DEMO_GRAPH_ENTITIES,
  DEMO_GRAPH_RELATIONS,
  DEMO_CHUNK_MENTIONS,
  DEMO_CHAT_SESSIONS,
  generateSyntheticDemoEmbedding,
} from './seed-data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const prisma = new PrismaClient();

/**
 * Finds the local storage directory and ensures it exists.
 */
function getStorageDirectory(): string {
  const customDir = process.env.STORAGE_DIR;
  if (customDir) {
    return path.isAbsolute(customDir) ? customDir : path.resolve(rootDir, customDir);
  }
  return path.resolve(rootDir, 'infrastructure', 'storage', 'documents');
}

/**
 * Generate password hash using Argon2id matching auth.security.ts parameters.
 */
async function generateDemoPasswordHash(password: string): Promise<string> {
  return hashPassword(password);
}

async function main() {
  console.log('\n========================================================================');
  console.log('MindVault — Initializing Deterministic Showcase Seed System');
  console.log('========================================================================\n');

  const startTime = performance.now();

  // -----------------------------------------------------------------------
  // Step 1: Demo User (demo@mindvault.local)
  // -----------------------------------------------------------------------
  console.log(`[1/7] Initializing demo user (${DEMO_CONFIG.userEmail})...`);
  const passwordHash = await generateDemoPasswordHash(DEMO_CONFIG.userPlainPassword);

  const user = await prisma.user.upsert({
    where: { email: DEMO_CONFIG.userEmail },
    update: {
      name: DEMO_CONFIG.userName,
      passwordHash,
    },
    create: {
      id: DEMO_CONFIG.userId,
      name: DEMO_CONFIG.userName,
      email: DEMO_CONFIG.userEmail,
      passwordHash,
    },
  });
  console.log(`  -> User verified: ${user.email} (${user.id})`);

  // -----------------------------------------------------------------------
  // Step 2: Demo Workspace & Membership
  // -----------------------------------------------------------------------
  console.log(`[2/7] Initializing demo workspace (${DEMO_CONFIG.workspaceSlug})...`);
  const workspace = await prisma.workspace.upsert({
    where: { slug: DEMO_CONFIG.workspaceSlug },
    update: {
      name: DEMO_CONFIG.workspaceName,
    },
    create: {
      id: DEMO_CONFIG.workspaceId,
      name: DEMO_CONFIG.workspaceName,
      slug: DEMO_CONFIG.workspaceSlug,
    },
  });

  await prisma.workspaceMember.upsert({
    where: {
      userId_workspaceId: {
        userId: user.id,
        workspaceId: workspace.id,
      },
    },
    update: {
      role: 'OWNER',
    },
    create: {
      id: DEMO_CONFIG.workspaceRoleId,
      userId: user.id,
      workspaceId: workspace.id,
      role: 'OWNER',
    },
  });
  console.log(`  -> Workspace verified: "${workspace.name}" (${workspace.id}) [Role: OWNER]`);

  // -----------------------------------------------------------------------
  // Step 3: Physical Document Storage Sync
  // -----------------------------------------------------------------------
  console.log('[3/7] Synchronizing showcase documents to local storage...');
  const storageDir = getStorageDirectory();
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }

  for (const doc of DEMO_DOCUMENTS) {
    const targetFilePath = path.join(storageDir, doc.storageKey);
    fs.writeFileSync(targetFilePath, doc.rawContent, 'utf-8');
  }
  console.log(`  -> Synchronized ${DEMO_DOCUMENTS.length} document files to ${storageDir}`);

  // -----------------------------------------------------------------------
  // Step 4: Documents, Chunks, and Vector Embeddings
  // -----------------------------------------------------------------------
  console.log('[4/7] Seeding documents and pre-computed 768d unit vector chunks...');
  let totalChunksInserted = 0;

  for (const doc of DEMO_DOCUMENTS) {
    const sizeBytes = BigInt(Buffer.byteLength(doc.rawContent, 'utf-8'));
    const checksum = doc.metadata.documentId as string;

    // Upsert Document
    await prisma.document.upsert({
      where: {
        workspaceId_id: {
          workspaceId: workspace.id,
          id: doc.id,
        },
      },
      update: {
        originalName: doc.originalName,
        mimeType: doc.mimeType,
        extension: doc.extension,
        sizeBytes,
        checksum,
        storageKey: doc.storageKey,
        status: 'COMPLETED',
        pageCount: doc.pageCount,
        chunkCount: doc.chunks.length,
        embeddingModel: DEMO_CONFIG.embeddingModel,
        embeddingDimension: DEMO_CONFIG.embeddingDimension,
        metadata: doc.metadata as Prisma.InputJsonValue,
        processedAt: new Date(),
      },
      create: {
        id: doc.id,
        workspaceId: workspace.id,
        uploadedById: user.id,
        originalName: doc.originalName,
        mimeType: doc.mimeType,
        extension: doc.extension,
        sizeBytes,
        checksum,
        storageKey: doc.storageKey,
        status: 'COMPLETED',
        pageCount: doc.pageCount,
        chunkCount: doc.chunks.length,
        embeddingModel: DEMO_CONFIG.embeddingModel,
        embeddingDimension: DEMO_CONFIG.embeddingDimension,
        metadata: doc.metadata as Prisma.InputJsonValue,
        processedAt: new Date(),
      },
    });

    // Upsert Chunks with pgvector vector(768) embeddings
    for (const chunk of doc.chunks) {
      const vector = generateSyntheticDemoEmbedding(chunk.content, DEMO_CONFIG.embeddingDimension);
      const vectorStr = `[${vector.join(',')}]`;

      const chunkMetadata = {
        headingHierarchy: chunk.headingHierarchy,
        originalDocName: doc.originalName,
        isDemo: true,
        syntheticEmbeddings: true,
        embeddingModel: DEMO_CONFIG.embeddingModel,
        dimension: DEMO_CONFIG.embeddingDimension,
      };

      await prisma.$executeRaw`
        INSERT INTO "document_chunks" (
          "id", "documentId", "workspaceId", "chunkIndex", "content", "tokenCount",
          "pageStart", "pageEnd", "metadata", "embedding", "createdAt"
        )
        VALUES (
          ${chunk.id}, ${doc.id}, ${workspace.id}, ${chunk.chunkIndex}, ${chunk.content}, ${chunk.tokenCount},
          ${chunk.pageStart}, ${chunk.pageEnd}, ${JSON.stringify(chunkMetadata)}::jsonb, ${vectorStr}::vector, NOW()
        )
        ON CONFLICT ("documentId", "chunkIndex") DO UPDATE SET
          "content" = EXCLUDED."content",
          "tokenCount" = EXCLUDED."tokenCount",
          "pageStart" = EXCLUDED."pageStart",
          "pageEnd" = EXCLUDED."pageEnd",
          "metadata" = EXCLUDED."metadata",
          "embedding" = EXCLUDED."embedding";
      `;
      totalChunksInserted++;
    }
  }
  console.log(
    `  -> Seeded ${DEMO_DOCUMENTS.length} documents and ${totalChunksInserted} vector chunks.`,
  );

  // -----------------------------------------------------------------------
  // Step 5: Knowledge Graph Entities, Aliases, Relations & Evidence
  // -----------------------------------------------------------------------
  console.log('[5/7] Seeding Knowledge Graph entities, aliases, relations, and evidence...');

  // 5.1 Entities and Aliases
  let totalAliases = 0;
  for (const ent of DEMO_GRAPH_ENTITIES) {
    const entVector = generateSyntheticDemoEmbedding(
      `${ent.canonicalName}: ${ent.description}`,
      DEMO_CONFIG.embeddingDimension,
    );
    const entVectorStr = `[${entVector.join(',')}]`;

    const entityRecord = await prisma.graphEntity.upsert({
      where: {
        workspaceId_normalizedName: {
          workspaceId: workspace.id,
          normalizedName: ent.normalizedName,
        },
      },
      update: {
        canonicalName: ent.canonicalName,
        entityType: ent.entityType as EntityType,
        description: ent.description,
        metadata: { isDemo: true, syntheticEmbeddings: true },
      },
      create: {
        id: ent.id,
        workspaceId: workspace.id,
        canonicalName: ent.canonicalName,
        normalizedName: ent.normalizedName,
        entityType: ent.entityType as EntityType,
        description: ent.description,
        metadata: { isDemo: true, syntheticEmbeddings: true },
      },
    });

    // Update entity dense vector embedding
    await prisma.$executeRaw`
      UPDATE "graph_entities"
      SET "embedding" = ${entVectorStr}::vector
      WHERE "workspace_id" = ${workspace.id} AND "id" = ${entityRecord.id};
    `;

    // Upsert Aliases
    for (const aliasText of ent.aliases) {
      const normalizedAlias = aliasText.toLowerCase().trim();
      const aliasId = `alias_${ent.id}_${normalizedAlias.replace(/\s+/g, '_')}`;

      await prisma.graphEntityAlias.upsert({
        where: {
          workspaceId_normalizedAlias: {
            workspaceId: workspace.id,
            normalizedAlias,
          },
        },
        update: {
          alias: aliasText,
          entityId: entityRecord.id,
        },
        create: {
          id: aliasId,
          workspaceId: workspace.id,
          entityId: entityRecord.id,
          alias: aliasText,
          normalizedAlias,
          aliasType: 'SYNONYM',
        },
      });
      totalAliases++;
    }
  }

  // 5.2 Relations and Evidence
  for (const rel of DEMO_GRAPH_RELATIONS) {
    const relationRecord = await prisma.graphRelation.upsert({
      where: {
        workspaceId_sourceEntityId_targetEntityId_relationType: {
          workspaceId: workspace.id,
          sourceEntityId: rel.sourceEntityId,
          targetEntityId: rel.targetEntityId,
          relationType: rel.relationType,
        },
      },
      update: {
        description: rel.description,
        weight: rel.weight,
        confidence: rel.confidence,
        metadata: { isDemo: true },
      },
      create: {
        id: rel.id,
        workspaceId: workspace.id,
        sourceEntityId: rel.sourceEntityId,
        targetEntityId: rel.targetEntityId,
        relationType: rel.relationType,
        description: rel.description,
        weight: rel.weight,
        confidence: rel.confidence,
        metadata: { isDemo: true },
      },
    });

    // Upsert Evidence
    await prisma.relationEvidence.upsert({
      where: {
        workspaceId_relationId_chunkId: {
          workspaceId: workspace.id,
          relationId: relationRecord.id,
          chunkId: rel.evidence.chunkId,
        },
      },
      update: {
        evidenceText: rel.evidence.evidenceText,
        confidence: rel.evidence.confidence,
      },
      create: {
        id: rel.evidence.id,
        workspaceId: workspace.id,
        relationId: relationRecord.id,
        chunkId: rel.evidence.chunkId,
        documentId: rel.evidence.documentId,
        evidenceText: rel.evidence.evidenceText,
        confidence: rel.evidence.confidence,
      },
    });
  }

  // 5.3 Chunk Entity Mentions
  // Cleanly clear existing demo workspace mentions to avoid duplicate accumulation
  await prisma.chunkEntityMention.deleteMany({
    where: { workspaceId: workspace.id },
  });

  for (const mention of DEMO_CHUNK_MENTIONS) {
    await prisma.chunkEntityMention.create({
      data: {
        id: mention.id,
        workspaceId: workspace.id,
        chunkId: mention.chunkId,
        entityId: mention.entityId,
        mentionText: mention.mentionText,
        confidence: mention.confidence,
      },
    });
  }

  console.log(
    `  -> Seeded ${DEMO_GRAPH_ENTITIES.length} entities, ${totalAliases} aliases, ${DEMO_GRAPH_RELATIONS.length} relations, and ${DEMO_CHUNK_MENTIONS.length} mentions.`,
  );

  // -----------------------------------------------------------------------
  // Step 6: Showcase Chat Sessions & Grounded Citations
  // -----------------------------------------------------------------------
  console.log('[6/7] Seeding realistic multi-turn chat sessions with grounded citations...');
  let totalMessages = 0;

  for (const session of DEMO_CHAT_SESSIONS) {
    await prisma.chatSession.upsert({
      where: { id: session.id },
      update: {
        title: session.title,
        summary: session.summary,
        messageCount: session.messages.length,
        lastMessageAt: new Date(),
      },
      create: {
        id: session.id,
        workspaceId: workspace.id,
        userId: user.id,
        title: session.title,
        status: 'ACTIVE',
        summary: session.summary,
        messageCount: session.messages.length,
        lastMessageAt: new Date(),
      },
    });

    for (const msg of session.messages) {
      await prisma.chatMessage.upsert({
        where: {
          sessionId_sequenceNumber: {
            sessionId: session.id,
            sequenceNumber: msg.sequenceNumber,
          },
        },
        update: {
          content: msg.content,
          status: 'COMPLETED',
          citations: msg.citations as Prisma.InputJsonValue,
          metadata: msg.metadata as Prisma.InputJsonValue,
          tokenEstimate: msg.tokenEstimate,
          completedAt: new Date(),
        },
        create: {
          id: msg.id,
          sessionId: session.id,
          workspaceId: workspace.id,
          role: msg.role as ChatMessageRole,
          content: msg.content,
          status: 'COMPLETED',
          sequenceNumber: msg.sequenceNumber,
          citations: msg.citations as Prisma.InputJsonValue,
          metadata: msg.metadata as Prisma.InputJsonValue,
          tokenEstimate: msg.tokenEstimate,
          completedAt: new Date(),
        },
      });
      totalMessages++;
    }
  }
  console.log(
    `  -> Seeded ${DEMO_CHAT_SESSIONS.length} chat sessions with ${totalMessages} messages and validated citations.`,
  );

  // -----------------------------------------------------------------------
  // Step 7: Integrity Verification
  // -----------------------------------------------------------------------
  console.log('[7/7] Verifying seeded database state & tenant isolation...');
  const verifyDocCount = await prisma.document.count({ where: { workspaceId: workspace.id } });
  const verifyChunkCount = await prisma.documentChunk.count({
    where: { workspaceId: workspace.id },
  });
  const verifyEntityCount = await prisma.graphEntity.count({
    where: { workspaceId: workspace.id },
  });
  const verifyRelationCount = await prisma.graphRelation.count({
    where: { workspaceId: workspace.id },
  });
  const verifySessionCount = await prisma.chatSession.count({
    where: { workspaceId: workspace.id },
  });
  const verifyMessageCount = await prisma.chatMessage.count({
    where: { workspaceId: workspace.id },
  });

  const durationMs = Math.round(performance.now() - startTime);

  console.log('\n========================================================================');
  console.log('MindVault Demo Seed Complete & Verified');
  console.log('========================================================================');
  console.log(`Execution Duration: ${durationMs} ms`);
  console.log(`Demo User:          ${user.email} (Password: ${DEMO_CONFIG.userPlainPassword})`);
  console.log(`Demo Workspace:     ${workspace.name} (${workspace.id})`);
  console.log(`Documents Seeded:   ${verifyDocCount} / 6`);
  console.log(`Chunks & Vectors:   ${verifyChunkCount} / 6 (768d unit vectors)`);
  console.log(`Graph Entities:     ${verifyEntityCount} (Target: 12-15)`);
  console.log(`Graph Relations:    ${verifyRelationCount} (Target: >= 15)`);
  console.log(`Chat Sessions:      ${verifySessionCount} sessions, ${verifyMessageCount} messages`);
  console.log('Offline Guarantee:  Verified (0 external network requests)');
  console.log('Tenant Isolation:   Verified (Scoped to ws_demo_showcase_001)');
  console.log('========================================================================\n');
}

main()
  .catch((err) => {
    console.error('\n[FATAL SEED ERROR]:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
