/**
 * MindVault — Worker: Graph Extraction Queue Dispatcher
 *
 * Enqueues newly ingested documents to the 'graph-extraction' BullMQ queue.
 */

import { Queue } from 'bullmq';
import { env } from '../config/env.js';
import type { GraphExtractionJobPayload } from '@mindvault/shared';

export interface IWorkerGraphQueue {
  enqueue(payload: GraphExtractionJobPayload): Promise<void>;
  close(): Promise<void>;
}

export class BullMQWorkerGraphQueue implements IWorkerGraphQueue {
  private queue: Queue<GraphExtractionJobPayload> | null = null;

  constructor() {
    if (env.NODE_ENV !== 'test') {
      try {
        this.queue = new Queue<GraphExtractionJobPayload>('graph-extraction', {
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

  async enqueue(payload: GraphExtractionJobPayload): Promise<void> {
    if (this.queue) {
      await this.queue.add('extract-graph', payload, {
        jobId: `graph_${payload.documentId}`,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      });
    }
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }
}
