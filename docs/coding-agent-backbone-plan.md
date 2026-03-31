# Coding-Agent Backbone Migration Plan

## Goal

Borrow the backbone architecture from `pi-mono/packages/coding-agent` and adapt it into OMI's existing `desktop + runner` architecture without importing the TUI/CLI product shell.

The target is not code copying. The target is to establish stable runtime layers:

1. model registry and resolution
2. resource loading
3. message normalization
4. runtime session abstraction
5. extension runtime
6. runner integration and protocol cleanup

## Non-goals

- Do not port the interactive TUI
- Do not port CLI commands
- Do not port themes/export-html/auth UX flows
- Do not replace the existing desktop application shell

## Current Gap

Current `packages/agent` is still flat:

- `orchestrator.ts`
- `providers.ts`
- `skills.ts`
- `tools.ts`
- `vcs.ts`

This keeps model selection, resource discovery, agent execution, approval flow, and runner orchestration too tightly coupled.

## Target Backbone

`packages/agent/src` should converge toward these layers:

- `model-registry.ts`
- `model-resolver.ts`
- `resource-loader.ts`
- `messages.ts`
- `agent-session.ts`
- `session-manager.ts` or OMI-specific runtime session store
- `extensions/`
- `tools/`
- `orchestrator.ts`

`orchestrator.ts` should become a thin application coordinator, not the runtime core.

## Phase List

### Phase 0: Baseline and invariants

- Freeze current behavior with tests around provider config, tool approval, skill resolution, and run lifecycle
- Record architecture decisions and target module boundaries

Acceptance:

- Existing `agent`, `runner`, and `desktop` type-check and build continue to pass
- Added tests describe current behavior that later refactors must preserve

### Phase 1: Model layer

Status: completed

- Introduce `model-registry.ts`
- Introduce `model-resolver.ts`
- Centralize provider/model resolution there
- Move compatible-provider logic out of `providers.ts`
- Keep current env-driven defaults working

Acceptance:

- Built-in `pi-ai` providers and compatible providers resolve through one shared path
- Default provider/model selection is centralized
- Tests cover:
  - built-in provider model resolution
  - compatible provider resolution
  - unknown provider/model failures
  - default provider selection

### Phase 2: Resource layer

Status: completed

- Introduce `resource-loader.ts`
- Unify AGENTS loading, skill loading, prompt/system prompt assembly behind one loader
- Stop letting `orchestrator.ts` manually coordinate these pieces

Acceptance:

- Skill discovery and project context loading come from one resource API
- System prompt construction is produced from one place
- Tests cover loader output and precedence rules

### Phase 3: Message normalization

Status: completed

- Introduce `messages.ts`
- Define runtime message variants for:
  - user
  - assistant
  - tool result
  - summary/compaction placeholders
  - extension/custom runtime messages
- Add conversion to LLM input messages

Acceptance:

- Runtime-only messages and model-visible messages are separated cleanly
- Future compaction and extension output have a stable message surface

### Phase 4: Runtime session abstraction

Status: completed

- Introduce `agent-session.ts`
- Move agent lifecycle, event subscription, retries, queued prompts, and future compaction hooks there
- Keep OMI database persistence, but stop letting `orchestrator.ts` own every runtime concern

Acceptance:

- `AgentSession` can run a prompt independent of desktop/runner transport
- `orchestrator.ts` only coordinates app-level state and persistence
- Approval flow remains intact

### Phase 5: Extension runtime

Status: completed

- Introduce `extensions/` backbone:
  - extension types
  - extension runner
  - tool registration surface
  - limited UI bridge contracts for desktop
- Start with headless-safe extension APIs first

Acceptance:

- Extensions can register tools and subscribe to runtime events
- Desktop-specific UI hooks are abstract interfaces, not hardcoded runtime calls
- Runner stays usable without interactive TUI

### Phase 6: Session history and compaction foundation

Status: completed

- Add an OMI-appropriate session runtime store
- Decide whether to mirror coding-agent tree sessions or adapt the concept onto DB records
- Add summary/compaction insertion points

Acceptance:

- Session runtime state is explicit
- Compaction can be added without rewriting orchestration again

### Phase 7: Runner protocol cleanup

Status: pending

- Revisit runner event and command protocol
- Align state operations around runtime session concepts
- Prepare for future extension-driven commands and model switching

Acceptance:

- Runner API reflects the new runtime boundaries
- Desktop can query models, runtime state, and extension-provided capabilities cleanly

## Execution Rules

- Each phase must land with tests or verification updates
- Each phase must preserve app buildability
- If a phase fails acceptance, iterate before moving on
- Prefer extracting modules before rewriting behavior

## Immediate Execution Order

1. Phase 1: model layer
2. Phase 2: resource layer
3. Phase 3: message normalization
4. Phase 4: runtime session abstraction
5. Phase 5: extension runtime

## Initial Acceptance Commands

- `./node_modules/.bin/tsc -p packages/agent/tsconfig.json --noEmit`
- `./node_modules/.bin/tsc -p apps/runner/tsconfig.json --noEmit`
- `./node_modules/.bin/tsc -p apps/desktop/tsconfig.json --noEmit`
- `./node_modules/.bin/vitest run` in `packages/agent`
- `./node_modules/.bin/electron-vite build` in `apps/desktop`
