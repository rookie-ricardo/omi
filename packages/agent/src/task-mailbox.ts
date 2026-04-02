/**
 * Task Mailbox Protocol
 *
 * Implements task-notification style events for sub-agent communication.
 * Supports:
 * - Async task notifications
 * - Event-driven coordination
 * - Message queuing and delivery
 */

import { createId, nowIso } from "@omi/core";

// ============================================================================
// Types
// ============================================================================

export type MailboxEventType =
  | "task.submitted"
  | "task.started"
  | "task.progress"
  | "task.completed"
  | "task.failed"
  | "task.canceled"
  | "task.result"
  | "message.sent"
  | "message.received"
  | "agent.heartbeat"
  | "agent.status";

export interface MailboxEvent<T = unknown> {
  id: string;
  type: MailboxEventType;
  senderId: string;
  recipientId?: string;
  timestamp: string;
  payload: T;
  correlationId?: string;
  replyTo?: string;
}

export interface TaskSubmittedPayload {
  taskId: string;
  task: string;
  priority?: number;
  deadline?: number;
}

export interface TaskProgressPayload {
  taskId: string;
  progress: number;
  message?: string;
}

export interface TaskCompletedPayload {
  taskId: string;
  result: unknown;
  duration?: number;
}

export interface TaskFailedPayload {
  taskId: string;
  error: string;
  recoverable?: boolean;
}

export interface TaskCanceledPayload {
  taskId: string;
  reason?: string;
}

export interface MessagePayload {
  messageId: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface HeartbeatPayload {
  agentId: string;
  status: string;
  load?: number;
}

// ============================================================================
// Mailbox
// ============================================================================

export interface MailboxOptions {
  maxQueueSize?: number;
  defaultTtl?: number;
  persistent?: boolean;
}

export interface MailboxSubscription {
  id: string;
  filter: EventFilter;
  handler: EventHandler;
}

export interface EventFilter {
  type?: MailboxEventType | MailboxEventType[];
  senderId?: string | string[];
  recipientId?: string | string[];
  correlationId?: string;
}

export type EventHandler = (event: MailboxEvent) => void | Promise<void>;

/**
 * Mailbox for task notification style events.
 */
export class TaskMailbox {
  private queue: MailboxEvent[] = [];
  private subscriptions: Map<string, MailboxSubscription> = new Map();
  private handlers: Map<MailboxEventType, Set<EventHandler>> = new Map();
  private deliveryConfirmations: Map<string, (confirmed: boolean) => void> = new Map();
  private readonly maxQueueSize: number;
  private readonly defaultTtl: number;

  constructor(options: MailboxOptions = {}) {
    this.maxQueueSize = options.maxQueueSize ?? 1000;
    this.defaultTtl = options.defaultTtl ?? 3600000;
  }

  // ==========================================================================
  // Event Publishing
  // ==========================================================================

  publish<T>(event: Omit<MailboxEvent<T>, "id" | "timestamp">): string {
    const id = createId("event");
    const fullEvent: MailboxEvent<T> = {
      ...event,
      id,
      timestamp: nowIso(),
    };

    this.queue.push(fullEvent);
    if (this.queue.length > this.maxQueueSize) {
      this.queue.shift();
    }

    this.deliver(fullEvent);
    return id;
  }

  publishTaskNotification(
    type: "submitted" | "started" | "progress" | "completed" | "failed" | "canceled",
    senderId: string,
    taskId: string,
    payload: Record<string, unknown>,
  ): string {
    const eventType = `task.${type}` as MailboxEventType;
    return this.publish({
      type: eventType,
      senderId,
      payload: { taskId, ...payload } as any,
    });
  }

  sendMessage(
    senderId: string,
    recipientId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): string {
    const messageId = createId("msg");
    return this.publish({
      type: "message.sent",
      senderId,
      recipientId,
      payload: { messageId, content, metadata } as MessagePayload,
    });
  }

  sendHeartbeat(agentId: string, status: string, load?: number): string {
    return this.publish({
      type: "agent.heartbeat",
      senderId: agentId,
      payload: { agentId, status, load } as HeartbeatPayload,
    });
  }

  // ==========================================================================
  // Subscription Management
  // ==========================================================================

  subscribe(filter: EventFilter, handler: EventHandler): string {
    const id = createId("sub");
    const subscription: MailboxSubscription = { id, filter, handler };
    this.subscriptions.set(id, subscription);

    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      for (const type of types) {
        if (!this.handlers.has(type)) {
          this.handlers.set(type, new Set());
        }
        this.handlers.get(type)!.add(handler);
      }
    }

    return id;
  }

  unsubscribe(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return;

    if (subscription.filter.type) {
      const types = Array.isArray(subscription.filter.type)
        ? subscription.filter.type
        : [subscription.filter.type];
      for (const type of types) {
        this.handlers.get(type)?.delete(subscription.handler);
      }
    }

    this.subscriptions.delete(subscriptionId);
  }

  clearSubscriptions(): void {
    this.subscriptions.clear();
    this.handlers.clear();
  }

  // ==========================================================================
  // Query
  // ==========================================================================

  query(filter: EventFilter, limit = 100): MailboxEvent[] {
    return this.queue
      .filter((event) => this.matchesFilter(event, filter))
      .slice(-limit);
  }

  getMessagesFor(recipientId: string): MailboxEvent<MessagePayload>[] {
    return this.query({
      type: "message.received",
      recipientId,
    }) as MailboxEvent<MessagePayload>[];
  }

  getAgentStatus(agentId: string): MailboxEvent[] {
    return this.query({
      type: ["agent.status", "agent.heartbeat"],
      senderId: agentId,
    }).slice(-10);
  }

  waitForDelivery(eventId: string, timeoutMs = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.deliveryConfirmations.delete(eventId);
        resolve(false);
      }, timeoutMs);

      this.deliveryConfirmations.set(eventId, (confirmed) => {
        clearTimeout(timeout);
        resolve(confirmed);
      });
    });
  }

  private deliver(event: MailboxEvent): void {
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          handler(event);
        } catch {
          // Ignore handler errors
        }
      }
    }

    for (const subscription of this.subscriptions.values()) {
      if (this.matchesFilter(event, subscription.filter)) {
        try {
          subscription.handler(event);
        } catch {
          // Ignore handler errors
        }
      }
    }

    const confirm = this.deliveryConfirmations.get(event.id);
    if (confirm) {
      this.deliveryConfirmations.delete(event.id);
      confirm(true);
    }
  }

  private matchesFilter(event: MailboxEvent, filter: EventFilter): boolean {
    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      if (!types.includes(event.type)) return false;
    }

    if (filter.senderId) {
      const senders = Array.isArray(filter.senderId) ? filter.senderId : [filter.senderId];
      if (!senders.includes(event.senderId)) return false;
    }

    if (filter.recipientId) {
      const recipients = Array.isArray(filter.recipientId)
        ? filter.recipientId
        : [filter.recipientId];
      if (!event.recipientId || !recipients.includes(event.recipientId)) return false;
    }

    if (filter.correlationId && event.correlationId !== filter.correlationId) {
      return false;
    }

    return true;
  }
}

// ============================================================================
// Event Factory
// ============================================================================

export function createTaskSubmittedEvent(
  senderId: string,
  taskId: string,
  task: string,
  options?: { priority?: number; deadline?: number },
): Omit<MailboxEvent<TaskSubmittedPayload>, "id" | "timestamp"> {
  return {
    type: "task.submitted",
    senderId,
    payload: { taskId, task, priority: options?.priority, deadline: options?.deadline },
  };
}

export function createTaskCompletedEvent(
  senderId: string,
  taskId: string,
  result: unknown,
  correlationId?: string,
): Omit<MailboxEvent<TaskCompletedPayload>, "id" | "timestamp"> {
  return {
    type: "task.completed",
    senderId,
    correlationId,
    payload: { taskId, result },
  };
}

export function createTaskFailedEvent(
  senderId: string,
  taskId: string,
  error: string,
  recoverable = false,
  correlationId?: string,
): Omit<MailboxEvent<TaskFailedPayload>, "id" | "timestamp"> {
  return {
    type: "task.failed",
    senderId,
    correlationId,
    payload: { taskId, error, recoverable },
  };
}
