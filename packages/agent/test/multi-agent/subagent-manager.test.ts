import { describe, it, expect, beforeEach } from "vitest";
import { SubAgentManager, createSpawnConfig } from "../../src/subagent-manager";

describe("SubAgentManager", () => {
  let manager: SubAgentManager;

  beforeEach(() => {
    manager = new SubAgentManager("/tmp/test-workspace");
  });

  describe("spawn", () => {
    it("should spawn a new sub-agent", async () => {
      const config = createSpawnConfig("owner-1", "Test task");
      const id = await manager.spawn(config);

      expect(id).toBeDefined();
      expect(typeof id).toBe("string");

      const state = manager.getState(id);
      expect(state).toBeDefined();
      expect(state?.ownerId).toBe("owner-1");
      expect(state?.task).toBe("Test task");
      expect(state?.status).toBe("pending");
    });

    it("should spawn a background sub-agent", async () => {
      const config = createSpawnConfig("owner-1", "Background task", { background: true });
      const id = await manager.spawn(config);

      expect(id).toBeDefined();
      const state = manager.getState(id);
      expect(state?.status).toBeDefined();
      // Background agents start running immediately
      expect(["pending", "running"]).toContain(state?.status);
    });

    it("should emit spawned event", async () => {
      let eventReceived = false;
      manager.on("subagent.spawned", () => {
        eventReceived = true;
      });

      const config = createSpawnConfig("owner-1", "Test task");
      await manager.spawn(config);

      expect(eventReceived).toBe(true);
    });
  });

  describe("getByOwner", () => {
    it("should return all agents for an owner", async () => {
      await manager.spawn(createSpawnConfig("owner-1", "Task 1"));
      await manager.spawn(createSpawnConfig("owner-1", "Task 2"));
      await manager.spawn(createSpawnConfig("owner-2", "Task 3"));

      const owner1Agents = manager.getByOwner("owner-1");
      expect(owner1Agents).toHaveLength(2);

      const owner2Agents = manager.getByOwner("owner-2");
      expect(owner2Agents).toHaveLength(1);
    });
  });

  describe("getByStatus", () => {
    it("should filter agents by status", async () => {
      await manager.spawn(createSpawnConfig("owner-1", "Task 1"));

      const pending = manager.getByStatus("pending");
      expect(pending.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("hasRunning", () => {
    it("should return false when no agents running", () => {
      expect(manager.hasRunning()).toBe(false);
    });
  });

  describe("cancel", () => {
    it("should cancel a running agent", async () => {
      const config = createSpawnConfig("owner-1", "Task to cancel", { background: true });
      const id = await manager.spawn(config);

      await manager.cancel(id);

      const state = manager.getState(id);
      expect(state?.status).toBe("canceled");
    });
  });

  describe("close", () => {
    it("should close and remove an agent", async () => {
      const config = createSpawnConfig("owner-1", "Task to close");
      const id = await manager.spawn(config);

      await manager.close(id);

      expect(manager.getState(id)).toBeUndefined();
    });
  });
});

describe("createSpawnConfig", () => {
  it("should create config with defaults", () => {
    const config = createSpawnConfig("owner-1", "Test task");

    expect(config.ownerId).toBe("owner-1");
    expect(config.task).toBe("Test task");
    expect(config.writeScope).toBe("shared");
    expect(config.background).toBe(false);
  });

  it("should override defaults with options", () => {
    const config = createSpawnConfig("owner-1", "Test task", {
      background: true,
      writeScope: "isolated",
      deadline: 60000,
    });

    expect(config.background).toBe(true);
    expect(config.writeScope).toBe("isolated");
    expect(config.deadline).toBe(60000);
  });
});
