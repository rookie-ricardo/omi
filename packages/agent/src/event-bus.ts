/**
 * 事件总线 - 组件间通信
 *
 * 提供统一的事件发布/订阅机制，用于：
 * - 组件间解耦通信
 * - 观测性事件分发
 * - 遥测数据收集
 */

import { EventEmitter } from "node:events";

// ============================================================================
// Types
// ============================================================================

/**
 * 事件处理器
 */
export type EventHandler<T = unknown> = (data: T) => void;

/**
 * 事件总线接口
 */
export interface EventBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

/**
 * 事件总线控制器接口
 */
export interface EventBusController extends EventBus {
	/** 获取订阅者数量 */
	listenerCount(channel: string): number;
	/** 清空所有订阅者 */
	clear(): void;
}

// ============================================================================
// Implementation
// ============================================================================

export function createEventBus(): EventBusController {
	const emitter = new EventEmitter();
	// 设置最大监听器数量以避免内存泄漏警告
	emitter.setMaxListeners(100);

	return {
		emit: (channel: string, data: unknown) => {
			emitter.emit(channel, data);
		},
		on: (channel: string, handler: (data: unknown) => void) => {
			const safeHandler = async (data: unknown) => {
				try {
					await handler(data);
				} catch (err) {
					console.error(`Event handler error (${channel}):`, err);
				}
			};
			emitter.on(channel, safeHandler);
			return () => emitter.off(channel, safeHandler);
		},
		listenerCount: (channel: string) => emitter.listenerCount(channel),
		clear: () => {
			emitter.removeAllListeners();
		},
	};
}

// ============================================================================
// Global Event Bus
// ============================================================================

let globalEventBus: EventBusController | null = null;

/**
 * 获取全局事件总线实例
 */
export function getGlobalEventBus(): EventBusController {
	if (!globalEventBus) {
		globalEventBus = createEventBus();
	}
	return globalEventBus;
}

/**
 * 设置全局事件总线实例
 */
export function setGlobalEventBus(eventBus: EventBusController): void {
	globalEventBus = eventBus;
}

/**
 * 重置全局事件总线
 */
export function resetGlobalEventBus(): void {
	globalEventBus?.clear();
	globalEventBus = null;
}
