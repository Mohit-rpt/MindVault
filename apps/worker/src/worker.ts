import { Logger } from './utils/logger.js';
import { env } from './config/env.js';

export class WorkerService {
  private logger = new Logger('WorkerService');
  private isRunning = false;
  private heartbeatInterval?: NodeJS.Timeout;

  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Worker is already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('🚀 MindVault background worker initialized', {
      concurrency: env.WORKER_CONCURRENCY,
      redisUrl: env.REDIS_URL,
      environment: env.NODE_ENV,
    });
    this.logger.info('Ready for queue processing (BullMQ queues ready for Phase 2 registration)');

    // Start a lightweight heartbeat in dev/test to monitor worker liveness
    this.heartbeatInterval = setInterval(() => {
      if (this.isRunning) {
        this.logger.debug('Worker heartbeat: active and listening for jobs');
      }
    }, 60000);
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('🛑 Stopping worker service, releasing resources...');
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.isRunning = false;
    this.logger.info('✅ Worker service gracefully stopped');
  }

  public getActiveStatus(): boolean {
    return this.isRunning;
  }
}
