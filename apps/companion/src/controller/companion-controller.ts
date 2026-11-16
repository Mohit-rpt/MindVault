import os from 'node:os';
import { Logger } from '../utils/logger.js';
import {
  CloudApiClient,
  AuthError,
  NetworkError,
  type JobAvailabilityResponse,
} from '../client/cloud-api.client.js';
import { WorkerSupervisor } from '../supervisor/worker-supervisor.js';
import { IdleController } from './idle-controller.js';
import { loadStoredToken, clearStoredToken, type StoredDeviceToken } from '../auth/token-store.js';
import { env } from '../config/env.js';

export class CompanionController {
  private logger = new Logger('CompanionController');
  private client: CloudApiClient;
  private supervisor: WorkerSupervisor;
  private idleController: IdleController;
  private pollTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isPolling = false;
  private isRunning = false;
  private restartPending = false;
  private backoffDelayMs = 0;
  private tokenData: StoredDeviceToken | null = null;
  private startedAt = Date.now();

  constructor(
    client?: CloudApiClient,
    supervisor?: WorkerSupervisor,
    idleController?: IdleController,
  ) {
    this.client = client || new CloudApiClient(env.CLOUD_API_URL);
    this.supervisor = supervisor || new WorkerSupervisor();
    this.idleController = idleController || new IdleController();

    // Listen to idle controller events
    this.idleController.on('idle_expired', () => {
      void this.handleIdleExpired();
    });

    // Listen to supervisor exit
    this.supervisor.on('stopped', () => {
      if (this.restartPending) {
        this.restartPending = false;
        this.logger.info(
          'Restart flag active; immediately re-launching worker for newly arrived jobs...',
        );
        void this.supervisor.start({ workspaceId: this.tokenData?.workspaceId });
      }
    });

    this.supervisor.on('crashed', ({ attempt }) => {
      this.logger.warn(`Worker crashed (attempt ${attempt}). Restarting in 5s...`);
      setTimeout(() => {
        if (this.isRunning && this.supervisor.getState() === 'STOPPED') {
          void this.supervisor.start({ workspaceId: this.tokenData?.workspaceId });
        }
      }, 5000);
    });
  }

  public getSupervisor(): WorkerSupervisor {
    return this.supervisor;
  }

  public getIdleController(): IdleController {
    return this.idleController;
  }

  /**
   * Initializes token and launches outbound coordination loop.
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startedAt = Date.now();

    this.logger.info('========================================================================');
    this.logger.info('  MindVault — Smart Local Windows Companion Starting');
    this.logger.info(`  Cloud API URL:    ${env.CLOUD_API_URL}`);
    this.logger.info(`  Polling Interval: ${env.COMPANION_POLL_INTERVAL_MS}ms`);
    this.logger.info(
      `  Idle Timeout:     ${env.WORKER_IDLE_TIMEOUT_MS}ms (${Math.round(env.WORKER_IDLE_TIMEOUT_MS / 60000)} mins)`,
    );
    this.logger.info(`  Concurrency:      ${env.WORKER_CONCURRENCY}`);
    this.logger.info('========================================================================');

    // 1. Resolve Device Token
    this.tokenData = loadStoredToken();
    if (!this.tokenData && env.DEVICE_TOKEN) {
      this.tokenData = {
        deviceId: 'env-configured-device',
        deviceToken: env.DEVICE_TOKEN,
        deviceName: env.DEVICE_NAME || os.hostname(),
        registeredAt: new Date().toISOString(),
        apiUrl: env.CLOUD_API_URL,
      };
    }

    if (!this.tokenData) {
      this.logger.warn('No registered device token found!');
      this.logger.warn('To pair this Windows computer with your MindVault Cloud account, run:');
      this.logger.warn('  pnpm companion:dev --pair');
      this.logger.warn('Or run the PowerShell installer:');
      this.logger.warn('  .\\scripts\\install-mindvault-companion.ps1');
      return;
    }

    if (this.tokenData.workspaceId) {
      this.supervisor.setWorkspaceId(this.tokenData.workspaceId);
    }

    // 2. Validate Device Registration with Cloud API
    try {
      this.logger.info(`Verifying device pairing for "${this.tokenData.deviceName}"...`);
      const status = await this.client.getDeviceStatus(this.tokenData.deviceToken);
      if (status.isRevoked) {
        this.logger.error('Device registration has been revoked on the cloud server.');
        clearStoredToken();
        this.tokenData = null;
        return;
      }
      this.logger.info(`Device paired successfully (ID: ${status.deviceId})`);
    } catch (err: any) {
      if (err instanceof AuthError) {
        this.logger.error(`Device authentication failed: ${err.message}. Clearing local token.`);
        clearStoredToken();
        this.tokenData = null;
        return;
      }
      this.logger.warn(
        `Could not reach cloud API on startup (${err.message}); will retry in polling loop.`,
      );
    }

    // 3. Start Polling Loop
    this.scheduleNextPoll(0);

    // 4. Start Heartbeat Timer (every 15s)
    this.heartbeatTimer = setInterval(() => {
      void this.dispatchHeartbeat();
    }, 15000);
    this.heartbeatTimer.unref();
  }

  /**
   * Executes a single polling cycle to query pending work.
   */
  public async pollOnce(): Promise<JobAvailabilityResponse | null> {
    if (!this.tokenData || this.isPolling) return null;
    this.isPolling = true;

    try {
      const jobStatus = await this.client.getJobStatus(this.tokenData.deviceToken);
      this.backoffDelayMs = 0; // Reset backoff on successful contact

      const workerState = this.supervisor.getState();
      const { hasPendingJobs, hasActiveJobs, summary } = jobStatus;
      const effectivePending = hasPendingJobs || summary.delayed > 0;

      this.logger.debug(
        `Job status: ${summary.waiting} waiting, ${summary.active} active, ${summary.delayed} delayed | Worker: ${workerState}`,
      );

      if (effectivePending) {
        // Pending work exists: cancel any idle shutdown and ensure worker is running (§LFC-02)
        this.idleController.onJobActivityDetected(
          `Pending work detected (${summary.waiting} waiting, ${summary.delayed} delayed in queues)`,
        );

        if (workerState === 'STOPPED') {
          this.logger.info(
            `Pending jobs detected (${summary.waiting} waiting, ${summary.delayed} delayed). Starting background worker for workspace ${this.tokenData.workspaceId || 'global'}...`,
          );
          await this.supervisor.start({ workspaceId: this.tokenData.workspaceId });
        } else if (workerState === 'STOPPING' || workerState === 'DRAINING') {
          this.restartPending = true;
          this.logger.info(
            'Jobs arrived while worker is stopping/draining; flagged for immediate restart.',
          );
        }
      } else if (hasActiveJobs) {
        // Worker is actively processing jobs
        this.idleController.onJobActivityDetected(
          `Worker actively processing ${summary.active} job(s)`,
        );
      } else {
        // No pending and no active jobs
        if (workerState === 'RUNNING') {
          this.idleController.onIdleDetected();
        } else if (workerState === 'STOPPED') {
          // Worker is off and queues are empty: perfect steady state
          this.idleController.reset();
        }
      }

      return jobStatus;
    } catch (err: any) {
      if (err instanceof AuthError) {
        this.logger.error(`Device token rejected by cloud API: ${err.message}. Halting companion.`);
        clearStoredToken();
        this.tokenData = null;
        this.stop();
        return null;
      }

      // Network or transient server error: apply backoff
      this.backoffDelayMs =
        this.backoffDelayMs === 0 ? 2000 : Math.min(this.backoffDelayMs * 2, 30000);
      const jitter = Math.round(Math.random() * 1000);
      this.logger.warn(
        `Cloud API poll failed (${err.message}). Retrying in ${Math.round((this.backoffDelayMs + jitter) / 1000)}s...`,
      );
    } finally {
      this.isPolling = false;
    }

    return null;
  }

  private scheduleNextPoll(delayMs?: number): void {
    if (!this.isRunning) return;

    const baseDelay = delayMs !== undefined ? delayMs : env.COMPANION_POLL_INTERVAL_MS;
    const finalDelay = this.backoffDelayMs > 0 ? this.backoffDelayMs : baseDelay;

    this.pollTimer = setTimeout(async () => {
      await this.pollOnce();
      this.scheduleNextPoll();
    }, finalDelay);
    this.pollTimer.unref();
  }

  /**
   * Double-checks queue status before executing idle shutdown.
   */
  private async handleIdleExpired(): Promise<void> {
    if (!this.tokenData || this.supervisor.getState() !== 'RUNNING') {
      return;
    }

    this.logger.info('Idle countdown expired. Performing pre-shutdown double-check...');
    try {
      const status = await this.client.getJobStatus(this.tokenData.deviceToken);
      if (status.hasPendingJobs || status.hasActiveJobs || status.summary?.delayed > 0) {
        this.logger.info('Work arrived during final idle verification! Cancelling shutdown.');
        this.idleController.onJobActivityDetected('Jobs arrived during final check');
        return;
      }
    } catch (err: any) {
      this.logger.warn(
        `Could not verify final queue status (${err.message}); deferring shutdown safely.`,
      );
      return;
    }

    this.logger.info(
      'Double-check confirmed zero queue activity. Shutting down worker gracefully.',
    );
    await this.supervisor.stop('Five-minute idle timeout reached with zero active jobs');
  }

  /**
   * Sends periodic telemetry to the cloud API.
   */
  private async dispatchHeartbeat(): Promise<void> {
    if (!this.tokenData) return;

    try {
      const mem = process.memoryUsage();
      const workerState = this.supervisor.getState();
      const isIdle = this.idleController.isIdleCountdownActive();

      await this.client.sendHeartbeat(this.tokenData.deviceToken, {
        companionStatus: workerState === 'RUNNING' ? 'running_worker' : isIdle ? 'idle' : 'idle',
        workerState,
        uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
        idleCountdownSeconds: this.idleController.getRemainingSeconds(),
        system: {
          platform: os.platform(),
          hostname: os.hostname(),
          arch: os.arch(),
          memory: {
            rssMb: Math.round(mem.rss / 1024 / 1024),
            heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
          },
        },
      });
    } catch {
      // Non-blocking telemetry dispatch failure
    }
  }

  /**
   * Graceful companion termination.
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    this.logger.info('Stopping MindVault Companion...');
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.idleController.reset();

    if (this.supervisor.isRunning()) {
      await this.supervisor.stop('Companion process shutting down');
    }

    this.logger.info('MindVault Companion stopped cleanly.');
  }
}
