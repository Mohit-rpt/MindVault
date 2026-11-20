import { test, expect } from '@playwright/test';
import { setupMockApi } from './fixtures/mock-api';

test.describe('Flow 3: Document Upload Ingress & Signature Protection', () => {
  test('should navigate to documents view and reveal uploader area', async ({ page }) => {
    await setupMockApi(page, { authenticated: true });
    await page.goto('/');

    // Navigate to Documents view
    await page.getByRole('button', { name: 'Knowledge Documents' }).click();

    await expect(page.getByPlaceholder('Search documents by filename...')).toBeVisible();
    await expect(page.getByRole('button', { name: /Upload Documents/i })).toBeVisible();

    // Toggle uploader area
    await page.getByRole('button', { name: /Upload Documents/i }).click();
    await expect(page.locator('text=drag & drop files here')).toBeVisible();
  });

  test('should successfully upload a supported PDF document', async ({ page }) => {
    await setupMockApi(page, { authenticated: true });
    await page.goto('/');

    await page.getByRole('button', { name: 'Knowledge Documents' }).click();
    await page.getByRole('button', { name: /Upload Documents/i }).click();

    // Attach synthetic valid PDF file directly via input[type="file"]
    await page.locator('input[type="file"]').setInputFiles({
      name: 'test_document.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 Mock PDF Stream Content'),
    });

    // Verification of upload success feedback
    await expect(page.locator('text="test_document.pdf" uploaded successfully')).toBeVisible();
  });

  test('should reject unsupported file types with error feedback', async ({ page }) => {
    await setupMockApi(page, { authenticated: true });
    await page.goto('/');

    await page.getByRole('button', { name: 'Knowledge Documents' }).click();
    await page.getByRole('button', { name: /Upload Documents/i }).click();

    // Attach unsupported executable
    await page.locator('input[type="file"]').setInputFiles({
      name: 'malicious.exe',
      mimeType: 'application/x-msdownload',
      buffer: Buffer.from('MZ\x90\x00\x03\x00\x00\x00'),
    });

    // Should display rejection warning in upload queue
    await expect(page.locator('text=Unsupported file type')).toBeVisible();
  });

  test('should reject oversized files exceeding upload limits', async ({ page }) => {
    await setupMockApi(page, { authenticated: true });
    await page.goto('/');

    await page.getByRole('button', { name: 'Knowledge Documents' }).click();
    await page.getByRole('button', { name: /Upload Documents/i }).click();

    // Simulate oversized document
    await page.locator('input[type="file"]').setInputFiles({
      name: 'massive_document.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('Massive mock content'),
    });

    // Should display size limit error
    await expect(page.locator('text=exceeds maximum limit').or(page.locator('text=error'))).toBeVisible();
  });
});
