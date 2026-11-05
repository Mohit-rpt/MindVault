import { Router } from 'express';
import { authController } from './auth.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authRateLimiter } from '../../middleware/rateLimiter.js';
import { csrfProtection } from '../../middleware/csrfProtection.js';

export const authRouter: Router = Router();

// Public auth endpoints
authRouter.post('/register', authRateLimiter, (req, res, next) => {
  authController.register(req, res, next);
});

authRouter.post('/login', authRateLimiter, (req, res, next) => {
  authController.login(req, res, next);
});

// Cookie-based session rotation & logout (with CSRF protection)
authRouter.post('/refresh', csrfProtection, (req, res, next) => {
  authController.refresh(req, res, next);
});

authRouter.post('/logout', csrfProtection, (req, res, next) => {
  authController.logout(req, res, next);
});

// Authenticated session & identity routes
authRouter.get('/me', authenticate, (req, res, next) => {
  authController.getMe(req, res, next);
});

authRouter.get('/sessions', authenticate, (req, res, next) => {
  authController.getSessions(req, res, next);
});

authRouter.delete('/sessions/:id', authenticate, (req, res, next) => {
  authController.revokeSession(req, res, next);
});
