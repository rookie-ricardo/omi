// Local type definitions - extensions package has minimal dependencies
// These match the shapes used from @omi/memory and @mariozechner/pi-ai

/** Minimal message type for extension context */
export interface ExtensionMessage {
  role: string;
  content: unknown;
  timestamp: number;
}

/** Minimal runtime message compatible with @omi/memory RuntimeMessage */
export type RuntimeMessage = ExtensionMessage;

/** Minimal tool result type */
export interface ExtensionToolResult {
  content: unknown;
  isError?: boolean;
}

export interface ExtensionEvent {
  type: string;
  payload: Record<string, unknown>;
}

export interface ExtensionRunInput {
  prompt: string;
  sessionId: string;
  workspaceRoot: string;
  systemPrompt: string;
  messages: ExtensionMessage[];
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
  messages: ExtensionMessage[];
  diagnostics: string[];
}
