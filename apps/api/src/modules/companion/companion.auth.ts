import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma.js';

export function hashDeviceToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

/**
 * Middleware authenticating requests from the Local Windows Companion
 * using a high-entropy device-specific bearer token.
 */
export async function authenticateDevice(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Device authentication token missing or invalid',
      },
      meta: { timestamp: new Date().toISOString() },
    });
    return;
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Empty device token provided',
      },
      meta: { timestamp: new Date().toISOString() },
    });
    return;
  }

  try {
    const tokenHash = hashDeviceToken(token);
    const device = await prisma.companionDevice.findUnique({
      where: { tokenHash },
    });

    if (!device) {
      res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_DEVICE_TOKEN',
          message: 'Device token not recognized. Please re-register your companion.',
        },
        meta: { timestamp: new Date().toISOString() },
      });
      return;
    }

    if (device.revokedAt) {
      res.status(401).json({
        success: false,
        error: {
          code: 'DEVICE_REVOKED',
          message: 'This device registration has been revoked.',
        },
        meta: { timestamp: new Date().toISOString() },
      });
      return;
    }

    // Attach device identity to request
    req.companionDevice = {
      id: device.id,
      userId: device.userId,
      deviceName: device.deviceName,
      platform: device.platform,
    };

    // Throttled lastSeenAt update (at most once every 30 seconds to avoid DB write thrashing)
    const now = Date.now();
    const lastSeen = device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : 0;
    if (now - lastSeen > 30000) {
      prisma.companionDevice
        .update({
          where: { id: device.id },
          data: { lastSeenAt: new Date(now) },
        })
        .catch(() => {
          // Non-blocking telemetry update failure
        });
    }

    next();
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal error verifying device authentication',
      },
      meta: { timestamp: new Date().toISOString() },
    });
  }
}
