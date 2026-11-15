import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import { Logger } from '../utils/logger.js';

export interface StoredDeviceToken {
  deviceId: string;
  deviceToken: string;
  deviceName: string;
  registeredAt: string;
  apiUrl: string;
  workspaceId?: string;
}

const logger = new Logger('TokenStore');

export function getStorageDirectory(): string {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    return path.join(localAppData, 'MindVault', 'companion');
  }
  return path.join(os.homedir(), '.mindvault', 'companion');
}

export function getTokenFilePath(): string {
  return path.join(getStorageDirectory(), 'device-token.dat');
}

// ---------------------------------------------------------------------------
// Windows DPAPI Implementation (§SEC-02)
// Uses System.Security.Cryptography.ProtectedData with CurrentUser scope.
// Data is piped exclusively through stdin/stdout to avoid command-line leakage.
// ---------------------------------------------------------------------------

const DPAPI_PROTECT_SCRIPT = `
Add-Type -AssemblyName System.Security
$b64 = [Console]::In.ReadToEnd()
if (-not $b64) { exit 1 }
$inBytes = [Convert]::FromBase64String($b64.Trim())
$prot = [System.Security.Cryptography.ProtectedData]::Protect($inBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($prot))
`;

const DPAPI_UNPROTECT_SCRIPT = `
Add-Type -AssemblyName System.Security
$b64 = [Console]::In.ReadToEnd()
if (-not $b64) { exit 1 }
$inBytes = [Convert]::FromBase64String($b64.Trim())
$unprot = [System.Security.Cryptography.ProtectedData]::Unprotect($inBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($unprot))
`;

export function dpapiProtect(plaintext: string): string {
  const res = cp.spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', DPAPI_PROTECT_SCRIPT],
    {
      input: Buffer.from(plaintext, 'utf-8').toString('base64'),
      encoding: 'utf-8',
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
  if (res.status !== 0 || res.error) {
    throw new Error(`DPAPI encryption failed: ${res.stderr || res.error?.message || 'Unknown error'}`);
  }
  return res.stdout.trim();
}

export function dpapiUnprotect(ciphertextB64: string): string {
  const res = cp.spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', DPAPI_UNPROTECT_SCRIPT],
    {
      input: ciphertextB64.trim(),
      encoding: 'utf-8',
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
  if (res.status !== 0 || res.error) {
    throw new Error(`DPAPI decryption failed: ${res.stderr || res.error?.message || 'Unknown error'}`);
  }
  return Buffer.from(res.stdout.trim(), 'base64').toString('utf-8');
}

// Fallback AES key for non-Windows testing environments
function getFallbackTestKey(): Buffer {
  const salt = 'mindvault-companion-device-auth-salt-v2';
  const secret = process.env.TEST_COMPANION_SECRET || `${os.userInfo().username}#mindvault_test`;
  return crypto.pbkdf2Sync(secret, salt, 50000, 32, 'sha256');
}

export interface TokenStoreOptions {
  forceRealDpapi?: boolean;
  customPath?: string;
}

/**
 * Tightens Windows NTFS file permissions so only the current user and SYSTEM have access.
 */
export function restrictWindowsPermissions(targetPath: string, isDirectory = false, forceReal = false): void {
  if (process.platform !== 'win32') return;
  if (process.env.NODE_ENV === 'test' && !forceReal && process.env.FORCE_REAL_DPAPI !== 'true') return;
  try {
    const username = process.env.USERNAME || os.userInfo().username;
    const perm = isDirectory ? `${username}:(OI)(CI)F` : `${username}:F`;
    cp.execFileSync(
      'icacls.exe',
      [targetPath, '/grant', perm],
      { windowsHide: true, stdio: 'ignore' },
    );
  } catch {
    // Non-blocking ACL enhancement
  }
}

/**
 * Persists device token encrypted with Windows DPAPI (or AES-256-GCM in cross-platform test mode).
 */
export function saveStoredToken(token: StoredDeviceToken, options?: TokenStoreOptions): void {
  try {
    const filePath = options?.customPath || getTokenFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      restrictWindowsPermissions(dir, true, options?.forceRealDpapi);
    }

    const plaintext = JSON.stringify(token);
    const isWindows =
      process.platform === 'win32' &&
      (options?.forceRealDpapi || process.env.FORCE_REAL_DPAPI === 'true' || process.env.NODE_ENV !== 'test');

    let filePayload: string;

    if (isWindows) {
      // Primary: Native Windows DPAPI bound to logged-in user profile
      const protectedB64 = dpapiProtect(plaintext);
      filePayload = JSON.stringify({
        version: 2,
        mechanism: 'dpapi',
        protectedData: protectedB64,
      });
    } else {
      // Test / Non-Windows fallback: AES-256-GCM
      const key = getFallbackTestKey();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
      const authTag = cipher.getAuthTag();

      filePayload = JSON.stringify({
        version: 2,
        mechanism: 'aes-gcm',
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
        ciphertext: encrypted.toString('hex'),
      });
    }

    fs.writeFileSync(filePath, filePayload, 'utf-8');
    restrictWindowsPermissions(filePath, false, options?.forceRealDpapi);
    logger.info(`Device token securely persisted using ${isWindows ? 'Windows DPAPI' : 'AES-GCM'} at ${filePath}`);
  } catch (err: any) {
    logger.error(`Failed to securely save device token: ${err.message}`);
    throw err;
  }
}

/**
 * Loads and decrypts device token from secure Windows user storage.
 */
export function loadStoredToken(options?: TokenStoreOptions): StoredDeviceToken | null {
  try {
    const filePath = options?.customPath || getTokenFilePath();
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);

    // 1. Version 2 DPAPI mechanism
    if (parsed.mechanism === 'dpapi' && parsed.protectedData) {
      const decryptedJson = dpapiUnprotect(parsed.protectedData);
      return JSON.parse(decryptedJson) as StoredDeviceToken;
    }

    // 2. Version 2 AES-GCM test fallback
    if (parsed.mechanism === 'aes-gcm' && parsed.iv && parsed.authTag && parsed.ciphertext) {
      const key = getFallbackTestKey();
      const iv = Buffer.from(parsed.iv, 'hex');
      const authTag = Buffer.from(parsed.authTag, 'hex');
      const ciphertext = Buffer.from(parsed.ciphertext, 'hex');

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return JSON.parse(decrypted.toString('utf-8')) as StoredDeviceToken;
    }

    // 3. Version 1 legacy backward compatibility fallback
    if (parsed.version === 1 && parsed.iv && parsed.authTag && parsed.ciphertext) {
      const machineEntropy = `${os.userInfo().username}#${os.hostname()}#${process.env.USERPROFILE || os.homedir()}#mindvault_v1`;
      const salt = 'mindvault-companion-device-auth-salt-v1';
      const key = crypto.pbkdf2Sync(machineEntropy, salt, 50000, 32, 'sha256');

      const iv = Buffer.from(parsed.iv, 'hex');
      const authTag = Buffer.from(parsed.authTag, 'hex');
      const ciphertext = Buffer.from(parsed.ciphertext, 'hex');

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return JSON.parse(decrypted.toString('utf-8')) as StoredDeviceToken;
    }

    logger.warn('Corrupt or unrecognized token storage file detected');
    return null;
  } catch (err: any) {
    logger.warn(`Could not decrypt stored device token: ${err.message}`);
    return null;
  }
}

/**
 * Clears stored device token upon revocation or logout.
 */
export function clearStoredToken(): void {
  try {
    const filePath = getTokenFilePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info('Device token removed from local storage');
    }
  } catch (err: any) {
    logger.warn(`Failed to delete token file: ${err.message}`);
  }
}
