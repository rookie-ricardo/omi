# OMI to pi-coding-agent Parity Plan

## Goal

Raise OMI's product maturity to the same level as `pi-mono/packages/coding-agent` on the parts that matter for a desktop coding agent product:

1. session model
2. runtime control plane
3. compaction quality and recovery
4. model and settings governance
5. tool surface and execution quality
6. protocol and transport maturity

The target is not UI parity and not frameworkization.

## Scope

In scope:

- session lifecycle and persistence maturity
- precise run recovery and control semantics
- compaction and long-context handling
- model selection, settings, and runtime controls
- tool surface needed for high-quality coding-agent behavior
- runner protocol maturity for desktop integration

Out of scope:

- TUI
- CLI slash-command shell
- themes
- export HTML
- auth/login UX
- extension platform parity
- package-manager/package distribution features

## Current Position

OMI already has these backbone pieces:

- `pi-ai` provider integration
- model registry and resolver basics
- resource loader
- message normalization
- runtime session store
- retry/resume/model switch basics
- manual compaction
- desktop to runner protocol

That means OMI is no longer missing the backbone.
The remaining gap is product maturity.

## Gap Summary

### Gap 1: Session model is still linear

OMI stores sessions, runs, messages, events, and tool calls, but it does not yet have the session-tree semantics that `pi-coding-agent` uses for:

- branching from any point
- tree navigation
- branch-local context reconstruction
- branch summaries and labels
- exact continuation from historical points

### Gap 2: Runtime recovery is not precise enough

Current retry/resume behavior is good enough for recent runs but still relies on session-level prompt memory in places.
To reach parity, recovery must become run-precise and history-aware.

### Gap 3: Compaction is functional but not mature

Current compaction works, but it is still:

- manual-first
- deterministic summary generation
- missing token-budget cut logic
- missing overflow-triggered recovery
- missing post-compaction auto-continue semantics

### Gap 4: Settings and model governance are thin

OMI can switch provider configs, but it still lacks a real settings layer for:

- default provider and model
- default thinking level
- auto-compaction settings
- auto-retry settings
- queue behavior
- scoped models and model cycling

### Gap 5: Tool surface is too coarse

OMI's built-in tools are still less capable than `pi-coding-agent`'s default coding loop.
This affects both exploration quality and edit success rate.

### Gap 6: Protocol is internal, not a mature control plane

OMI's protocol is already much better than before, but it still behaves like an internal app RPC.
To reach parity, runtime control and query semantics need to be first-class and typed end-to-end.

## Parity Principles

1. Product before framework
   No speculative plug-in surface or framework-style abstractions.
2. Prefer direct borrowing when the design is already correct
   If `pi-coding-agent` has a mature implementation for a product concern, copy and adapt it instead of re-inventing it.
3. Keep OMI architecture intact
   Preserve `desktop + runner + db`.
4. Runtime truth before UI
   Desktop should render a trustworthy runtime model, not reconstruct one from scattered events.
5. Each phase must end in working software
   No phase is considered done without validation.

## Phase Plan

### Phase 1: Session Tree Foundation

Objective:

- introduce tree-capable session history semantics into OMI

Iteration 1 status:

- `session_history_entries` now stores explicit lineage with `parentId`
- branch summary entries are representable in storage
- agent runtime can rebuild branch-local history from ancestry instead of assuming a flat message list

Work:

- design an OMI-native session-entry model that can coexist with current DB records
- add parent/entry lineage for messages and runtime history
- add branch reconstruction APIs
- add branch summary and label primitives
- define exact semantics for "continue from historical point"

Acceptance:

- runtime can reconstruct the active branch deterministically
- a historical point can be selected and continued without corrupting current branch history
- branch summaries are representable in storage and in prompt reconstruction
- tests cover branch reconstruction and branch-local context building

Notes:

- this phase does not need desktop tree UI yet
- this phase is about runtime correctness first

### Phase 2: Precise Run Recovery

Objective:

- eliminate session-level approximation in retry and resume flows

Work:

- bind retries and resumes to stable run lineage, not just `lastUserPrompt`
- define recovery rules for:
  - blocked
  - interrupted
  - canceled
  - failed
  - resumed after restart
- persist enough runtime metadata to restart safely

Acceptance:

- retry always rebuilds from the intended run lineage
- resume after restart is deterministic
- blocked approval flows survive restart without state drift
- tests cover restart recovery and historical retry correctness

### Phase 3: Mature Compaction

Objective:

- bring compaction to `pi-coding-agent` grade

Work:

- port token-budget cut-point logic
- port model-driven structured summarization
- support both threshold-triggered compaction and overflow-triggered recovery
- define keep-recent policy
- inject compaction summaries into runtime history cleanly
- support post-compaction continuation semantics

Acceptance:

- long sessions compact automatically when budget policy says so
- overflow recovery compact-and-continue works
- compaction summaries are model-generated and structured
- prompt reconstruction after compaction is deterministic
- tests cover threshold compaction, overflow compaction, and summary reuse

### Phase 4: Settings and Model Governance

Objective:

- add a real settings layer for runtime and model behavior

Work:

- introduce an OMI settings manager
- persist default provider, default model, default thinking level
- persist auto-compaction and auto-retry settings
- add scoped models and cycle semantics
- wire settings into runner startup and session restoration

Acceptance:

- model selection and restore behavior follow explicit settings rules
- runtime controls do not depend on ad hoc environment-only defaults
- tests cover settings precedence and restore behavior

### Phase 5: Tool Surface Upgrade

Objective:

- bring coding-loop tool quality closer to `pi-coding-agent`

Work:

- evaluate direct adoption or adaptation of:
  - `grep`
  - `find`
  - `ls`
  - better `read`
  - better `edit/write` semantics
- keep OMI's approval policy product-safe
- tighten tool result normalization for prompt quality

Acceptance:

- exploration and edit loops require fewer shell fallbacks
- tool semantics are stable and approval rules remain explicit
- tests cover tool behavior and approval policies

### Phase 6: Protocol and Control Plane Parity

Objective:

- make runner protocol a mature runtime control surface

Work:

- replace loose request handling with command/result maps end-to-end
- expose runtime controls and state queries as first-class protocol operations
- add protocol support for:
  - runtime state
  - queue state
  - retry state
  - compaction state
  - model selection state
  - session branch navigation hooks

Acceptance:

- desktop no longer needs to infer runtime truth from events
- request and response types are closed across renderer, main, and runner
- tests cover protocol parsing and handler dispatch without stringly-typed gaps

### Phase 7: Desktop Product Integration

Objective:

- surface the new maturity in the actual OMI desktop product

Work:

- add runtime controls to desktop where needed
- expose session branch and recovery state
- expose compaction and model controls
- ensure UX follows runtime truth and not event reconstruction hacks

Acceptance:

- desktop can inspect and control the mature runtime without hidden assumptions
- build remains stable and flows are manually verifiable

## Suggested Execution Order

1. Phase 1: Session Tree Foundation
2. Phase 2: Precise Run Recovery
3. Phase 3: Mature Compaction
4. Phase 4: Settings and Model Governance
5. Phase 5: Tool Surface Upgrade
6. Phase 6: Protocol and Control Plane Parity
7. Phase 7: Desktop Product Integration

## Acceptance Commands

- `./node_modules/.bin/tsc -p packages/kernel/tsconfig.json --noEmit`
- `./node_modules/.bin/tsc -p packages/db/tsconfig.json --noEmit`
- `./node_modules/.bin/tsc -p packages/agent/tsconfig.json --noEmit`
- `./node_modules/.bin/tsc -p apps/runner/tsconfig.json --noEmit`
- `./node_modules/.bin/tsc -p apps/desktop/tsconfig.json --noEmit`
- `./node_modules/.bin/vitest run` in `packages/agent`
- `./node_modules/.bin/vitest run` in `packages/db`
- `./node_modules/.bin/vitest run` in `apps/runner`
- `./node_modules/.bin/electron-vite build` in `apps/desktop`

## First Execution Target

Start with Phase 1, but keep it narrow for the first iteration:

1. define OMI session-entry types for branchable runtime history
2. add branch reconstruction helpers
3. add storage and tests for branch summaries
4. do not build desktop tree UI yet

The first implementation milestone is successful when OMI can reconstruct a branch-local runtime context from explicit lineage instead of assuming a single linear chat history.
