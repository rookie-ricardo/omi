/**
 * Plan Mode - 只读计划阶段的安全机制
 *
 * 通过 EnterPlan/ExitPlan 实现：
 * 1. 进入时：切换到只读模式，只允许使用 isReadOnly() 为 true 的工具
 * 2. 退出时：提交计划文件供用户审批，支持 allowedPrompts 机制
 */

import { randomUUID } from "node:crypto";
import { nowIso } from "@omi/core";
import { READ_TOOLS } from "../permissions/rules";

// ============================================================================
// Types
// ============================================================================

/**
 * Plan mode permission context
 */
export interface PlanPermissionContext {
	mode: "plan";
	allowedPrompts?: AllowedPrompt[];
	previousMode?: AgentMode;
}

/**
 * Agent 运行模式
 */
export type AgentMode = "default" | "plan" | "auto" | "manual";

/**
 * allowedPrompts 中声明的命令类别
 */
export interface AllowedPrompt {
	tool: "Bash" | "Edit" | "Write" | string;
	prompt: string;
}

/**
 * Plan 状态
 */
export interface PlanState {
	isInPlanMode: boolean;
	planFilePath?: string;
	planContent?: string;
	allowedPrompts: AllowedPrompt[];
	planWasEdited: boolean;
	enteredAt?: string;
	previousMode?: AgentMode;
}

/**
 * Plan Mode 事件类型
 */
export type PlanModeEventType = "enter_plan" | "exit_plan" | "submit_plan" | "approve_plan";

/**
 * Plan Mode 事件
 */
export interface PlanModeEvent {
	type: PlanModeEventType;
	sessionId: string;
	timestamp: string;
	planFilePath?: string;
	allowedPrompts?: AllowedPrompt[];
	approved?: boolean;
	planWasEdited?: boolean;
}

/**
 * Plan Mode 事件处理器
 */
export type PlanModeEventHandler = (event: PlanModeEvent) => void;

// ============================================================================
// Plan State Manager
// ============================================================================

/**
 * Plan Mode 状态管理器
 * 管理 plan mode 的进入/退出状态和权限上下文
 */
export class PlanStateManager {
	private state: PlanState = {
		isInPlanMode: false,
		allowedPrompts: [],
		planWasEdited: false,
	};

	private eventHandlers: PlanModeEventHandler[] = [];

	/**
	 * 检查当前是否处于 Plan Mode
	 */
	isInPlanMode(): boolean {
		return this.state.isInPlanMode;
	}

	/**
	 * 获取当前 Plan 状态
	 */
	getState(): Readonly<PlanState> {
		return this.state;
	}

	/**
	 * 进入 Plan Mode
	 */
	enterPlanMode(previousMode: AgentMode = "default"): PlanPermissionContext {
		if (this.state.isInPlanMode) {
			throw new Error("Already in plan mode");
		}

		const timestamp = nowIso();
		this.state = {
			...this.state,
			isInPlanMode: true,
			enteredAt: timestamp,
			previousMode,
			allowedPrompts: [],
			planWasEdited: false,
		};

		const context: PlanPermissionContext = {
			mode: "plan",
			allowedPrompts: [...this.state.allowedPrompts],
			previousMode,
		};

		this.emitEvent({
			type: "enter_plan",
			sessionId: "",
			timestamp,
			allowedPrompts: [...this.state.allowedPrompts],
			planFilePath: this.state.planFilePath,
			planWasEdited: this.state.planWasEdited,
		});

		return context;
	}

	/**
	 * 退出 Plan Mode
	 */
	exitPlanMode(): {
		previousMode: AgentMode;
		allowedPrompts: AllowedPrompt[];
	} {
		if (!this.state.isInPlanMode) {
			throw new Error("Not in plan mode");
		}

		const previousMode = this.state.previousMode ?? "default";
		const allowedPrompts = [...this.state.allowedPrompts];
		const planFilePath = this.state.planFilePath;
		const planWasEdited = this.state.planWasEdited;

		this.state = {
			isInPlanMode: false,
			planFilePath: undefined,
			planContent: undefined,
			allowedPrompts: [],
			planWasEdited: false,
			previousMode: undefined,
		};

		this.emitEvent({
			type: "exit_plan",
			sessionId: "",
			timestamp: nowIso(),
			allowedPrompts,
			planFilePath,
			planWasEdited,
		});

		return { previousMode, allowedPrompts };
	}

	/**
	 * 设置计划内容
	 */
	setPlanContent(content: string, filePath?: string): void {
		this.state.planContent = content;
		this.state.planFilePath = filePath;
	}

	/**
	 * 设置允许的 prompts
	 */
	setAllowedPrompts(prompts: AllowedPrompt[]): void {
		this.state.allowedPrompts = [...prompts];
	}

	/**
	 * 获取允许的 prompts
	 */
	getAllowedPrompts(): AllowedPrompt[] {
		return [...this.state.allowedPrompts];
	}

	/**
	 * 标记计划已被编辑
	 */
	markPlanEdited(): void {
		this.state.planWasEdited = true;
	}

	/**
	 * 检查计划是否被编辑过
	 */
	wasPlanEdited(): boolean {
		return this.state.planWasEdited;
	}

	/**
	 * 获取 Plan Mode 权限上下文
	 */
	getPermissionContext(): PlanPermissionContext {
		return {
			mode: "plan",
			allowedPrompts: [...this.state.allowedPrompts],
			previousMode: this.state.previousMode,
		};
	}

	/**
	 * 订阅事件
	 */
	onEvent(handler: PlanModeEventHandler): () => void {
		this.eventHandlers.push(handler);
		return () => {
			const index = this.eventHandlers.indexOf(handler);
			if (index !== -1) {
				this.eventHandlers.splice(index, 1);
			}
		};
	}

	private emitEvent(event: PlanModeEvent): void {
		for (const handler of this.eventHandlers) {
			try {
				handler(event);
			} catch {
				// Ignore handler errors
			}
		}
	}
}

// ============================================================================
// Plan Mode 工具辅助函数
// ============================================================================

/**
 * 判断工具是否是只读的（可以在 Plan Mode 下使用）
 */
export function isReadOnlyTool(toolName: string): boolean {
	return READ_TOOLS.has(toolName);
}

/**
 * 检查工具是否可以在当前模式下执行
 */
export function canExecuteTool(toolName: string, mode: AgentMode | PlanPermissionContext): boolean {
	if (mode === "plan" || (typeof mode === "object" && mode.mode === "plan")) {
		return isReadOnlyTool(toolName);
	}
	return true;
}

/**
 * 验证 allowed prompt 格式
 */
export function validateAllowedPrompt(prompt: AllowedPrompt): boolean {
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

// ============================================================================
// Singleton instance
// ============================================================================

let planStateManagerInstance: PlanStateManager | null = null;

export function getPlanStateManager(): PlanStateManager {
	if (!planStateManagerInstance) {
		planStateManagerInstance = new PlanStateManager();
	}
	return planStateManagerInstance;
}

export function createPlanStateManager(): PlanStateManager {
	planStateManagerInstance = new PlanStateManager();
	return planStateManagerInstance;
}

// ============================================================================
// Exports
// ============================================================================

export {
	PlanStateManager as default,
};
