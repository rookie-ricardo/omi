/**
 * Run modes for the omi agent.
 */

export { runPrintMode, type PrintModeOptions } from "./print-mode";
export { runInteractiveMode, type InteractiveModeOptions } from "./interactive";
export {
  runRpcMode,
  RpcClient,
  type RpcClientOptions,
  type RpcEventListener,
} from "./rpc";
export type {
  RpcCommand,
  RpcSlashCommand,
  RpcSessionState,
  RpcResponse,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  RpcCommandType,
} from "./rpc/rpc-types";

// Plan Mode
export {
  PlanStateManager,
  getPlanStateManager,
  createPlanStateManager,
  isReadOnlyTool,
  canExecuteTool,
  validateAllowedPrompt,
  type PlanState,
  type PlanPermissionContext,
  type AllowedPrompt,
  type AgentMode,
  type PlanModeEvent,
  type PlanModeEventHandler,
} from "./plan-mode";

// Worktree Mode
export {
  WorktreeStateManager,
  getWorktreeStateManager,
  createWorktreeStateManager,
  type WorktreeState,
  type WorktreeCreateOptions,
  type WorktreeCreateResult,
  type WorktreeChanges,
  type ExitWorktreeOptions,
  type WorktreeEvent,
  type WorktreeEventHandler,
} from "./worktree-mode";
