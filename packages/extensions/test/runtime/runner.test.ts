import { describe, expect, it } from "vitest";

import { createRuntimeCustomMessage } from "@omi/memory";
import { ExtensionRunner } from "../../src/runtime/runner";
import type { ExtensionDefinition, ExtensionRunInput } from "../../src/runtime/types";

describe("extension runner", () => {
  it("runs hooks and aggregates prompts and messages", async () => {
    const runner = new ExtensionRunner("/workspace");
    const observedEvents: string[] = [];
    const subscriptionEvents: string[] = [];
    let setupCalls = 0;
    let beforeRunCalls = 0;
    let beforeRunInput: ExtensionRunInput | undefined;

    const extension: ExtensionDefinition = {
      name: "headless-extension",
      setup(context) {
        setupCalls += 1;
        context.appendSystemPrompt("setup fragment");
        context.appendRuntimeMessage(
          createRuntimeCustomMessage("setup", "setup message", true, { phase: "setup" }, 1),
        );
        context.onEvent((event) => {
          subscriptionEvents.push(`${event.type}:${String(event.payload.value)}`);
        });
      },
      beforeRun(input, context) {
        beforeRunCalls += 1;
        beforeRunInput = input;
        context.appendSystemPrompt(`before:${input.prompt}`);
        context.appendRuntimeMessage(
          createRuntimeCustomMessage(
            "before-run",
            input.prompt,
            true,
            { sessionId: input.sessionId },
            2,
          ),
        );
      },
      onEvent(event, context) {
        observedEvents.push(event.type);
        context.appendRuntimeMessage(
          createRuntimeCustomMessage("event", event.type, false, { payload: event.payload }, 3),
        );
      },
    };

    runner.register(extension);

    await runner.emit({ type: "extension.ready", payload: { value: 1 } });
    await runner.beforeRun({
      prompt: "Hello",
      sessionId: "session-1",
      workspaceRoot: "/workspace",
      systemPrompt: "Base prompt",
      messages: [],
    });
    await runner.emit({ type: "extension.started", payload: { value: 2 } });

    expect(setupCalls).toBe(1);
    expect(beforeRunCalls).toBe(1);
    expect(beforeRunInput).toEqual({
      prompt: "Hello",
      sessionId: "session-1",
      workspaceRoot: "/workspace",
      systemPrompt: "Base prompt",
      messages: [],
    });
    expect(subscriptionEvents).toEqual(["extension.ready:1", "extension.started:2"]);
    expect(observedEvents).toEqual(["extension.ready", "extension.started"]);
    expect(runner.getSystemPromptFragments()).toEqual(["setup fragment", "before:Hello"]);
    expect(runner.buildSystemPrompt("Base prompt")).toBe(
      "Base prompt\n\nsetup fragment\n\nbefore:Hello",
    );
    expect(runner.getRuntimeMessages()).toHaveLength(4);
    expect(runner.getDiagnostics()).toEqual([]);
  });
});
