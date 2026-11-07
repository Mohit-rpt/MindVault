/**
 * MindVault — Knowledge Graph: BullMQ Extraction Queue
 *
 * Implements job enqueueing with exponential backoff and deduplication keys.
 * Includes an in-memory queue for offline unit and integration testing.
 */

import { Queue } from 'bullmq';
import { env } from '../../../config/env.js';
import type { GraphExtractionJobPayload } from '@mindvault/shared';

export interface IGraphExtractionQueue {
  enqueue(payload: GraphExtractionJobPayload): Promise<void>;
  close(): Promise<void>;
}

export class BullMQGraphExtractionQueue implements IGraphExtractionQueue {
  private queue: Queue<GraphExtractionJobPayload> | null = null;

  constructor() {
    if (env.NODE_ENV !== 'test') {
      try {
        this.queue = new Queue<GraphExtractionJobPayload>('graph-extraction', {
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

  async enqueue(payload: GraphExtractionJobPayload): Promise<void> {
    if (this.queue) {
      const jobId = `graph_${payload.documentId}_${payload.chunkId || 'doc'}`;
      await this.queue.add('extract-graph', payload, {
        jobId,
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

export class InMemoryGraphExtractionQueue implements IGraphExtractionQueue {
  public jobs: GraphExtractionJobPayload[] = [];
  public handler?: (payload: GraphExtractionJobPayload) => Promise<void>;

  async enqueue(payload: GraphExtractionJobPayload): Promise<void> {
    this.jobs.push(payload);
    if (this.handler) {
      setTimeout(() => {
        this.handler!(payload).catch((err) => {
          console.error('In-memory graph worker execution error:', err);
        });
      }, 0);
    }
  }

  async close(): Promise<void> {
    this.jobs = [];
  }
}

export let graphExtractionQueue: IGraphExtractionQueue = new BullMQGraphExtractionQueue();

export function setGraphExtractionQueue(queue: IGraphExtractionQueue): void {
  graphExtractionQueue = queue;
}
