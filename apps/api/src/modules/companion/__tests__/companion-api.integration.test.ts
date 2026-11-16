import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// Mock prisma before importing app
vi.mock('../../../lib/prisma.js', () => {
  const devices = new Map<string, any>();
  const workspaceMembers: any[] = [];
  const documents: any[] = [];

  return {
    prisma: {
      companionDevice: {
        create: vi.fn().mockImplementation(async ({ data }) => {
          const record = {
            id: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            userId: data.userId,
            deviceName: data.deviceName,
            platform: data.platform || 'win32',
            tokenHash: data.tokenHash,
            lastSeenAt: null,
            revokedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          devices.set(data.tokenHash, record);
          devices.set(record.id, record);
          return record;
        }),
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          if (where.tokenHash) return devices.get(where.tokenHash) || null;
          if (where.id) return devices.get(where.id) || null;
          return null;
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const record = devices.get(where.id);
          if (!record) throw new Error('Not found');
          Object.assign(record, data, { updatedAt: new Date() });
          return record;
        }),
      },
      workspaceMember: {
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          const { userId_workspaceId } = where;
          return (
            workspaceMembers.find(
              (m) =>
                m.userId === userId_workspaceId.userId &&
                m.workspaceId === userId_workspaceId.workspaceId,
            ) || null
          );
        }),
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          if (where.userId) {
            return workspaceMembers.filter((m) => m.userId === where.userId);
          }
          return workspaceMembers;
        }),
      },
      document: {
        count: vi.fn().mockImplementation(async ({ where }) => {
          return documents.filter((doc) => {
            if (where.workspaceId?.in && !where.workspaceId.in.includes(doc.workspaceId)) {
              return false;
            }
            if (where.status?.in && !where.status.in.includes(doc.status)) {
              return false;
            }
            if (where.status && typeof where.status === 'string' && doc.status !== where.status) {
              return false;
            }
            return true;
          }).length;
        }),
      },
      _testState: {
        devices,
        workspaceMembers,
        documents,
      },
      $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    },
  };
});

import { createApp } from '../../../app.js';
import { generateAccessToken } from '../../auth/auth.security.js';
import { setRedisHealthClient } from '../../../routes/health.js';
import { prisma } from '../../../lib/prisma.js';

describe('MindVault Cloud API — Companion Device & Job Status Endpoints', () => {
  let app: any;
  let validUserToken: string;
  let mockRedisClient: any;
  const testState = (prisma as any)._testState;

  beforeEach(() => {
    vi.clearAllMocks();
    testState.devices.clear();
    testState.workspaceMembers.length = 0;
    testState.documents.length = 0;

    const inMemoryRedis = new Map<string, string>();
    mockRedisClient = {
      get: vi.fn().mockImplementation(async (key: string) => inMemoryRedis.get(key) || null),
      set: vi.fn().mockImplementation(async (key: string, val: string) => {
        inMemoryRedis.set(key, val);
        return 'OK';
      }),
      del: vi.fn().mockImplementation(async (key: string) => {
        const existed = inMemoryRedis.has(key);
        inMemoryRedis.delete(key);
        return existed ? 1 : 0;
      }),
      ping: vi.fn().mockResolvedValue('PONG'),
    };
    setRedisHealthClient(mockRedisClient);

    app = createApp();
    validUserToken = generateAccessToken({
      id: 'user-uuid-1234',
      email: 'companion-owner@mindvault.dev',
      name: 'Companion Owner',
    });
  });

  afterEach(() => {
    setRedisHealthClient(null);
  });

  // =========================================================================
  // 1. One-Time Pairing Code Flow (§SEC-01)
  // =========================================================================
  describe('One-Time Pairing Code Flow (§SEC-01)', () => {
    it('generates a short-lived 8-character pairing code for authorized workspace member', async () => {
      const workspaceId = 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d';
      testState.workspaceMembers.push({
        userId: 'user-uuid-1234',
        workspaceId,
        role: 'OWNER',
        workspace: { id: workspaceId, name: 'Personal Vault' },
      });

      const res = await request(app)
        .post('/api/companion/pairing/code')
        .set('Authorization', `Bearer ${validUserToken}`)
        .send({ workspaceId, deviceName: 'Mohit-Win11' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.pairingCode).toMatch(/^MVP-[A-F0-9]{4}-[A-F0-9]{4}$/);
      expect(res.body.data.workspaceId).toBe(workspaceId);
      expect(res.body.data.workspaceName).toBe('Personal Vault');
    });

    it('rejects pairing code generation if user is not a member of the workspace', async () => {
      const res = await request(app)
        .post('/api/companion/pairing/code')
        .set('Authorization', `Bearer ${validUserToken}`)
        .send({ workspaceId: 'b2c3d4e5-f6a1-4b2c-9d3e-4f5a6b7c8d9e' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('claims pairing code atomically and invalidates upon second use (one-time guarantee)', async () => {
      const workspaceId = 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d';
      testState.workspaceMembers.push({
        userId: 'user-uuid-1234',
        workspaceId,
        role: 'OWNER',
        workspace: { id: workspaceId, name: 'Personal Vault' },
      });

      // 1. Create code
      const codeRes = await request(app)
        .post('/api/companion/pairing/code')
        .set('Authorization', `Bearer ${validUserToken}`)
        .send({ workspaceId });
      const pairingCode = codeRes.body.data.pairingCode;

      // 2. Claim code
      const claimRes = await request(app)
        .post('/api/companion/pairing/claim')
        .send({ pairingCode, deviceName: 'Mohit-Win11-PC', platform: 'win32' });

      expect(claimRes.status).toBe(201);
      expect(claimRes.body.success).toBe(true);
      expect(claimRes.body.data.deviceToken).toMatch(/^mvd_[a-f0-9]{64}$/);
      expect(claimRes.body.data.workspaceId).toBe(workspaceId);

      // 3. Second claim of identical code must be rejected (single-use enforcement)
      const secondClaim = await request(app)
        .post('/api/companion/pairing/claim')
        .send({ pairingCode, deviceName: 'Intruder-PC', platform: 'win32' });

      expect(secondClaim.status).toBe(400);
      expect(secondClaim.body.error.code).toBe('INVALID_PAIRING_CODE');
    });
  });

  // =========================================================================
  // 2. Multi-Tenant Queue Isolation Adversarial Test (§ARC-01)
  // =========================================================================
  describe('Multi-Tenant Queue Isolation Adversarial Suite (§ARC-01)', () => {
    it('guarantees Companion A strictly observes and processes ONLY Workspace A jobs, with zero leakage of Workspace B', async () => {
      const userAId = 'user-uuid-1234';
      const userBId = 'user-uuid-5678';
      const workspaceA = 'a1b2c3d4-0000-0000-0000-000000000001';
      const workspaceB = 'b2c3d4e5-0000-0000-0000-000000000002';

      // User A is member of Workspace A only
      testState.workspaceMembers.push({
        userId: userAId,
        workspaceId: workspaceA,
        workspace: { id: workspaceA, name: 'Workspace A' },
      });

      // User B is member of Workspace B only
      testState.workspaceMembers.push({
        userId: userBId,
        workspaceId: workspaceB,
        workspace: { id: workspaceB, name: 'Workspace B' },
      });

      // Pair Companion A for User A
      const tokenA = (
        await request(app)
          .post('/api/companion/device/register')
          .set('Authorization', `Bearer ${validUserToken}`)
          .send({ deviceName: 'Companion-UserA' })
      ).body.data.deviceToken;

      // Pair Companion B for User B
      const userBToken = generateAccessToken({
        id: userBId,
        email: 'userb@mindvault.dev',
        name: 'User B',
      });
      const tokenB = (
        await request(app)
          .post('/api/companion/device/register')
          .set('Authorization', `Bearer ${userBToken}`)
          .send({ deviceName: 'Companion-UserB' })
      ).body.data.deviceToken;

      // Workspace B has 10 pending documents enqueued!
      for (let i = 0; i < 10; i++) {
        testState.documents.push({
          id: `doc-b-${i}`,
          workspaceId: workspaceB,
          status: 'QUEUED',
        });
      }

      // Workspace A has 0 pending documents enqueued
      // Query job status using Companion A:
      const statusA = await request(app)
        .get('/api/companion/jobs/status')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(statusA.status).toBe(200);
      expect(statusA.body.data.hasPendingJobs).toBe(false);
      expect(statusA.body.data.summary.waiting).toBe(0); // Zero cross-tenant leakage!

      // Query job status using Companion B:
      const statusB = await request(app)
        .get('/api/companion/jobs/status')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(statusB.status).toBe(200);
      expect(statusB.body.data.hasPendingJobs).toBe(true);
      expect(statusB.body.data.summary.waiting).toBe(10); // Sees its own 10 documents
    });
  });

  // =========================================================================
  // 3. Device Status (GET /api/companion/device/status)
  // =========================================================================
  it('returns device status when authenticated with valid device token', async () => {
    const regRes = await request(app)
      .post('/api/companion/device/register')
      .set('Authorization', `Bearer ${validUserToken}`)
      .send({ deviceName: 'Status-Test-Device' });

    const token = regRes.body.data.deviceToken;

    const statusRes = await request(app)
      .get('/api/companion/device/status')
      .set('Authorization', `Bearer ${token}`);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.success).toBe(true);
    expect(statusRes.body.data.deviceName).toBe('Status-Test-Device');
    expect(statusRes.body.data.isRevoked).toBe(false);
  });

  it('rejects device status check with unknown token (HTTP 401 INVALID_DEVICE_TOKEN)', async () => {
    const res = await request(app)
      .get('/api/companion/device/status')
      .set(
        'Authorization',
        'Bearer mvd_invalid_nonexistent_token_00000000000000000000000000000000',
      );

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_DEVICE_TOKEN');
  });

  // =========================================================================
  // 4. Companion Heartbeat & Telemetry (POST /api/companion/heartbeat)
  // =========================================================================
  it('persists companion telemetry into Redis and updates lastSeenAt', async () => {
    const regRes = await request(app)
      .post('/api/companion/device/register')
      .set('Authorization', `Bearer ${validUserToken}`)
      .send({ deviceName: 'Heartbeat-Test-Device' });
    const token = regRes.body.data.deviceToken;

    const hbRes = await request(app)
      .post('/api/companion/heartbeat')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companionStatus: 'idle',
        workerState: 'STOPPED',
        uptimeSeconds: 120,
        idleCountdownSeconds: null,
      });

    expect(hbRes.status).toBe(200);
    expect(hbRes.body.success).toBe(true);
    expect(mockRedisClient.set).toHaveBeenCalledWith(
      'mindvault:companion:heartbeat',
      expect.stringContaining('Heartbeat-Test-Device'),
      'EX',
      35,
    );
  });

  // =========================================================================
  // 5. Device Revocation (POST /api/companion/device/revoke)
  // =========================================================================
  it('revokes device registration and rejects subsequent calls with DEVICE_REVOKED', async () => {
    const regRes = await request(app)
      .post('/api/companion/device/register')
      .set('Authorization', `Bearer ${validUserToken}`)
      .send({ deviceName: 'To-Revoke-Device' });
    const token = regRes.body.data.deviceToken;

    // Revoke
    const revokeRes = await request(app)
      .post('/api/companion/device/revoke')
      .set('Authorization', `Bearer ${token}`);

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.success).toBe(true);

    // Subsequent call must fail with DEVICE_REVOKED
    const blockedRes = await request(app)
      .get('/api/companion/jobs/status')
      .set('Authorization', `Bearer ${token}`);

    expect(blockedRes.status).toBe(401);
    expect(blockedRes.body.error.code).toBe('DEVICE_REVOKED');
  });

  // =========================================================================
  // 6. Health Probe for Companion (GET /api/health/companion)
  // =========================================================================
  it('health endpoint reports companion offline when no heartbeat is in Redis', async () => {
    mockRedisClient.get.mockResolvedValue(null);

    const res = await request(app).get('/api/health/companion');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('offline');
  });

  it('health endpoint reports companion online with host metadata when heartbeat exists in Redis', async () => {
    mockRedisClient.get.mockResolvedValue(
      JSON.stringify({
        deviceId: 'dev-123',
        deviceName: 'Mohit-Win11',
        companionStatus: 'idle',
        workerState: 'STOPPED',
        uptimeSeconds: 3600,
      }),
    );

    const res = await request(app).get('/api/health/companion');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('online');
    expect(res.body.deviceName).toBe('Mohit-Win11');
    expect(res.body.workerState).toBe('STOPPED');
  });
});
