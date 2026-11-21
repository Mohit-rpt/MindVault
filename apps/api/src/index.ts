import { createApp } from './app.js';
import { env } from './config/env.js';
import { ConversationRepository } from './modules/conversations/repositories/conversation.repository.js';
import { documentQueue } from './modules/document/document.queue.js';
import { graphExtractionQueue } from './modules/graph/queue/graph-extraction.queue.js';
import { closeApiRedisClient } from './lib/redis.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`🚀 MindVault API server running on http://localhost:${env.PORT}`);
  console.log(`📊 Health endpoint: http://localhost:${env.PORT}/api/health`);
  console.log(`⚙️ Environment: ${env.NODE_ENV}`);

  // Reconcile any orphaned messages left in STREAMING or PENDING status from an earlier process crash
  ConversationRepository.reconcileOrphanedMessages()
    .then((count) => {
      if (count > 0) {
        console.log(`🧹 Reconciled ${count} orphaned chat message(s) from previous server run.`);
      }
    })
    .catch((err) => {
      console.warn('⚠️ Failed to reconcile orphaned messages on startup:', err);
    });
});

// Graceful shutdown handling
let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

  // Close BullMQ producer queues
  try {
    await Promise.allSettled([documentQueue.close(), graphExtractionQueue.close()]);
    console.log('✅ BullMQ producer queues closed.');
  } catch (err) {
    console.warn('⚠️ Error closing BullMQ queues during shutdown:', err);
  }

  // Close dedicated API Redis client
  try {
    await closeApiRedisClient();
    console.log('✅ API Redis client closed.');
  } catch (err) {
    console.warn('⚠️ Error closing API Redis client during shutdown:', err);
  }

  server.close((err) => {
    if (err) {
      console.error('❌ Error during server close:', err);
      process.exit(1);
    }
    console.log('✅ HTTP server closed. Shutdown complete.');
    process.exit(0);
  });

  // Force exit if connections take too long to close
  setTimeout(() => {
    console.warn('⚠️ Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
