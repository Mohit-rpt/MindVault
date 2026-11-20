import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { env } from './config/env.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { workspaceRouter } from './modules/workspace/workspace.routes.js';
import { documentRouter } from './modules/document/document.routes.js';
import { retrievalRoutes } from './modules/retrieval/retrieval.routes.js';
import { createGenerationRouter } from './modules/generation/generation.routes.js';
import { createConversationRouter } from './modules/conversations/conversation.routes.js';
import { createGraphRouter } from './modules/graph/routes/graph.routes.js';
import { companionRouter } from './modules/companion/companion.routes.js';

export function createApp(): Express {
  const app = express();

  // 1. HTTP Security Headers (§SEC-08)
  app.use(
    helmet({
      contentSecurityPolicy: false, // REST & SSE API serving JSON/events; CSP enforced at frontend host
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allows cross-origin SPA requests (Vercel -> Render)
      frameguard: { action: 'deny' }, // Anti-clickjacking
      hsts:
        env.NODE_ENV === 'production'
          ? { maxAge: 15552000, includeSubDomains: true, preload: true }
          : false,
    }),
  );

  // 2. Cross-Origin Resource Sharing
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser(env.COOKIE_SECRET));

  // Logging
  app.use(requestLogger);

  // Health probe
  app.use('/api/health', healthRouter);

  // Authentication & Workspace management routes
  app.use('/api/auth', authRouter);
  app.use('/api/workspaces', workspaceRouter);
  app.use('/api/documents', documentRouter);
  app.use('/api/retrieval', retrievalRoutes);
  app.use('/api/rag', createGenerationRouter());
  app.use('/api/conversations', createConversationRouter());
  app.use('/api/graph', createGraphRouter());
  app.use('/api/companion', companionRouter);

  // 404 Handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.originalUrl} not found`,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  });

  // Centralized Error Handler
  app.use(errorHandler);

  return app;
}
