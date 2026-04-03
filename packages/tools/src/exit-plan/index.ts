/**
 * ExitPlan Tool - 退出计划模式
 *
 * 用于提交计划供用户审批，支持 allowedPrompts 机制：
 * - 声明计划中需要执行的命令类别
 * - 用户批准后自动放行这些命令
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";

export const exitPlanSchema = Type.Object({
	plan: Type.String({
		description: "The plan to submit for user approval. Describe the changes to be made and the steps to implement.",
	}),
	plan_file_path: Type.Optional(
		Type.String({
			description: "Path to the plan file (if saved to disk)",
		}),
	),
	allowed_prompts: Type.Optional(
		Type.Array(
			Type.Object({
				tool: Type.String({
					description: "Tool name (e.g., 'Bash', 'Edit', 'Write')",
				}),
				prompt: Type.String({
					description: "Semantic description of the command category (e.g., 'run tests', 'install dependencies')",
				}),
			}),
			{
				description: "List of command categories that should be auto-approved when user accepts the plan",
			},
		),
	),
});

export type ExitPlanInput = typeof exitPlanSchema.static;

interface AllowedPrompt {
	tool: string;
	prompt: string;
}

interface ExitPlanStateManager {
	isInPlanMode(): boolean;
	setPlanContent(content: string, filePath?: string): void;
	setAllowedPrompts(prompts: AllowedPrompt[]): void;
	exitPlanMode(): { previousMode: string; allowedPrompts: AllowedPrompt[] };
}

let exitPlanStateInstance: ExitPlanStateManager = {
	isInPlanMode: () => false,
	setPlanContent: () => {},
	setAllowedPrompts: () => {},
	exitPlanMode: () => ({ previousMode: "default", allowedPrompts: [] }),
};

export function setExitPlanStateManager(manager: ExitPlanStateManager): void {
	exitPlanStateInstance = manager;
}

function validateAllowedPrompt(prompt: AllowedPrompt): boolean {
	if (!prompt.tool || typeof prompt.tool !== "string") {
		return false;
	}
	if (!prompt.prompt || typeof prompt.prompt !== "string") {
		return false;
	}
	if (prompt.prompt.length < 3 || prompt.prompt.length > 200) {
		return false;
	}
	return true;
}

/**
 * 创建 ExitPlanTool
 *
 * 使用场景：
 * - AI 完成探索，提交计划供用户审批
 * - 声明需要执行的命令类别
 */
export function createExitPlanTool(sessionId: string): AgentTool {
	return {
		name: "plan.exit",
		label: "plan.exit",
		description:
			"Exit plan mode and submit the plan for user approval. The plan will be reviewed by the user, and if approved, you will be able to execute the planned changes. Optionally, you can declare allowed_prompts to auto-approve specific command categories.",

		parameters: exitPlanSchema,

		execute: async (
			_toolCallId: string,
			params: unknown,
		) => {
			const input = params as ExitPlanInput;

			if (!exitPlanStateInstance.isInPlanMode()) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Not in plan mode. Use plan.enter first.",
						},
					],
					details: {},
				};
			}

			// 验证并设置 allowed prompts
			const allowedPrompts: AllowedPrompt[] = [];
			if (input.allowed_prompts) {
				for (const prompt of input.allowed_prompts) {
					if (validateAllowedPrompt(prompt)) {
						allowedPrompts.push(prompt as AllowedPrompt);
					}
				}
			}

			// 保存计划内容
			exitPlanStateInstance.setPlanContent(input.plan, input.plan_file_path);
			exitPlanStateInstance.setAllowedPrompts(allowedPrompts);

			// 退出 plan mode
			const { previousMode, allowedPrompts: finalPrompts } = exitPlanStateInstance.exitPlanMode();

			return {
				content: [
					{
						type: "text" as const,
						text: `Plan submitted for approval:\n\n${input.plan}\n\nAllowed prompts: ${
							finalPrompts.length > 0
								? finalPrompts.map((p: AllowedPrompt) => `${p.tool}: "${p.prompt}"`).join(", ")
								: "none"
						}\n\nOnce approved, you can execute the planned changes. Mode will be restored to: ${previousMode}`,
					},
				],
				details: {
					planLength: input.plan.length,
					allowedPrompts: finalPrompts,
					previousMode,
				},
			};
		},
	};
}

export const exitPlanTool = createExitPlanTool("");
