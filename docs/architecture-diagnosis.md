# OMI 架构诊断与重构设计

> **Status: ALL PHASES COMPLETED (2026-04)**
>
> 本文档中描述的所有重构阶段均已完成：
> - **Phase 4.1** — `@omi/protocol` 合并入 `@omi/core` ✓ (commit 397818b)
> - **Phase 4.2** — Vercel AI SDK 替换为 `pi-agent-core` ✓ (commit 146c986)
> - **Phase 4.3** — 上下文压缩策略实现 ✓ (commit 7ac7bf2)
> - **Phase 4.4** — agent-session 事件与测试对齐 SDK-first 架构 ✓ (commit 986a0d5)
> - **Phase 4.5** — 清理残留死代码 (task-mailbox, cost-tracker 等) ✓ (commit aeb0bb7)
>
> 本文档保留作为历史参考，记录迁移前的架构缺陷分析与重构设计决策。

> 以 Claude Agent SDK 为核心，构建简单且强大的 Agent。
> 消灭所有冗余抽象，让 SDK 的能力直接流淌到每一层。

---

## 一、当前架构全景

### 1.1 代码量统计

| 文件 | 行数 | 职责 |
|------|------|------|
| `packages/agent/src/query-engine.ts` | 1,979 | 状态机 + 执行循环 + 压缩 + 恢复 + 预算 + 权限 |
| `packages/agent/src/agent-session.ts` | 1,216 | 会话生命周期 + 重复的压缩/状态逻辑 |
| `packages/agent/src/subagent-manager.ts` | 1,210 | 子 Agent 管理 |
| `packages/agent/src/session-manager.ts` | 1,015 | 会话 CRUD + 运行时状态 |
| `packages/agent/src/recovery.ts` | 885 | 错误恢复引擎 |
| `packages/agent/src/orchestrator.ts` | 840 | God class：编排一切 |
| `packages/agent/src/task-mailbox.ts` | 762 | 任务收件箱 |
| `packages/agent/src/telemetry.ts` | 655 | 遥测 |
| `packages/agent/src/slash-commands.ts` | 584 | 斜杠命令 |
| `packages/agent/src/audit-log.ts` | 537 | 审计日志 |
| `packages/agent/src/bash-executor.ts` | 481 | Bash 执行器 |
| `packages/provider/src/runtimes/claude-agent-sdk-provider.ts` | 554 | SDK 集成点 |
| `packages/protocol/src/index.ts` | 315 | RPC schema |
| `packages/sdk/src/agent.ts` | 429 | 面向用户的 SDK 薄封装 |

**agent 包总计：11,559 行** — 一个"编排层"不该有这么多代码。

### 1.2 包依赖关系

```
apps/desktop ──→ @omi/agent ──→ @omi/provider ──→ @anthropic-ai/claude-agent-sdk
                     │                │
                     │                ├──→ @omi/tools
                     │                ├──→ @omi/memory
                     │                └──→ @omi/prompt
                     │
                     ├──→ @omi/store
                     ├──→ @omi/settings
                     └──→ @omi/core

apps/desktop ──→ @omi/protocol (RPC schemas)
apps/desktop ──→ @omi/sdk (thin wrapper, 几乎不被 desktop 使用)
```

---

## 二、缺陷清单

### 缺陷 D1：双重循环 — QueryEngine 外循环 vs SDK 内循环

**严重度：Critical**

Claude Agent SDK 的 `query()` 内部已经运行了完整的 agentic loop（think → act → observe → repeat）。但 `QueryEngine.execute()` 又在外面包了一层 while(true) 状态机：

```
QueryEngine.execute() {
  while (true) {
    preprocess context  // 5 阶段压缩管线
    callProviderSingleTurn()  // 调 SDK query()，SDK 内部又是个 while(true)
    handle errors / recovery
    check termination
  }
}
```

**问题**：
- SDK 内循环管理工具执行、上下文、重试。外循环再做一遍同样的事。
- 两套压缩逻辑：QueryEngine 的 `contextPipeline` + SDK 内置的 `snipCompact`/`microcompact`/`contextCollapse`/`autocompact`。
- 两套恢复逻辑：`recovery.ts`（885 行）处理溢出恢复 + SDK 内置的 `max_output_tokens` 恢复。
- 两套终止条件：QueryEngine 的 `shouldContinue()` + SDK 的终止原因系统。

**根因**：项目诞生时尚未完全信任 SDK，手动复刻了 SDK 的所有内部能力。

### 缺陷 D2：agent-session.ts 与 query-engine.ts 的大面积重复

**严重度：Critical**

以下函数在两个文件中存在近乎完全相同的实现：

| 函数 | agent-session.ts | query-engine.ts |
|------|:---:|:---:|
| `compactHistoricalContext()` | ✓ | ✓ |
| `buildHistoricalRuntimeMessages()` | ✓ | ✓ |
| `buildHistoricalRuntimeMessageEnvelopes()` | ✓ | ✓ |
| `buildRuntimeCompactionSnapshot()` | ✓ | ✓ |
| `nextSessionStatus()` | ✓ | ✓ |
| `nextTaskStatus()` | ✓ | ✓ |
| `normalizeHistoryDetails()` | ✓ | ✓ |

**3,195 行（两文件合计）中至少 40% 是重复代码。**

### 缺陷 D3：God Class — AppOrchestrator

**严重度：High**

`AppOrchestrator`（840 行）直接管理：
- 会话生命周期（创建、查找、活跃会话跟踪）
- 运行控制（start、retry、resume、cancel）
- 工具审批/拒绝
- Git 状态
- Provider 配置
- 权限模式
- 子 Agent
- 任务收件箱
- 技能系统
- 事件总线
- 遥测
- 审计日志

一个类做 13 件事，任何一个改动都可能波及全局。

### 缺陷 D4：SDK 能力严重未被利用

**严重度：High**

Claude Agent SDK 提供了以下能力，但项目只用了其中一小部分：

| SDK 能力 | 当前使用状态 |
|----------|:---:|
| `query()` 流式执行 | ✓ 使用 |
| `tool()` / `createSdkMcpServer()` | ✓ 使用（但包了一层 MCP 转换） |
| `canUseTool` 权限回调 | ✓ 使用 |
| `resume` / `continue` 游标 | ⚠️ 部分使用 |
| Tool preset `"claude_code"` | ⚠️ 配了但手动工具覆盖了它 |
| `settingSources` 设置源 | ✓ 使用 |
| `effort` 思考级别 | ⚠️ 未充分暴露 |
| SDK 内置压缩管线 | ❌ 被外层管线架空 |
| SDK 内置恢复逻辑 | ❌ 被 recovery.ts 替代 |
| SDK 内置终止逻辑 | ❌ 被 QueryEngine 状态机替代 |
| SDK 的 `maxTurns` 控制 | ❌ 未使用，手动检查 |
| SDK 的 `permissions` 系统 | ❌ 手动实现了一套 |

**特别是 `"claude_code"` preset**：这个 preset 自带了完整的 Read、Write、Edit、Bash、Glob、Grep、LS、NotebookEdit 等工具 + 文件系统权限 + 上下文管理。但项目在 `@omi/tools`（28 个文件）中重新实现了这些工具，然后通过 MCP 协议桥接回 SDK，形成了一个完全不必要的间接层。

### 缺陷 D5：packages/sdk 与 packages/agent 职责重叠

**严重度：Medium**

`@omi/sdk`（429 行）和 `@omi/agent`（11,559 行）都在做"编排 Agent 执行"：

- `@omi/sdk` 的 `Agent.query()` — 构建 prompt → 调 provider → 处理工具生命周期 → 返回流
- `@omi/agent` 的 `AgentSession.executeRun()` — 构建 prompt → 调 QueryEngine → 处理工具生命周期 → 返回流

两套 API，两种 message 类型，两种工具处理逻辑。Desktop app 用 agent 包，SDK 用 sdk 包，但底层调的同一个 provider。

### 缺陷 D6：packages/protocol 是纯 schema 包

**严重度：Medium**

`@omi/protocol`（315 行）只做一件事：定义 RPC 命令的 Zod schema。它：
- 从 `@omi/core` 导入所有领域 schema
- 加上 RPC 信封 schema
- 导出类型推导

这不是一个独立包该做的事。RPC schema 是 runner app 的通信契约，应该跟 runner 放在一起，或者合入 core。

### 缺陷 D7：@omi/tools 的 28 个文件重建了 SDK 自带的工具

**严重度：High**

`packages/tools/src/` 包含：bash.ts、edit.ts、read.ts、write.ts、grep.ts、find.ts、ls.ts 等。这些工具实现了 Claude Code 同款功能，然后通过 `createClaudeMcpTool()` + `createSdkMcpServer()` 桥接回 SDK。

SDK 的 `"claude_code"` preset 已经内置了所有这些工具。项目的自定义实现只是在给 SDK 戴上了一副手套再操作工具 — 增加了延迟、维护成本和 bug 面。

### 缺陷 D8：memory 包的压缩逻辑分散在三处

**严重度：Medium**

上下文压缩逻辑分布在：
1. `packages/memory/src/context-pipeline.ts` — 5 阶段管线定义
2. `packages/memory/src/compaction.ts` — 实际压缩算法
3. `packages/agent/src/query-engine.ts` — 运行时管线编排 + fallback 压缩
4. `packages/agent/src/agent-session.ts` — 历史压缩（重复）

但 SDK 内部已经有完整的压缩管线：`applyToolResultBudget → snipCompact → microcompact → contextCollapse → autocompact`。

### 缺陷 D9：Provider 包内嵌 MCP Client 和 Cost Tracker

**严重度：Low**

`packages/provider/src/` 包含：
- `mcp-client.ts` — MCP 客户端管理
- `mcp-registry.ts` — MCP 注册表
- `cost-tracker.ts` — 费用追踪

这些不属于 "provider adapter" 的职责边界。MCP 是 SDK 的扩展性机制，费用追踪是可观测性关注点。

### 缺陷 D10：SubagentManager 的 1,210 行复杂度

**严重度：Medium**

`subagent-manager.ts` 实现了完整的子 Agent 生命周期管理。但 Claude Agent SDK 的 agentic loop 中，子 Agent 调用只是一个工具调用（`Agent` tool）。SDK 已经处理了子 Agent 的工具执行和结果回传，不需要外部管理器。

---

## 三、根因分析

所有缺陷指向同一个根因：

> **不信任 SDK，在 SDK 外面重建了 SDK 的核心能力。**

这形成了一个"洋葱架构"：
```
[自定义状态机] → [自定义循环] → [自定义压缩] → [自定义恢复] → [自定义工具]
                                     ↓
                         [SDK query()] — 内部已有全套
```

每一层都在做 SDK 已经做好的事。结果：
- 11,559 行 agent 包 ≈ SDK 的用户态克隆
- 28 个自定义工具文件 ≈ SDK preset 的用户态克隆
- 885 行恢复引擎 ≈ SDK 恢复逻辑的用户态克隆

---

## 四、新架构设计

### 4.1 设计原则

1. **SDK-first**：SDK 能做的，绝不在外面再做一次。
2. **删除优于重构**：能删的代码比重构的代码更好。
3. **一个循环**：只有 SDK 的 agentic loop，没有外层循环。
4. **一个压缩管线**：只有 SDK 内置的 5 阶段管线。
5. **一个恢复机制**：只有 SDK 的恢复路径。
6. **工具 = SDK preset + 自定义 MCP 扩展**：标准工具用 preset，自定义能力用 MCP server 注入。

### 4.2 目标包结构

```
packages/
  core/           # 领域模型、Zod schema、工具函数（保留，精简）
  agent/          # 瘦编排层：Session + Orchestrator + SDK 桥接（目标 < 2000 行）
  provider/       # 纯 provider 适配：Claude Agent SDK + pi-mono agent-core（目标 < 800 行）
  store/          # 持久化（保留）
  memory/         # 仅保留：记忆注入/召回（压缩逻辑删除，交给 SDK）
  settings/       # 设置管理（保留）
  prompt/         # 系统提示词组装（保留）

删除：
  protocol/       → RPC schema 合入 core 或移到 apps/runner
  sdk/            → 合入 agent（一个入口，不要两个）
  tools/          → 删除自定义标准工具，仅保留 OMI 特有的自定义工具作为 MCP server
```

### 4.3 核心执行流（新设计）

```
用户消息
  ↓
Orchestrator.startRun(sessionId, prompt)
  ↓
AgentSession.executeRun()
  ↓
┌────────────────────────────────────┐
│  ClaudeAgentSdkProvider.run()      │
│                                    │
│  const result = await query({      │
│    prompt,                         │
│    systemPrompt,                   │
│    tools: {                        │
│      type: "preset",               │
│      preset: "claude_code",        │  ← SDK 内置全部标准工具
│    },                              │
│    mcpServers: [                   │
│      omiCustomToolsServer,         │  ← 仅 OMI 特有的自定义工具
│      ...userMcpServers,            │  ← 用户配置的 MCP server
│    ],                              │
│    canUseTool: permissionCallback,  │  ← 权限控制
│    settingSources: ["project",     │
│      "local", "user"],             │
│    resume: sessionCursor,          │  ← 会话续传
│    maxTurns,                       │
│  });                               │
│                                    │
│  // SDK 内部执行：                   │
│  // while(true) {                  │
│  //   compress context             │  ← SDK 管理压缩
│  //   call model                   │  ← SDK 管理模型调用
│  //   execute tools                │  ← SDK 管理工具执行
│  //   check termination            │  ← SDK 管理终止
│  //   handle recovery              │  ← SDK 管理恢复
│  // }                              │
│                                    │
│  return result;                    │
└────────────────────────────────────┘
  ↓
AgentSession.persistResult()  // 持久化到 store
  ↓
EventBus.emit()  // 通知 UI
```

**关键变化：没有外层循环。** SDK 的 `query()` 一次调用完成整个 agentic 交互。

### 4.4 新的 agent 包设计

```typescript
// packages/agent/src/orchestrator.ts  — 目标 ~300 行
// 职责：会话 CRUD + 运行派发 + 权限路由
class Orchestrator {
  constructor(store: Store, workspaceRoot: string)

  // 会话
  createSession(title: string): Session
  getSession(id: string): Session
  listSessions(): Session[]

  // 运行
  startRun(sessionId: string, prompt: string): Run
  cancelRun(runId: string): void
  resumeRun(sessionId: string, prompt: string): Run

  // 权限
  approveTool(toolCallId: string): void
  rejectTool(toolCallId: string): void
}

// packages/agent/src/agent-session.ts  — 目标 ~400 行
// 职责：单会话的运行执行 + 持久化
class AgentSession {
  constructor(session: Session, store: Store, provider: ProviderAdapter)

  executeRun(prompt: string, options?: RunOptions): AsyncGenerator<SDKEvent>
  resume(prompt: string): AsyncGenerator<SDKEvent>
  compact(): void
  dispose(): void
}
```

**删除的内容：**
- `query-engine.ts`（1,979 行）— 完全删除，其职责由 SDK `query()` 承担
- `recovery.ts`（885 行）— 完全删除，SDK 内置恢复
- `subagent-manager.ts`（1,210 行）— 删除，SDK 的 Agent 工具已处理
- `task-mailbox.ts`（762 行）— 简化为事件，非独立模块
- `bash-executor.ts`（481 行）— 删除，SDK preset 自带 Bash 工具
- `slash-commands.ts`（584 行）— 简化，作为 prompt 前处理而非独立系统

**保留但大幅精简的内容：**
- `session-manager.ts` — 合入 orchestrator
- `event-bus.ts` — 保留，99 行足够
- `telemetry.ts` — 保留，但移出 agent 包到独立的可观测性关注点

### 4.5 新的 provider 包设计

```typescript
// packages/provider/src/providers.ts  — 保持 ProviderAdapter 接口
interface ProviderAdapter {
  run(input: ProviderRunInput): Promise<ProviderRunResult>
  cancel(runId: string): void
}

// packages/provider/src/runtimes/claude-agent-sdk-provider.ts  — 目标 ~300 行
// 变化：不再手动构建 MCP tools，直接使用 preset + mcpServers
class ClaudeAgentSdkProvider implements ProviderAdapter {
  async run(input: ProviderRunInput): Promise<ProviderRunResult> {
    // 1. 构建 SDK options
    // 2. 注入自定义 MCP servers（仅 OMI 特有工具）
    // 3. 设置 canUseTool 回调
    // 4. 调用 query() 并流式转发事件
    // 5. 返回结果

    // 不再：手动将 OmiTool[] 转 MCP → createClaudeMcpTool()
    // 不再：手动管理工具 schema 转换
    // 不再：手动解析工具结果
  }
}

// packages/provider/src/runtimes/pi-agent-provider.ts  — 目标 ~250 行
// 变化：用 pi-agent-core 的 Agent 替代 Vercel AI SDK 的 streamText
class PiAgentProvider implements ProviderAdapter {
  async run(input: ProviderRunInput): Promise<ProviderRunResult> {
    // 1. 通过 pi-ai 的 getModel() 获取模型（已有基础设施）
    // 2. 构建 Agent({ initialState, transformContext, beforeToolCall, afterToolCall })
    // 3. agent.prompt() 启动 agentic loop — pi-agent-core 管理工具执行循环
    // 4. agent.subscribe() 流式转发事件
    // 5. 返回结果（内置 token/cost tracking）

    // 不再：手动 streamText + stepCountIs(20) 限制
    // 不再：手动构建 Vercel tool schema（jsonSchema 转换）
    // 不再：手动管理工具执行循环
    // 新增：transformContext 钩子接入 OMI 的上下文压缩策略
  }
}
```

**删除的内容：**
- `vercel-ai-sdk-provider.ts` — 被 `pi-agent-provider.ts` 替代
- `mcp-client.ts` — SDK 管理 MCP 连接
- `mcp-registry.ts` — SDK 管理 MCP 注册
- `cost-tracker.ts` — pi-ai 内置 cost tracking，移除自定义实现
- `tool-schema.ts` — 不再需要手动 schema 转换

**删除的依赖：**
- `ai`（Vercel AI SDK）
- `@ai-sdk/openai`

### 4.6 tools 包的转型

**当前状态**：28 个文件实现标准编程工具（read、write、edit、bash、grep 等）。

**新设计**：

```
packages/tools/  — 删除或重命名为 packages/custom-tools/
  src/
    index.ts           # 导出 createOmiMcpServer()
    skill.ts           # /skill 命令等 OMI 特有能力
    memory-tools.ts    # 记忆管理工具（如果需要作为工具暴露）
```

标准编程工具（Read、Write、Edit、Bash、Grep、Glob、LS、NotebookEdit）全部由 SDK 的 `"claude_code"` preset 提供。项目只需在 `mcpServers` 中注入 OMI 特有的自定义工具。

### 4.7 memory 包的精简

**当前状态**：包含压缩管线（context-pipeline.ts、compaction.ts、context-pipeline-runner.ts、context-budget.ts）+ 记忆功能（memory-inject.ts、memory-recall.ts）。

**新设计**：

```
packages/memory/
  src/
    index.ts
    memory-inject.ts     # 保留：将长期记忆注入 system prompt
    memory-recall.ts     # 保留：从历史中召回相关记忆
    memory-types.ts      # 保留：记忆数据类型
```

**删除的内容：**
- `context-pipeline.ts` — SDK 内置压缩管线
- `context-pipeline-runner.ts` — SDK 内置管线运行器
- `compaction.ts` — SDK 内置压缩算法
- `context-budget.ts` — SDK 内置预算管理

### 4.8 protocol 包的处理

**方案**：合入 `@omi/core`。

RPC schema 是领域协议的一部分。`commandMap`、`resultSchemas`、`parseCommand`、`parseResult` 直接移入 `packages/core/src/protocol.ts`。protocol 包删除。

### 4.9 sdk 包的处理

**方案**：合入 `@omi/agent` 作为其公共 API 的薄门面。

`Agent` class、`createAgent()`、`query()` 成为 agent 包的用户态入口：

```typescript
// packages/agent/src/sdk.ts  — 从 @omi/sdk 迁移
export class Agent { ... }
export function createAgent(options?: AgentOptions): Agent { ... }
export async function* query(params: QueryParams): AsyncGenerator<SDKMessage> { ... }
```

一个包、一个入口、一种方式来创建和运行 Agent。

---

## 五、修复策略（按优先级排序）

### Phase 1：消灭双重循环（D1 + D2 + D8）

**影响**：删除 ~3,800 行代码

1. **删除 `query-engine.ts`**：
   - 将状态机、外循环、压缩管线、恢复逻辑全部移除
   - `AgentSession.executeRun()` 直接调用 `provider.run()`
   - SDK 的 `query()` 负责完整的 agentic loop

2. **删除 `recovery.ts`**：
   - SDK 内置处理 `max_output_tokens`、`prompt_too_long`、`token budget` 恢复
   - 不再需要外部恢复引擎

3. **删除 memory 包的压缩逻辑**：
   - 删除 `context-pipeline.ts`、`context-pipeline-runner.ts`、`compaction.ts`、`context-budget.ts`
   - SDK 的 5 阶段压缩管线接管

4. **清理 agent-session.ts 中的重复函数**：
   - 所有与 query-engine.ts 重复的函数随 query-engine.ts 一起消失
   - agent-session.ts 精简到 ~400 行

### Phase 2：消灭工具重建（D4 + D7）

**影响**：删除 ~2,000 行代码

1. **使用 SDK `"claude_code"` preset 替代自定义工具**：
   - 删除 `tools/src/` 中的标准工具实现：bash.ts、edit.ts、read.ts、write.ts、grep.ts、find.ts、ls.ts 等
   - 保留 OMI 特有的自定义工具（skill.ts 等）

2. **简化 provider 的工具桥接**：
   - 删除 `createClaudeMcpTool()` 到 `OmiTool[]` 的转换逻辑
   - 删除 `tool-schema.ts`（jsonSchemaToZod 转换不再需要）
   - 自定义工具直接作为 MCP server 注入

### Phase 3：消灭 God Class（D3 + D5 + D10）

**影响**：删除 ~2,500 行，重组 ~1,000 行

1. **拆分 AppOrchestrator**：
   - 会话管理 → `SessionStore`（纯持久化）
   - 运行控制 → `AgentSession`（已有）
   - 权限 → `canUseTool` 回调（SDK 原生）
   - Git → 删除（SDK preset 自带）
   - Provider 配置 → `SettingsManager`（已有）
   - 子 Agent → 删除（SDK 管理）
   - 任务 → 简化为事件

2. **合并 sdk 包到 agent 包**：
   - `Agent` class 成为 agent 包的公共 API
   - 删除 sdk 包目录

3. **删除 SubagentManager**：
   - SDK 的 Agent 工具处理子 Agent 的创建、执行、结果收集
   - 不需要外部管理器

### Phase 4：包合并与清理（D6 + D9）

**影响**：删除 2 个包、精简 1 个包

1. **合并 protocol 到 core**：
   - `protocol/src/index.ts` → `core/src/protocol.ts`
   - 更新所有 import
   - 删除 protocol 包

2. **清理 provider 包**：
   - 删除 `vercel-ai-sdk-provider.ts`，替换为 `pi-agent-provider.ts`
   - 删除 `mcp-client.ts`、`mcp-registry.ts`（SDK 管理）
   - 移除 `cost-tracker.ts`（pi-ai 内置）
   - 删除 `ai` 和 `@ai-sdk/openai` 依赖
   - provider 包只保留：适配器接口 + Claude SDK runtime + pi-agent-core runtime + 模型注册

---

## 六、预期效果

### 代码量变化

| 包 | 当前行数 | 目标行数 | 变化 |
|----|---------|---------|------|
| agent | 11,559 | ~2,000 | -83% |
| provider | ~1,500 | ~800 | -47% |
| tools | ~2,500 | ~300 | -88% |
| memory | ~1,200 | ~400 | -67% |
| protocol | ~315 | 0（合入 core） | -100% |
| sdk | ~550 | 0（合入 agent） | -100% |
| **总计** | **~17,600** | **~3,500** | **-80%** |

### 架构层次变化

**当前**：
```
UI → Orchestrator → SessionManager → AgentSession → QueryEngine → Provider → SDK query()
                                                         ↕                       ↕
                                                   RecoveryEngine          (SDK 内循环)
                                                         ↕
                                                   ContextPipeline
                                                         ↕
                                                   SubagentManager
```

**目标**：
```
UI → Orchestrator → AgentSession → Provider → SDK query()
                                                  ↕
                                            (SDK 管理一切)
```

从 7 层 + 3 个旁路，简化到 4 层、零旁路。

### SDK 能力利用率变化

| SDK 能力 | 当前 | 目标 |
|----------|:---:|:---:|
| `query()` agentic loop | 被外循环架空 | 完全信任 |
| Tool preset `"claude_code"` | 配了但被覆盖 | 作为主工具源 |
| 内置压缩管线 | 被自定义管线替代 | 完全信任 |
| 内置恢复逻辑 | 被 recovery.ts 替代 | 完全信任 |
| `canUseTool` 权限 | 使用 | 使用（简化） |
| `resume` 游标 | 部分使用 | 完整使用 |
| `maxTurns` 控制 | 未使用 | 使用 |
| `effort` 级别 | 未充分暴露 | 完整暴露 |
| `mcpServers` 扩展 | 未使用 | 用于自定义工具注入 |
| `settingSources` | 使用 | 使用 |

---

## 七、风险与缓解

### 风险 1：SDK 能力不足以覆盖所有场景

**缓解**：SDK 的 `"claude_code"` preset 是 Claude Code 产品自身使用的工具集。Claude Code 能做的，preset 都能做。如果发现 preset 不支持某场景，通过 `mcpServers` 注入自定义工具补充，而非重建整套工具链。

### 风险 2：持久化会话恢复依赖自定义压缩格式

**缓解**：SDK 的 `resume` 机制使用游标（session cursor）恢复会话状态。完全信任游标机制，Store 只需持久化游标即可。

### 风险 3：非 Anthropic 路径的 Agent 循环

**缓解**：`PiAgentProvider` 使用 `@mariozechner/pi-agent-core` 的 `Agent` 类，提供完整的 agentic loop（tool calling → execute → feed result → re-prompt）。pi-agent-core 的 `transformContext` 钩子天然支持上下文压缩，`beforeToolCall`/`afterToolCall` 钩子与 OMI 的工具审批流程对齐。20+ provider 的模型发现、token/cost tracking 均由 pi-ai 内置处理。

### 风险 4：大规模删除可能遗漏功能

**缓解**：按 Phase 执行，每个 Phase 完成后运行完整类型检查 + 测试套件。在删除每个模块之前，先确认其职责已被 SDK 或其他模块覆盖。

---

## 八、执行路线图

```
Phase 1 (Week 1-2)
├── 删除 query-engine.ts
├── 删除 recovery.ts
├── 精简 agent-session.ts
├── 删除 memory 压缩逻辑
└── 验证：类型检查 + 核心流程可用

Phase 2 (Week 2-3)
├── 切换到 SDK tool preset
├── 删除 tools 包标准工具
├── 简化 provider 工具桥接
└── 验证：工具执行正确

Phase 3 (Week 3-4)
├── 拆分 Orchestrator
├── 合并 sdk → agent
├── 删除 SubagentManager
└── 验证：全流程 + 子 Agent

Phase 4 (Week 4)
├── 合并 protocol → core
├── 清理 provider 包
├── 最终代码审查
└── 验证：全量测试 + 类型检查
```

---

## 九、一句话总结

> 停止克隆 SDK。信任它，使用它，在它之上构建差异化价值。
> 11,559 行的 agent 包应该是 2,000 行 — 因为 SDK 已经写好了另外 9,559 行。
> Vercel AI SDK 是一个多余的转换层 — pi-ai 的消息已经到了门口，不要再绕一圈。

---

## 十、pi-mono 适配计划

### 10.1 背景：为什么用 pi-mono 替代 Vercel AI SDK

当前 provider 包的双路由设计：Anthropic 模型走 Claude Agent SDK，其他模型走 Vercel AI SDK（`ai` + `@ai-sdk/openai`）。但项目 **已经深度使用 `@mariozechner/pi-ai`** 作为模型抽象层（`Message`、`Model`、`getModel`、`getModels`、`getProviders`），Vercel AI SDK 成了一个多余的中间层 — 它只被 `vercel-ai-sdk-provider.ts` 用于 `streamText()` 调用。

pi-mono 生态（`pi-ai` + `pi-agent-core`）相比 Vercel AI SDK 的优势：

| 维度 | Vercel AI SDK（当前） | pi-mono（目标） |
|------|:---:|:---:|
| 模型抽象 | 需要额外的 `@ai-sdk/openai` 等 provider 包 | `pi-ai` 已内置 20+ provider，零额外依赖 |
| Agent 循环 | 无内置 agent loop，需手动 `stepCountIs(20)` | `pi-agent-core` 内置有状态 agentic loop |
| 工具执行 | 手动在 `execute` 回调中管理生命周期 | `beforeToolCall`/`afterToolCall` 钩子原生支持 |
| 上下文压缩 | 无内置支持 | `transformContext` 钩子：每次 LLM 调用前自动转换消息历史 |
| Token/Cost 追踪 | 无内置支持 | 每次响应自带 `usage.input`/`output`/`cost.total` |
| 跨 Provider 切换 | 需手动转换 | `Context` 是纯 JSON，天然跨 provider 序列化 |
| 流式事件 | `textStream` 单一文本流 | 类型化事件流：`text_delta`、`thinking_delta`、`toolcall_delta` |
| 思维链 | 需手动处理 | `thinkingLevel` 一等公民（off/minimal/low/medium/high/xhigh） |
| 依赖体积 | `ai` + `@ai-sdk/openai` | 已有 `@mariozechner/pi-ai`，新增 `@mariozechner/pi-agent-core` |

**核心论点**：项目已经站在 pi-ai 的地基上，Vercel AI SDK 是一个嫁接上去的冗余层。替换后，non-Anthropic 路径从"pi-ai 模型 → Vercel streamText → 手动工具循环"变为"pi-ai 模型 → pi-agent-core Agent → 原生 agentic loop"，与 Claude Agent SDK 路径的架构对称。

### 10.2 当前依赖关系

```
@omi/provider
  ├── @mariozechner/pi-ai          ← 模型抽象（已深度使用）
  ├── @anthropic-ai/claude-agent-sdk  ← Anthropic 路径
  ├── ai (Vercel AI SDK)           ← 待删除
  └── @ai-sdk/openai               ← 待删除
```

`pi-ai` 的 `Message`/`Model`/`Context` 类型已贯穿整个 provider 包：
- `providers.ts` 的 `ProviderRunInput.historyMessages` 类型是 `Message`（from pi-ai）
- `model-resolver.ts` 全量使用 `Model<Api>`、`getModel`、`modelsAreEqual`
- `model-registry.ts` 使用 `getModels`、`getProviders`、`KnownProvider`
- `runtime-utils.ts` 的 `buildModelMessages()` 从 pi-ai `Message` 转换为 Vercel `ModelMessage` — **这正是多余的转换层**

### 10.3 适配设计

#### 10.3.1 新的 PiAgentProvider

```typescript
// packages/provider/src/runtimes/pi-agent-provider.ts
import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { getModel, type Context, type Message } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

class PiAgentProvider implements ProviderAdapter {
  private readonly agents = new Map<string, Agent>();

  async run(input: ProviderRunInput): Promise<ProviderRunResult> {
    const model = createModelFromConfig(input.providerConfig);

    // OmiTool[] → AgentTool[] — 直接映射，无需 Vercel jsonSchema 中间层
    const agentTools: AgentTool<any>[] = (input.tools ?? [])
      .filter(tool => !input.enabledTools || input.enabledTools.includes(tool.name))
      .map(tool => ({
        name: tool.name,
        label: tool.name,
        description: tool.description,
        parameters: tool.parameters,  // TypeBox schema 直接透传
        execute: async (toolCallId, params, signal, onUpdate) => {
          // 复用现有 ProviderToolLifecycleEvent 流程
          // beforeToolCall → approval → execute → afterToolCall
          const result = await this.executeWithLifecycle(input, tool, toolCallId, params, signal, onUpdate);
          return result;
        },
      }));

    const agent = new Agent({
      initialState: {
        systemPrompt: input.systemPrompt ?? "",
        model,
        tools: agentTools,
        messages: input.historyMessages,  // pi-ai Message[] 直接透传，零转换
        thinkingLevel: input.thinkingLevel ?? "off",
      },

      // 上下文压缩钩子 — 这是 Vercel AI SDK 完全不具备的能力
      transformContext: async (messages, signal) => {
        // 接入 OMI 的压缩策略（或 SDK 内置压缩管线）
        return messages;
      },

      // 工具审批 — 映射到 OMI 的 ProviderToolLifecycleEvent
      beforeToolCall: async ({ toolCall, args, context }) => {
        if (!input.onToolLifecycle) return undefined;
        const control = await input.onToolLifecycle({
          stage: "requested",
          runId: input.runId,
          sessionId: input.sessionId,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: args,
        });
        if (control?.allowExecution === false) {
          return { block: true, reason: control.error ?? "Denied by runtime policy." };
        }
        return undefined;
      },

      afterToolCall: async ({ toolCall, result, isError }) => {
        await input.onToolLifecycle?.({
          stage: isError ? "failed" : "finished",
          runId: input.runId,
          sessionId: input.sessionId,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: {},
          output: result,
          error: isError ? String(result) : undefined,
        });
        return undefined;
      },
    });

    this.agents.set(input.runId, agent);

    // 流式事件转发
    let assistantText = "";
    agent.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        assistantText += event.assistantMessageEvent.delta;
        input.onTextDelta?.(event.assistantMessageEvent.delta);
      }
    });

    await agent.prompt(input.prompt);
    await agent.waitForIdle();

    const lastMessage = agent.state.messages.at(-1);
    const usage = lastMessage?.usage ?? { input: 0, output: 0 };

    this.agents.delete(input.runId);

    return {
      assistantText,
      stopReason: "end_turn",
      usage: {
        inputTokens: usage.input,
        outputTokens: usage.output,
        // pi-ai 内置 cost tracking，不再需要自定义 cost-tracker
      },
      error: null,
    };
  }

  cancel(runId: string): void {
    const agent = this.agents.get(runId);
    agent?.abort();
    this.agents.delete(runId);
  }
}
```

#### 10.3.2 运行时路由更新

```typescript
// packages/provider/src/runtimes/resolver.ts
export type ProviderRuntime = "claude-agent-sdk" | "pi-agent-core";

export function resolveProviderRuntime(providerConfig: ProviderConfig): ProviderRuntime {
  if (providerConfig.protocol === "anthropic-messages") {
    return "claude-agent-sdk";
  }
  return "pi-agent-core";  // 所有非 Anthropic 模型走 pi-agent-core
}

// packages/provider/src/providers.ts
export class PiAiProvider implements ProviderAdapter {
  private readonly claudeProvider: ProviderAdapter;
  private readonly piAgentProvider: ProviderAdapter;  // 替代 vercelProvider

  async run(input: ProviderRunInput): Promise<ProviderRunResult> {
    const runtime = resolveProviderRuntime(input.providerConfig);
    return runtime === "claude-agent-sdk"
      ? this.claudeProvider.run(input)
      : this.piAgentProvider.run(input);
  }
}
```

#### 10.3.3 上下文压缩策略

pi-agent-core 的 `transformContext` 钩子在每次 LLM 调用前触发，接收完整的 `AgentMessage[]`，返回压缩后的消息序列。这与 Claude Agent SDK 的内置压缩管线职责等价，但需要 **OMI 自己提供压缩逻辑**。

```
调用链路：
AgentMessage[] → transformContext() → AgentMessage[]（压缩后） → convertToLlm() → Message[] → LLM

压缩策略选项：
1. 简单截断：保留最近 N 条消息 + system prompt
2. 摘要压缩：对旧消息调用轻量模型生成摘要，替换原始消息
3. 基于 token 预算：计算剩余 context window，按优先级裁剪
4. 混合策略：保留工具调用结果 + 摘要中间对话
```

**推荐实现**：Phase 1 先用简单截断（基于 token 计数），Phase 2 引入摘要压缩。`transformContext` 的钩子设计天然支持渐进式增强。

#### 10.3.4 消息类型对齐

关键优势：**pi-ai 的 `Message` 类型已经贯穿整个 provider 包**，替换后零消息转换。

```
当前：pi-ai Message → buildModelMessages() → Vercel ModelMessage → streamText()
目标：pi-ai Message → Agent.initialState.messages（直接透传） → pi-agent-core 内部处理
```

删除 `runtime-utils.ts` 中的 `buildModelMessages()`、`toModelUserContent()`、`buildToolResultOutput()` —— 这些函数的唯一目的就是把 pi-ai 消息转成 Vercel 格式。

### 10.4 删除清单

| 文件/依赖 | 原因 |
|----------|------|
| `vercel-ai-sdk-provider.ts` | 被 `pi-agent-provider.ts` 替代 |
| `vercel-ai-sdk-provider.test.ts` | 对应测试文件 |
| `runtime-utils.ts` 中的 Vercel 转换函数 | `buildModelMessages()`、`toModelUserContent()` 等不再需要 |
| `mapVercelFinishReasonToModel()` | Vercel 特有的 finish reason 映射 |
| `ai`（package.json） | Vercel AI SDK 主包 |
| `@ai-sdk/openai`（package.json） | Vercel OpenAI provider |

### 10.5 新增清单

| 文件/依赖 | 目的 |
|----------|------|
| `pi-agent-provider.ts` | pi-agent-core 的 ProviderAdapter 实现 |
| `pi-agent-provider.test.ts` | 对应测试 |
| `@mariozechner/pi-agent-core`（package.json） | Agent 运行时（agentic loop + tool execution） |
| `context-compressor.ts`（可选） | `transformContext` 钩子的压缩策略实现 |

### 10.6 执行步骤

```
Step 1：创建 PiAgentProvider
├── 新建 pi-agent-provider.ts
├── 实现 ProviderAdapter 接口
├── OmiTool[] → AgentTool[] 映射
├── ProviderToolLifecycleEvent → beforeToolCall/afterToolCall 映射
├── 流式事件转发（subscribe → onTextDelta）
└── 验证：单元测试 + 类型检查

Step 2：更新路由
├── resolver.ts：ProviderRuntime 改为 "claude-agent-sdk" | "pi-agent-core"
├── providers.ts：PiAiProvider 路由到 PiAgentProvider
├── 更新所有 import
└── 验证：现有 Claude 路径不受影响

Step 3：删除 Vercel AI SDK
├── 删除 vercel-ai-sdk-provider.ts + 测试
├── 清理 runtime-utils.ts 中的 Vercel 转换函数
├── 从 package.json 移除 ai、@ai-sdk/openai
└── 验证：npm install + 类型检查 + 全量测试

Step 4：实现 transformContext 压缩
├── 创建 context-compressor.ts（简单截断策略）
├── 注入到 PiAgentProvider 的 transformContext 钩子
├── 配置 token 预算（基于模型 contextWindow）
└── 验证：长对话场景的压缩行为
```

### 10.7 架构对称性

替换完成后，两条运行时路径具有 **架构对称性**：

```
Anthropic 模型：
  ProviderRunInput → ClaudeAgentSdkProvider → query() → SDK 内置 agentic loop
                                                          ├── 内置工具执行
                                                          ├── 内置压缩管线
                                                          └── 内置恢复逻辑

非 Anthropic 模型：
  ProviderRunInput → PiAgentProvider → Agent.prompt() → pi-agent-core agentic loop
                                                          ├── AgentTool 工具执行
                                                          ├── transformContext 压缩钩子
                                                          └── 内置 token/cost tracking
```

两条路径都是"单次调用启动完整 agent 循环"，不再有外层循环或手动 step 计数。差异仅在于 SDK 实现细节，ProviderAdapter 接口屏蔽了这些差异。
