import fs from 'node:fs';
import path from 'node:path';
import { getStorageDirectory } from '../auth/token-store.js';
import { Logger } from './logger.js';

const logger = new Logger('SingleInstanceLock');

export interface LockData {
  pid: number;
  startedAt: string;
}

export class SingleInstanceLock {
  private lockFilePath: string;
  private hasAcquired = false;
  private cleanupRegistered = false;

  constructor(customPath?: string) {
    this.lockFilePath = customPath || path.join(getStorageDirectory(), 'companion.lock');
  }

  public getLockPath(): string {
    return this.lockFilePath;
  }

  /**
   * Attempts to acquire exclusive single-instance lock.
   * Recovers safely from stale locks if the previous process crashed or terminated.
   */
  public acquire(): boolean {
    const dir = path.dirname(this.lockFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 1. Check existing lockfile
    if (fs.existsSync(this.lockFilePath)) {
      try {
        const content = fs.readFileSync(this.lockFilePath, 'utf-8');
        const lockData: LockData = JSON.parse(content);

        if (this.isProcessRunning(lockData.pid)) {
          logger.warn(
            `Another MindVault Companion instance is already running (PID: ${lockData.pid}, Started: ${lockData.startedAt}). Startup aborted.`,
          );
          return false;
        }

        // Stale lock detected (process is dead)
        logger.info(
          `Detected stale companion lock from previous dead process (PID: ${lockData.pid}). Safely reclaiming lock...`,
        );
        try {
          fs.unlinkSync(this.lockFilePath);
        } catch {
          // Non-blocking unlink
        }
      } catch (err: any) {
        logger.warn(`Corrupt lockfile encountered (${err.message}); overwriting safely.`);
        try {
          fs.unlinkSync(this.lockFilePath);
        } catch {
          // Ignore
        }
      }
    }

    // 2. Write new lock atomically
    try {
      const payload: LockData = {
        pid: process.pid,
        startedAt: new Date().toISOString(),
      };
      fs.writeFileSync(this.lockFilePath, JSON.stringify(payload, null, 2), {
        flag: 'wx', // Fails if file exists (atomic creation)
      });
      this.hasAcquired = true;

      // Register process exit cleanups
      if (!this.cleanupRegistered) {
        this.cleanupRegistered = true;
        const cleanup = () => this.release();
        process.on('exit', cleanup);
      }

      logger.info(`Acquired exclusive companion instance lock (PID: ${process.pid})`);
      return true;
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        // Race condition: another process acquired it concurrently
        logger.warn('Lock contention: Another companion process just acquired the lockfile.');
        return false;
      }
      logger.error(`Failed to write companion lockfile: ${err.message}`);
      return false;
    }
  }

  /**
   * Releases lockfile if held by current process.
   */
  public release(): void {
    if (!this.hasAcquired) return;
    try {
      if (fs.existsSync(this.lockFilePath)) {
        const content = fs.readFileSync(this.lockFilePath, 'utf-8');
        const data: LockData = JSON.parse(content);
        if (data.pid === process.pid) {
          fs.unlinkSync(this.lockFilePath);
          this.hasAcquired = false;
          logger.info(`Released companion lockfile (PID: ${process.pid})`);
        }
      }
    } catch (err: any) {
      logger.warn(`Could not cleanly release lockfile: ${err.message}`);
    }
  }

  /**
   * Checks whether a given PID is currently active.
   */
  public isProcessRunning(pid: number): boolean {
    if (!pid || typeof pid !== 'number' || pid <= 0) return false;
    if (pid === process.pid) return true;

    try {
      // Signal 0 tests for process existence without killing it
      process.kill(pid, 0);
      return true;
    } catch (err: any) {
      // EPERM means process exists but we lack permission to signal it
      return err.code === 'EPERM';
    }
  }
}
