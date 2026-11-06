import { createApp } from './app.js';
import { env } from './config/env.js';

import { ConversationRepository } from './modules/conversations/repositories/conversation.repository.js';

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

function shutdown(signal: string): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

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

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
