/**
 * Multi-Agent Module
 *
 * Exports coordinator and swarm implementations for multi-agent orchestration.
 */

export { CoordinatorAgent } from "./coordinator";
export type {
  CoordinatorStatus,
  CoordinatorTask,
  CoordinatorPlan,
  CoordinatorResult,
  CoordinatorOptions,
} from "./coordinator";

export { Swarm } from "./swarm";
export type {
  SwarmStatus,
  SwarmAgentStatus,
  SwarmTask,
  SwarmAgentInfo,
  SwarmConfig,
  SwarmResult,
} from "./swarm";
