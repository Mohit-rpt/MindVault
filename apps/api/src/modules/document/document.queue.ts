import { Queue } from 'bullmq';
import { env } from '../../config/env.js';
import {
  type ProcessDocumentJobPayload,
  DOCUMENT_PROCESSING_QUEUE_NAME,
  getDocumentQueueName,
  toBullQueueName,
  parseRedisUrl,
  sanitizeErrorMessage,
} from '@mindvault/shared';

export interface IDocumentQueue {
  enqueue(payload: ProcessDocumentJobPayload): Promise<void>;
  close(): Promise<void>;
}

export class BullMQDocumentQueue implements IDocumentQueue {
  private defaultQueue: Queue<ProcessDocumentJobPayload> | null = null;
  private queues: Map<string, Queue<ProcessDocumentJobPayload>> = new Map();
  private forceRealQueue: boolean;

  constructor(forceRealQueue = false) {
    this.forceRealQueue = forceRealQueue;
    if (env.NODE_ENV !== 'test' || forceRealQueue) {
      try {
        const redisUrl = process.env.REDIS_URL || env.REDIS_URL;
        const connectionOptions = parseRedisUrl(redisUrl, 'producer');
        this.defaultQueue = new Queue<ProcessDocumentJobPayload>(DOCUMENT_PROCESSING_QUEUE_NAME, {
          connection: connectionOptions as any,
        });
        this.queues.set(DOCUMENT_PROCESSING_QUEUE_NAME, this.defaultQueue);
      } catch (err: any) {
        console.warn('Failed to connect to BullMQ Redis:', sanitizeErrorMessage(err.message));
      }
    }
  }

  public getQueue(
    workspaceId?: string,
    capability?: 'local' | 'cloud',
  ): Queue<ProcessDocumentJobPayload> | null {
    const queueName = getDocumentQueueName(workspaceId, capability);
    let q = this.queues.get(queueName);
    if (!q && (env.NODE_ENV !== 'test' || this.forceRealQueue)) {
      try {
        const redisUrl = process.env.REDIS_URL || env.REDIS_URL;
        const connectionOptions = parseRedisUrl(redisUrl, 'producer');
        q = new Queue<ProcessDocumentJobPayload>(toBullQueueName(queueName), {
          connection: connectionOptions as any,
        });
        this.queues.set(queueName, q);
      } catch (err: any) {
        console.warn(`Failed to connect to BullMQ Redis for queue ${queueName}:`, sanitizeErrorMessage(err.message));
      }
    }
    return q || this.defaultQueue || null;
  }

  async enqueue(payload: ProcessDocumentJobPayload): Promise<void> {
    const capability = payload.capability || (payload.requiresLocal ? 'local' : undefined);
    const targetQueue = this.getQueue(payload.workspaceId, capability);
    if (!targetQueue) {
      throw new Error('Document processing queue is unavailable (Redis offline or uninitialized)');
    }
    try {
      await targetQueue.add('process-document', { ...payload, capability }, {
        jobId: `proc_${payload.documentId}`,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      });
    } catch (err: any) {
      throw new Error(`Failed to enqueue document processing job: ${sanitizeErrorMessage(err.message)}`);
    }
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

  public getJobsForWorkspace(workspaceId: string): ProcessDocumentJobPayload[] {
    return this.jobs.filter((j) => j.workspaceId === workspaceId);
  }

  async close(): Promise<void> {
    this.jobs = [];
  }
}

export let documentQueue: IDocumentQueue =
  env.NODE_ENV === 'test' ? new InMemoryDocumentQueue() : new BullMQDocumentQueue();

export function setDocumentQueue(queue: IDocumentQueue): void {
  documentQueue = queue;
}
