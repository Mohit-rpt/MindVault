/**
 * MindVault — Document Object Storage Migration & Backfill Tool (§5.2)
 *
 * Migrates existing documents from legacy flat storage keys or database Base64 metadata
 * to the secure, hierarchical object storage scheme:
 *   documents/{workspaceId}/{documentId}/doc_{timestamp}_{hex}.{ext}
 *
 * Safety Guarantees:
 * - Strictly NON-DESTRUCTIVE: Legacy sources and Base64 metadata are preserved.
 * - Idempotent and resumable: Skips already-migrated documents.
 * - Integrity-verified: Verifies SHA-256 checksum against stored database checksum.
 * - Supports --dry-run mode.
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import {
  LocalFileSystemStorageProvider,
  createDocumentStorage,
} from '../apps/api/src/modules/document/document.storage.js';

const prisma = new PrismaClient();
const storage = createDocumentStorage();

async function runMigration() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('='.repeat(70));
  console.log('📦 MindVault Secure Object Storage Migration & Backfill');
  console.log(`Mode: ${isDryRun ? '🔍 DRY RUN (no writes)' : '🚀 LIVE MIGRATION'}`);
  console.log('='.repeat(70));

  const documents = await prisma.document.findMany({
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${documents.length} document records in database.`);

  let alreadyMigrated = 0;
  let migratedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const doc of documents) {
    const isHierarchical =
      doc.storageKey.startsWith(`documents/${doc.workspaceId}/${doc.id}/`) ||
      doc.storageKey.includes('/');

    // Check if already in target storage
    let existsInStorage = false;
    try {
      existsInStorage = await storage.exists(doc.storageKey);
    } catch {
      existsInStorage = false;
    }

    if (isHierarchical && existsInStorage) {
      alreadyMigrated++;
      continue;
    }

    console.log(
      `\nMigrating Document ${doc.id} ('${doc.originalName}') [Workspace: ${doc.workspaceId}]...`,
    );

    // 1. Read file bytes from legacy source
    let fileBuffer: Buffer | null = null;

    if (existsInStorage) {
      try {
        fileBuffer = await storage.read(doc.storageKey);
      } catch (err: any) {
        console.warn(`  - Storage read failed: ${err.message}`);
      }
    }

    if (!fileBuffer && (doc.metadata as any)?.rawContentBase64) {
      console.log('  - Reconstructing from database Base64 metadata fallback...');
      fileBuffer = Buffer.from((doc.metadata as any).rawContentBase64, 'base64');
    }

    if (!fileBuffer) {
      console.error(`  ❌ FAILED: Unable to locate source bytes for document ${doc.id}.`);
      failedCount++;
      continue;
    }

    // 2. Verify integrity against stored checksum
    const computedChecksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    if (doc.checksum && computedChecksum !== doc.checksum) {
      console.error(
        `  ❌ CHECKSUM MISMATCH: Stored: ${doc.checksum}, Computed: ${computedChecksum}. Skipping.`,
      );
      failedCount++;
      continue;
    }

    // 3. Compute target hierarchical storage key
    const targetStorageKey = LocalFileSystemStorageProvider.generateStorageKey({
      workspaceId: doc.workspaceId,
      documentId: doc.id,
      extension: doc.extension,
    });

    console.log(`  - Target Key: ${targetStorageKey}`);

    if (isDryRun) {
      console.log('  [DRY RUN] Would write to storage and update database storageKey.');
      migratedCount++;
      continue;
    }

    // 4. Write to target storage
    try {
      await storage.save(targetStorageKey, fileBuffer, { contentType: doc.mimeType });
      const verified = await storage.exists(targetStorageKey);
      if (!verified) {
        throw new Error('Verification failed: target object not accessible after write');
      }

      // 5. Update database record with new storage key
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          storageKey: targetStorageKey,
          updatedAt: new Date(),
        },
      });

      console.log(`  ✅ Successfully migrated to '${targetStorageKey}'`);
      migratedCount++;
    } catch (err: any) {
      console.error(`  ❌ Migration error: ${err.message}`);
      failedCount++;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('MIGRATION SUMMARY:');
  console.log(`  Total examined:    ${documents.length}`);
  console.log(`  Already migrated:  ${alreadyMigrated}`);
  console.log(`  Newly migrated:    ${migratedCount}`);
  console.log(`  Failed:            ${failedCount}`);
  console.log(`  Skipped:           ${skippedCount}`);
  console.log('='.repeat(70));
}

runMigration()
  .catch((err) => {
    console.error('Fatal migration script failure:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
