import { test, expect } from '@playwright/test';
import { setupMockApi, DEFAULT_WORKSPACE } from './fixtures/mock-api';

test.describe('Flow 5: RAG Chat & Server-Sent Events (SSE) Streaming', () => {
  test('should display chat composer and submit prompt to stream SSE response', async ({ page }) => {
    const session = {
      id: 'session-chat-1',
      title: 'MindVault Architecture',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workspaceId: 'ws-playwright-test-1',
    };
    await setupMockApi(page, {
      authenticated: true,
      conversations: [session],
    });
    await page.goto('/');

    await expect(page.locator(`text=${DEFAULT_WORKSPACE.name}`)).toBeVisible();

    // Select existing conversation
    await page.locator('text=MindVault Architecture').click();

    // Verify chat composer is visible
    const textarea = page.getByPlaceholder(/Ask questions, explore ideas/i);
    await expect(textarea).toBeVisible();

    // Type query into composer
    await textarea.fill('What is the architecture of MindVault?');

    // Submit message via Enter key
    await textarea.press('Enter');

    // Verify user message appears in conversation thread
    await expect(page.locator('text=What is the architecture of MindVault?')).toBeVisible();

    // Verify streamed assistant response content rendered via SSE delta events
    await expect(
      page.locator('text=MindVault is an AI-powered personal knowledge operating system'),
    ).toBeVisible({ timeout: 10000 });

    // Verify citation pill or sources button is rendered
    await expect(
      page.getByRole('button', { name: /cited source/i }).or(page.getByRole('button', { name: /Evidence/i })).first(),
    ).toBeVisible();
  });

  test('should open source drawer when clicking citation pill', async ({ page }) => {
    const session = {
      id: 'session-chat-2',
      title: 'Citation Sources Review',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workspaceId: 'ws-playwright-test-1',
    };
    await setupMockApi(page, {
      authenticated: true,
      conversations: [session],
    });
    await page.goto('/');

    await expect(page.locator(`text=${DEFAULT_WORKSPACE.name}`)).toBeVisible();

    await page.locator('text=Citation Sources Review').click();

    const textarea = page.getByPlaceholder(/Ask questions, explore ideas/i);
    await textarea.fill('Explain the citation sources.');
    await textarea.press('Enter');

    await expect(
      page.locator('text=MindVault is an AI-powered personal knowledge operating system'),
    ).toBeVisible({ timeout: 10000 });

    // Click citation reference or evidence button
    const citationTrigger = page
      .getByRole('button', { name: /cited source/i })
      .or(page.getByRole('button', { name: /Evidence/i }))
      .first();
    await expect(citationTrigger).toBeVisible();
    await citationTrigger.click();

    // Source panel drawer should reveal document snippet
    await expect(
      page.locator('text=Verified Evidence').or(page.locator('text=Architecture Blueprint')).first(),
    ).toBeVisible();
  });

  test('should handle empty chat state gracefully', async ({ page }) => {
    await setupMockApi(page, { authenticated: true, conversations: [] });
    await page.goto('/');

    await expect(page.locator(`text=${DEFAULT_WORKSPACE.name}`)).toBeVisible();

    // Verify calm welcoming UI
    await expect(page.locator('text=Your knowledge, connected.')).toBeVisible();
    await expect(page.locator('text=Summarize my documents')).toBeVisible();
  });
});
