import { WorkerService } from './worker.js';

const worker = new WorkerService();

await worker.start();

let shuttingDown = false;

async function handleSignal(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n🛑 Worker received ${signal}. Commencing graceful shutdown...`);
  try {
    await worker.stop();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during worker shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => void handleSignal('SIGTERM'));
process.on('SIGINT', () => void handleSignal('SIGINT'));
