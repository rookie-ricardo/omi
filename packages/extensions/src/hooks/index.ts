/**
 * Hook System — Public API
 */

export type {
	HookEvent,
	HookDefinition,
	HookInput,
	HookOutput,
	HookConfig,
} from "./types.js";

export { HOOK_EVENTS } from "./types.js";

export {
	HookRegistry,
	createHookRegistry,
	shouldBlock,
	collectMessages,
	getModifiedInput,
	getBlockReason,
	collectPermissionUpdates,
} from "./registry.js";

export { executeShellHook } from "./shell-hook.js";
