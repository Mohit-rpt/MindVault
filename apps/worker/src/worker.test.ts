import { describe, it, expect, vi } from 'vitest';
import { WorkerService } from './worker.js';
import type { GraphExtractionWorker } from './modules/graph/worker/graph-extraction.worker.js';
import type { DispatchRecoveryService } from './services/dispatch-recovery.service.js';
import type { GraphReconciliationService } from './services/graph-reconciliation.service.js';

describe('WorkerService lifecycle', () => {
  it('should initialize, report active status, and shut down gracefully', async () => {
    const worker = new WorkerService();
    expect(worker.getActiveStatus()).toBe(false);

    await worker.start();
    expect(worker.getActiveStatus()).toBe(true);

    await worker.stop();
    expect(worker.getActiveStatus()).toBe(false);
  });

  it('should execute startup reconciliation before starting graph worker and start periodic loops', async () => {
    const callOrder: string[] = [];

    const mockReconciliationService = {
      executeStartupReconciliation: vi.fn(async () => {
        callOrder.push('reconciliation.executeStartupReconciliation');
        return {
          locked: true,
          reconciledCount: 0,
          adoptedReceiptCount: 0,
          exhaustedRecoveredCount: 0,
          untrustedRecoveredCount: 0,
          presenceRecoveredCount: 0,
          ceilingReachedCount: 0,
          errors: [],
        };
      }),
      start: vi.fn((intervalMs?: number) => {
        callOrder.push(`reconciliation.start:${intervalMs}`);
      }),
      stop: vi.fn(async () => {
        callOrder.push('reconciliation.stop');
      }),
    } as unknown as GraphReconciliationService;

    const mockGraphWorker = {
      start: vi.fn(async () => {
        callOrder.push('graphWorker.start');
      }),
      stop: vi.fn(async () => {
        callOrder.push('graphWorker.stop');
      }),
    } as unknown as GraphExtractionWorker;

    const mockRecoveryService = {
      start: vi.fn((intervalMs?: number) => {
        callOrder.push(`recovery.start:${intervalMs}`);
      }),
      stop: vi.fn(async () => {
        callOrder.push('recovery.stop');
      }),
    } as unknown as DispatchRecoveryService;

    const worker = new WorkerService(
      undefined,
      mockGraphWorker,
      mockRecoveryService,
      mockReconciliationService,
    );

    await worker.start();
    expect(worker.getActiveStatus()).toBe(true);

    // Verify ordering: startup reconciliation strictly before graphWorker.start
    expect(callOrder[0]).toBe('reconciliation.executeStartupReconciliation');
    expect(callOrder[1]).toBe('graphWorker.start');
    expect(callOrder).toContain('reconciliation.start:60000');
    expect(callOrder).toContain('recovery.start:60000');

    await worker.stop();
    expect(worker.getActiveStatus()).toBe(false);

    // Verify shutdown order: reconciliation.stop -> graphWorker.stop -> recovery.stop
    const stopReconciliationIdx = callOrder.indexOf('reconciliation.stop');
    const stopGraphWorkerIdx = callOrder.indexOf('graphWorker.stop');
    const stopRecoveryIdx = callOrder.indexOf('recovery.stop');

    expect(stopReconciliationIdx).toBeGreaterThan(-1);
    expect(stopGraphWorkerIdx).toBeGreaterThan(stopReconciliationIdx);
    expect(stopRecoveryIdx).toBeGreaterThan(stopGraphWorkerIdx);
  });

  it('should not crash worker if startup reconciliation throws an unhandled error', async () => {
    const mockReconciliationService = {
      executeStartupReconciliation: vi.fn(async () => {
        throw new Error('Database connection refused');
      }),
      start: vi.fn(),
      stop: vi.fn(async () => {}),
    } as unknown as GraphReconciliationService;

    const mockGraphWorker = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    } as unknown as GraphExtractionWorker;

    const mockRecoveryService = {
      start: vi.fn(),
      stop: vi.fn(async () => {}),
    } as unknown as DispatchRecoveryService;

    const worker = new WorkerService(
      undefined,
      mockGraphWorker,
      mockRecoveryService,
      mockReconciliationService,
    );

    // Should not throw
    await expect(worker.start()).resolves.not.toThrow();
    expect(worker.getActiveStatus()).toBe(true);
    expect(mockGraphWorker.start).toHaveBeenCalled();

    await worker.stop();
    expect(worker.getActiveStatus()).toBe(false);
  });
});
