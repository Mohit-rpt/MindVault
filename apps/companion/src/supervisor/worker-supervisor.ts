import { spawn, type ChildProcess, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { Logger } from '../utils/logger.js';
import { WorkerStateMachine, type WorkerState } from './worker-state-machine.js';
import { env } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../../');

export interface WorkerSupervisorOptions {
  startupTimeoutMs?: number;
  shutdownGraceMs?: number;
  maxCrashRestarts?: number;
  workspaceId?: string;
}

export class WorkerSupervisor extends EventEmitter {
  private logger = new Logger('WorkerSupervisor');
  private stateMachine = new WorkerStateMachine('STOPPED');
  private childProcess: ChildProcess | null = null;
  private crashTimestamps: number[] = [];
  private startupTimer: NodeJS.Timeout | null = null;
  private isIntentionallyStopping = false;
  private workspaceId?: string;

  private startupTimeoutMs: number;
  private shutdownGraceMs: number;
  private maxCrashRestarts: number;

  constructor(options?: WorkerSupervisorOptions) {
    super();
    this.startupTimeoutMs = options?.startupTimeoutMs || env.WORKER_STARTUP_TIMEOUT_MS || 30000;
    this.shutdownGraceMs = options?.shutdownGraceMs || env.WORKER_SHUTDOWN_TIMEOUT_MS || 60000;
    this.maxCrashRestarts = options?.maxCrashRestarts || env.WORKER_MAX_CRASH_RESTARTS || 3;
    this.workspaceId = options?.workspaceId;
  }

  public setWorkspaceId(workspaceId?: string): void {
    this.workspaceId = workspaceId;
  }

  public getWorkspaceId(): string | undefined {
    return this.workspaceId;
  }

  public getState(): WorkerState {
    return this.stateMachine.getState();
  }

  public getPid(): number | undefined {
    return this.childProcess?.pid;
  }

  public isRunning(): boolean {
    return this.stateMachine.getState() === 'RUNNING';
  }

  /**
   * Spawns the background worker child process.
   */
  public async start(options?: { workspaceId?: string }): Promise<boolean> {
    const currentState = this.stateMachine.getState();
    if (currentState === 'RUNNING' || currentState === 'STARTING') {
      this.logger.warn(`Worker is already ${currentState}`);
      return true;
    }

    if (currentState === 'STOPPING') {
      this.logger.warn('Worker is currently stopping. Delaying start until shutdown completes.');
      return false;
    }

    this.stateMachine.transition('STARTING', 'Initiating background worker child process');
    this.isIntentionallyStopping = false;

    const targetWorkspaceId = options?.workspaceId || this.workspaceId || process.env.AUTHORIZED_WORKSPACE_ID;
    if (targetWorkspaceId) {
      this.workspaceId = targetWorkspaceId;
    }

    try {
      // 1. Resolve executable and arguments
      const distEntry = path.join(repoRoot, 'apps/worker/dist/index.js');
      const srcEntry = path.join(repoRoot, 'apps/worker/src/index.ts');

      let command: string;
      let args: string[];

      if (fs.existsSync(distEntry)) {
        command = process.execPath; // node.exe
        args = [distEntry];
        this.logger.info(`Starting worker using compiled distribution bundle (${distEntry}) [workspace: ${targetWorkspaceId || 'global'}]`);
      } else {
        // Fallback to tsx for development execution
        command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
        args = process.platform === 'win32' ? ['/c', 'pnpm', 'worker:dev'] : ['worker:dev'];
        this.logger.info(`Distribution bundle not found; running worker via tsx watch [workspace: ${targetWorkspaceId || 'global'}]`);
      }

      // 2. Child environment inheritance
      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        WORKER_CONCURRENCY: String(env.WORKER_CONCURRENCY || 1),
        NODE_ENV: process.env.NODE_ENV || 'production',
        WORKER_TYPE: 'local',
        ...(targetWorkspaceId ? { AUTHORIZED_WORKSPACE_ID: targetWorkspaceId } : {}),
      };

      // 3. Spawn child process
      this.childProcess = spawn(command, args, {
        cwd: repoRoot,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      const pid = this.childProcess.pid;
      this.logger.info(`Worker child process spawned with PID ${pid}`);

      // Pipe stdout/stderr
      this.childProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) this.logger.debug(`[Worker:stdout] ${text}`);
      });

      this.childProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) this.logger.debug(`[Worker:stderr] ${text}`);
      });

      // Handle process exit
      this.childProcess.on('exit', (code, signal) => {
        this.handleProcessExit(code, signal);
      });

      this.childProcess.on('error', (err) => {
        this.logger.error(`Worker process error: ${err.message}`);
        this.stateMachine.transition('FAILED', `Process error: ${err.message}`);
        this.emit('error', err);
      });

      // Verify startup readiness based on explicit worker readiness signal (§LFC-01)
      const started = await new Promise<boolean>((resolve) => {
        let isSettled = false;

        const settle = (success: boolean) => {
          if (!isSettled) {
            isSettled = true;
            if (this.startupTimer) clearTimeout(this.startupTimer);
            if (checkInterval) clearInterval(checkInterval);
            resolve(success);
          }
        };

        const onStdoutData = (data: Buffer) => {
          const str = data.toString();
          if (str.includes('[MINDVAULT_WORKER_READY]')) {
            this.logger.info('Worker readiness signal confirmed via stdout');
            settle(true);
          }
        };

        const onMessage = (msg: any) => {
          if (msg?.type === 'WORKER_READY') {
            this.logger.info('Worker readiness signal confirmed via IPC');
            settle(true);
          }
        };

        this.childProcess?.stdout?.on('data', onStdoutData);
        this.childProcess?.on('message', onMessage);

        const checkInterval = setInterval(() => {
          if (!this.childProcess || this.childProcess.killed || this.childProcess.exitCode !== null) {
            settle(false);
          }
        }, 200);

        // Fail startup if no readiness signal within startupTimeoutMs
        this.startupTimer = setTimeout(() => {
          this.logger.warn(`Startup timeout (${this.startupTimeoutMs}ms) reached without readiness signal`);
          settle(false);
        }, this.startupTimeoutMs);
      });

      if (started) {
        this.stateMachine.transition('RUNNING', `Worker PID ${pid} confirmed active`);
        this.emit('started', { pid });
        return true;
      } else {
        this.stateMachine.transition('FAILED', 'Worker process exited during startup window');
        return false;
      }
    } catch (err: any) {
      this.logger.error(`Failed to launch worker child process: ${err.message}`);
      this.stateMachine.transition('FAILED', `Launch exception: ${err.message}`);
      return false;
    }
  }

  /**
   * Gracefully terminates the background worker process.
   */
  public async stop(reason = 'Graceful shutdown requested'): Promise<boolean> {
    const currentState = this.stateMachine.getState();
    if (currentState === 'STOPPED') {
      return true;
    }

    this.isIntentionallyStopping = true;
    this.stateMachine.transition('STOPPING', reason);

    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }

    if (!this.childProcess || this.childProcess.exitCode !== null) {
      this.stateMachine.transition('STOPPED', 'Child process already exited');
      this.childProcess = null;
      return true;
    }

    const pid = this.childProcess.pid;
    this.logger.info(`Initiating graceful shutdown for worker PID ${pid}...`);

    return new Promise<boolean>((resolve) => {
      let resolved = false;

      // 1. Send SIGINT (Windows-compatible readline listener triggers graceful stop)
      try {
        this.childProcess?.kill('SIGINT');
      } catch (err: any) {
        this.logger.warn(`Failed to send SIGINT: ${err.message}`);
      }

      // 2. Set force-kill timeout if graceful shutdown exceeds grace window
      const forceKillTimer = setTimeout(() => {
        if (!resolved && this.childProcess && this.childProcess.exitCode === null) {
          this.logger.warn(`Worker PID ${pid} did not exit in ${this.shutdownGraceMs}ms; force-terminating...`);
          try {
            if (process.platform === 'win32' && pid) {
              execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
            } else {
              this.childProcess.kill('SIGKILL');
            }
          } catch {
            // Process may have exited in the interim
          }
          resolved = true;
          this.stateMachine.transition('STOPPED', 'Force terminated after grace timeout');
          this.childProcess = null;
          resolve(true);
        }
      }, this.shutdownGraceMs);

      // Listen for exit
      this.once('stopped', () => {
        clearTimeout(forceKillTimer);
        if (!resolved) {
          resolved = true;
          resolve(true);
        }
      });
    });
  }

  private handleProcessExit(code: number | null, signal: NodeJS.Signals | null): void {
    const wasIntentionallyStopping = this.isIntentionallyStopping;
    const pid = this.childProcess?.pid;
    this.childProcess = null;

    if (wasIntentionallyStopping) {
      this.logger.info(`Worker PID ${pid} stopped cleanly (code: ${code}, signal: ${signal})`);
      this.stateMachine.transition('STOPPED', 'Intentional shutdown completed');
      this.emit('stopped', { code, signal });
      return;
    }

    // Unexpected exit
    this.logger.warn(`Worker PID ${pid} exited unexpectedly! (code: ${code}, signal: ${signal})`);
    const now = Date.now();
    this.crashTimestamps.push(now);

    // Keep only crashes in the last 5 minutes
    this.crashTimestamps = this.crashTimestamps.filter((ts) => now - ts < 300000);

    if (this.crashTimestamps.length > this.maxCrashRestarts) {
      this.logger.error(
        `Worker exceeded max crash restart threshold (${this.maxCrashRestarts} in 5m). Halting restarts.`,
      );
      this.stateMachine.transition('FAILED', 'Excessive crash restart threshold exceeded');
      this.emit('crash_limit_reached', { code, signal });
    } else {
      this.stateMachine.transition(
        'STOPPED',
        `Unexpected exit (Crash ${this.crashTimestamps.length}/${this.maxCrashRestarts})`,
      );
      this.emit('crashed', { code, signal, attempt: this.crashTimestamps.length });
    }
  }
}
