import { Page } from '@playwright/test';

export interface MockApiOptions {
  authenticated?: boolean;
  user?: {
    id: string;
    email: string;
    name: string;
  };
  workspaces?: Array<{
    id: string;
    name: string;
    role: string;
    isDefault?: boolean;
  }>;
  documents?: Array<{
    id: string;
    title: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    createdAt: string;
  }>;
  conversations?: Array<{
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    workspaceId: string;
  }>;
  graphOverview?: any;
  rateLimitEndpoints?: string[];
  quotaExceededEndpoints?: string[];
}

export const DEFAULT_USER = {
  id: 'usr-playwright-test-1',
  email: 'testuser@mindvault.local',
  name: 'Playwright Test User',
};

export const DEFAULT_WORKSPACE = {
  id: 'ws-playwright-test-1',
  name: 'Primary Staging Workspace',
  role: 'OWNER',
  isDefault: true,
};

export const SECONDARY_WORKSPACE = {
  id: 'ws-playwright-test-2',
  name: 'Secondary Research Workspace',
  role: 'MEMBER',
  isDefault: false,
};

export const DEFAULT_DOCUMENTS = [
  {
    id: 'doc-playwright-1',
    workspaceId: 'ws-playwright-test-1',
    originalName: 'architecture_blueprint.pdf',
    fileName: 'architecture_blueprint.pdf',
    title: 'architecture_blueprint.pdf',
    sizeBytes: 1048576,
    mimeType: 'application/pdf',
    extension: '.pdf',
    status: 'COMPLETED' as const,
    chunkCount: 8,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'doc-playwright-2',
    workspaceId: 'ws-playwright-test-1',
    originalName: 'sprint_notes.md',
    fileName: 'sprint_notes.md',
    title: 'sprint_notes.md',
    sizeBytes: 4096,
    mimeType: 'text/markdown',
    extension: '.md',
    status: 'COMPLETED' as const,
    chunkCount: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export async function setupMockApi(page: Page, options: MockApiOptions = {}) {
  const isAuth = options.authenticated ?? false;
  const user = options.user || DEFAULT_USER;
  const workspaces = options.workspaces || [DEFAULT_WORKSPACE, SECONDARY_WORKSPACE];
  let documents = options.documents ? [...options.documents] : [...DEFAULT_DOCUMENTS];
  let conversations = options.conversations ? [...options.conversations] : [];
  const rateLimited = new Set(options.rateLimitEndpoints || []);
  const quotaExceeded = new Set(options.quotaExceededEndpoints || []);

  // Intercept all /api/ calls
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    // 1. Rate Limiting Simulation (§SEC-05)
    for (const pattern of rateLimited) {
      if (path.includes(pattern)) {
        await route.fulfill({
          status: 429,
          statusText: 'Too Many Requests',
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Too many requests. Please slow down and try again later.',
            },
            meta: { retryAfter: 60, timestamp: new Date().toISOString() },
          }),
        });
        return;
      }
    }

    // 2. Resource Quota Simulation (§SEC-06)
    for (const pattern of quotaExceeded) {
      if (path.includes(pattern)) {
        await route.fulfill({
          status: 429,
          statusText: 'Too Many Requests',
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: {
              code: 'WORKSPACE_DOCUMENT_QUOTA_EXCEEDED',
              message: 'Workspace document limit reached (100 documents). Delete existing documents to continue.',
            },
            meta: { timestamp: new Date().toISOString() },
          }),
        });
        return;
      }
    }

    // 3. Auth Endpoints
    if (path === '/api/auth/refresh' && method === 'POST') {
      if (!isAuth) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'No active session' },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            user,
            accessToken: 'mock_jwt_access_token_deterministic_for_playwright_test',
          },
          meta: { timestamp: new Date().toISOString() },
        }),
      });
      return;
    }

    if (path === '/api/auth/login' && method === 'POST') {
      const body = request.postDataJSON();
      if (body?.email === 'testuser@mindvault.local' && body?.password === 'CorrectPassword123!') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              user,
              accessToken: 'mock_jwt_access_token_deterministic_for_playwright_test',
              activeWorkspace: workspaces[0],
            },
            meta: { timestamp: new Date().toISOString() },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        }),
      });
      return;
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { message: 'Logged out successfully' },
        }),
      });
      return;
    }

    if (path === '/api/auth/register' && method === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            user: { ...user, email: request.postDataJSON()?.email || user.email },
            accessToken: 'mock_jwt_access_token_deterministic_for_playwright_test',
            activeWorkspace: workspaces[0],
          },
        }),
      });
      return;
    }

    // 4. Workspace Endpoints
    if (path === '/api/workspaces' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: workspaces,
        }),
      });
      return;
    }

    if (path === '/api/workspaces' && method === 'POST') {
      const body = request.postDataJSON();
      const newWs = {
        id: `ws-${Date.now()}`,
        name: body?.name || 'New Custom Workspace',
        role: 'OWNER',
        isDefault: false,
      };
      workspaces.push(newWs);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: newWs,
        }),
      });
      return;
    }

    // 5. Document Management Endpoints
    if (path === '/api/documents' && method === 'GET') {
      const search = url.searchParams.get('search');
      let filtered = [...documents];
      if (search) {
        filtered = filtered.filter((d) =>
          d.title.toLowerCase().includes(search.toLowerCase()) ||
          d.fileName.toLowerCase().includes(search.toLowerCase())
        );
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            items: filtered,
            total: filtered.length,
          },
        }),
      });
      return;
    }

    if (path === '/api/documents/upload' && method === 'POST') {
      const postData = request.postData() || '';
      if (postData.includes('.exe') || postData.includes('application/x-msdownload')) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: {
              code: 'UNSUPPORTED_FILE_TYPE',
              message: 'Unsupported file type. Only PDF, DOCX, TXT, and MD files are supported.',
            },
          }),
        });
        return;
      }

      if (postData.includes('massive_document')) {
        await route.fulfill({
          status: 413,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            error: {
              code: 'FILE_TOO_LARGE',
              message: 'File size exceeds maximum limit of 25MB.',
            },
          }),
        });
        return;
      }

      const newDoc = {
        id: `doc-${Date.now()}`,
        workspaceId: workspaces[0].id,
        originalName: 'test_document.pdf',
        fileName: 'test_document.pdf',
        title: 'test_document.pdf',
        sizeBytes: 10240,
        mimeType: 'application/pdf',
        extension: '.pdf',
        status: 'QUEUED' as const,
        chunkCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      documents.unshift(newDoc);
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: newDoc,
        }),
      });
      return;
    }

    if (path.match(/\/api\/documents\/[^/]+\/download/) && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        headers: {
          'Content-Disposition': 'attachment; filename="test_document.pdf"',
        },
        body: '%PDF-1.4 Mock PDF Content For Playwright Verification',
      });
      return;
    }

    if (path.match(/\/api\/documents\/[^/]+$/) && method === 'DELETE') {
      const docId = path.split('/').pop();
      documents = documents.filter((d) => d.id !== docId);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { id: docId, deleted: true },
        }),
      });
      return;
    }

    // 6. Conversations & RAG Streaming Endpoints
    if (path === '/api/conversations' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { items: conversations, total: conversations.length },
        }),
      });
      return;
    }

    if (path === '/api/conversations' && method === 'POST') {
      const newSession = {
        id: `session_${Date.now()}`,
        title: 'New Investigation',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        workspaceId: workspaces[0].id,
      };
      conversations.unshift(newSession);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: newSession,
        }),
      });
      return;
    }

    if (path.match(/\/api\/conversations\/[^/]+\/messages$/) && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { items: [], total: 0 },
        }),
      });
      return;
    }

    // SSE Real-time Token Streaming
    if (path.match(/\/api\/conversations\/[^/]+\/messages\/stream$/) && method === 'POST') {
      const sseBody = [
        'event: start\ndata: {"assistantMessageId":"asst-mock-1","userMessageId":"user-mock-1"}\n\n',
        'event: sources\ndata: {"sources":[{"citationId":"1","documentId":"doc-playwright-1","documentName":"Architecture Blueprint","chunkId":"chunk-1","chunkIndex":0,"content":"MindVault architectural blueprint specification.","score":0.95}]}\n\n',
        'event: token\ndata: {"text":"MindVault is an AI-powered personal knowledge operating system "}\n\n',
        'event: token\ndata: {"text":"providing private RAG search with citations [1]. "}\n\n',
        'event: done\ndata: {"totalTokens":42}\n\n',
      ].join('');

      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: {
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
        body: sseBody,
      });
      return;
    }

    // 7. Knowledge Graph Endpoints
    if (path === '/api/graph/overview' && method === 'GET') {
      const overview = options.graphOverview || {
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
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: overview,
        }),
      });
      return;
    }

    if (path === '/api/graph/entities' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            items: [
              { id: 'ent-1', canonicalName: 'MindVault Core', entityType: 'CONCEPT', degree: 5 },
              { id: 'ent-2', canonicalName: 'Gemini 3.5 Flash', entityType: 'MODEL', degree: 3 },
              { id: 'ent-3', canonicalName: 'pgvector Cosine', entityType: 'DATABASE', degree: 4 },
            ],
            total: 3,
          },
        }),
      });
      return;
    }

    if (path.match(/\/api\/graph\/entities\/[^/]+\/neighborhood/) && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            nodes: [
              { id: 'ent-1', canonicalName: 'MindVault Core', entityType: 'CONCEPT', degree: 5 },
              { id: 'ent-2', canonicalName: 'Gemini 3.5 Flash', entityType: 'MODEL', degree: 3 },
              { id: 'ent-3', canonicalName: 'pgvector Cosine', entityType: 'DATABASE', degree: 4 },
            ],
            edges: [
              { id: 'rel-1', sourceEntityId: 'ent-1', targetEntityId: 'ent-2', relationType: 'USES_MODEL', confidence: 0.95 },
              { id: 'rel-2', sourceEntityId: 'ent-1', targetEntityId: 'ent-3', relationType: 'STORES_IN', confidence: 0.9 },
            ],
          },
        }),
      });
      return;
    }

    // 8. Auth Sessions and Workspace Detail
    if (path.startsWith('/api/auth/sessions')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 'sess-current-1',
              userAgent: 'Playwright Headless Chrome',
              ipAddress: '127.0.0.1',
              isCurrent: true,
              createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
            },
          ],
        }),
      });
      return;
    }

    if (path.startsWith('/api/workspaces/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: workspaces[0],
        }),
      });
      return;
    }

    // Fallback unhandled API routes: respond immediately with empty success JSON to prevent hanging proxy
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [],
        meta: { mock: true, timestamp: new Date().toISOString() },
      }),
    });
  });
}
