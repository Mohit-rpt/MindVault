import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

/**
 * CSRF Protection for cookie-based authentication operations (refresh, logout).
 * Validates Origin/Referer against allowed origins or verifies standard anti-CSRF custom headers.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Safe HTTP methods do not require CSRF validation
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // If in test environment, skip strict origin checking unless explicitly testing CSRF
  if (env.NODE_ENV === 'test') {
    return next();
  }

  const origin = req.headers.origin || req.headers.referer;
  const customHeader = req.headers['x-requested-with'] || req.headers['x-csrf-token'];

  // Requests made with custom headers cannot be submitted via simple cross-site forms
  if (customHeader) {
    return next();
  }

  if (origin) {
    try {
      const originUrl = new URL(origin);
      const allowedUrl = new URL(env.CORS_ORIGIN);

      if (originUrl.origin === allowedUrl.origin) {
        return next();
      }
    } catch {
      // Invalid URL format
    }
  }

  res.status(403).json({
    success: false,
    error: {
      code: 'CSRF_VALIDATION_FAILED',
      message: 'Cross-site request forgery validation failed for cookie-based operation',
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  });
}
