import { Queue } from 'bullmq';
import {
  getDocumentQueueName,
  getGraphQueueName,
  toBullQueueName,
  parseRedisUrl,
  sanitizeErrorMessage,
} from '@mindvault/shared';
import { env } from '../../config/env.js';

export interface WorkspaceQueueCleanupResult {
  workspaceId: string;
  cleanedQueues: string[];
  pausedQueues: string[];
  errors: Record<string, string>;
}

export class WorkspaceQueueService {
  /**
   * Safely and idempotently cleans all capability and legacy queues for a deleted workspace (§LFC-03).
   * Pauses active queues to prevent work processing, and obliterates empty/inactive queues
   * without affecting any other tenant workspaces.
   */
  public async cleanWorkspaceQueues(
    workspaceId: string,
    redisUrlOverride?: string,
  ): Promise<WorkspaceQueueCleanupResult> {
    const result: WorkspaceQueueCleanupResult = {
      workspaceId,
      cleanedQueues: [],
      pausedQueues: [],
      errors: {},
    };

    if (!workspaceId) {
      return result;
    }

    const targetRedisUrl = redisUrlOverride || env.REDIS_URL;

    const queueNames = [
      getDocumentQueueName(workspaceId, 'local'),
      getDocumentQueueName(workspaceId, 'cloud'),
      getDocumentQueueName(workspaceId),
      getGraphQueueName(workspaceId, 'local'),
      getGraphQueueName(workspaceId, 'cloud'),
      getGraphQueueName(workspaceId),
    ];

    const uniqueQueueNames = [...new Set(queueNames)];

    for (const qName of uniqueQueueNames) {
      let q: Queue | null = null;
      try {
        const conn = parseRedisUrl(targetRedisUrl, 'producer');
        q = new Queue(toBullQueueName(qName), { connection: conn as any });

        // 1. Pause queue to immediately halt pulling or processing any jobs
        try {
          await q.pause();
          result.pausedQueues.push(qName);
        } catch (pauseErr: any) {
          // If queue doesn't exist yet in Redis, pause might fail harmlessly
        }

        // 2. Safe obliterate (non-destructive if active jobs are in-flight)
        try {
          await q.obliterate({ force: false });
          result.cleanedQueues.push(qName);
        } catch (obliterateErr: any) {
          // If active jobs are running, obliterate({ force: false }) throws safely
          result.errors[qName] = sanitizeErrorMessage(obliterateErr.message);
        }
      } catch (err: any) {
        result.errors[qName] = sanitizeErrorMessage(err.message);
      } finally {
        if (q) {
          try {
            await q.close();
          } catch {
            // Ignore close error
          }
        }
      }
    }

    return result;
  }
}

export const workspaceQueueService = new WorkspaceQueueService();
