import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env.js';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  details?: unknown;
}

export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const isZod = err instanceof ZodError || err.name === 'ZodError';
  const statusCode = err.statusCode || (isZod ? 400 : 500);
  const errorCode = err.code || (isZod ? 'VALIDATION_ERROR' : 'INTERNAL_SERVER_ERROR');
  const message = err.message || 'An unexpected error occurred';

  console.error(`[ERROR] [${errorCode}] ${message}`, err.stack);

  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message,
      ...(isZod && { details: (err as unknown as ZodError).errors }),
      ...(env.NODE_ENV === 'development' && { stack: err.stack }),
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  });
}
