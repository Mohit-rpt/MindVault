import os from 'node:os';
import readline from 'node:readline';
import { Logger } from './utils/logger.js';
import { CloudApiClient } from './client/cloud-api.client.js';
import { CompanionController } from './controller/companion-controller.js';
import { SingleInstanceLock } from './utils/single-instance-lock.js';
import {
  saveStoredToken,
  loadStoredToken,
  clearStoredToken,
  getTokenFilePath,
} from './auth/token-store.js';
import { env } from './config/env.js';

const logger = new Logger('CompanionApp');

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // -------------------------------------------------------------------------
  // Disallow token passing via command-line arguments and obsolete --register (§SEC-01)
  // Prevents credential leakage via process tables and PowerShell history.
  // -------------------------------------------------------------------------
  if (args[0] === '--register') {
    console.error('========================================================================');
    console.error('  DEPRECATION & SECURITY NOTICE (§SEC-01)');
    console.error('========================================================================');
    console.error('  The "--register" command has been retired and is no longer supported.');
    console.error('  To securely pair your device without exposing tokens in shell history:');
    console.error('');
    console.error('    pnpm companion:dev --pair');
    console.error('========================================================================');
    process.exit(1);
  }

  if (args[0] === '--pair' && args[1] && !args[1].startsWith('--')) {
    console.error('========================================================================');
    console.error('  SECURITY VIOLATION (§SEC-01)');
    console.error('========================================================================');
    console.error('  Passing authentication tokens or secrets via CLI arguments is disallowed');
    console.error('  to prevent credential leakage in process inspection and shell history.');
    console.error('');
    console.error('  Please use secure interactive pairing:');
    console.error('    pnpm companion:dev --pair');
    console.error('');
    console.error('  Or set the environment variable:');
    console.error('    $env:MINDVAULT_PAIRING_CODE = "MVP-XXXX-XXXX"');
    console.error('    pnpm companion:dev --pair');
    console.error('========================================================================');
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // Subcommand: --pair (Interactive secure pairing flow) (§SEC-01)
  // -------------------------------------------------------------------------
  if (args[0] === '--pair') {
    let pairingCode = (process.env.MINDVAULT_PAIRING_CODE || '').trim();

    if (!pairingCode) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      pairingCode = await new Promise<string>((resolve) => {
        rl.question('Enter one-time pairing code from MindVault (e.g. MVP-XXXX-XXXX): ', (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });
    }

    if (!pairingCode) {
      console.error('Error: A one-time pairing code is required to pair this device.');
      process.exit(1);
    }

    const deviceName =
      env.DEVICE_NAME || `win-${os.hostname().toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;

    try {
      console.log(`Connecting to MindVault Cloud API at ${env.CLOUD_API_URL}...`);
      const client = new CloudApiClient(env.CLOUD_API_URL);
      const registration = await client.claimPairingCode(pairingCode, deviceName, 'win32');

      saveStoredToken({
        deviceId: registration.deviceId,
        deviceToken: registration.deviceToken,
        deviceName: registration.deviceName,
        registeredAt: registration.createdAt,
        apiUrl: env.CLOUD_API_URL,
        workspaceId: registration.workspaceId,
      });

      console.log('========================================================================');
      console.log('  MindVault Companion Device Pairing SUCCESSFUL');
      console.log('========================================================================');
      console.log(`  Device ID:    ${registration.deviceId}`);
      console.log(`  Device Name:  ${registration.deviceName}`);
      console.log(`  Workspace ID: ${registration.workspaceId || 'N/A'}`);
      console.log(`  Platform:     ${registration.platform}`);
      console.log(`  Token File:   ${getTokenFilePath()}`);
      console.log('========================================================================');
      console.log('You can now launch the companion service:');
      console.log('  pnpm companion:dev');
      console.log('========================================================================');
      process.exit(0);
    } catch (err: any) {
      console.error(`Pairing failed: ${err.message}`);
      process.exit(1);
    }
  }

  // -------------------------------------------------------------------------
  // Subcommand: --status
  // -------------------------------------------------------------------------
  if (args[0] === '--status') {
    const token = loadStoredToken();
    console.log('========================================================================');
    console.log('  MindVault Companion Status');
    console.log('========================================================================');
    if (!token) {
      console.log('  Status:       UNPAIRED (No device token found)');
      console.log(`  Token Path:   ${getTokenFilePath()}`);
      console.log('  Action:       Run --pair to pair this Windows PC with a workspace');
    } else {
      console.log(`  Device ID:    ${token.deviceId}`);
      console.log(`  Device Name:  ${token.deviceName}`);
      console.log(`  Workspace ID: ${token.workspaceId || 'All authorized workspaces'}`);
      console.log(`  Registered:   ${token.registeredAt}`);
      console.log(`  Cloud API:    ${token.apiUrl}`);

      try {
        const client = new CloudApiClient(token.apiUrl);
        const deviceStatus = await client.getDeviceStatus(token.deviceToken);
        console.log(`  Cloud Status: ${deviceStatus.isRevoked ? 'REVOKED' : 'ACTIVE'}`);
        console.log(`  Last Seen At: ${deviceStatus.lastSeenAt || 'Never'}`);

        const jobStatus = await client.getJobStatus(token.deviceToken);
        console.log(`  Queued Jobs:  ${jobStatus.summary.waiting} waiting, ${jobStatus.summary.active} active`);
      } catch (err: any) {
        console.log(`  Cloud Status: UNREACHABLE (${err.message})`);
      }
    }
    console.log('========================================================================');
    process.exit(0);
  }

  // -------------------------------------------------------------------------
  // Subcommand: --clear-token
  // -------------------------------------------------------------------------
  if (args[0] === '--clear-token') {
    clearStoredToken();
    console.log('Stored device token cleared.');
    process.exit(0);
  }

  // -------------------------------------------------------------------------
  // Default: Run Companion Daemon
  // -------------------------------------------------------------------------

  // Single-instance protection lock (§OPS-02)
  const singleInstanceLock = new SingleInstanceLock();
  if (!singleInstanceLock.acquire()) {
    logger.warn('Another companion instance is already running. Exiting cleanly.');
    process.exit(0);
  }

  const companion = new CompanionController();

  let isShuttingDown = false;
  const handleShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info(`Received ${signal}. Shutting down companion cleanly...`);
    try {
      await companion.stop();
      singleInstanceLock.release();
      logger.info('Shutdown complete.');
      process.exit(0);
    } catch (err: any) {
      logger.error(`Error during shutdown: ${err.message}`);
      singleInstanceLock.release();
      process.exit(1);
    }
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGBREAK', () => handleShutdown('SIGBREAK'));

  // Windows readline handler for instant Ctrl+C trap
  if (process.platform === 'win32' && process.stdin.isTTY) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.on('SIGINT', () => handleShutdown('SIGINT (readline)'));
  }

  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception in Companion: ${err.message}`, err.stack);
    void handleShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.warn(`Unhandled rejection in Companion: ${reason}`);
  });

  await companion.start();
}

main().catch((err) => {
  console.error('Fatal companion initialization error:', err);
  process.exit(1);
});
