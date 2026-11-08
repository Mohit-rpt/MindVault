import { WorkerService } from './worker.js';
import { Logger } from './utils/logger.js';

const logger = new Logger('WorkerRoot');
const worker = new WorkerService();

await worker.start();

let shuttingDown = false;

async function handleSignal(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`🛑 Worker received ${signal}. Commencing graceful shutdown...`);

  // Unreferenced 15-second hard asynchronous-I/O safety deadline
  const safetyTimer = setTimeout(() => {
    logger.error('Graceful shutdown deadline exceeded (15s); forcing process termination');
    process.exit(1);
  }, 15000);
  safetyTimer.unref();

  try {
    await worker.stop();
    clearTimeout(safetyTimer);
    logger.info('Graceful shutdown completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error during worker shutdown:', error);
    clearTimeout(safetyTimer);
    process.exit(1);
  }
}

process.on('SIGTERM', () => void handleSignal('SIGTERM'));
process.on('SIGINT', () => void handleSignal('SIGINT'));
