import { test, expect } from '@playwright/test';
import { setupMockApi } from './fixtures/mock-api';

test.describe('Flow 8: Resource Governance, Rate Limiting & Quotas', () => {
  test('should display rate limit feedback when document upload rate limit is exceeded', async ({ page }) => {
    await setupMockApi(page, {
      authenticated: true,
      rateLimitEndpoints: ['/api/documents/upload'],
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Knowledge Documents' }).click();
    await page.getByRole('button', { name: /Upload Documents/i }).click();

    // Attach file via file input to trigger rate limited upload
    await page.locator('input[type="file"]').setInputFiles({
      name: 'rate_limit_test.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 Mock PDF Content'),
    });

    // Verification of rate limit message
    await expect(page.locator('text=Too many requests')).toBeVisible();
  });

  test('should display quota exceeded error when workspace document quota is reached', async ({ page }) => {
    await setupMockApi(page, {
      authenticated: true,
      quotaExceededEndpoints: ['/api/documents/upload'],
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Knowledge Documents' }).click();
    await page.getByRole('button', { name: /Upload Documents/i }).click();

    // Attach file to trigger quota exceeded upload
    await page.locator('input[type="file"]').setInputFiles({
      name: 'quota_test.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 Mock PDF Content'),
    });

    // Verification of quota error message
    await expect(page.locator('text=Workspace document limit reached')).toBeVisible();
  });
});
