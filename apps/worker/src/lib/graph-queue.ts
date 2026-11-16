/**
 * MindVault — Worker: Graph Extraction Queue Dispatcher
 *
 * @deprecated Deprecated in Task 6.4.1. Use unified queue contracts and standard jobId generation.
 * Maintained for worker ingestion pipeline backward compatibility.
 */

import { Queue, type Job } from 'bullmq';
import { env } from '../config/env.js';
import {
  type GraphExtractionJobPayload,
  GRAPH_EXTRACTION_QUEUE_NAME,
  GRAPH_EXTRACTION_JOB_NAME,
  GRAPH_QUEUE_DEFAULT_JOB_OPTIONS,
  formatExtractionJobId,
  getGraphQueueName,
  toBullQueueName,
  parseRedisUrl,
  sanitizeErrorMessage,
} from '@mindvault/shared';
import crypto from 'node:crypto';

export interface IWorkerGraphQueue {
  enqueue(payload: GraphExtractionJobPayload, options?: { delay?: number }): Promise<string | void>;
  getJob?(
    jobId: string,
    workspaceId?: string,
    capability?: 'local' | 'cloud',
  ): Promise<Job<GraphExtractionJobPayload> | null | undefined>;
  close(): Promise<void>;
}

export class BullMQWorkerGraphQueue implements IWorkerGraphQueue {
  private defaultQueue: Queue<GraphExtractionJobPayload> | null = null;
  private queues: Map<string, Queue<GraphExtractionJobPayload>> = new Map();
  private forceRealQueue: boolean;

  constructor(forceRealQueue = false) {
    this.forceRealQueue = forceRealQueue;
    if (env.NODE_ENV !== 'test' || forceRealQueue) {
      try {
        const redisUrl = process.env.REDIS_URL || env.REDIS_URL;
        const connectionOptions = parseRedisUrl(redisUrl, 'producer');
        this.defaultQueue = new Queue<GraphExtractionJobPayload>(GRAPH_EXTRACTION_QUEUE_NAME, {
          connection: connectionOptions as any,
        });
        this.queues.set(GRAPH_EXTRACTION_QUEUE_NAME, this.defaultQueue);
      } catch (err: any) {
        console.warn(
          'Failed to connect to Redis for worker graph extraction queue:',
          sanitizeErrorMessage(err.message),
        );
      }
    }
  }

  public getQueue(
    workspaceId?: string,
    capability?: 'local' | 'cloud',
  ): Queue<GraphExtractionJobPayload> | null {
    const queueName = getGraphQueueName(workspaceId, capability);
    let q = this.queues.get(queueName);
    if (!q && (env.NODE_ENV !== 'test' || this.forceRealQueue)) {
      try {
        const redisUrl = process.env.REDIS_URL || env.REDIS_URL;
        const connectionOptions = parseRedisUrl(redisUrl, 'producer');
        q = new Queue<GraphExtractionJobPayload>(toBullQueueName(queueName), {
          connection: connectionOptions as any,
        });
        this.queues.set(queueName, q);
      } catch (err: any) {
        console.warn(
          `Failed to connect to Redis for worker graph queue ${queueName}:`,
          sanitizeErrorMessage(err.message),
        );
      }
    }
    return q || this.defaultQueue || null;
  }

  async enqueue(payload: GraphExtractionJobPayload, options?: { delay?: number }): Promise<string> {
    const capability = payload.capability || (payload.requiresLocal ? 'local' : undefined);
    const targetQueue = this.getQueue(payload.workspaceId, capability);
    if (!targetQueue) {
      throw new Error(
        'Worker graph extraction queue is unavailable (Redis offline or uninitialized)',
      );
    }
    const runId = payload.extractionRunId || crypto.randomUUID();
    const jobId = formatExtractionJobId(payload.documentId, runId);
    const enrichedPayload: GraphExtractionJobPayload = {
      ...payload,
      capability,
      extractionRunId: runId,
    };

    try {
      await targetQueue.add(GRAPH_EXTRACTION_JOB_NAME, enrichedPayload, {
        jobId,
        ...GRAPH_QUEUE_DEFAULT_JOB_OPTIONS,
        ...(options?.delay !== undefined ? { delay: options.delay } : {}),
      });
    } catch (err: any) {
      throw new Error(
        `Failed to enqueue worker graph extraction job: ${sanitizeErrorMessage(err.message)}`,
      );
    }

    return jobId;
  }

  async getJob(
    jobId: string,
    workspaceId?: string,
    capability?: 'local' | 'cloud',
  ): Promise<Job<GraphExtractionJobPayload> | null | undefined> {
    if (capability) {
      const targetQueue = this.getQueue(workspaceId, capability);
      if (!targetQueue) return null;
      try {
        return await targetQueue.getJob(jobId);
      } catch (err: any) {
        throw new Error(
          `Failed to retrieve worker graph extraction job: ${sanitizeErrorMessage(err.message)}`,
        );
      }
    }

    // Inspect local partition first, then cloud, then legacy fallback
    const localQ = this.getQueue(workspaceId, 'local');
    if (localQ) {
      try {
        const j = await localQ.getJob(jobId);
        if (j) return j;
      } catch (err: any) {
        throw new Error(
          `Failed to retrieve worker graph extraction job: ${sanitizeErrorMessage(err.message)}`,
        );
      }
    }

    const cloudQ = this.getQueue(workspaceId, 'cloud');
    if (cloudQ) {
      try {
        const j = await cloudQ.getJob(jobId);
        if (j) return j;
      } catch (err: any) {
        throw new Error(
          `Failed to retrieve worker graph extraction job: ${sanitizeErrorMessage(err.message)}`,
        );
      }
    }

    if (workspaceId) {
      const legacyWorkspaceQueue = this.queues.get(`graph-extraction:${workspaceId}`);
      if (legacyWorkspaceQueue) {
        try {
          const j = await legacyWorkspaceQueue.getJob(jobId);
          if (j) return j;
        } catch {
          // ignore
        }
      }
    }

    if (this.defaultQueue) {
      try {
        return await this.defaultQueue.getJob(jobId);
      } catch {
        return null;
      }
    }

    return null;
  }

  async close(): Promise<void> {
    for (const q of this.queues.values()) {
      try {
        await q.close();
      } catch {
        // ignore
      }
    }
    this.queues.clear();
    this.defaultQueue = null;
  }
}
