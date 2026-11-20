import { test, expect } from '@playwright/test';
import { setupMockApi } from './fixtures/mock-api';

test.describe('Flow 4: Document Ingestion & Status Progression', () => {
  test('should display documents with their respective processing status badges', async ({ page }) => {
    const customDocs = [
      {
        id: 'doc-completed',
        workspaceId: 'ws-playwright-test-1',
        title: 'ready.pdf',
        originalName: 'ready.pdf',
        fileName: 'ready.pdf',
        sizeBytes: 1024,
        mimeType: 'application/pdf',
        extension: '.pdf',
        status: 'COMPLETED' as const,
        chunkCount: 4,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'doc-processing',
        workspaceId: 'ws-playwright-test-1',
        title: 'processing.pdf',
        originalName: 'processing.pdf',
        fileName: 'processing.pdf',
        sizeBytes: 2048,
        mimeType: 'application/pdf',
        extension: '.pdf',
        status: 'PROCESSING' as const,
        chunkCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'doc-queued',
        workspaceId: 'ws-playwright-test-1',
        title: 'queued.pdf',
        originalName: 'queued.pdf',
        fileName: 'queued.pdf',
        sizeBytes: 4096,
        mimeType: 'application/pdf',
        extension: '.pdf',
        status: 'QUEUED' as const,
        chunkCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'doc-failed',
        workspaceId: 'ws-playwright-test-1',
        title: 'failed.pdf',
        originalName: 'failed.pdf',
        fileName: 'failed.pdf',
        sizeBytes: 512,
        mimeType: 'application/pdf',
        extension: '.pdf',
        status: 'FAILED' as const,
        chunkCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    await setupMockApi(page, {
      authenticated: true,
      documents: customDocs,
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Knowledge Documents' }).click();

    // Verify all 4 status badges are displayed accurately
    await expect(page.locator('text=Ready').first()).toBeVisible();
    await expect(page.locator('text=Processing').first()).toBeVisible();
    await expect(page.locator('text=Queued').first()).toBeVisible();
    await expect(page.locator('text=Failed').first()).toBeVisible();
  });

  test('should filter documents by status tabs', async ({ page }) => {
    const customDocs = [
      {
        id: 'doc-ready',
        workspaceId: 'ws-playwright-test-1',
        title: 'active.pdf',
        originalName: 'active.pdf',
        fileName: 'active.pdf',
        sizeBytes: 1024,
        mimeType: 'application/pdf',
        extension: '.pdf',
        status: 'COMPLETED' as const,
        chunkCount: 4,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'doc-err',
        workspaceId: 'ws-playwright-test-1',
        title: 'err.pdf',
        originalName: 'err.pdf',
        fileName: 'err.pdf',
        sizeBytes: 512,
        mimeType: 'application/pdf',
        extension: '.pdf',
        status: 'FAILED' as const,
        chunkCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    await setupMockApi(page, {
      authenticated: true,
      documents: customDocs,
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Knowledge Documents' }).click();

    // Filter by 'Completed'
    await page.getByRole('button', { name: 'Completed' }).click();
    await expect(page.locator('text=active.pdf')).toBeVisible();

    // Filter by 'Failed'
    await page.getByRole('button', { name: 'Failed' }).click();
    await expect(page.locator('text=err.pdf')).toBeVisible();
  });
});
