import type { AgentToolResult } from "@mariozechner/pi-agent-core";

import type { Message } from "@mariozechner/pi-ai";
import type { RuntimeMessage } from "@omi/memory";

export interface ExtensionEvent {
  type: string;
  payload: Record<string, unknown>;
}

export interface ExtensionRunInput {
  prompt: string;
  sessionId: string;
  workspaceRoot: string;
  systemPrompt: string;
  messages: Message[];
}

export interface ExtensionContext {
  workspaceRoot: string;
  onEvent(handler: (event: ExtensionEvent) => void | Promise<void>): () => void;
  appendSystemPrompt(fragment: string): void;
  appendRuntimeMessage(message: RuntimeMessage): void;
}

export interface ExtensionDefinition {
  name: string;
  setup?(context: ExtensionContext): void | Promise<void>;
  beforeRun?(input: ExtensionRunInput, context: ExtensionContext): void | Promise<void>;
  onEvent?(event: ExtensionEvent, context: ExtensionContext): void | Promise<void>;
}

export interface ExtensionFactoryInput {
  workspaceRoot: string;
  extensionDir: string;
}

export type ExtensionFactory =
  | ExtensionDefinition
  | ((input: ExtensionFactoryInput) => ExtensionDefinition | Promise<ExtensionDefinition>);

export interface ExtensionRunnerState {
  systemPromptFragments: string[];
  runtimeMessages: RuntimeMessage[];
}

export interface ExtensionRuntimeResult {
  systemPrompt: string;
  messages: Message[];
  diagnostics: string[];
}

export type ExtensionToolResult = AgentToolResult<unknown>;
