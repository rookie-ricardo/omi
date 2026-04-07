import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	HookRegistry,
	createHookRegistry,
	shouldBlock,
	collectMessages,
	getModifiedInput,
	getBlockReason,
	collectPermissionUpdates,
} from "../../src/hooks/registry";
import type { HookInput, HookOutput, HookConfig } from "../../src/hooks/types";

describe("HookRegistry", () => {
	let registry: HookRegistry;

	beforeEach(() => {
		registry = new HookRegistry();
	});

	describe("registration", () => {
		it("registers a single hook", () => {
			registry.register("PreToolUse", {
				handler: async () => ({ message: "hello" }),
			});
			expect(registry.hasHooks("PreToolUse")).toBe(true);
			expect(registry.hookCount("PreToolUse")).toBe(1);
		});

		it("registers multiple hooks for the same event", () => {
			registry.register("PreToolUse", { handler: async () => ({}) });
			registry.register("PreToolUse", { handler: async () => ({}) });
			expect(registry.hookCount("PreToolUse")).toBe(2);
		});

		it("registers from config object", () => {
			const config: HookConfig = {
				PreToolUse: [
					{ handler: async () => ({}) },
					{ handler: async () => ({}) },
				],
				PostToolUse: [
					{ handler: async () => ({}) },
				],
			};
			registry.registerFromConfig(config);
			expect(registry.hookCount("PreToolUse")).toBe(2);
			expect(registry.hookCount("PostToolUse")).toBe(1);
		});

		it("skips unknown event names in config", () => {
			const config = {
				InvalidEvent: [{ handler: async () => ({}) }],
				PreToolUse: [{ handler: async () => ({}) }],
			} as HookConfig;
			registry.registerFromConfig(config);
			expect(registry.hasHooks("PreToolUse")).toBe(true);
			expect(registry.getRegisteredEvents()).toEqual(["PreToolUse"]);
		});

		it("unregisters all hooks for an event", () => {
			registry.register("PreToolUse", { handler: async () => ({}) });
			registry.register("PreToolUse", { handler: async () => ({}) });
			registry.unregisterAll("PreToolUse");
			expect(registry.hasHooks("PreToolUse")).toBe(false);
		});

		it("clears all hooks", () => {
			registry.register("PreToolUse", { handler: async () => ({}) });
			registry.register("PostToolUse", { handler: async () => ({}) });
			registry.clear();
			expect(registry.getRegisteredEvents()).toEqual([]);
		});
	});

	describe("execution", () => {
		it("executes handler hooks and returns outputs", async () => {
			registry.register("PreToolUse", {
				handler: async () => ({ message: "hook1" }),
			});
			registry.register("PreToolUse", {
				handler: async () => ({ message: "hook2" }),
			});

			const results = await registry.execute("PreToolUse", {
				event: "PreToolUse",
				toolName: "bash",
			});

			expect(results).toHaveLength(2);
			expect(results[0].message).toBe("hook1");
			expect(results[1].message).toBe("hook2");
		});

		it("skips hooks that don't match tool name", async () => {
			registry.register("PreToolUse", {
				matcher: "bash",
				handler: async () => ({ message: "matched" }),
			});
			registry.register("PreToolUse", {
				matcher: "edit",
				handler: async () => ({ message: "skipped" }),
			});

			const results = await registry.execute("PreToolUse", {
				event: "PreToolUse",
				toolName: "bash",
			});

			expect(results).toHaveLength(1);
			expect(results[0].message).toBe("matched");
		});

		it("supports regex matchers", async () => {
			registry.register("PreToolUse", {
				matcher: "^(bash|edit)$",
				handler: async () => ({ message: "matched" }),
			});

			const bashResults = await registry.execute("PreToolUse", {
				event: "PreToolUse",
				toolName: "bash",
			});
			expect(bashResults).toHaveLength(1);

			const readResults = await registry.execute("PreToolUse", {
				event: "PreToolUse",
				toolName: "read",
			});
			expect(readResults).toHaveLength(0);
		});

		it("catches handler errors without crashing", async () => {
			registry.register("PreToolUse", {
				handler: async () => { throw new Error("boom"); },
			});
			registry.register("PreToolUse", {
				handler: async () => ({ message: "ok" }),
			});

			const results = await registry.execute("PreToolUse", {
				event: "PreToolUse",
			});

			expect(results).toHaveLength(1);
			expect(results[0].message).toBe("ok");
		});

		it("handles void handler returns", async () => {
			registry.register("PostToolUse", {
				handler: async () => { /* no return */ },
			});

			const results = await registry.execute("PostToolUse", {
				event: "PostToolUse",
			});

			expect(results).toHaveLength(0);
		});

		it("returns empty array for events with no hooks", async () => {
			const results = await registry.execute("SessionStart", {
				event: "SessionStart",
			});
			expect(results).toEqual([]);
		});

		it("enforces timeout on slow handlers", async () => {
			registry.register("PreToolUse", {
				timeout: 50,
				handler: async () => {
					await new Promise((r) => setTimeout(r, 200));
					return { message: "slow" };
				},
			});

			const results = await registry.execute("PreToolUse", {
				event: "PreToolUse",
			});

			expect(results).toHaveLength(0);
		});
	});

	describe("factory", () => {
		it("createHookRegistry creates registry with config", () => {
			const reg = createHookRegistry({
				SessionStart: [{ handler: async () => ({ message: "init" }) }],
			});
			expect(reg.hasHooks("SessionStart")).toBe(true);
		});
	});
});

describe("Hook result utilities", () => {
	const outputs: HookOutput[] = [
		{ message: "msg1" },
		{ block: true, blockReason: "dangerous" },
		{ modifiedInput: { command: "safe-command" } },
		{ permissionUpdate: { tool: "bash", behavior: "deny" } },
		{ message: "msg2" },
	];

	it("shouldBlock detects blocking", () => {
		expect(shouldBlock(outputs)).toBe(true);
		expect(shouldBlock([{ message: "ok" }])).toBe(false);
	});

	it("collectMessages gathers all messages", () => {
		expect(collectMessages(outputs)).toEqual(["msg1", "msg2"]);
	});

	it("getModifiedInput returns first modified input", () => {
		expect(getModifiedInput(outputs)).toEqual({ command: "safe-command" });
	});

	it("getBlockReason returns first block reason", () => {
		expect(getBlockReason(outputs)).toBe("dangerous");
	});

	it("collectPermissionUpdates gathers all permission changes", () => {
		const updates = collectPermissionUpdates(outputs);
		expect(updates).toEqual([{ tool: "bash", behavior: "deny" }]);
	});
});
