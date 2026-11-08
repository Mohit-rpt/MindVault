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
} from '@mindvault/shared';
import crypto from 'node:crypto';

export interface IWorkerGraphQueue {
  enqueue(payload: GraphExtractionJobPayload, options?: { delay?: number }): Promise<string | void>;
  getJob?(jobId: string): Promise<Job<GraphExtractionJobPayload> | null | undefined>;
  close(): Promise<void>;
}

export class BullMQWorkerGraphQueue implements IWorkerGraphQueue {
  private queue: Queue<GraphExtractionJobPayload> | null = null;

  constructor() {
    if (env.NODE_ENV !== 'test') {
      try {
        this.queue = new Queue<GraphExtractionJobPayload>(GRAPH_EXTRACTION_QUEUE_NAME, {
          connection: {
            url: env.REDIS_URL,
            maxRetriesPerRequest: null,
          },
        });
      } catch (err) {
        console.warn('Failed to connect to Redis for worker graph extraction queue:', err);
      }
    }
  }

  async enqueue(payload: GraphExtractionJobPayload, options?: { delay?: number }): Promise<string> {
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
        ...(options?.delay !== undefined ? { delay: options.delay } : {}),
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
