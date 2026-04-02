import { describe, it, expect, beforeEach } from "vitest";
import { TaskMailbox, createTaskSubmittedEvent, createTaskCompletedEvent } from "../../src/task-mailbox";

describe("TaskMailbox", () => {
  let mailbox: TaskMailbox;

  beforeEach(() => {
    mailbox = new TaskMailbox();
  });

  describe("publish", () => {
    it("should publish an event and return an ID", () => {
      const eventId = mailbox.publish({
        type: "task.submitted",
        senderId: "agent-1",
        payload: { taskId: "task-1", task: "Test task" },
      });

      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe("string");
    });

    it("should store event in queue", () => {
      mailbox.publish({
        type: "task.submitted",
        senderId: "agent-1",
        payload: { taskId: "task-1", task: "Test task" },
      });

      const events = mailbox.query({ type: "task.submitted" });
      expect(events).toHaveLength(1);
    });
  });

  describe("publishTaskNotification", () => {
    it("should publish task submitted notification", () => {
      const eventId = mailbox.publishTaskNotification("submitted", "agent-1", "task-1", {});

      expect(eventId).toBeDefined();
      const events = mailbox.query({ type: "task.submitted" });
      expect(events).toHaveLength(1);
      expect(events[0].payload).toHaveProperty("taskId", "task-1");
    });

    it("should publish task completed notification", () => {
      mailbox.publishTaskNotification("completed", "agent-1", "task-1", { result: "success" });

      const events = mailbox.query({ type: "task.completed" });
      expect(events).toHaveLength(1);
    });
  });

  describe("sendMessage", () => {
    it("should send a message to a recipient", () => {
      const eventId = mailbox.sendMessage("sender-1", "recipient-1", "Hello!");

      expect(eventId).toBeDefined();
      // Query for message.sent events to the recipient
      const messages = mailbox.query({ type: "message.sent", recipientId: "recipient-1" });
      expect(messages).toHaveLength(1);
    });
  });

  describe("subscribe", () => {
    it("should subscribe to events by type", () => {
      const testMailbox = new TaskMailbox();
      let received = 0;
      testMailbox.subscribe({ type: "task.completed" }, () => {
        received++;
      });

      // Publish two completed events
      testMailbox.publish({
        type: "task.completed",
        senderId: "agent-1",
        payload: { taskId: "task-1" },
      });
      testMailbox.publish({
        type: "task.completed",
        senderId: "agent-1",
        payload: { taskId: "task-2" },
      });

      // Verify handler was called (at least once per event)
      expect(received).toBeGreaterThanOrEqual(2);
    });

    it("should subscribe to events by sender", () => {
      let received = 0;
      mailbox.subscribe({ senderId: "agent-1" }, () => {
        received++;
      });

      mailbox.publish({
        type: "task.submitted",
        senderId: "agent-1",
        payload: {},
      });
      mailbox.publish({
        type: "task.submitted",
        senderId: "agent-2",
        payload: {},
      });

      expect(received).toBe(1);
    });

    it("should return subscription ID", () => {
      const subId = mailbox.subscribe({ type: "task.submitted" }, () => {});
      expect(subId).toBeDefined();
    });
  });

  describe("unsubscribe", () => {
    it("should remove subscription", () => {
      let received = 0;
      const subId = mailbox.subscribe({ type: "task.completed" }, () => {
        received++;
      });

      mailbox.unsubscribe(subId);

      mailbox.publishTaskNotification("completed", "agent-1", "task-1", {});
      expect(received).toBe(0);
    });
  });

  describe("query", () => {
    it("should filter events by type", () => {
      mailbox.publish({
        type: "task.submitted",
        senderId: "agent-1",
        payload: {},
      });
      mailbox.publish({
        type: "task.completed",
        senderId: "agent-1",
        payload: {},
      });

      const submitted = mailbox.query({ type: "task.submitted" });
      expect(submitted).toHaveLength(1);
    });

    it("should support multiple types", () => {
      mailbox.publish({ type: "task.submitted", senderId: "a", payload: {} });
      mailbox.publish({ type: "task.completed", senderId: "a", payload: {} });
      mailbox.publish({ type: "agent.heartbeat", senderId: "a", payload: {} });

      const taskEvents = mailbox.query({ type: ["task.submitted", "task.completed"] });
      expect(taskEvents).toHaveLength(2);
    });

    it("should limit results", () => {
      for (let i = 0; i < 10; i++) {
        mailbox.publish({ type: "task.submitted", senderId: "a", payload: { i } });
      }

      const limited = mailbox.query({ type: "task.submitted" }, 5);
      expect(limited).toHaveLength(5);
    });
  });
});

describe("createTaskSubmittedEvent", () => {
  it("should create a task submitted event", () => {
    const event = createTaskSubmittedEvent("agent-1", "task-1", "Test task", {
      priority: 5,
      deadline: 60000,
    });

    expect(event.type).toBe("task.submitted");
    expect(event.senderId).toBe("agent-1");
    expect(event.payload.taskId).toBe("task-1");
    expect(event.payload.task).toBe("Test task");
    expect(event.payload.priority).toBe(5);
    expect(event.payload.deadline).toBe(60000);
  });
});

describe("createTaskCompletedEvent", () => {
  it("should create a task completed event", () => {
    const event = createTaskCompletedEvent("agent-1", "task-1", { result: "success" }, "corr-1");

    expect(event.type).toBe("task.completed");
    expect(event.correlationId).toBe("corr-1");
    expect(event.payload.taskId).toBe("task-1");
    expect(event.payload.result).toEqual({ result: "success" });
  });
});
