import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { workspaceRouter } from './modules/workspace/workspace.routes.js';
import { documentRouter } from './modules/document/document.routes.js';
import { retrievalRoutes } from './modules/retrieval/retrieval.routes.js';

export function createApp(): Express {
  const app = express();

  // Basic security and parsing middleware
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
