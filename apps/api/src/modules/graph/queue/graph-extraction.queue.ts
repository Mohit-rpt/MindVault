/**
 * MindVault — Knowledge Graph: BullMQ Extraction Queue
 *
 * Implements job enqueueing with exponential backoff and deterministic run-bound job IDs (§6.3.3).
 * Includes an in-memory queue for offline unit and integration testing.
 */

import { Queue, type Job } from 'bullmq';
import { env } from '../../../config/env.js';
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

export interface IGraphExtractionQueue {
  enqueue(payload: GraphExtractionJobPayload): Promise<string>;
  getJob(
    jobId: string,
    workspaceId?: string,
    capability?: 'local' | 'cloud',
  ): Promise<Job<GraphExtractionJobPayload> | null | undefined>;
  close(): Promise<void>;
}

export class BullMQGraphExtractionQueue implements IGraphExtractionQueue {
  private defaultQueue: Queue<GraphExtractionJobPayload> | null = null;
  private queues: Map<string, Queue<GraphExtractionJobPayload>> = new Map();
  private forceRealQueue: boolean;

  constructor(forceRealQueue = false) {
    this.forceRealQueue = forceRealQueue;
    if (env.NODE_ENV !== 'test' || forceRealQueue) {
      try {
        const connectionOptions = parseRedisUrl(env.REDIS_URL, 'producer');
        this.defaultQueue = new Queue<GraphExtractionJobPayload>(GRAPH_EXTRACTION_QUEUE_NAME, {
          connection: connectionOptions as any,
        });
        this.queues.set(GRAPH_EXTRACTION_QUEUE_NAME, this.defaultQueue);
      } catch (err: any) {
        console.warn(
          'Failed to connect to BullMQ Redis for graph-extraction:',
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
        const connectionOptions = parseRedisUrl(env.REDIS_URL, 'producer');
        q = new Queue<GraphExtractionJobPayload>(toBullQueueName(queueName), {
          connection: connectionOptions as any,
        });
        this.queues.set(queueName, q);
      } catch (err: any) {
        console.warn(
          `Failed to connect to BullMQ Redis for graph queue ${queueName}:`,
          sanitizeErrorMessage(err.message),
        );
      }
    }
    return q || this.defaultQueue || null;
  }

  async enqueue(payload: GraphExtractionJobPayload): Promise<string> {
    const capability = payload.capability || (payload.requiresLocal ? 'local' : undefined);
    const targetQueue = this.getQueue(payload.workspaceId, capability);
    if (!targetQueue) {
      throw new Error('Graph extraction queue is unavailable (Redis offline or uninitialized)');
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
      });
    } catch (err: any) {
      throw new Error(
        `Failed to enqueue graph extraction job: ${sanitizeErrorMessage(err.message)}`,
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
          `Failed to retrieve graph extraction job: ${sanitizeErrorMessage(err.message)}`,
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
          `Failed to retrieve graph extraction job: ${sanitizeErrorMessage(err.message)}`,
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
          `Failed to retrieve graph extraction job: ${sanitizeErrorMessage(err.message)}`,
        );
      }
    }

    const legacyQ = this.getQueue(workspaceId);
    if (legacyQ) {
      try {
        return await legacyQ.getJob(jobId);
      } catch (err: any) {
        throw new Error(
          `Failed to retrieve graph extraction job: ${sanitizeErrorMessage(err.message)}`,
        );
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

export class InMemoryGraphExtractionQueue implements IGraphExtractionQueue {
  public jobs: GraphExtractionJobPayload[] = [];
  public enqueuedJobsMap: Map<string, GraphExtractionJobPayload> = new Map();
  public handler?: (payload: GraphExtractionJobPayload) => Promise<void>;

  async enqueue(payload: GraphExtractionJobPayload): Promise<string> {
    const runId = payload.extractionRunId || crypto.randomUUID();
    const jobId = formatExtractionJobId(payload.documentId, runId);
    const enrichedPayload: GraphExtractionJobPayload = {
      ...payload,
      extractionRunId: runId,
    };

    this.jobs.push(enrichedPayload);
    this.enqueuedJobsMap.set(jobId, enrichedPayload);

    if (this.handler) {
      // Directly invoke the handler synchronously and await its completion
      await this.handler!(enrichedPayload).catch((err) => {
        console.error('In-memory graph worker execution error:', err);
      });
    }

    return jobId;
  }

  async getJob(jobId: string): Promise<Job<GraphExtractionJobPayload> | null | undefined> {
    const payload = this.enqueuedJobsMap.get(jobId);
    if (!payload) return null;
    return {
      id: jobId,
      data: payload,
      getState: async () => 'waiting',
    } as unknown as Job<GraphExtractionJobPayload>;
  }

  async close(): Promise<void> {
    this.jobs = [];
    this.enqueuedJobsMap.clear();
  }
}

export let graphExtractionQueue: IGraphExtractionQueue =
  env.NODE_ENV === 'test' ? new InMemoryGraphExtractionQueue() : new BullMQGraphExtractionQueue();

export function setGraphExtractionQueue(queue: IGraphExtractionQueue): void {
  graphExtractionQueue = queue;
}
