# OMI — AI Agent Workbench

OMI 是一个本地优先的 AI Agent 桌面工作台，基于 Electron + React 前端和 Node.js Runner 子进程，通过 JSON-RPC IPC 桥接通信。

## 架构总览

```
┌─────────────────────────────────────────────────┐
│  apps/desktop (Electron + React)                │
│  状态管理: zustand  │  UI: Radix + Tailwind 4   │
└────────────────────┬────────────────────────────┘
                     │ JSON-RPC (IPC)
                     v
┌─────────────────────────────────────────────────┐
│  apps/runner (Node.js 子进程)                    │
│  创建 SQLite DB，实例化 Orchestrator，转发事件    │
└────────────────────┬────────────────────────────┘
                     │ API 调用
                     v
┌─────────────────────────────────────────────────┐
│  packages/agent (编排层)                         │
│  Orchestrator → AgentSession → ProviderAdapter  │
│  Run 队列 · Tool 生命周期 · 权限评估 · 事件流     │
└────────────────────┬────────────────────────────┘
          ┌──────────┼──────────┬──────────────┐
          v          v          v              v
   packages/store  provider   tools   memory/prompt/settings
   SQLite 持久化   LLM 适配   工具系统  上下文构建
          │          │          │              │
          └──────────┴──────────┴──────────────┘
                          │
                          v
                   packages/core
               领域类型 · 事件 · RPC 协议
```

## 数据流：一次用户提问的完整路径

```
用户输入 prompt
  → Desktop 发送 "run.start" RPC 到 Runner 子进程
    → AppOrchestrator.startRun()
      → AgentSession 创建 User Message (DB) + Run 记录
        → 从 DB 加载历史消息，构建 LLM 上下文
          → ProviderAdapter.run() 调用 LLM API
            → 流式返回 text delta + tool 调用
              → 权限评估 (default / yolo 模式)
                → 需审批: 阻塞 Run，等待用户决策
                → 自动通过: 直接执行工具
              → 工具结果写回 DB，继续 LLM 对话循环
        → LLM 结束，持久化 Assistant Message
      → 发送 "run.completed" 事件回 Desktop
  → UI 实时更新
```

## 包职责与依赖

### `@omi/core` — 领域基础（零依赖）

所有包的公共地基，不依赖任何其他 `@omi/*` 包。

| 文件 | 职责 |
|------|------|
| `domain.ts` | Zod schema: Session, Run, Task, ToolCall, SessionMessage, MemoryRecord, ProviderConfig, SkillDescriptor |
| `events.ts` | RunnerEventEnvelope — 30+ 种事件的 discriminated union |
| `protocol.ts` | RPC 命令定义、请求/结果 schema、parseCommand/parseResult |
| `tool-types.ts` | OmiTool 接口、ThinkingLevel、OmiToolResult |
| `compaction.ts` | CompactionSummaryDocument schema |
| `utils.ts` | createId, nowIso, AppError |

### `@omi/store` — SQLite 持久化

依赖: `@omi/core`

| 文件 | 职责 |
|------|------|
| `contracts.ts` | `AppStore` 接口 — Session/Task/Run/Message/ToolCall/Memory/ProviderConfig 的 CRUD |
| `schema.ts` | Drizzle ORM 表定义 |
| `sqlite-store.ts` | `createAppDatabase()` — better-sqlite3 + Drizzle 实现 |

**数据库表**: sessions, tasks, run_logs, messages, tool_calls, memories, provider_configs

消息模型为树结构 (`parentMessageId`)，支持分支和压缩溯源 (`compressedFromMessageId`)。

### `@omi/provider` — LLM Provider 适配

依赖: `@omi/core`, `@mariozechner/pi-ai`, `@anthropic-ai/claude-agent-sdk`

| 文件 | 职责 |
|------|------|
| `providers.ts` | `ProviderAdapter` 接口、`createProviderAdapter()`、`ProviderRunInput/Result` |
| `model-registry.ts` | 内建 + 自定义 Provider 注册 |
| `runtimes/claude-agent-sdk-provider.ts` | Anthropic 协议运行时 |
| `runtimes/pi-agent-provider.ts` | 通用协议运行时 (OpenAI, Google, Bedrock 等) |

路由规则: `anthropic-messages` 协议走 Claude Agent SDK，其余走 pi-agent-core。

### `@omi/tools` — 工具系统

依赖: `@omi/core`

| 文件 | 职责 |
|------|------|
| `tools.ts` | `createAllTools()`, `requiresApproval()` |
| `registry.ts` | 工具名集合: CORE_TOOL_NAMES, SAFE_TOOL_NAMES, WRITE_TOOL_NAMES |
| `builtins.ts` | 内建工具定义 (read, bash, edit, write, grep, find, ls) |
| `runtime.ts` | ToolRuntimeContext, SkillExecutor, CronRuntime |
| `skill.ts` / `skill-tools.ts` | discover_skills 和 skill 工具 |

### `@omi/memory` — 上下文构建

依赖: `@omi/core`

| 文件 | 职责 |
|------|------|
| `messages.ts` | RuntimeMessage 类型、buildSessionRuntimeMessages()、LLM 格式转换 |
| `memory-recall.ts` | 文件扫描 → LLM 相关性选择 |
| `memory-inject.ts` | Token 预算管理 → 注入系统提示词 |
| `compaction.ts` | 上下文截断策略 |

Memory 分为 4 个 scope: `user`, `feedback`, `project`, `reference`。

### `@omi/prompt` — 系统提示词组装

依赖: `@omi/core`

`buildSystemPrompt()` 加载 AGENTS.md/CLAUDE.md 项目上下文，注入工具描述、技能、日期和工作目录。

### `@omi/settings` — 配置管理

依赖: `@omi/core`

`SettingsManager` 管理全局/项目级配置，文件锁保护的深合并策略。

### `@omi/agent` — 编排层（系统核心）

依赖: `@omi/core`, `@omi/store`, `@omi/provider`, `@omi/tools`, `@omi/memory`, `@omi/prompt`, `@omi/settings`

| 文件 | 职责 |
|------|------|
| `orchestrator.ts` | `AppOrchestrator` — 顶层门面: Session/Run/Tool/Git/Model 操作 |
| `agent-session.ts` | `AgentSession` — 单 Session 执行引擎: Run 队列、Tool 生命周期、权限评估、流式输出 |
| `session-manager.ts` | `SessionRuntime` — 内存状态机: 活跃 Run、阻塞工具、审批队列、压缩状态 |
| `resource-loader.ts` | 加载上下文文件、解析技能、构建系统提示词 |
| `permissions.ts` | `PermissionEvaluator` — 工具审批/拒绝逻辑 |
| `vcs.ts` | Git 操作 (状态、diff) |
| `skills/` | 技能发现与解析 |

**关键状态机** (`SessionRuntimeState`):
- 追踪 `activeRunId`, `queuedRuns`, `blockedToolCallId`, `pendingApprovalToolCallIds`
- 运行间串行执行，通过队列管理并发
- `compaction` 状态独立追踪

**权限模式**: `"default"` (逐工具审批) vs `"yolo"` (全量放行)

## Apps

### `apps/runner` — Runner 子进程

Node.js 进程，由 Electron main process 启动。职责:
1. 创建 SQLite 数据库 (`workspace-data/app.db`)
2. 实例化 `AppOrchestrator`
3. 监听 `process.on('message')` 的 JSON-RPC 请求
4. 调用 `handleRunnerRequest()` 分发命令
5. 通过 `process.send()` 返回结果和事件

### `apps/desktop` — Electron 桌面应用

技术栈: electron-vite, React 19, zustand, @tanstack/react-query, react-router-dom, Tailwind CSS 4, Radix UI

关键组件:
- `workspace-store.ts` — zustand store，管理 Session/Run/Message 状态
- `runner-gateway.ts` — IPC 桥接层
- `tool-ui/` — 工具调用、Run 事件、技能事件的可视化组件
- `Chat.tsx` — 主聊天视图，消息树渲染

## 依赖约束

```
core ← store, memory, provider, tools, prompt, settings
  ← agent (聚合层)
    ← runner (进程桥接)
      ← desktop (UI 层)
```

- 依赖方向严格单向：高层依赖底层，底层不反向引用。
- `agent` 不 re-export 其他包的 API，只消费。
- 不存在 `@omi/protocol`、`@omi/sdk`、`@omi/extensions` 包（已删除）。

## 开发规范

### 测试
- 框架: `vitest`，禁止混用 `bun:test`。
- 位置: `test/**` 与 `src` 平级，不在 `src` 内放测试。
- 命名: `*.test.ts` / `*.test.tsx`，`it(...)` 按行为描述。
- 新功能必须包含成功路径 + 失败/边界路径。

### TypeScript
- 各模块 `tsconfig.json` 的 `include` 覆盖 `src/**` 和 `test/**`。
- 别名与构建别名一致，避免路径分裂。
- 根配置已设 `jsx: react-jsx`，支持 `.tsx` 编译。
