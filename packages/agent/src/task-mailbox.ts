/**
 * Task Mailbox - Message passing protocol for SubAgent communication
 *
 * Provides an async message queue system for inter-agent communication
 * using a mailbox pattern with topics for selective message consumption.
 */

import { createId, nowIso } from "@omi/core";

// ============================================================================
// Types
// ============================================================================

/**
 * Mailbox message envelope
 */
export interface MailboxMessage<T = unknown> {
  id: string;
  senderId: string;
  recipientId: string | null; // null for broadcast
  topic: string;
  payload: T;
  timestamp: string;
  replyTo?: string; // Message ID to reply to
  correlationId?: string; // For tracking related messages
}

/**
 * Mailbox subscription handle
 */
export interface MailboxSubscription<T = unknown> {
  id: string;
  topic: string | null; // null for all topics
  callback: (message: MailboxMessage<T>) => void | Promise<void>;
  filter?: (message: MailboxMessage<T>) => boolean;
}

/**
 * Mailbox message status
 */
export type MessageStatus = "pending" | "delivered" | "read" | "replied" | "expired";

/**
 * Message metadata for tracking
 */
export interface MailboxMessageMeta {
  status: MessageStatus;
  deliveredAt?: string;
  readAt?: string;
  replyId?: string;
}

/**
 * Mailbox configuration
 */
export interface MailboxConfig {
  /** Maximum messages to retain per recipient */
  maxMessages?: number;
  /** Message TTL in milliseconds (default: 1 hour) */
  messageTtl?: number;
  /** Whether to retain messages after delivery */
  retainDelivered?: boolean;
}

// ============================================================================
// Mailbox Implementation
// ============================================================================

/**
 * Async message mailbox for agent communication.
 *
 * Features:
 * - Topic-based message routing
 * - Pub/sub subscriptions with filters
 * - Message tracking and acknowledgment
 * - Broadcast and direct messaging
 * - Automatic message expiration
 */
export class Mailbox {
  private readonly messages = new Map<string, MailboxMessage>();
  private readonly subscriptions = new Map<string, MailboxSubscription>();
  private readonly recipientInbox = new Map<string, string[]>(); // recipientId -> messageIds
  private readonly topicIndex = new Map<string, Set<string>>(); // topic -> messageIds
  private readonly config: Required<MailboxConfig>;

  constructor(config: MailboxConfig = {}) {
    this.config = {
      maxMessages: config.maxMessages ?? 1000,
      messageTtl: config.messageTtl ?? 3600000, // 1 hour
      retainDelivered: config.retainDelivered ?? true,
    };
  }

  /**
   * Send a message to a recipient or broadcast.
   */
  send<T>(message: Omit<MailboxMessage<T>, "id" | "timestamp">): MailboxMessage<T> {
    const id = createId("msg");
    const fullMessage: MailboxMessage<T> = {
      ...message,
      id,
      timestamp: nowIso(),
    };

    // Store message
    this.messages.set(id, fullMessage as MailboxMessage<unknown> as MailboxMessage);

    // Index by topic
    if (!this.topicIndex.has(fullMessage.topic)) {
      this.topicIndex.set(fullMessage.topic, new Set());
    }
    this.topicIndex.get(fullMessage.topic)!.add(id);

    // Index by recipient
    if (fullMessage.recipientId) {
      if (!this.recipientInbox.has(fullMessage.recipientId)) {
        this.recipientInbox.set(fullMessage.recipientId, []);
      }
      const inbox = this.recipientInbox.get(fullMessage.recipientId)!;
      inbox.push(id);

      // Enforce max messages
      while (inbox.length > this.config.maxMessages) {
        const oldestId = inbox.shift()!;
        this.deleteMessage(oldestId);
      }
    }

    // Deliver to matching subscriptions
    this.deliverToSubscriptions(fullMessage as MailboxMessage);

    // Schedule expiration
    if (this.config.messageTtl > 0) {
      setTimeout(() => this.expireMessage(id), this.config.messageTtl);
    }

    return fullMessage;
  }

  /**
   * Broadcast a message to all agents listening on a topic.
   */
  broadcast<T>(senderId: string, topic: string, payload: T, correlationId?: string): MailboxMessage<T> {
    return this.send({
      senderId,
      recipientId: null, // broadcast
      topic,
      payload,
      correlationId,
    });
  }

  /**
   * Send a direct message to a specific recipient.
   */
  sendTo<T>(
    senderId: string,
    recipientId: string,
    topic: string,
    payload: T,
    replyTo?: string,
    correlationId?: string,
  ): MailboxMessage<T> {
    return this.send({
      senderId,
      recipientId,
      topic,
      payload,
      replyTo,
      correlationId,
    });
  }

  /**
   * Reply to a message.
   */
  reply<T>(
    originalMessageId: string,
    senderId: string,
    payload: T,
    topic?: string,
  ): MailboxMessage<T> | null {
    const original = this.messages.get(originalMessageId);
    if (!original) {
      return null;
    }

    return this.send({
      senderId,
      recipientId: original.senderId,
      topic: topic ?? original.topic,
      payload,
      replyTo: originalMessageId,
      correlationId: original.correlationId,
    });
  }

  /**
   * Subscribe to messages on a topic.
   */
  subscribe<T>(
    topic: string | null,
    callback: (message: MailboxMessage<T>) => void | Promise<void>,
    filter?: (message: MailboxMessage<T>) => boolean,
  ): MailboxSubscription<T> {
    const id = createId("msg");
    const subscription: MailboxSubscription<T> = { id, topic, callback, filter };
    this.subscriptions.set(id, subscription as MailboxSubscription);
    return subscription;
  }

  /**
   * Unsubscribe from messages.
   */
  unsubscribe(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId);
  }

  /**
   * Get messages for a recipient.
   */
  getMessagesForRecipient(recipientId: string, topic?: string): MailboxMessage[] {
    const messageIds = this.recipientInbox.get(recipientId) ?? [];
    const messages: MailboxMessage[] = [];

    for (const id of messageIds) {
      const message = this.messages.get(id);
      if (message && (!topic || message.topic === topic)) {
        messages.push(message);
      }
    }

    return messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * Get messages by topic.
   */
  getMessagesByTopic(topic: string): MailboxMessage[] {
    const messageIds = this.topicIndex.get(topic) ?? [];
    const messages: MailboxMessage[] = [];

    for (const id of messageIds) {
      const message = this.messages.get(id);
      if (message) {
        messages.push(message);
      }
    }

    return messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * Mark a message as read.
   */
  markAsRead(messageId: string): boolean {
    const message = this.messages.get(messageId);
    if (!message) {
      return false;
    }
    return true;
  }

  /**
   * Delete a message.
   */
  deleteMessage(messageId: string): boolean {
    const message = this.messages.get(messageId);
    if (!message) {
      return false;
    }

    this.messages.delete(messageId);

    // Remove from topic index
    const topicSet = this.topicIndex.get(message.topic);
    if (topicSet) {
      topicSet.delete(messageId);
      if (topicSet.size === 0) {
        this.topicIndex.delete(message.topic);
      }
    }

    // Remove from recipient inbox
    if (message.recipientId) {
      const inbox = this.recipientInbox.get(message.recipientId);
      if (inbox) {
        const idx = inbox.indexOf(messageId);
        if (idx !== -1) {
          inbox.splice(idx, 1);
        }
        if (inbox.length === 0) {
          this.recipientInbox.delete(message.recipientId);
        }
      }
    }

    return true;
  }

  /**
   * Get mailbox statistics.
   */
  getStats(): { totalMessages: number; totalSubscriptions: number; topics: string[] } {
    return {
      totalMessages: this.messages.size,
      totalSubscriptions: this.subscriptions.size,
      topics: [...this.topicIndex.keys()],
    };
  }

  /**
   * Clear all messages (for testing or reset).
   */
  clear(): void {
    this.messages.clear();
    this.recipientInbox.clear();
    this.topicIndex.clear();
  }

  private deliverToSubscriptions(message: MailboxMessage): void {
    for (const subscription of this.subscriptions.values()) {
      // Check topic match
      if (subscription.topic !== null && subscription.topic !== message.topic) {
        continue;
      }

      // Check filter
      if (subscription.filter && !subscription.filter(message as MailboxMessage<unknown>)) {
        continue;
      }

      // Deliver asynchronously to avoid blocking
      Promise.resolve().then(() => {
        subscription.callback(message);
      });
    }
  }

  private expireMessage(messageId: string): void {
    if (this.messages.has(messageId)) {
      this.deleteMessage(messageId);
    }
  }
}

// ============================================================================
// Task Notification Mailbox
// ============================================================================

export type TaskNotificationKind =
  | "submitted"
  | "completed"
  | "failed"
  | "progress"
  | "canceled"
  | "cancelled";

export interface TaskMailboxEvent<T = unknown> {
  id: string;
  type: string;
  senderId: string;
  recipientId?: string | null;
  payload: T;
  timestamp: string;
  correlationId?: string;
}

export interface TaskMailboxQueryFilter {
  type?: string | string[];
  senderId?: string;
  recipientId?: string;
  correlationId?: string;
  taskId?: string;
}

export interface TaskMailboxSubscription<T = unknown> {
  id: string;
  filter: TaskMailboxQueryFilter;
  callback: (event: TaskMailboxEvent<T>) => void | Promise<void>;
}

export interface TaskSubmittedPayload {
  taskId: string;
  task: string;
  priority?: number;
  deadline?: number;
  ownerId?: string;
  writeScope?: string;
  background?: boolean;
}

export interface TaskCompletedPayload<T = unknown> {
  taskId: string;
  result: T;
}

export interface TaskFailedPayload {
  taskId: string;
  error: string;
}

export interface TaskProgressPayload {
  taskId: string;
  progress: number;
  message?: string;
}

function normalizeTaskNotificationType(kind: TaskNotificationKind): string {
  if (kind === "submitted") {
    return "task.submitted";
  }
  if (kind === "completed") {
    return "task.completed";
  }
  if (kind === "failed") {
    return "task.failed";
  }
  if (kind === "progress") {
    return "task.progress";
  }
  return "task.canceled";
}

function matchesTaskMailboxFilter(
  event: TaskMailboxEvent,
  filter: TaskMailboxQueryFilter,
): boolean {
  if (filter.type !== undefined) {
    const types = Array.isArray(filter.type) ? filter.type : [filter.type];
    if (!types.includes(event.type)) {
      return false;
    }
  }

  if (filter.senderId !== undefined && filter.senderId !== event.senderId) {
    return false;
  }

  if (filter.recipientId !== undefined && filter.recipientId !== event.recipientId) {
    return false;
  }

  if (filter.correlationId !== undefined && filter.correlationId !== event.correlationId) {
    return false;
  }

  if (filter.taskId !== undefined) {
    const payload = event.payload as { taskId?: string };
    if (payload.taskId !== filter.taskId) {
      return false;
    }
  }

  return true;
}

function buildTaskNotificationPayload(
  kind: TaskNotificationKind,
  taskId: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (kind === "submitted") {
    return {
      taskId,
      task: String(payload.task ?? ""),
      priority: payload.priority as number | undefined,
      deadline: payload.deadline as number | undefined,
      ownerId: payload.ownerId as string | undefined,
      writeScope: payload.writeScope as string | undefined,
      background: payload.background as boolean | undefined,
    };
  }

  if (kind === "completed") {
    return {
      taskId,
      result: payload.result,
    };
  }

  if (kind === "failed") {
    return {
      taskId,
      error: String(payload.error ?? "Unknown error"),
    };
  }

  if (kind === "progress") {
    return {
      taskId,
      progress: Number(payload.progress ?? 0),
      message: payload.message as string | undefined,
    };
  }

  return {
    taskId,
    status: "canceled",
    reason: payload.reason as string | undefined,
  };
}

export function createTaskSubmittedEvent(
  senderId: string,
  taskId: string,
  task: string,
  options: {
    priority?: number;
    deadline?: number;
    ownerId?: string;
    writeScope?: string;
    background?: boolean;
    correlationId?: string;
    recipientId?: string | null;
  } = {},
): TaskMailboxEvent<TaskSubmittedPayload> {
  return {
    id: createId("evt"),
    type: "task.submitted",
    senderId,
    recipientId: options.recipientId ?? null,
    payload: {
      taskId,
      task,
      priority: options.priority,
      deadline: options.deadline,
      ownerId: options.ownerId,
      writeScope: options.writeScope,
      background: options.background,
    },
    timestamp: nowIso(),
    correlationId: options.correlationId,
  };
}

export function createTaskCompletedEvent<T>(
  senderId: string,
  taskId: string,
  result: T,
  correlationId?: string,
): TaskMailboxEvent<TaskCompletedPayload<T>> {
  return {
    id: createId("evt"),
    type: "task.completed",
    senderId,
    recipientId: null,
    payload: {
      taskId,
      result,
    },
    timestamp: nowIso(),
    correlationId,
  };
}

export function createTaskFailedEvent(
  senderId: string,
  taskId: string,
  error: string,
  correlationId?: string,
): TaskMailboxEvent<TaskFailedPayload> {
  return {
    id: createId("evt"),
    type: "task.failed",
    senderId,
    recipientId: null,
    payload: {
      taskId,
      error,
    },
    timestamp: nowIso(),
    correlationId,
  };
}

export function createTaskProgressEvent(
  senderId: string,
  taskId: string,
  progress: number,
  message?: string,
  correlationId?: string,
): TaskMailboxEvent<TaskProgressPayload> {
  return {
    id: createId("evt"),
    type: "task.progress",
    senderId,
    recipientId: null,
    payload: {
      taskId,
      progress,
      message,
    },
    timestamp: nowIso(),
    correlationId,
  };
}

/**
 * Task mailbox with task-notification style events.
 */
export class TaskMailbox {
  private readonly events: TaskMailboxEvent[] = [];
  private readonly subscriptions = new Map<string, TaskMailboxSubscription>();

  publish<T>(event: Omit<TaskMailboxEvent<T>, "id" | "timestamp">): string {
    const fullEvent: TaskMailboxEvent<T> = {
      ...event,
      id: createId("evt"),
      timestamp: nowIso(),
    };

    this.events.push(fullEvent as TaskMailboxEvent);
    this.deliver(fullEvent as TaskMailboxEvent);
    return fullEvent.id;
  }

  publishTaskNotification(
    kind: TaskNotificationKind,
    senderId: string,
    taskId: string,
    payload: Record<string, unknown> = {},
    correlationId?: string,
  ): string {
    const type = normalizeTaskNotificationType(kind);
    const notificationPayload = buildTaskNotificationPayload(kind, taskId, payload);

    return this.publish({
      type,
      senderId,
      recipientId: payload.recipientId === undefined ? null : (payload.recipientId as string | null),
      payload: notificationPayload,
      correlationId,
    });
  }

  sendMessage(
    senderId: string,
    recipientId: string,
    message: string,
    correlationId?: string,
  ): string {
    return this.publish({
      type: "message.sent",
      senderId,
      recipientId,
      payload: { message },
      correlationId,
    });
  }

  subscribe<T>(
    filter: TaskMailboxQueryFilter,
    callback: (event: TaskMailboxEvent<T>) => void | Promise<void>,
  ): string {
    const id = createId("sub");
    this.subscriptions.set(id, {
      id,
      filter,
      callback: callback as TaskMailboxSubscription["callback"],
    });
    return id;
  }

  unsubscribe(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId);
  }

  query(filter: TaskMailboxQueryFilter = {}, limit?: number): TaskMailboxEvent[] {
    const matches = this.events.filter((event) => matchesTaskMailboxFilter(event, filter));
    return typeof limit === "number" ? matches.slice(-limit) : matches;
  }

  clear(): void {
    this.events.length = 0;
    this.subscriptions.clear();
  }

  getStats(): { totalEvents: number; totalSubscriptions: number } {
    return {
      totalEvents: this.events.length,
      totalSubscriptions: this.subscriptions.size,
    };
  }

  private deliver(event: TaskMailboxEvent): void {
    for (const subscription of this.subscriptions.values()) {
      if (!matchesTaskMailboxFilter(event, subscription.filter)) {
        continue;
      }

      void subscription.callback(event);
    }
  }
}

// ============================================================================
// Topic Constants
// ============================================================================

export const MailboxTopics = {
  /** Task delegation messages */
  TASK_DELEGATE: "task/delegate",
  /** Task completion messages */
  TASK_COMPLETE: "task/complete",
  /** Task failure messages */
  TASK_FAIL: "task/fail",
  /** Progress updates */
  TASK_PROGRESS: "task/progress",
  /** Status updates */
  STATUS_UPDATE: "status/update",
  /** Resource requests */
  RESOURCE_REQUEST: "resource/request",
  /** Resource responses */
  RESOURCE_RESPONSE: "resource/response",
  /** Shutdown signals */
  SHUTDOWN: "system/shutdown",
  /** Health checks */
  HEALTH: "system/health",
  /** Task notification envelope */
  TASK_NOTIFICATION: "task.notification",
  /** Task submitted notification */
  TASK_SUBMITTED: "task.submitted",
  /** Task completed notification */
  TASK_COMPLETED: "task.completed",
  /** Task failed notification */
  TASK_FAILED: "task.failed",
  /** Task canceled notification */
  TASK_CANCELED: "task.canceled",
  /** Direct message notification */
  MESSAGE_SENT: "message.sent",
} as const;

// ============================================================================
// Exports
// ============================================================================
