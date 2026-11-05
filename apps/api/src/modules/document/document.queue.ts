import { Queue } from 'bullmq';
import { env } from '../../config/env.js';
import type { ProcessDocumentJobPayload } from '@mindvault/shared';

export interface IDocumentQueue {
  enqueue(payload: ProcessDocumentJobPayload): Promise<void>;
  close(): Promise<void>;
}

export class BullMQDocumentQueue implements IDocumentQueue {
  private queue: Queue<ProcessDocumentJobPayload> | null = null;

  constructor() {
    if (env.NODE_ENV !== 'test') {
      try {
        this.queue = new Queue<ProcessDocumentJobPayload>('document-processing', {
          connection: {
            url: env.REDIS_URL,
            maxRetriesPerRequest: null,
          },
        });
      } catch (err) {
        console.warn('Failed to connect to BullMQ Redis:', err);
      }
    }
  }

  async enqueue(payload: ProcessDocumentJobPayload): Promise<void> {
    if (this.queue) {
      await this.queue.add('process-document', payload, {
        jobId: `proc_${payload.documentId}`,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
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

// In-Memory test queue that records jobs or triggers a mock worker
export class InMemoryDocumentQueue implements IDocumentQueue {
  public jobs: ProcessDocumentJobPayload[] = [];
  public handler?: (payload: ProcessDocumentJobPayload) => Promise<void>;

  async enqueue(payload: ProcessDocumentJobPayload): Promise<void> {
    this.jobs.push(payload);
    if (this.handler) {
      // Execute asynchronously to mimic worker job processing
      setTimeout(() => {
        this.handler!(payload).catch((err) => {
          console.error('In-memory worker execution error:', err);
        });
      }, 0);
    }
  }

  async close(): Promise<void> {
    this.jobs = [];
  }
}

export let documentQueue: IDocumentQueue = new BullMQDocumentQueue();

export function setDocumentQueue(queue: IDocumentQueue): void {
  documentQueue = queue;
}
