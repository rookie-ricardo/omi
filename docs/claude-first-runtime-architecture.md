# OMI Claude-First Runtime Architecture

## Overview

OMI now runs on a Claude-first runtime model:

- Primary runtime: `Claude Agent SDK`
- Secondary runtime: `Vercel AI SDK` (only for OpenAI-protocol models)

Legacy self-managed control surfaces (plan/worktree/multi-agent protocol families) are intentionally removed from the public runner contract.

## Runtime Routing

Provider protocol maps to runtime as follows:

- `anthropic-messages` -> `Claude Agent SDK`
- `openai-chat` -> `Vercel AI SDK`
- `openai-responses` -> `Vercel AI SDK`

Routing is implemented in:

- `packages/provider/src/runtimes/resolver.ts`

## Supported Runner Command Surface

Only the following command families are supported:

- `session.create`
- `session.list`
- `session.get`
- `session.title.update`
- `session.runtime.get`
- `session.history.list`
- `session.history.continue`
- `session.workspace.set`
- `session.permission.set`
- `session.model.switch`
- `run.start`
- `run.cancel`
- `run.state.get`
- `run.events.subscribe`
- `run.events.unsubscribe`
- `tool.approve`
- `tool.reject`
- `tool.pending.list`
- `tool.list`
- `provider.config.save`
- `provider.config.delete`
- `model.list`
- `git.status`
- `git.diff`

Any removed command returns `UNSUPPORTED_COMMAND`.

## `/plan` Behavior

`/plan` is preserved as a user-facing command intent, but not as an RPC control mode.

- Claude runtime (`anthropic-messages`): prompt is forwarded as-is.
- Vercel runtime (`openai-*`): prompt is rewritten into a plan-only instruction template.

This keeps `/plan` usable without preserving legacy `plan.*` protocol/state machinery.

## Tool Surface Policy

Default tool set is intentionally reduced to standard coding tools:

- `read`
- `ls`
- `grep`
- `glob`
- `bash`
- `edit`
- `notebook_edit`
- `write`
- `tool.search`

Removed families include plan/worktree/subagent/task/mcp-resource/web/team/cron-oriented tools.

## Boundaries

`apps/runner` must not import internal module paths such as `packages/agent/src/*`.
Cross-package usage must happen through public package exports.
