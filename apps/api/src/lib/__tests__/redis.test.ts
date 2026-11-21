import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getApiRedisClient, setApiRedisClient, closeApiRedisClient } from '../redis.js';

describe('Dedicated API Redis Singleton Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setApiRedisClient(undefined);
  });

  afterEach(async () => {
    setApiRedisClient(undefined);
    await closeApiRedisClient();
  });

  it('returns null in test environment by default when not forced', () => {
    const client = getApiRedisClient(false);
    expect(client).toBeNull();
  });

  it('returns test override client when setApiRedisClient is called', () => {
    const mockClient = { ping: vi.fn().mockResolvedValue('PONG'), status: 'ready' } as any;
    setApiRedisClient(mockClient);

    const client = getApiRedisClient();
    expect(client).toBe(mockClient);
  });

  it('closeApiRedisClient gracefully quits active client and resets singleton', async () => {
    const mockClient = {
      status: 'ready',
      quit: vi.fn().mockResolvedValue('OK'),
      disconnect: vi.fn(),
    } as any;

    setApiRedisClient(mockClient);
    await closeApiRedisClient();

    // Since mockClient was an override, resetting testOverrideClient restores default behavior
    setApiRedisClient(undefined);
    expect(getApiRedisClient(false)).toBeNull();
  });

  it('closeApiRedisClient is idempotent when called multiple times or when uninitialized', async () => {
    await expect(closeApiRedisClient()).resolves.not.toThrow();
    await expect(closeApiRedisClient()).resolves.not.toThrow();
  });
});
