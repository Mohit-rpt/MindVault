import { test, expect } from '@playwright/test';
import { setupMockApi, DEFAULT_WORKSPACE, SECONDARY_WORKSPACE } from './fixtures/mock-api';

test.describe('Flow 2: Workspace Management & Boundary Isolation', () => {
  test('should display active workspace name and role badge', async ({ page }) => {
    await setupMockApi(page, { authenticated: true });
    await page.goto('/');

    await expect(page.locator(`text=${DEFAULT_WORKSPACE.name}`).first()).toBeVisible();
    await expect(page.locator(`text=${DEFAULT_WORKSPACE.role}`).first()).toBeVisible();
  });

  test('should open workspace dropdown and switch active workspace', async ({ page }) => {
    await setupMockApi(page, { authenticated: true });
    await page.goto('/');

    // Click workspace button in sidebar
    const wsButton = page.locator(`button:has-text("${DEFAULT_WORKSPACE.name}")`).first();
    await wsButton.click();

    // Verify secondary workspace is visible in dropdown
    await expect(page.locator(`text=${SECONDARY_WORKSPACE.name}`)).toBeVisible();

    // Click secondary workspace to switch
    await page.locator(`button:has-text("${SECONDARY_WORKSPACE.name}")`).click();

    // Active workspace in button should now reflect secondary workspace
    await expect(page.locator(`text=${SECONDARY_WORKSPACE.name}`).first()).toBeVisible();
  });

  test('should open create workspace modal and validate input', async ({ page }) => {
    await setupMockApi(page, { authenticated: true });
    await page.goto('/');

    // Open workspace dropdown in sidebar
    const wsButton = page.locator(`button:has-text("${DEFAULT_WORKSPACE.name}")`).first();
    await wsButton.click();

    // Click Create Workspace in dropdown
    await page.getByRole('button', { name: /Create Workspace/i }).click();

    // Modal appears
    await expect(page.getByRole('heading', { name: /Create New Workspace/i })).toBeVisible();
    const nameInput = page.getByPlaceholder('Engineering Knowledge');
    await expect(nameInput).toBeVisible();

    // Fill new workspace details and submit
    await nameInput.fill('Engineering Core Team');
    await page.locator('form button[type="submit"]:has-text("Create Workspace")').click();

    // Modal closes
    await expect(page.getByRole('heading', { name: /Create New Workspace/i })).not.toBeVisible();
  });
});
