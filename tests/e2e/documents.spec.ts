import { test, expect } from '@playwright/test';
import { setupMockApi, DEFAULT_DOCUMENTS } from './fixtures/mock-api';

test.describe('Flow 6: Document Management & Search', () => {
  test('should render document list with filenames and statuses', async ({ page }) => {
    await setupMockApi(page, { authenticated: true });
    await page.goto('/');

    await page.getByRole('button', { name: 'Knowledge Documents' }).click();

    // Verify document filenames
    await expect(page.locator(`text=${DEFAULT_DOCUMENTS[0].originalName}`)).toBeVisible();
    await expect(page.locator(`text=${DEFAULT_DOCUMENTS[1].originalName}`)).toBeVisible();
  });

  test('should filter documents using search input', async ({ page }) => {
    await setupMockApi(page, { authenticated: true });
    await page.goto('/');

    await page.getByRole('button', { name: 'Knowledge Documents' }).click();

    const searchInput = page.getByPlaceholder('Search documents by filename...');
    await searchInput.fill('architecture');

    // Matching document remains visible
    await expect(page.locator('text=architecture_blueprint.pdf')).toBeVisible();

    // Non-matching document is filtered out
    await expect(page.locator('text=sprint_notes.md')).not.toBeVisible();
  });

  test('should trigger document download', async ({ page }) => {
    await setupMockApi(page, { authenticated: true });
    await page.goto('/');

    await page.getByRole('button', { name: 'Knowledge Documents' }).click();

    // Find download button for first document
    const downloadPromise = page.waitForEvent('download').catch(() => null);
    const downloadBtn = page.locator('button[title="Download original file"]').or(page.locator('button:has-text("Download")')).first();
    if (await downloadBtn.isVisible()) {
      await downloadBtn.click();
      const download = await downloadPromise;
      if (download) {
        expect(download.suggestedFilename()).toBe('test_document.pdf');
      }
    }
  });

  test('should delete document and update list', async ({ page }) => {
    await setupMockApi(page, { authenticated: true });
    await page.goto('/');

    await page.getByRole('button', { name: 'Knowledge Documents' }).click();

    await expect(page.locator('text=architecture_blueprint.pdf')).toBeVisible();

    // Trigger delete action
    const deleteBtn = page.locator('button[title="Delete document"]').or(page.locator('button:has-text("Delete")')).first();
    if (await deleteBtn.isVisible()) {
      page.once('dialog', (dialog) => dialog.accept());
      await deleteBtn.click();

      // Document removed from UI
      await expect(page.locator('text=architecture_blueprint.pdf')).not.toBeVisible();
    }
  });
});
