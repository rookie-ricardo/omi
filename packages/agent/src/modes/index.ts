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
export { PlanMode, createPlanModeDenial, isPlanModeDenial, type ToolDenial } from "./plan-mode";
export type {
  PlanModeStatus,
  PlanModeState,
  PlanStep,
  PlanModeConfig,
  ApprovalRule,
} from "./plan-mode";

// Worktree Mode
export { WorktreeMode } from "./worktree-mode";
export type {
  WorktreeStatus,
  WorktreeInfo,
  WorktreeConfig,
  WorktreeChangeDetection,
  WorktreeLifecycleEvents,
} from "./worktree-mode";
