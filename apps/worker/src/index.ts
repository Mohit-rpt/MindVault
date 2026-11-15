import { WorkerService } from './worker.js';
import { Logger } from './utils/logger.js';

const logger = new Logger('WorkerRoot');
const worker = new WorkerService();

await worker.start();

// Explicit readiness signal for Supervisor (§LFC-01)
console.log('[MINDVAULT_WORKER_READY] Worker runtime initialized and ready');
if (typeof process.send === 'function') {
  process.send({ type: 'WORKER_READY' });
}

let shuttingDown = false;

async function handleSignal(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`🛑 Worker received ${signal}. Commencing graceful shutdown...`);

  // Unreferenced 60-second hard safety deadline to allow deep inference batches to finish
  const safetyTimer = setTimeout(() => {
    logger.error('Graceful shutdown deadline exceeded (60s); forcing process termination');
    process.exit(1);
  }, 60000);
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

import readline from 'node:readline';

if (process.platform === 'win32') {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.on('SIGINT', () => {
    process.emit('SIGINT');
  });
}

process.on('SIGTERM', () => void handleSignal('SIGTERM'));
process.on('SIGINT', () => void handleSignal('SIGINT'));
process.on('SIGBREAK', () => void handleSignal('SIGBREAK'));

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception in Worker process:', err);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection in Worker process:', reason);
});
