/**
 * EnterPlan Tool - 进入计划模式
 *
 * 用于 AI 自主判断需要规划时调用，进入只读的计划阶段。
 * 需要用户审批（checkPermissions 返回 ask）。
 */

import type { OmiTool } from "@omi/core";
import { Type } from "@mariozechner/pi-ai";

export const enterPlanSchema = Type.Object({
	reason: Type.Optional(
		Type.String({
			description: "Reason for entering plan mode (optional, shown to user)",
		}),
	),
});

export type EnterPlanInput = typeof enterPlanSchema.static;

type AgentMode = "default" | "plan" | "auto" | "manual";

interface PlanPermissionContext {
	mode: "plan";
	previousMode?: AgentMode;
}

interface PlanStateManager {
	isInPlanMode: () => boolean;
	enterPlanMode: (previousMode?: AgentMode) => PlanPermissionContext;
}

// Singleton instance for plan state
let planStateInstance: PlanStateManager = {
	isInPlanMode: () => false,
	enterPlanMode: () => ({ mode: "plan" as const }),
};

export function setPlanStateManager(manager: PlanStateManager): void {
	planStateInstance = manager;
}

/**
 * 创建 EnterPlanTool
 *
 * 使用场景：
 * - AI 自主判断任务复杂，需要先规划
 * - 用户要求 AI "先制定计划"
 */
export function createEnterPlanTool(sessionId: string): OmiTool {
	return {
		name: "plan.enter",
		label: "plan.enter",
		description: `Enter plan mode to explore the codebase and create a plan before making changes.

When to use:
- New features that require understanding existing architecture
- Tasks with multiple possible approaches that need evaluation
- Multi-file changes where order and dependencies matter
- Unclear requirements that need exploration before implementation

When NOT to use:
- Single-line fixes or trivial changes
- Tasks where the user gave specific, clear instructions
- Simple bug fixes with obvious solutions

What happens in plan mode:
- You can only use read-only tools (read, grep, glob, ls, ask_user)
- Write/edit/bash operations are blocked until you exit plan mode
- Use this time to understand the codebase, then call plan.exit with your plan`,

		parameters: enterPlanSchema,

		execute: async (
			_toolCallId: string,
			params: unknown,
		) => {
			const input = params as EnterPlanInput;

			if (planStateInstance.isInPlanMode()) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Already in plan mode. Use plan.exit to exit.",
						},
					],
					details: {},
				};
			}

			const reason = input.reason ?? "Task requires planning";
			const context = planStateInstance.enterPlanMode("default");

			return {
				content: [
					{
						type: "text" as const,
						text: `Entered plan mode. Reason: ${reason}\n\nYou can now use read-only tools to explore the codebase. When ready, call plan.exit with your plan.`,
					},
				],
				details: {
					reason,
					mode: context.mode,
				},
			};
		},
	};
}

export const enterPlanTool = createEnterPlanTool("");
