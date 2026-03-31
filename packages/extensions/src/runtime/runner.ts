import type {
  ExtensionContext,
  ExtensionDefinition,
  ExtensionEvent,
  ExtensionRunInput,
  ExtensionRunnerState,
} from "./types";

export class ExtensionRunner {
  private readonly extensions: Array<{
    definition: ExtensionDefinition;
    context: ExtensionContext;
    initialized: boolean;
  }> = [];
  private readonly eventListeners = new Set<(event: ExtensionEvent) => void | Promise<void>>();
  private readonly state: ExtensionRunnerState = {
    systemPromptFragments: [],
    runtimeMessages: [],
  };
  private readonly diagnostics: string[] = [];

  constructor(readonly workspaceRoot: string) {}

  register(extension: ExtensionDefinition): void {
    const context = this.createContext();
    this.extensions.push({ definition: extension, context, initialized: false });
  }

  async load(extensions: ExtensionDefinition[]): Promise<void> {
    for (const extension of extensions) {
      this.register(extension);
    }

    await this.ensureInitialized();
  }

  async beforeRun(input: ExtensionRunInput): Promise<void> {
    await this.ensureInitialized();

    for (const { definition, context } of this.extensions) {
      if (!definition.beforeRun) {
        continue;
      }

      try {
        await definition.beforeRun(input, context);
      } catch (error) {
        this.diagnostics.push(formatError(definition.name, "beforeRun", error));
      }
    }
  }

  async emit(event: ExtensionEvent): Promise<void> {
    await this.ensureInitialized();

    for (const listener of this.eventListeners) {
      try {
        await listener(event);
      } catch (error) {
        this.diagnostics.push(formatError("listener", event.type, error));
      }
    }

    for (const { definition, context } of this.extensions) {
      if (!definition.onEvent) {
        continue;
      }

      try {
        await definition.onEvent(event, context);
      } catch (error) {
        this.diagnostics.push(formatError(definition.name, event.type, error));
      }
    }
  }

  getSystemPromptFragments(): string[] {
    return [...this.state.systemPromptFragments];
  }

  getRuntimeMessages() {
    return [...this.state.runtimeMessages];
  }

  getDiagnostics(): string[] {
    return [...this.diagnostics];
  }

  buildSystemPrompt(basePrompt = ""): string {
    const fragments = this.state.systemPromptFragments.filter((fragment) => fragment.trim().length > 0);
    if (fragments.length === 0) {
      return basePrompt;
    }

    return [basePrompt, ...fragments].filter((fragment) => fragment.trim().length > 0).join("\n\n");
  }

  private createContext(): ExtensionContext {
    return {
      workspaceRoot: this.workspaceRoot,
      onEvent: (handler) => {
        this.eventListeners.add(handler);
        return () => {
          this.eventListeners.delete(handler);
        };
      },
      appendSystemPrompt: (fragment) => {
        const trimmed = fragment.trim();
        if (trimmed.length > 0) {
          this.state.systemPromptFragments.push(trimmed);
        }
      },
      appendRuntimeMessage: (message) => {
        this.state.runtimeMessages.push(message);
      },
    };
  }

  private async ensureInitialized(): Promise<void> {
    for (const entry of this.extensions) {
      if (entry.initialized || !entry.definition.setup) {
        entry.initialized = true;
        continue;
      }

      try {
        await entry.definition.setup(entry.context);
      } catch (error) {
        this.diagnostics.push(formatError(entry.definition.name, "setup", error));
      } finally {
        entry.initialized = true;
      }
    }
  }
}

function formatError(scope: string, phase: string, error: unknown): string {
  return `[extensions:${scope}] ${phase} failed: ${error instanceof Error ? error.message : String(error)}`;
}
