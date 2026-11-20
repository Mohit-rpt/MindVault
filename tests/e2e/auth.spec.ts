import { test, expect } from '@playwright/test';
import { setupMockApi, DEFAULT_USER } from './fixtures/mock-api';

test.describe('Flow 1: Authentication & Session Lifecycle', () => {
  test('should display login screen when unauthenticated', async ({ page }) => {
    await setupMockApi(page, { authenticated: false });
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /Sign in to MindVault/i })).toBeVisible();
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
    await expect(page.getByPlaceholder('••••••••')).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign In/i })).toBeVisible();
  });

  test('should display error message on invalid credentials', async ({ page }) => {
    await setupMockApi(page, { authenticated: false });
    await page.goto('/');

    await page.getByPlaceholder('you@example.com').fill('wrong@mindvault.local');
    await page.getByPlaceholder('••••••••').fill('BadPassword123!');
    await page.getByRole('button', { name: /Sign In/i }).click();

    await expect(page.locator('text=Invalid email or password')).toBeVisible();
  });

  test('should successfully log in and display active workspace and user info', async ({ page }) => {
    await setupMockApi(page, { authenticated: false });
    await page.goto('/');

    await page.getByPlaceholder('you@example.com').fill(DEFAULT_USER.email);
    await page.getByPlaceholder('••••••••').fill('CorrectPassword123!');
    await page.getByRole('button', { name: /Sign In/i }).click();

    // After login, main workspace interface should be visible
    await expect(page.locator('text=Primary Staging Workspace').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /New Conversation/i })).toBeVisible();
  });

  test('should persist authentication session across page reload', async ({ page }) => {
    // Initial active session simulated via refresh cookie endpoint
    await setupMockApi(page, { authenticated: true });
    await page.goto('/');

    await expect(page.locator('text=Primary Staging Workspace').first()).toBeVisible();

    // Reload browser page
    await page.reload();

    // Session remains active without redirecting to login
    await expect(page.locator('text=Primary Staging Workspace').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /Sign in to MindVault/i })).not.toBeVisible();
  });

  test('should log out cleanly and return to login screen', async ({ page }) => {
    await setupMockApi(page, { authenticated: true });
    await page.goto('/');

    // Click sign out button in sidebar footer
    const logoutBtn = page.locator('button[title="Sign out"]').first();
    await expect(logoutBtn).toBeVisible();
    await logoutBtn.click();

    // Verification of return to login screen
    await expect(page.getByRole('heading', { name: /Sign in to MindVault/i })).toBeVisible();
  });
});
