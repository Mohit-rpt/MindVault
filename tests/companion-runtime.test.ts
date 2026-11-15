import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WorkerStateMachine } from '../apps/companion/src/supervisor/worker-state-machine.js';
import { IdleController } from '../apps/companion/src/controller/idle-controller.js';
import { SingleInstanceLock } from '../apps/companion/src/utils/single-instance-lock.js';
import {
  saveStoredToken,
  loadStoredToken,
  clearStoredToken,
  getTokenFilePath,
} from '../apps/companion/src/auth/token-store.js';
import { CloudApiClient, AuthError, NetworkError } from '../apps/companion/src/client/cloud-api.client.js';
import { WorkerSupervisor } from '../apps/companion/src/supervisor/worker-supervisor.js';
import { CompanionController } from '../apps/companion/src/controller/companion-controller.js';

describe('MindVault — Local Windows Companion Runtime Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearStoredToken();
  });

  // =========================================================================
  // 1. Worker State Machine Tests
  // =========================================================================
  describe('Worker State Machine', () => {
    it('executes valid lifecycle transitions and logs transition history', () => {
      const sm = new WorkerStateMachine('STOPPED');
      expect(sm.getState()).toBe('STOPPED');

      // Valid sequence: STOPPED -> STARTING -> RUNNING -> DRAINING -> STOPPING -> STOPPED
      expect(sm.transition('STARTING', 'Job enqueued')).toBe(true);
      expect(sm.getState()).toBe('STARTING');

      expect(sm.transition('RUNNING', 'Process active')).toBe(true);
      expect(sm.getState()).toBe('RUNNING');

      expect(sm.transition('DRAINING', 'Idle timeout starting')).toBe(true);
      expect(sm.getState()).toBe('DRAINING');

      expect(sm.transition('STOPPING', 'Terminating child')).toBe(true);
      expect(sm.getState()).toBe('STOPPING');

      expect(sm.transition('STOPPED', 'Process exited cleanly')).toBe(true);
      expect(sm.getState()).toBe('STOPPED');

      const history = sm.getHistory();
      expect(history).toHaveLength(5);
      expect(history[0].from).toBe('STOPPED');
      expect(history[0].to).toBe('STARTING');
    });

    it('rejects invalid state transitions deterministically', () => {
      const sm = new WorkerStateMachine('STOPPED');

      // Cannot jump from STOPPED directly to DRAINING or STOPPING
      expect(sm.transition('DRAINING', 'Invalid jump')).toBe(false);
      expect(sm.getState()).toBe('STOPPED');

      expect(sm.transition('STOPPING', 'Invalid jump')).toBe(false);
      expect(sm.getState()).toBe('STOPPED');
    });

    it('transitions to FAILED on startup or runtime crash', () => {
      const sm = new WorkerStateMachine('STARTING');
      expect(sm.transition('FAILED', 'Process crash')).toBe(true);
      expect(sm.getState()).toBe('FAILED');

      // Can reset from FAILED to STOPPED or STARTING
      expect(sm.transition('STOPPED', 'User reset')).toBe(true);
      expect(sm.getState()).toBe('STOPPED');
    });
  });

  // =========================================================================
  // 2. Idle Controller Tests
  // =========================================================================
  describe('Idle Shutdown Controller', () => {
    it('starts countdown on idle and emits idle_expired after timeout', async () => {
      vi.useFakeTimers();
      const idle = new IdleController({ idleTimeoutMs: 300000 }); // 5 minutes

      const onStarted = vi.fn();
      const onExpired = vi.fn();
      idle.on('idle_started', onStarted);
      idle.on('idle_expired', onExpired);

      expect(idle.isIdleCountdownActive()).toBe(false);

      idle.onIdleDetected();
      expect(idle.isIdleCountdownActive()).toBe(true);
      expect(onStarted).toHaveBeenCalledWith({ timeoutMs: 300000 });
      expect(idle.getRemainingSeconds()).toBe(300);

      // Fast forward 2 minutes
      vi.advanceTimersByTime(120000);
      expect(idle.getRemainingSeconds()).toBe(180);
      expect(onExpired).not.toHaveBeenCalled();

      // Fast forward remaining 3 minutes
      vi.advanceTimersByTime(180000);
      expect(onExpired).toHaveBeenCalledTimes(1);
      expect(idle.isIdleCountdownActive()).toBe(false);

      vi.useRealTimers();
    });

    it('immediately cancels countdown when new job activity arrives', () => {
      vi.useFakeTimers();
      const idle = new IdleController({ idleTimeoutMs: 300000 });

      const onCancelled = vi.fn();
      idle.on('idle_cancelled', onCancelled);

      idle.onIdleDetected();
      expect(idle.isIdleCountdownActive()).toBe(true);

      // Advance 1 minute
      vi.advanceTimersByTime(60000);

      // New work arrives
      idle.onJobActivityDetected('New document uploaded');
      expect(idle.isIdleCountdownActive()).toBe(false);
      expect(idle.getRemainingSeconds()).toBeNull();
      expect(onCancelled).toHaveBeenCalledWith({ reason: 'New document uploaded' });

      vi.useRealTimers();
    });
  });

  // =========================================================================
  // 3. Secure Windows Token Store Tests
  // =========================================================================
  describe('Secure Windows Token Store', () => {
    it('saves, decrypts, and verifies stored device token matching original payload', () => {
      const mockToken = {
        deviceId: 'dev-win11-xyz-999',
        deviceToken: 'mvd_aabbccddeeff00112233445566778899',
        deviceName: 'Mohit-Test-PC',
        registeredAt: new Date().toISOString(),
        apiUrl: 'http://localhost:3000',
      };

      saveStoredToken(mockToken);

      const filePath = getTokenFilePath();
      expect(fs.existsSync(filePath)).toBe(true);

      // Verify file content is encrypted JSON (not containing plaintext token)
      const rawDisk = fs.readFileSync(filePath, 'utf-8');
      expect(rawDisk).not.toContain(mockToken.deviceToken);
      const isEncrypted = rawDisk.includes('ciphertext') || rawDisk.includes('protectedData');
      expect(isEncrypted).toBe(true);

      // Load and decrypt
      const loaded = loadStoredToken();
      expect(loaded).toEqual(mockToken);

      // Clear token
      clearStoredToken();
      expect(fs.existsSync(filePath)).toBe(false);
      expect(loadStoredToken()).toBeNull();
    });

    it('handles corrupted or malformed token storage files safely returning null without crashing (§SEC-02)', () => {
      const filePath = getTokenFilePath();
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, 'CORRUPT_RAW_DATA_NOT_JSON');

      expect(loadStoredToken()).toBeNull();

      // Malformed json missing ciphertext
      fs.writeFileSync(filePath, JSON.stringify({ version: 2, mechanism: 'dpapi' }));
      expect(loadStoredToken()).toBeNull();

      // Clean up
      clearStoredToken();
    });
  });

  // =========================================================================
  // 4. Cloud API Client Tests
  // =========================================================================
  describe('Cloud API Client', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('queries job status with bearer token and parses queue counts', async () => {
      const mockJobData = {
        hasPendingJobs: true,
        hasActiveJobs: false,
        summary: { waiting: 2, active: 0, delayed: 0, completed: 5, failed: 0 },
        queues: {
          documentProcessing: { waiting: 2, active: 0, delayed: 0, completed: 5, failed: 0 },
          graphExtraction: { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 },
        },
        timestamp: new Date().toISOString(),
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: mockJobData }),
      } as any);

      const client = new CloudApiClient('http://localhost:3000');
      const result = await client.getJobStatus('mvd_test_token_123');

      expect(result.hasPendingJobs).toBe(true);
      expect(result.summary.waiting).toBe(2);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/companion/jobs/status',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mvd_test_token_123',
          }),
        }),
      );
    });

    it('throws AuthError with code UNAUTHORIZED on HTTP 401', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Device token revoked' } }),
      } as any);

      const client = new CloudApiClient('http://localhost:3000');
      await expect(client.getJobStatus('mvd_revoked_token')).rejects.toThrow(AuthError);
    });

    it('throws NetworkError when request times out or connection is refused', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('fetch failed: connect ECONNREFUSED'));

      const client = new CloudApiClient('http://localhost:3000');
      await expect(client.getJobStatus('mvd_test_token')).rejects.toThrow(NetworkError);
    });
  });

  // =========================================================================
  // 5. Worker Supervisor Tests
  // =========================================================================
  describe('Worker Process Supervisor', () => {
    it('prevents duplicate start attempts when worker is already running', async () => {
      const supervisor = new WorkerSupervisor();
      (supervisor as any).stateMachine.transition('STARTING', 'test');
      (supervisor as any).stateMachine.transition('RUNNING', 'test');

      const secondStart = await supervisor.start();
      expect(secondStart).toBe(true);
      expect(supervisor.getState()).toBe('RUNNING');
    });

    it('tracks crash timestamps and limits restart attempts to maxCrashRestarts', () => {
      const supervisor = new WorkerSupervisor({ maxCrashRestarts: 2 });
      const onCrashLimit = vi.fn();
      supervisor.on('crash_limit_reached', onCrashLimit);

      // Simulate first crash
      (supervisor as any).handleProcessExit(1, null);
      expect(supervisor.getState()).toBe('STOPPED');

      // Simulate second crash
      (supervisor as any).handleProcessExit(1, null);
      expect(supervisor.getState()).toBe('STOPPED');

      // Simulate third crash (exceeds 2)
      (supervisor as any).handleProcessExit(1, null);
      expect(supervisor.getState()).toBe('FAILED');
      expect(onCrashLimit).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 6. Companion Controller Orchestration Tests
  // =========================================================================
  describe('Companion Controller Orchestration', () => {
    it('starts worker when pending jobs are discovered while worker is STOPPED', async () => {
      const mockClient = {
        getJobStatus: vi.fn().mockResolvedValue({
          hasPendingJobs: true,
          hasActiveJobs: false,
          summary: { waiting: 1, active: 0, delayed: 0, completed: 0, failed: 0 },
        }),
        getDeviceStatus: vi.fn().mockResolvedValue({ isRevoked: false }),
        sendHeartbeat: vi.fn().mockResolvedValue(undefined),
      };

      const mockSupervisor = {
        getState: vi.fn().mockReturnValue('STOPPED'),
        isRunning: vi.fn().mockReturnValue(false),
        start: vi.fn().mockResolvedValue(true),
        stop: vi.fn().mockResolvedValue(true),
        on: vi.fn(),
      };

      const mockIdle = {
        onJobActivityDetected: vi.fn(),
        onIdleDetected: vi.fn(),
        isIdleCountdownActive: vi.fn().mockReturnValue(false),
        getRemainingSeconds: vi.fn().mockReturnValue(null),
        reset: vi.fn(),
        on: vi.fn(),
      };

      const controller = new CompanionController(
        mockClient as any,
        mockSupervisor as any,
        mockIdle as any,
      );

      // Inject token
      (controller as any).tokenData = {
        deviceId: 'dev-1',
        deviceToken: 'mvd_test',
        deviceName: 'TestPC',
      };

      await controller.pollOnce();

      expect(mockIdle.onJobActivityDetected).toHaveBeenCalled();
      expect(mockSupervisor.start).toHaveBeenCalledTimes(1);
    });

    it('activates idle countdown when no pending or active jobs exist while worker is RUNNING', async () => {
      const mockClient = {
        getJobStatus: vi.fn().mockResolvedValue({
          hasPendingJobs: false,
          hasActiveJobs: false,
          summary: { waiting: 0, active: 0, delayed: 0, completed: 5, failed: 0 },
        }),
      };

      const mockSupervisor = {
        getState: vi.fn().mockReturnValue('RUNNING'),
        isRunning: vi.fn().mockReturnValue(true),
        start: vi.fn(),
        stop: vi.fn(),
        on: vi.fn(),
      };

      const mockIdle = {
        onJobActivityDetected: vi.fn(),
        onIdleDetected: vi.fn(),
        isIdleCountdownActive: vi.fn().mockReturnValue(true),
        getRemainingSeconds: vi.fn().mockReturnValue(280),
        reset: vi.fn(),
        on: vi.fn(),
      };

      const controller = new CompanionController(
        mockClient as any,
        mockSupervisor as any,
        mockIdle as any,
      );

      (controller as any).tokenData = {
        deviceId: 'dev-1',
        deviceToken: 'mvd_test',
        deviceName: 'TestPC',
      };

      await controller.pollOnce();

      expect(mockIdle.onIdleDetected).toHaveBeenCalledTimes(1);
      expect(mockSupervisor.stop).not.toHaveBeenCalled(); // Still in countdown
    });

    it('does not terminate worker during network failure', async () => {
      const mockClient = {
        getJobStatus: vi.fn().mockRejectedValue(new NetworkError('Connection timeout')),
      };

      const mockSupervisor = {
        getState: vi.fn().mockReturnValue('RUNNING'),
        isRunning: vi.fn().mockReturnValue(true),
        stop: vi.fn(),
        on: vi.fn(),
      };

      const mockIdle = {
        onJobActivityDetected: vi.fn(),
        onIdleDetected: vi.fn(),
        isIdleCountdownActive: vi.fn().mockReturnValue(false),
        reset: vi.fn(),
        on: vi.fn(),
      };

      const controller = new CompanionController(
        mockClient as any,
        mockSupervisor as any,
        mockIdle as any,
      );

      (controller as any).tokenData = {
        deviceId: 'dev-1',
        deviceToken: 'mvd_test',
        deviceName: 'TestPC',
      };

      await controller.pollOnce();

      // Worker must remain running safely through network blips
      expect(mockSupervisor.stop).not.toHaveBeenCalled();
    });

    it('cancels idle countdown and treats delayed jobs as pending work (§LFC-02)', async () => {
      const mockClient = {
        getJobStatus: vi.fn().mockResolvedValue({
          hasPendingJobs: false,
          hasActiveJobs: false,
          summary: { waiting: 0, active: 0, delayed: 3, completed: 5, failed: 0 },
        }),
      };

      const mockSupervisor = {
        getState: vi.fn().mockReturnValue('RUNNING'),
        isRunning: vi.fn().mockReturnValue(true),
        start: vi.fn(),
        stop: vi.fn(),
        on: vi.fn(),
      };

      const mockIdle = {
        onJobActivityDetected: vi.fn(),
        onIdleDetected: vi.fn(),
        isIdleCountdownActive: vi.fn().mockReturnValue(false),
        reset: vi.fn(),
        on: vi.fn(),
      };

      const controller = new CompanionController(
        mockClient as any,
        mockSupervisor as any,
        mockIdle as any,
      );

      (controller as any).tokenData = {
        deviceId: 'dev-1',
        deviceToken: 'mvd_test',
        deviceName: 'TestPC',
      };

      await controller.pollOnce();

      // Because delayed === 3, it must report job activity and NOT trigger idle
      expect(mockIdle.onJobActivityDetected).toHaveBeenCalledWith(
        expect.stringContaining('3 delayed'),
      );
      expect(mockIdle.onIdleDetected).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 7. Single-Instance Protection Lock Suite (§OPS-02)
  // =========================================================================
  describe('Single-Instance Lock (§OPS-02)', () => {
    const testLockPath = path.join(os.tmpdir(), `companion-test-lock-${Date.now()}.lock`);

    afterEach(() => {
      try {
        if (fs.existsSync(testLockPath)) fs.unlinkSync(testLockPath);
      } catch {
        // Ignore
      }
    });

    it('acquires lock cleanly and prevents duplicate companion startup', () => {
      const lock1 = new SingleInstanceLock(testLockPath);
      const lock2 = new SingleInstanceLock(testLockPath);

      expect(lock1.acquire()).toBe(true);
      expect(fs.existsSync(testLockPath)).toBe(true);

      // Second attempt by another instance must be rejected
      expect(lock2.acquire()).toBe(false);

      // Releasing lock1 allows lock2 to acquire
      lock1.release();
      expect(fs.existsSync(testLockPath)).toBe(false);

      expect(lock2.acquire()).toBe(true);
      lock2.release();
    });

    it('detects and reclaims stale lock left by terminated/dead process', () => {
      const deadPid = 99999999;
      fs.writeFileSync(
        testLockPath,
        JSON.stringify({ pid: deadPid, startedAt: new Date().toISOString() }),
      );

      const lock = new SingleInstanceLock(testLockPath);
      expect(lock.isProcessRunning(deadPid)).toBe(false);

      // Acquire reclaims stale lock
      expect(lock.acquire()).toBe(true);
      const content = JSON.parse(fs.readFileSync(testLockPath, 'utf-8'));
      expect(content.pid).toBe(process.pid);

      lock.release();
    });
  });

  // =========================================================================
  // 8. Embedding Dimension Compatibility (§MOD-01)
  // =========================================================================
  describe('Embedding Dimension Compatibility (§MOD-01)', () => {
    it('enforces strict 768-dimension constraint and rejects incompatible provider configurations', async () => {
      const { createEmbeddingProvider } = await import(
        '../apps/worker/src/modules/ingestion/embeddings/index.js'
      );

      // Reject non-768 dimensions
      expect(() => {
        createEmbeddingProvider({ provider: 'mock', dimension: 1536 });
      }).toThrow(/EmbeddingDimensionViolation/);

      expect(() => {
        createEmbeddingProvider({ provider: 'mock', dimension: 384 });
      }).toThrow(/EmbeddingDimensionViolation/);

      // 768 must succeed
      expect(() => {
        createEmbeddingProvider({ provider: 'mock', dimension: 768 });
      }).not.toThrow();
    });
  });
});
