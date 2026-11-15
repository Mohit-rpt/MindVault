import { Redis } from 'ioredis';
import os from 'node:os';
import { Logger } from '../utils/logger.js';
import { parseRedisUrl, sanitizeErrorMessage } from '@mindvault/shared';

export interface WorkerHeartbeatPayload {
  workerId: string;
  status: 'online' | 'stopping' | 'offline';
  startedAt: string;
  lastHeartbeatAt: string;
  lastJobAt: string | null;
  lastJobId: string | null;
  lastDocId: string | null;
  concurrency: number;
  environment: string;
  system: {
    platform: string;
    hostname: string;
    arch: string;
    uptimeSeconds: number;
    memory: {
      rssMb: number;
      heapUsedMb: number;
      totalSystemRamMb: number;
      freeSystemRamMb: number;
    };
  };
}

export const WORKER_HEARTBEAT_REDIS_KEY = 'mindvault:worker:heartbeat';
export const WORKER_HEARTBEAT_TTL_SECONDS = 35; // Expire in 35s if no heartbeat emitted

export class WorkerHeartbeatService {
  private logger = new Logger('WorkerHeartbeatService');
  private redisClient: Redis | null = null;
  private timer: NodeJS.Timeout | null = null;
  private startedAt = new Date().toISOString();
  private lastJobAt: string | null = null;
  private lastJobId: string | null = null;
  private lastDocId: string | null = null;
  private workerId: string;
  private isRunning = false;

  constructor(
    private redisUrl: string,
    private concurrency: number,
    private environment: string,
    workerId?: string,
  ) {
    this.workerId = workerId || `win-worker-${os.hostname().toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
  }

  public async start(intervalMs = 15000): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const redisOptions = parseRedisUrl(this.redisUrl, 'lease');
      this.redisClient = new Redis(redisOptions as any);

      this.redisClient.on('error', (err: any) => {
        this.logger.warn(`Heartbeat Redis connection issue: ${sanitizeErrorMessage(err.message)}`);
      });

      // Emit initial heartbeat immediately
      await this.emitHeartbeat();

      this.timer = setInterval(() => {
        void this.emitHeartbeat();
      }, intervalMs);
      this.timer.unref();

      this.logger.info(`Worker heartbeat started (key: "${WORKER_HEARTBEAT_REDIS_KEY}", interval: ${intervalMs}ms)`);
    } catch (err: any) {
      this.logger.warn(`Could not start heartbeat publisher: ${sanitizeErrorMessage(err.message)}`);
    }
  }

  public recordJobActivity(jobId?: string, docId?: string): void {
    this.lastJobAt = new Date().toISOString();
    if (jobId) this.lastJobId = jobId;
    if (docId) this.lastDocId = docId;
  }

  public async emitHeartbeat(): Promise<void> {
    if (!this.redisClient) return;

    try {
      const mem = process.memoryUsage();
      const payload: WorkerHeartbeatPayload = {
        workerId: this.workerId,
        status: 'online',
        startedAt: this.startedAt,
        lastHeartbeatAt: new Date().toISOString(),
        lastJobAt: this.lastJobAt,
        lastJobId: this.lastJobId,
        lastDocId: this.lastDocId,
        concurrency: this.concurrency,
        environment: this.environment,
        system: {
          platform: os.platform(),
          hostname: os.hostname(),
          arch: os.arch(),
          uptimeSeconds: Math.floor(os.uptime()),
          memory: {
            rssMb: Math.round(mem.rss / 1024 / 1024),
            heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
            totalSystemRamMb: Math.round(os.totalmem() / 1024 / 1024),
            freeSystemRamMb: Math.round(os.freemem() / 1024 / 1024),
          },
        },
      };

      await this.redisClient.set(
        WORKER_HEARTBEAT_REDIS_KEY,
        JSON.stringify(payload),
        'EX',
        WORKER_HEARTBEAT_TTL_SECONDS,
      );
    } catch (err: any) {
      this.logger.debug(`Failed to publish worker heartbeat: ${sanitizeErrorMessage(err.message)}`);
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.redisClient) {
      try {
        // Record stopping state with short TTL (5s) so observers instantly recognize shutdown
        const mem = process.memoryUsage();
        const payload: Partial<WorkerHeartbeatPayload> = {
          workerId: this.workerId,
          status: 'stopping',
          lastHeartbeatAt: new Date().toISOString(),
          lastJobAt: this.lastJobAt,
          concurrency: this.concurrency,
          environment: this.environment,
        };
        await this.redisClient.set(WORKER_HEARTBEAT_REDIS_KEY, JSON.stringify(payload), 'EX', 5);
        await this.redisClient.quit();
      } catch {
        this.redisClient.disconnect();
      }
      this.redisClient = null;
    }
    this.logger.info('Worker heartbeat stopped cleanly');
  }

  public getWorkerId(): string {
    return this.workerId;
  }
}
