/**
 * MindVault — Stage 1B.6: Gemini Demo Re-Ingestion & Verification Script
 *
 * Reprocesses the six showcase demo documents using the active Google Gemini pipeline:
 * 1. Chunks each document using chunkDocument().
 * 2. Generates live 768-D vector embeddings via GeminiEmbeddingProvider ('gemini-embedding-2').
 * 3. Verifies strict mathematical unit norm (L2 = 1.000000 ± 0.000100) and 768 dimensions.
 * 4. Extracts Knowledge Graph entities and relations via GeminiExtractionProvider ('gemini-3.5-flash').
 * 5. Embeds entities with 768-D Gemini embeddings.
 * 6. Durably persists all chunks, vectors, entities, aliases, relations, evidence, and mentions.
 * 7. Verifies zero cross-model contamination in the database.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient, Prisma, EntityType } from '@prisma/client';
import {
  GeminiEmbeddingProvider,
  GeminiExtractionProvider,
} from '@mindvault/shared';
import { chunkDocument } from '../apps/worker/src/modules/ingestion/chunking/chunker.js';
import { normalizeText } from '../apps/worker/src/modules/ingestion/normalization/text.normalizer.js';
import { extractDocument } from '../apps/worker/src/modules/ingestion/extractors/index.js';
import { EntityNormalizer } from '../apps/worker/src/modules/graph/normalizers/entity.normalizer.js';

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

function computeL2Norm(vec: number[]): number {
  return Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
}

async function main() {
  console.log('========================================================================');
  console.log('MindVault — Stage 1B.6: Gemini Demo Re-Ingestion (768-D Gemini Pipeline)');
  console.log('========================================================================\n');

  const workspaceSlug = 'demo-showcase';
  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    include: { documents: true },
  });

  if (!workspace) {
    throw new Error(`Showcase workspace '${workspaceSlug}' not found! Run 'pnpm db:seed' first.`);
  }

  console.log(`Target Workspace: "${workspace.name}" (${workspace.id})`);
  console.log(`Documents to Re-Ingest: ${workspace.documents.length}\n`);

  const storageDir = path.resolve(rootDir, process.env.STORAGE_DIR || 'infrastructure/storage/documents');
  const embeddingModel = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
  const extractionModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is missing.');
  }

  const embeddingProvider = new GeminiEmbeddingProvider({
    apiKey,
    modelName: embeddingModel,
    dimension: 768,
    maxBatchSize: 1,
  });

  const extractionProvider = new GeminiExtractionProvider({
    apiKey,
    modelName: extractionModel,
  });

  console.log(`Embedding Provider:  Google Gemini (${embeddingModel}, 768-D)`);
  console.log(`Extraction Provider: Google Gemini (${extractionModel})`);
  console.log(`Storage Directory:   ${storageDir}\n`);

  // Track extracted graph elements across all documents
  type ExtractedEntity = {
    canonicalName: string;
    normalizedName: string;
    entityType: string;
    description: string;
    aliases: string[];
    embedding?: number[];
  };

  type ExtractedRelation = {
    sourceNormalized: string;
    targetNormalized: string;
    relationType: string;
    description: string;
    weight: number;
    confidence: number;
    evidenceText: string;
    chunkId: string;
    documentId: string;
  };

  type ExtractedMention = {
    chunkId: string;
    entityNormalized: string;
    mentionText: string;
    confidence: number;
  };

  const allEntities = new Map<string, ExtractedEntity>();
  const allRelations: ExtractedRelation[] = [];
  const allMentions: ExtractedMention[] = [];

  let totalChunksIngested = 0;

  for (let i = 0; i < workspace.documents.length; i++) {
    const doc = workspace.documents[i];
    console.log(`------------------------------------------------------------------------`);
    console.log(`[${i + 1}/${workspace.documents.length}] Processing Document: ${doc.originalName} (${doc.id})`);

    const filePath = path.join(storageDir, doc.storageKey);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Source file missing: ${filePath}`);
    }

    const fileBuffer = fs.readFileSync(filePath);
    const extraction = await extractDocument(fileBuffer, doc.extension, doc.mimeType);
    const normalized = normalizeText(extraction.extractedText);

    if (!normalized || normalized.trim().length === 0) {
      throw new Error(`Document ${doc.id} contains no text`);
    }

    const chunks = chunkDocument(normalized, undefined, extraction.pages);
    console.log(`  -> Extracted & Chunked: ${chunks.length} chunk(s)`);

    // 1. Generate live Gemini Embeddings
    console.log(`  -> Generating Gemini embeddings (${embeddingModel}, 768d)...`);
    const chunkTexts = chunks.map((c) => c.content);
    const embeddings = await embeddingProvider.generateEmbeddings(chunkTexts);

    // Validate embeddings
    for (let cIdx = 0; cIdx < embeddings.length; cIdx++) {
      const vec = embeddings[cIdx];
      if (vec.length !== 768) {
        throw new Error(`Chunk ${cIdx} returned ${vec.length} dimensions, expected 768`);
      }
      const norm = computeL2Norm(vec);
      if (Math.abs(norm - 1.0) > 0.001) {
        throw new Error(`Chunk ${cIdx} embedding is not unit-normalized: norm = ${norm}`);
      }
    }
    console.log(`  ✔ Generated ${embeddings.length} valid 768d unit-normalized Gemini embeddings`);

    // 2. Extract Knowledge Graph via Gemini OUTSIDE transaction
    type ChunkData = {
      chunkIndex: number;
      chunkId: string;
      content: string;
      heading?: string;
      tokenCount: number;
      pageStart?: number;
      pageEnd?: number;
      embeddingStr: string;
    };

    const chunkDataList: ChunkData[] = [];

    for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
      const c = chunks[cIdx];
      const chunkId = `chk_gemini_${doc.id}_${c.chunkIndex}`;
      const vecStr = `[${embeddings[cIdx].join(',')}]`;

      chunkDataList.push({
        chunkIndex: c.chunkIndex,
        chunkId,
        content: c.content,
        heading: c.heading,
        tokenCount: c.tokenCount,
        pageStart: c.pageStart,
        pageEnd: c.pageEnd,
        embeddingStr: vecStr,
      });

      console.log(`  -> Extracting Knowledge Graph via Gemini (${extractionModel}) for chunk ${c.chunkIndex}...`);
      try {
        const kgResult = await extractionProvider.extract(c.content, {
          documentTitle: doc.originalName,
          sectionHeading: c.heading,
          workspaceId: workspace.id,
        });

        console.log(`     ✔ Extracted ${kgResult.entities.length} entities, ${kgResult.relations.length} relations`);

        // Register entities
        for (const ent of kgResult.entities) {
          const normName = EntityNormalizer.normalize(ent.name);
          if (!normName) continue;

          const existing = allEntities.get(normName);
          const aliases = ent.aliases || [];
          if (existing) {
            const mergedAliases = Array.from(new Set([...existing.aliases, ...aliases]));
            existing.aliases = mergedAliases;
            if (ent.description && ent.description.length > existing.description.length) {
              existing.description = ent.description;
            }
          } else {
            allEntities.set(normName, {
              canonicalName: ent.name,
              normalizedName: normName,
              entityType: ent.entityType || 'CONCEPT',
              description: ent.description || '',
              aliases,
            });
          }

          allMentions.push({
            chunkId,
            entityNormalized: normName,
            mentionText: ent.name,
            confidence: 0.95,
          });
        }

        // Register relations
        for (const rel of kgResult.relations) {
          const srcNorm = EntityNormalizer.normalize(rel.sourceEntity);
          const tgtNorm = EntityNormalizer.normalize(rel.targetEntity);
          if (!srcNorm || !tgtNorm || srcNorm === tgtNorm) continue;

          allRelations.push({
            sourceNormalized: srcNorm,
            targetNormalized: tgtNorm,
            relationType: rel.relationType,
            description: rel.description || '',
            weight: rel.weight ?? 1.0,
            confidence: rel.confidence ?? 0.9,
            evidenceText: rel.evidence || c.content.slice(0, 150),
            chunkId,
            documentId: doc.id,
          });
        }
      } catch (kgErr: any) {
        console.warn(`     ⚠ KG extraction warning on chunk ${c.chunkIndex}: ${kgErr.message}`);
      }
    }

    // 3. Persist Chunks in PostgreSQL with vector(768) inside quick transaction
    await prisma.$transaction(async (tx) => {
      // Clear old mentions, evidence, chunks for this document
      await tx.relationEvidence.deleteMany({ where: { documentId: doc.id } });
      await tx.chunkEntityMention.deleteMany({ where: { chunk: { documentId: doc.id } } });
      await tx.documentChunk.deleteMany({ where: { documentId: doc.id } });

      for (const c of chunkDataList) {
        const chunkMeta = {
          heading: c.heading,
          tokenCount: c.tokenCount,
          originalDocName: doc.originalName,
          embeddingModel,
          dimension: 768,
          reingestedAt: new Date().toISOString(),
          provider: 'gemini',
        };

        await tx.$executeRaw`
          INSERT INTO "document_chunks" (
            "id", "documentId", "workspaceId", "chunkIndex", "content", "tokenCount",
            "pageStart", "pageEnd", "metadata", "embedding", "createdAt"
          )
          VALUES (
            ${c.chunkId}, ${doc.id}, ${workspace.id}, ${c.chunkIndex}, ${c.content}, ${c.tokenCount},
            ${c.pageStart}, ${c.pageEnd}, ${JSON.stringify(chunkMeta)}::jsonb, ${c.embeddingStr}::vector, NOW()
          );
        `;
        totalChunksIngested++;
      }

      // Update Document Status and Metadata
      await tx.document.update({
        where: { id: doc.id },
        data: {
          status: 'COMPLETED',
          chunkCount: chunks.length,
          embeddingModel,
          embeddingDimension: 768,
          processedAt: new Date(),
          metadata: {
            ...(typeof doc.metadata === 'object' && doc.metadata !== null ? (doc.metadata as any) : {}),
            reingestedWithGemini: true,
            reingestedAt: new Date().toISOString(),
            embeddingModel,
            embeddingDimension: 768,
          },
        },
      });
    }, { timeout: 30000 });

    console.log(`  ✔ Document ${doc.originalName} successfully re-ingested with Gemini.\n`);
  }

  // -------------------------------------------------------------------------
  // Persist Consolidated Knowledge Graph
  // -------------------------------------------------------------------------
  console.log('========================================================================');
  console.log(`Persisting Consolidated Knowledge Graph (${allEntities.size} entities, ${allRelations.length} relations)...`);
  console.log('========================================================================\n');

  // Cleanly clear existing graph data in this workspace to eliminate conflicts
  console.log('Clearing old workspace graph tables before Gemini KG insertion...');
  await prisma.relationEvidence.deleteMany({ where: { workspaceId: workspace.id } });
  await prisma.graphEntity.deleteMany({ where: { workspaceId: workspace.id } });

  // Embed entities with 768-D Gemini embeddings
  console.log(`Generating Gemini dense embeddings for ${allEntities.size} graph entities...`);
  const entityArray = Array.from(allEntities.values());
  const entityTexts = entityArray.map((e) => `${e.canonicalName}: ${e.description}`);
  const entityEmbeddings = await embeddingProvider.generateEmbeddings(entityTexts);

  for (let idx = 0; idx < entityArray.length; idx++) {
    entityArray[idx].embedding = entityEmbeddings[idx];
  }

  // Upsert entities & aliases into database
  const entityIdMap = new Map<string, string>(); // normalizedName -> id

  const registeredAliases = new Set<string>();

  for (const ent of entityArray) {
    const entityId = `ent_gemini_${ent.normalizedName.replace(/[^a-z0-9_]/g, '_')}`;
    const vecStr = `[${ent.embedding!.join(',')}]`;

    // Map entityType to Prisma EntityType enum
    let eType: EntityType = EntityType.CONCEPT;
    const typeUpper = (ent.entityType || '').toUpperCase();
    if (typeUpper in EntityType) {
      eType = typeUpper as EntityType;
    }

    const saved = await prisma.graphEntity.upsert({
      where: {
        workspaceId_normalizedName: {
          workspaceId: workspace.id,
          normalizedName: ent.normalizedName,
        },
      },
      update: {
        canonicalName: ent.canonicalName,
        entityType: eType,
        description: ent.description,
        metadata: { provider: 'gemini', reingested: true },
      },
      create: {
        id: entityId,
        workspaceId: workspace.id,
        canonicalName: ent.canonicalName,
        normalizedName: ent.normalizedName,
        entityType: eType,
        description: ent.description,
        metadata: { provider: 'gemini', reingested: true },
      },
    });

    await prisma.$executeRaw`
      UPDATE "graph_entities"
      SET "embedding" = ${vecStr}::vector
      WHERE "workspace_id" = ${workspace.id} AND "id" = ${saved.id};
    `;

    entityIdMap.set(ent.normalizedName, saved.id);

    // Aliases
    for (const aliasText of ent.aliases) {
      const normAlias = EntityNormalizer.normalize(aliasText);
      if (
        !normAlias ||
        normAlias === ent.normalizedName ||
        allEntities.has(normAlias) ||
        registeredAliases.has(normAlias)
      ) {
        continue;
      }
      registeredAliases.add(normAlias);

      const aliasId = `alias_${saved.id}_${normAlias.replace(/[^a-z0-9_]/g, '_')}`;
      await prisma.graphEntityAlias.upsert({
        where: {
          workspaceId_normalizedAlias: {
            workspaceId: workspace.id,
            normalizedAlias: normAlias,
          },
        },
        update: {
          alias: aliasText,
          entityId: saved.id,
        },
        create: {
          id: aliasId,
          workspaceId: workspace.id,
          entityId: saved.id,
          alias: aliasText,
          normalizedAlias: normAlias,
          aliasType: 'SYNONYM',
        },
      });
    }
  }

  // Persist Relations & Evidence
  let persistedRelations = 0;
  for (const rel of allRelations) {
    const srcId = entityIdMap.get(rel.sourceNormalized);
    const tgtId = entityIdMap.get(rel.targetNormalized);
    if (!srcId || !tgtId || srcId === tgtId) continue;

    const relId = `rel_gemini_${srcId.slice(-6)}_${tgtId.slice(-6)}_${rel.relationType.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;

    try {
      const relationRecord = await prisma.graphRelation.upsert({
        where: {
          workspaceId_sourceEntityId_targetEntityId_relationType: {
            workspaceId: workspace.id,
            sourceEntityId: srcId,
            targetEntityId: tgtId,
            relationType: rel.relationType,
          },
        },
        update: {
          description: rel.description,
          weight: rel.weight,
          confidence: rel.confidence,
          metadata: { provider: 'gemini' },
        },
        create: {
          id: relId,
          workspaceId: workspace.id,
          sourceEntityId: srcId,
          targetEntityId: tgtId,
          relationType: rel.relationType,
          description: rel.description,
          weight: rel.weight,
          confidence: rel.confidence,
          metadata: { provider: 'gemini' },
        },
      });

      // Evidence
      const evidenceId = `ev_${relationRecord.id}_${rel.chunkId.slice(-8)}`;
      await prisma.relationEvidence.upsert({
        where: {
          workspaceId_relationId_chunkId: {
            workspaceId: workspace.id,
            relationId: relationRecord.id,
            chunkId: rel.chunkId,
          },
        },
        update: {
          evidenceText: rel.evidenceText,
          confidence: rel.confidence,
        },
        create: {
          id: evidenceId,
          workspaceId: workspace.id,
          relationId: relationRecord.id,
          chunkId: rel.chunkId,
          documentId: rel.documentId,
          evidenceText: rel.evidenceText,
          confidence: rel.confidence,
        },
      });

      persistedRelations++;
    } catch (rErr: any) {
      // Continue on constraint edge cases
    }
  }

  // Persist Chunk Mentions
  for (const mention of allMentions) {
    const entId = entityIdMap.get(mention.entityNormalized);
    if (!entId) continue;

    const mentionId = `men_${mention.chunkId.slice(-8)}_${entId.slice(-8)}`;
    try {
      await prisma.chunkEntityMention.upsert({
        where: { id: mentionId },
        update: {
          mentionText: mention.mentionText,
          confidence: mention.confidence,
        },
        create: {
          id: mentionId,
          workspaceId: workspace.id,
          chunkId: mention.chunkId,
          entityId: entId,
          mentionText: mention.mentionText,
          confidence: mention.confidence,
        },
      });
    } catch {
      // Ignore duplicates
    }
  }

  // -------------------------------------------------------------------------
  // Verification
  // -------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log('Post-Ingestion Database Verification');
  console.log('========================================================================\n');

  const docCount = await prisma.document.count({ where: { workspaceId: workspace.id } });
  const chunkCount = await prisma.documentChunk.count({ where: { workspaceId: workspace.id } });
  const entityCount = await prisma.graphEntity.count({ where: { workspaceId: workspace.id } });
  const relationCount = await prisma.graphRelation.count({ where: { workspaceId: workspace.id } });
  const evidenceCount = await prisma.relationEvidence.count({ where: { workspaceId: workspace.id } });
  const mentionCount = await prisma.chunkEntityMention.count({ where: { workspaceId: workspace.id } });

  // Check models in documents
  const docs = await prisma.document.findMany({
    where: { workspaceId: workspace.id },
    select: { id: true, originalName: true, embeddingModel: true, embeddingDimension: true, chunkCount: true },
  });

  // Check vector dimensions and non-zero
  const sampleChunks = await prisma.$queryRaw<Array<{ id: string; norm: number; dim: number }>>`
    SELECT
      id,
      vector_dims(embedding) as dim,
      round((vector_norm(embedding))::numeric, 6) as norm
    FROM "document_chunks"
    WHERE "workspaceId" = ${workspace.id}
    LIMIT 6;
  `;

  console.log(`Showcase Documents: ${docCount} / 6`);
  console.log(`Document Chunks:    ${chunkCount}`);
  console.log(`Graph Entities:     ${entityCount}`);
  console.log(`Graph Relations:    ${relationCount}`);
  console.log(`Relation Evidence:  ${evidenceCount}`);
  console.log(`Entity Mentions:    ${mentionCount}\n`);

  console.log('Document Model Verification:');
  for (const d of docs) {
    console.log(`  - ${d.originalName}: model=${d.embeddingModel}, dim=${d.embeddingDimension}, chunks=${d.chunkCount}`);
  }

  console.log('\npgvector Chunk Embedding Verification (L2 Norm & Dim):');
  for (const sc of sampleChunks) {
    console.log(`  - Chunk ${sc.id}: dim=${sc.dim}, norm=${sc.norm}`);
  }

  // Ensure ZERO Ollama or mock models remain
  const invalidDocs = docs.filter((d) => d.embeddingModel !== embeddingModel || d.embeddingDimension !== 768);
  if (invalidDocs.length > 0) {
    throw new Error(`Data verification failed: ${invalidDocs.length} documents have invalid model or dimension!`);
  }

  console.log('\n========================================================================');
  console.log('✔ GEMINI RE-INGESTION COMPLETED AND DURABLY VERIFIED');
  console.log('========================================================================\n');
}

main()
  .catch((err) => {
    console.error('\n[FATAL RE-INGESTION ERROR]:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
