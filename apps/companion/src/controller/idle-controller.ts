import { EventEmitter } from 'node:events';
import { Logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export interface IdleControllerOptions {
  idleTimeoutMs?: number;
}

export class IdleController extends EventEmitter {
  private logger = new Logger('IdleController');
  private idleTimeoutMs: number;
  private timer: NodeJS.Timeout | null = null;
  private idleStartedAt: number | null = null;

  constructor(options?: IdleControllerOptions) {
    super();
    this.idleTimeoutMs = options?.idleTimeoutMs || env.WORKER_IDLE_TIMEOUT_MS || 300000;
  }

  public isIdleCountdownActive(): boolean {
    return this.timer !== null;
  }

  public getRemainingSeconds(): number | null {
    if (!this.idleStartedAt || !this.timer) return null;
    const elapsedMs = Date.now() - this.idleStartedAt;
    const remainingMs = Math.max(0, this.idleTimeoutMs - elapsedMs);
    return Math.round(remainingMs / 1000);
  }

  /**
   * Invoked when queues have no pending and no active jobs.
   * Starts the 5-minute countdown if not already running.
   */
  public onIdleDetected(): void {
    if (this.timer) {
      // Countdown already running
      const remaining = this.getRemainingSeconds();
      if (remaining && remaining % 60 === 0) {
        this.logger.info(`Worker has been idle. Shutdown in ${remaining}s if no work arrives.`);
      }
      return;
    }

    this.idleStartedAt = Date.now();
    const minutes = Math.round(this.idleTimeoutMs / 60000);
    this.logger.info(
      `No pending or active jobs detected. Initiating ${minutes}-minute idle shutdown countdown...`,
    );
    this.emit('idle_started', { timeoutMs: this.idleTimeoutMs });

    this.timer = setTimeout(() => {
      this.timer = null;
      this.idleStartedAt = null;
      this.logger.info(`Idle timeout of ${this.idleTimeoutMs}ms elapsed with zero job activity.`);
      this.emit('idle_expired');
    }, this.idleTimeoutMs);
    this.timer.unref();
  }

  /**
   * Invoked immediately when pending or active jobs are discovered.
   * Cancels any running shutdown countdown.
   */
  public onJobActivityDetected(reason = 'Work detected'): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.idleStartedAt = null;
      this.logger.info(`Idle countdown cancelled: ${reason}. Keeping worker active.`);
      this.emit('idle_cancelled', { reason });
    }
  }

  /**
   * Cancels timer cleanly upon companion shutdown or manual override.
   */
  public reset(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.idleStartedAt = null;
    }
  }
}
