/**
 * MindVault — Conversation Repository
 *
 * Encapsulates multi-tenant PostgreSQL / database operations for chat sessions
 * and messages, enforcing workspace and user scoping on every query.
 */

import { dbService, type ChatSessionRecord, type ChatMessageRecord } from '../../../lib/db.js';
import type {
  ChatSessionDto,
  ChatMessageDto,
  ChatSessionStatus,
  ChatMessageRole,
  ChatMessageStatus,
  ListConversationsQuery,
  GetMessagesQuery,
  ContextSourceItem,
} from '@mindvault/shared';

export function mapSessionToDto(session: ChatSessionRecord): ChatSessionDto {
  return {
    id: session.id,
    workspaceId: session.workspaceId,
    userId: session.userId,
    title: session.title,
    status: session.status,
    summary: session.summary,
    summaryVersion: session.summaryVersion,
    summarizedThroughSeq: session.summarizedThroughSeq,
    summaryUpdatedAt: session.summaryUpdatedAt ? session.summaryUpdatedAt.toISOString() : null,
    messageCount: session.messageCount,
    lastMessageAt: session.lastMessageAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    archivedAt: session.archivedAt ? session.archivedAt.toISOString() : null,
  };
}

export function mapMessageToDto(message: ChatMessageRecord): ChatMessageDto {
  return {
    id: message.id,
    sessionId: message.sessionId,
    workspaceId: message.workspaceId,
    role: message.role,
    content: message.content,
    status: message.status,
    sequenceNumber: message.sequenceNumber,
    citations: Array.isArray(message.citations) ? (message.citations as ContextSourceItem[]) : [],
    metadata: (message.metadata as Record<string, unknown>) || {},
    tokenEstimate: message.tokenEstimate,
    createdAt: message.createdAt.toISOString(),
    completedAt: message.completedAt ? message.completedAt.toISOString() : null,
  };
}

export class ConversationRepository {
  public static async createSession(
    workspaceId: string,
    userId: string,
    title?: string,
  ): Promise<ChatSessionDto> {
    const session = await dbService.createChatSession({
      workspaceId,
      userId,
      title: title || 'New Conversation',
    });
    return mapSessionToDto(session);
  }

  public static async findSessionById(
    sessionId: string,
    workspaceId: string,
  ): Promise<ChatSessionDto | null> {
    const session = await dbService.findChatSessionById(sessionId, workspaceId);
    if (!session) return null;
    return mapSessionToDto(session);
  }

  public static async listSessions(
    workspaceId: string,
    userId: string,
    query?: ListConversationsQuery,
  ): Promise<ChatSessionDto[]> {
    const sessions = await dbService.listChatSessions({
      workspaceId,
      userId,
      limit: query?.limit || 20,
      cursor: query?.cursor,
      search: query?.search,
      status: query?.status,
    });
    return sessions.map(mapSessionToDto);
  }

  public static async updateSession(
    sessionId: string,
    workspaceId: string,
    data: {
      title?: string;
      status?: ChatSessionStatus;
      summary?: string | null;
      summaryVersion?: number;
      summarizedThroughSeq?: number;
      summaryUpdatedAt?: Date | null;
      messageCount?: number;
      lastMessageAt?: Date;
      archivedAt?: Date | null;
    },
  ): Promise<ChatSessionDto> {
    const session = await dbService.updateChatSession(sessionId, workspaceId, data);
    return mapSessionToDto(session);
  }

  public static async deleteSession(sessionId: string, workspaceId: string): Promise<void> {
    await dbService.deleteChatSession(sessionId, workspaceId);
  }

  public static async createMessage(data: {
    sessionId: string;
    workspaceId: string;
    role: ChatMessageRole;
    content: string;
    status?: ChatMessageStatus;
    sequenceNumber?: number;
    citations?: any;
    metadata?: any;
    tokenEstimate?: number;
  }): Promise<ChatMessageDto> {
    const msg = await dbService.createChatMessage(data);
    return mapMessageToDto(msg);
  }

  public static async findMessageById(
    messageId: string,
    sessionId: string,
  ): Promise<ChatMessageDto | null> {
    const msg = await dbService.findChatMessageById(messageId, sessionId);
    if (!msg) return null;
    return mapMessageToDto(msg);
  }

  public static async updateMessage(
    messageId: string,
    sessionId: string,
    data: {
      content?: string;
      status?: ChatMessageStatus;
      citations?: any;
      metadata?: any;
      tokenEstimate?: number;
      completedAt?: Date | null;
    },
  ): Promise<ChatMessageDto> {
    const msg = await dbService.updateChatMessage(messageId, sessionId, data);
    return mapMessageToDto(msg);
  }

  public static async listMessages(
    sessionId: string,
    workspaceId: string,
    query?: GetMessagesQuery,
  ): Promise<ChatMessageDto[]> {
    const messages = await dbService.listChatMessages(sessionId, workspaceId, query);
    return messages.map(mapMessageToDto);
  }

  public static async getRecentContextMessages(
    sessionId: string,
    workspaceId: string,
    limit: number = 10,
  ): Promise<ChatMessageDto[]> {
    const messages = await dbService.getRecentMessagesForContext(sessionId, workspaceId, limit);
    return messages.map(mapMessageToDto);
  }
}
