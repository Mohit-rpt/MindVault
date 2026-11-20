import { test, expect } from '@playwright/test';
import { setupMockApi, DEFAULT_WORKSPACE } from './fixtures/mock-api';

test.describe('Flow 7: Knowledge Graph Navigation & Exploration', () => {
  test('should navigate to graph view and render entities and relationships', async ({ page }) => {
    await setupMockApi(page, {
      authenticated: true,
      graphOverview: {
        totalEntities: 3,
        totalRelations: 2,
        topConnectedEntities: [
          { id: 'ent-1', canonicalName: 'MindVault Core', degree: 5 },
          { id: 'ent-2', canonicalName: 'Gemini 3.5 Flash', degree: 3 },
          { id: 'ent-3', canonicalName: 'pgvector Cosine', degree: 4 },
        ],
        entityTypeDistribution: [
          { entityType: 'CONCEPT', count: 1 },
          { entityType: 'MODEL', count: 1 },
          { entityType: 'DATABASE', count: 1 },
        ],
      },
    });

    await page.goto('/');

    // Wait for authenticated workspace to be ready
    await expect(page.locator(`text=${DEFAULT_WORKSPACE.name}`)).toBeVisible();

    // Navigate to Knowledge Graph view
    await page.getByRole('button', { name: 'Knowledge Graph' }).click();

    // Verify graph view heading is visible
    await expect(page.getByRole('heading', { name: 'Knowledge Graph Explorer' })).toBeVisible();
  });

  test('should handle graph loading error with retry action', async ({ page }) => {
    await setupMockApi(page, {
      authenticated: true,
      rateLimitEndpoints: ['/api/graph/overview'], // Force error
    });

    await page.goto('/');

    await expect(page.locator(`text=${DEFAULT_WORKSPACE.name}`)).toBeVisible();

    await page.getByRole('button', { name: 'Knowledge Graph' }).click();

    // Verify error state
    await expect(page.locator('text=Failed to load Knowledge Graph')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });
});
