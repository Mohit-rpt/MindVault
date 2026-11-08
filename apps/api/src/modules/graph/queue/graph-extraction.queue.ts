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
} from '@mindvault/shared';
import crypto from 'node:crypto';

export interface IGraphExtractionQueue {
  enqueue(payload: GraphExtractionJobPayload): Promise<string>;
  getJob(jobId: string): Promise<Job<GraphExtractionJobPayload> | null | undefined>;
  close(): Promise<void>;
}

export class BullMQGraphExtractionQueue implements IGraphExtractionQueue {
  private queue: Queue<GraphExtractionJobPayload> | null = null;

  constructor() {
    if (env.NODE_ENV !== 'test') {
      try {
        this.queue = new Queue<GraphExtractionJobPayload>(GRAPH_EXTRACTION_QUEUE_NAME, {
          connection: {
            url: env.REDIS_URL || 'redis://localhost:6379',
            maxRetriesPerRequest: null,
          },
        });
      } catch (err) {
        console.warn('Failed to connect to BullMQ Redis for graph-extraction:', err);
      }
    }
  }

  async enqueue(payload: GraphExtractionJobPayload): Promise<string> {
    const runId = payload.extractionRunId || crypto.randomUUID();
    const jobId = formatExtractionJobId(payload.documentId, runId);
    const enrichedPayload: GraphExtractionJobPayload = {
      ...payload,
      extractionRunId: runId,
    };

    if (this.queue) {
      await this.queue.add(GRAPH_EXTRACTION_JOB_NAME, enrichedPayload, {
        jobId,
        ...GRAPH_QUEUE_DEFAULT_JOB_OPTIONS,
      });
    }

    return jobId;
  }

  async getJob(jobId: string): Promise<Job<GraphExtractionJobPayload> | null | undefined> {
    if (this.queue) {
      return this.queue.getJob(jobId);
    }
    return null;
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
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
      setTimeout(() => {
        this.handler!(enrichedPayload).catch((err) => {
          console.error('In-memory graph worker execution error:', err);
        });
      }, 0);
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

export let graphExtractionQueue: IGraphExtractionQueue = new BullMQGraphExtractionQueue();

export function setGraphExtractionQueue(queue: IGraphExtractionQueue): void {
  graphExtractionQueue = queue;
}
