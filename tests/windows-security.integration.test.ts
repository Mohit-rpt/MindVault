import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  dpapiProtect,
  dpapiUnprotect,
  restrictWindowsPermissions,
  saveStoredToken,
  loadStoredToken,
  StoredDeviceToken,
} from '../apps/companion/src/auth/token-store.js';

describe.runIf(process.platform === 'win32')('MindVault — Real Windows Security & DPAPI Integration Suite (§SEC-02)', () => {
  const tempDir = path.join(os.tmpdir(), `mindvault-win-sec-${Date.now()}`);
  const tempTokenFile = path.join(tempDir, 'device-token.dat');

  afterEach(() => {
    try {
      if (fs.existsSync(tempTokenFile)) {
        fs.unlinkSync(tempTokenFile);
      }
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir);
      }
    } catch {
      // Best effort cleanup
    }
  });

  it('performs native Windows DPAPI Protect and Unprotect roundtrip via stdin/stdout', () => {
    const originalText = 'mv_dev_token_real_dpapi_secret_payload_12345';
    
    // Encrypt using DPAPI
    const protectedB64 = dpapiProtect(originalText);
    expect(protectedB64).toBeDefined();
    expect(typeof protectedB64).toBe('string');
    expect(protectedB64.length).toBeGreaterThan(0);
    // Ciphertext must not contain plaintext
    expect(protectedB64).not.toContain(originalText);

    // Decrypt using DPAPI
    const decryptedText = dpapiUnprotect(protectedB64);
    expect(decryptedText).toBe(originalText);
  });

  it('persists and loads device token with forceRealDpapi=true and verifies dpapi mechanism', () => {
    const token: StoredDeviceToken = {
      deviceId: 'win-dev-real-001',
      deviceToken: 'mv_sec_token_99999',
      deviceName: 'Real-Windows-Test-PC',
      registeredAt: new Date().toISOString(),
      apiUrl: 'https://api.mindvault.cloud',
      workspaceId: 'ws-prod-win',
    };

    saveStoredToken(token, {
      forceRealDpapi: true,
      customPath: tempTokenFile,
    });

    expect(fs.existsSync(tempTokenFile)).toBe(true);

    // Inspect file content directly to verify it uses dpapi mechanism
    const rawContent = fs.readFileSync(tempTokenFile, 'utf-8');
    const parsed = JSON.parse(rawContent);
    expect(parsed.version).toBe(2);
    expect(parsed.mechanism).toBe('dpapi');
    expect(parsed.protectedData).toBeDefined();
    expect(parsed.ciphertext).toBeUndefined(); // Must not be AES test fallback

    // Load and verify decrypted values match
    const loaded = loadStoredToken({
      customPath: tempTokenFile,
    });

    expect(loaded).not.toBeNull();
    expect(loaded?.deviceId).toBe(token.deviceId);
    expect(loaded?.deviceToken).toBe(token.deviceToken);
    expect(loaded?.deviceName).toBe(token.deviceName);
    expect(loaded?.workspaceId).toBe('ws-prod-win');
  });

  it('restricts Windows NTFS permissions on directory and file using icacls.exe without error', () => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Must execute icacls on folder
    expect(() => restrictWindowsPermissions(tempDir, true, true)).not.toThrow();

    const dummyFile = path.join(tempDir, 'perm-test.dat');
    fs.writeFileSync(dummyFile, 'secure data', 'utf-8');

    // Must execute icacls on file
    expect(() => restrictWindowsPermissions(dummyFile, false, true)).not.toThrow();

    if (fs.existsSync(dummyFile)) {
      fs.unlinkSync(dummyFile);
    }
  });

  it('returns null safely when encountering corrupted or invalid DPAPI payload', () => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Invalid base64 / corrupted protectedData
    fs.writeFileSync(
      tempTokenFile,
      JSON.stringify({
        version: 2,
        mechanism: 'dpapi',
        protectedData: 'AABBAA==not-valid-dpapi-blob==',
      }),
      'utf-8',
    );

    const loaded = loadStoredToken({
      customPath: tempTokenFile,
    });

    expect(loaded).toBeNull();
  });
});
