import { describe, it, expect } from 'vitest';
import { WorkerService } from './worker.js';

describe('WorkerService lifecycle', () => {
  it('should initialize, report active status, and shut down gracefully', async () => {
    const worker = new WorkerService();
    expect(worker.getActiveStatus()).toBe(false);

    await worker.start();
    expect(worker.getActiveStatus()).toBe(true);

    await worker.stop();
    expect(worker.getActiveStatus()).toBe(false);
  });
});
