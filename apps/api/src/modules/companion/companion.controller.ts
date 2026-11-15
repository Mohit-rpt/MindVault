import { Request, Response } from 'express';
import { z } from 'zod';
import { companionService } from './companion.service.js';

const registerDeviceSchema = z.object({
  deviceName: z.string().trim().min(1, 'Device name is required').max(100),
  platform: z.string().trim().min(1).max(50).default('win32'),
});

const createPairingCodeSchema = z.object({
  workspaceId: z.string().uuid('Valid workspaceId UUID required'),
  deviceName: z.string().trim().max(100).optional(),
});

const claimPairingCodeSchema = z.object({
  pairingCode: z.string().trim().min(6, 'Valid pairing code required'),
  deviceName: z.string().trim().min(1, 'Device name required').max(100),
  platform: z.string().trim().default('win32'),
});

const heartbeatSchema = z.object({
  companionStatus: z.enum(['idle', 'running_worker', 'stopping_worker', 'error']),
  workerState: z.enum(['STOPPED', 'STARTING', 'RUNNING', 'DRAINING', 'STOPPING', 'FAILED']),
  uptimeSeconds: z.number().nonnegative(),
  idleCountdownSeconds: z.number().nullable().optional(),
  activeJobsCount: z.number().nonnegative().optional(),
  system: z
    .object({
      platform: z.string(),
      hostname: z.string(),
      arch: z.string(),
      memory: z
        .object({
          rssMb: z.number(),
          heapUsedMb: z.number(),
        })
        .optional(),
    })
    .optional(),
});

export class CompanionController {
  /**
   * POST /api/companion/pairing/code
   * Generates a short-lived one-time pairing code for an authorized workspace.
   */
  public async createPairingCode(req: Request, res: Response): Promise<void> {
    try {
      const parsed = createPairingCodeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.errors[0]?.message || 'Invalid pairing code request',
          },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      if (!req.user?.id) {
        res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'User authentication required' },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const { workspaceId, deviceName } = parsed.data;
      const result = await companionService.createPairingCode(
        req.user.id,
        workspaceId,
        deviceName,
      );

      res.status(201).json({
        success: true,
        data: result,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err: any) {
      const status = err.message?.includes('Forbidden') ? 403 : 500;
      res.status(status).json({
        success: false,
        error: { code: status === 403 ? 'FORBIDDEN' : 'INTERNAL_ERROR', message: err.message },
        meta: { timestamp: new Date().toISOString() },
      });
    }
  }

  /**
   * POST /api/companion/pairing/claim
   * Claims a one-time pairing code and returns device credentials.
   */
  public async claimPairingCode(req: Request, res: Response): Promise<void> {
    try {
      const parsed = claimPairingCodeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.errors[0]?.message || 'Invalid pairing claim request',
          },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const { pairingCode, deviceName, platform } = parsed.data;
      const registration = await companionService.claimPairingCode(
        pairingCode,
        deviceName,
        platform,
      );

      res.status(201).json({
        success: true,
        data: registration,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err: any) {
      const isInvalid = err.message?.includes('Invalid or expired');
      res.status(isInvalid ? 400 : 500).json({
        success: false,
        error: { code: isInvalid ? 'INVALID_PAIRING_CODE' : 'INTERNAL_ERROR', message: err.message },
        meta: { timestamp: new Date().toISOString() },
      });
    }
  }

  /**
   * POST /api/companion/device/register
   * Registers a new companion device. Requires authenticated User.
   */
  public async register(req: Request, res: Response): Promise<void> {
    try {
      const parsed = registerDeviceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.errors[0]?.message || 'Invalid registration request',
          },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      if (!req.user?.id) {
        res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'User authentication required' },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const { deviceName, platform } = parsed.data;
      const registration = await companionService.registerDevice(
        req.user.id,
        deviceName,
        platform,
      );

      res.status(201).json({
        success: true,
        data: registration,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err.message },
        meta: { timestamp: new Date().toISOString() },
      });
    }
  }

  /**
   * GET /api/companion/device/status
   * Returns current registration status of the authenticated device.
   */
  public async getStatus(req: Request, res: Response): Promise<void> {
    try {
      const deviceId = req.companionDevice?.id;
      if (!deviceId) {
        res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Device authentication required' },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const status = await companionService.getDeviceStatus(deviceId);
      if (!status) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Device registration not found' },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: status,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err.message },
        meta: { timestamp: new Date().toISOString() },
      });
    }
  }

  /**
   * POST /api/companion/device/revoke
   * Revokes an existing device registration.
   */
  public async revoke(req: Request, res: Response): Promise<void> {
    try {
      const deviceId = req.companionDevice?.id || req.body?.deviceId;
      if (!deviceId) {
        res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'deviceId is required to revoke registration' },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const userId = req.user?.id;
      const revoked = await companionService.revokeDevice(deviceId, userId);

      if (!revoked) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Device not found' },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: { message: 'Device registration revoked successfully' },
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err.message },
        meta: { timestamp: new Date().toISOString() },
      });
    }
  }

  /**
   * GET /api/companion/jobs/status
   * Reports pending and active job status across BullMQ queues.
   */
  public async getJobStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.companionDevice?.userId;
      const status = await companionService.getJobStatus(userId);
      res.status(200).json({
        success: true,
        data: status,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err: any) {
      res.status(503).json({
        success: false,
        error: {
          code: 'QUEUE_QUERY_FAILED',
          message: `Failed to query queue status: ${err.message}`,
        },
        meta: { timestamp: new Date().toISOString() },
      });
    }
  }

  /**
   * POST /api/companion/heartbeat
   * Receives companion telemetry.
   */
  public async recordHeartbeat(req: Request, res: Response): Promise<void> {
    try {
      const device = req.companionDevice;
      if (!device) {
        res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Device authentication required' },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const parsed = heartbeatSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.errors[0]?.message || 'Invalid heartbeat payload',
          },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      await companionService.recordCompanionHeartbeat(device.id, {
        deviceName: device.deviceName,
        ...parsed.data,
      });

      res.status(200).json({
        success: true,
        data: { status: 'recorded' },
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err.message },
        meta: { timestamp: new Date().toISOString() },
      });
    }
  }
}

export const companionController = new CompanionController();
