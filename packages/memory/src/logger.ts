/**
 * 内存包结构化日志工具
 *
 * 轻量级日志封装，复用 agent 包的日志功能
 */

import { getLogger as getAgentLogger } from "@omi/agent/logger";

/**
 * 获取内存包的日志记录器
 */
export function getLogger(component: string) {
	return getAgentLogger(`memory:${component}`);
}
