import { Router } from 'express';
import rateLimit, { type Store, type Options, type ClientRateLimitInfo } from 'express-rate-limit';
import { companionController } from './companion.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authenticateDevice } from './companion.auth.js';
import { env } from '../../config/env.js';
import { getRedisHealthClient } from '../../routes/health.js';
import { AppError } from '../../middleware/errorHandler.js';

export const companionRouter: Router = Router();

export { RedisRateLimitStore } from '../../middleware/redisRateLimiter.js';
import { RedisRateLimitStore } from '../../middleware/redisRateLimiter.js';

// Rate limiter for pairing code generation and device registration (§NET-01, P1 Fail-Closed)
export const companionPairingRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'test' ? 1000 : 15,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('pairing', undefined, true),
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many device pairing attempts. Please try again later.',
    },
    meta: { timestamp: new Date().toISOString() },
  },
});

// Rate limiter for high-frequency polling and heartbeats (§NET-01)
const companionPollingRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.NODE_ENV === 'test' ? 2000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('polling'),
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many companion polling requests. Please reduce polling interval.',
    },
    meta: { timestamp: new Date().toISOString() },
  },
});

// Rate limiter for device status & revocation (§NET-01)
const companionManagementRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.NODE_ENV === 'test' ? 1000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisRateLimitStore('mgmt'),
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many companion management requests.',
    },
    meta: { timestamp: new Date().toISOString() },
  },
});

// 1. One-time pairing code generation (authenticated user session required) (§SEC-01)
companionRouter.post('/pairing/code', companionPairingRateLimiter, authenticate, (req, res) => {
  companionController.createPairingCode(req, res);
});

// 2. Claim one-time pairing code to pair device (one-time code required) (§SEC-01)
companionRouter.post('/pairing/claim', companionPairingRateLimiter, (req, res) => {
  companionController.claimPairingCode(req, res);
});

// 3. Legacy device pairing / registration (user credentials required)
companionRouter.post('/device/register', companionPairingRateLimiter, authenticate, (req, res) => {
  companionController.register(req, res);
});

// 4. Device status check (device token required)
companionRouter.get(
  '/device/status',
  companionManagementRateLimiter,
  authenticateDevice,
  (req, res) => {
    companionController.getStatus(req, res);
  },
);

// 5. Device revocation (device token required)
companionRouter.post(
  '/device/revoke',
  companionManagementRateLimiter,
  authenticateDevice,
  (req, res) => {
    companionController.revoke(req, res);
  },
);

// 6. Pending job availability probe for local companion polling (device token required) (§ARC-01)
companionRouter.get('/jobs/status', companionPollingRateLimiter, authenticateDevice, (req, res) => {
  companionController.getJobStatus(req, res);
});

// 7. Heartbeat & telemetry from companion (device token required) (§NET-01)
companionRouter.post('/heartbeat', companionPollingRateLimiter, authenticateDevice, (req, res) => {
  companionController.recordHeartbeat(req, res);
});
