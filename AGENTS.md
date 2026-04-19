# OMI — AI Agent Workbench

OMI 是一个本地优先的 AI Agent 桌面工作台，基于 Electron + React 桌面端、Node.js Runner 子进程，以及围绕 `@omi/agent` 组织的运行时内核。

当前项目判断：
- Agent 运行时主链路已经基本成型，核心问题不再是后端架构缺失。
- 现在的主要短板在桌面端页面质量、交互一致性和若干视图的真实数据接线不足。
- 可以把项目理解为“内核已成型，UI/产品层明显落后于运行时能力”。

## 当前架构总览

```text
apps/desktop (Electron + React 19)
  └─ 通过 preload + runner-gateway 与 Runner 通信
      └─ apps/runner (Node.js 子进程 / JSON-RPC)
          └─ @omi/agent (Orchestrator / AgentSession / Permission / Skill / Event)
              ├─ @omi/provider (Claude Agent SDK + pi-agent-core 路由、MCP)
              ├─ @omi/tools (OMI 自定义工具，如 skill / subagent)
              ├─ @omi/memory (历史消息、memory recall、上下文注入、compaction)
              ├─ @omi/prompt (系统提示词、AGENTS/CLAUDE 项目上下文加载)
              ├─ @omi/store (SQLite + Drizzle 持久化)
              ├─ @omi/settings (全局/项目配置管理)
              └─ @omi/core (领域模型、事件、协议、工具类型)
```

## 项目现状

### 1. 已经比较完整的部分

- 会话、消息、Run、ToolCall、Memory、ProviderConfig 已经有稳定的 SQLite 持久化模型。
- `@omi/agent` 已具备 Orchestrator、SessionRuntime、Run 队列、工具生命周期、事件分发、权限评估、技能加载等主干能力。
- `@omi/provider` 已支持多协议 Provider 路由：
  - `anthropic-messages` 走 Claude Agent SDK
  - 其余协议走 pi-agent-core runtime
- MCP 基础设施已经落地在 `@omi/provider`，包含 `mcp-client.ts`、`mcp-registry.ts`。
- 权限系统已经从“简单开关”发展为规则驱动模型，包含：
  - `permissions/rules.ts`
  - `permissions/evaluator.ts`
  - `permissions/persistence.ts`
  - `permissions/tracking.ts`
- 工具层已经收缩为 OMI 特有能力，标准编码工具不再由 OMI 重造。
  - 当前 `@omi/tools` 内建重点是 `skill`、`subagent`
  - 标准 Read / Write / Edit / Bash / Grep / LS 等由 SDK preset 提供
- 测试已经铺到主要包，`vitest` 是统一测试框架。

### 2. 目前最明显的短板

- `apps/desktop` 虽然已经有完整视图骨架：
  - `new-thread`
  - `chat`
  - `plugins`
  - `automations`
  - `settings`
  - `config`
  - `providers`
  - `diagnostics`
- 但除聊天主链路、线程列表、工具事件展示外，多个页面仍偏静态展示或半成品壳层。
- 页面视觉语言、信息密度、组件一致性、状态闭环还不够好。
- 当前更像“运行时能力先行，桌面产品层尚未跟上”。

## 一次运行的真实链路

```text
用户在 Desktop 输入 prompt
  → renderer 调用 runner-gateway
    → preload / IPC 转发到 apps/runner
      → Runner 解析 JSON-RPC 命令
        → AppOrchestrator.startRun()
          → AgentSession 创建 user message / run record
            → ResourceLoader 加载 AGENTS.md / CLAUDE.md / skills / prompt context
            → memory 构建历史消息与注入上下文
            → provider runtime 发起 LLM 调用
              → 流式 text delta / SDK message / tool lifecycle 回传
              → PermissionEvaluator 判断 allow / ask / deny
              → 工具执行结果写回 DB
            → assistant message 持久化
          → RunnerEvent 回传 Desktop
  → workspace-store 驱动 UI 实时更新
```

## 包职责

### `@omi/core`

零依赖基础包，定义所有上层共享的领域模型与协议。

- `domain.ts`: Session、Run、Task、ToolCall、SessionMessage、MemoryRecord、ProviderConfig、SkillDescriptor 等 schema
- `events.ts`: Runner 事件 union
- `protocol.ts`: RPC 命令 schema、解析器
- `tool-types.ts`: OmiTool、ThinkingLevel、工具结果类型
- `compaction.ts`: compaction summary schema
- `skill-setting-sources.ts`: 技能/设置源相关类型
- `utils.ts`: `createId`、`nowIso`、`AppError`

### `@omi/store`

SQLite 持久化层，当前仍是系统事实来源之一。

- `contracts.ts`: `AppStore` 接口
- `schema.ts`: Drizzle 表定义
- `sqlite-store.ts`: `better-sqlite3` 实现

核心表：
- `sessions`
- `tasks`
- `run_logs`
- `messages`
- `tool_calls`
- `memories`
- `provider_configs`

消息模型仍是树结构，支持分支和压缩追溯。

### `@omi/provider`

Provider 适配与运行时路由层。

- `providers.ts`: `ProviderAdapter`、`ProviderRunInput`、runtime router facade
- `protocol-router.ts`: 协议到 runtime 的分流
- `model-registry.ts` / `model-resolver.ts` / `provider-defaults.ts`: 内建模型、默认值、解析逻辑
- `runtimes/claude-agent-sdk-provider.ts`: Claude Agent SDK runtime
- `runtimes/pi-agent-provider.ts`: pi-agent-core runtime
- `mcp-client.ts` / `mcp-registry.ts`: MCP server 管理、连接、聚合 catalog

当前实际形态已经不是“纯 provider 薄封装”，而是包含 MCP runtime 集成能力。

### `@omi/tools`

OMI 自定义工具层，不再重复实现通用编码工具。

- `builtins.ts`: 当前主要注册 `skill`、`subagent`
- `pi-skill.ts` / `pi-skill-tools.ts`: 技能工具与技能执行桥
- `pi-subagent.ts`: 子代理工具
- `definitions.ts` / `registry.ts`: 工具定义、风险等级、结构化输出执行
- `runtime.ts`: `ToolRuntimeContext`、task runtime 接口

判断原则：
- 通用 coding tool 交给 SDK
- OMI 特有编排能力留在 `@omi/tools`

### `@omi/memory`

负责会话消息构建、memory recall、注入与 compaction。

- `messages.ts`: runtime message 构建与 LLM 格式转换
- `memory-recall.ts`: 相关 memory 检索
- `memory-inject.ts`: token budget 管理与 memory 注入
- `memory-types.ts`: memory 类型
- `compaction.ts`: 历史压缩策略
- `logger.ts`: memory 相关日志

### `@omi/prompt`

系统提示词与项目上下文组装层。

- `system-prompt.ts`: `buildSystemPrompt()`
- 负责加载项目里的 `AGENTS.md` / `CLAUDE.md` 并注入到系统提示词

### `@omi/settings`

全局/项目配置管理。

- `settings-manager.ts`: 配置读写、深合并、锁保护

### `@omi/agent`

系统核心编排层，已经是当前项目复杂度最高的包。

主要文件：
- `orchestrator.ts`: 顶层门面，管理 session/run/tool/provider/git
- `agent-session.ts`: 单 session 执行引擎
- `session-manager.ts`: Session runtime 状态管理
- `task-runtime.ts`: 与 Task / Tool runtime 的连接层
- `resource-loader.ts`: 项目上下文、技能、系统提示词资源加载
- `event-bus.ts`: 事件分发
- `observability.ts` / `logger.ts`: 可观测性与日志
- `vcs.ts`: Git 状态与 diff
- `prompt-templates.ts`: prompt 模板辅助

权限模块已独立成目录：
- `permissions/evaluator.ts`
- `permissions/rules.ts`
- `permissions/persistence.ts`
- `permissions/tracking.ts`
- `permissions/index.ts`

技能模块：
- `skills/discovery.ts`
- `skills/index.ts`
- `skills/frontmatter.ts`
- `skills/bundled/*`

### `apps/runner`

Runner 子进程负责 Desktop 与 Orchestrator 的桥接。

- 创建数据库
- 实例化 `AppOrchestrator`
- 接收并解析 JSON-RPC 请求
- 分发 `session.*` / `run.*` / `tool.*` / `provider.*` / `model.*` / `git.*`
- 将运行事件转发回桌面端

### `apps/desktop`

当前桌面端已经具备应用骨架，但产品完成度仍落后于内核。

关键文件：
- `store/workspace-store.ts`: 前端状态中心
- `lib/runner-gateway.ts`: Runner RPC 桥接
- `App.tsx`: 顶层视图切换
- `components/Sidebar.tsx`: 线程/文件夹/导航
- `components/MainContent.tsx`: 主区域视图装配
- `components/views/Chat.tsx`: 当前最接近真实工作流的页面
- `components/tool-ui/*`: ToolCall、审批卡片、RunEvent、Terminal、Diff 等 UI

当前桌面端判断：
- Chat / thread / tool timeline 已经开始承载真实 runtime 数据
- Settings / Plugins / Automations 等页面仍有明显“静态壳层”特征
- 页面设计质量问题大于底层功能缺失问题

## 依赖约束

```text
core
  ├─ store
  ├─ provider
  ├─ tools
  ├─ memory
  ├─ prompt
  └─ settings

agent
  └─ 聚合消费上述基础包

runner
  └─ 依赖 agent / store / provider / memory / core

desktop
  └─ 依赖 runner + core
```

原则：
- 依赖方向单向，底层不反向引用上层
- `agent` 是编排层，不应成为新的“万能公共包”
- UI 不应绕过 Runner 直接碰底层实现

## 开发规范

### 测试

- 统一使用 `vitest`
- 测试目录位于各包 `test/**`
- 命名使用 `*.test.ts` / `*.test.tsx`
- 新功能至少覆盖：
  - 成功路径
  - 失败路径
  - 边界条件

### TypeScript

- 各模块 `tsconfig.json` 需要覆盖 `src/**` 与 `test/**`
- 路径别名必须与构建配置一致
- 根配置使用 `jsx: react-jsx`

### 工程命令

根目录常用命令：
- `pnpm dev`
- `pnpm build`
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`

## 维护这份文档时的判断标准

更新 `AGENTS.md` 时，以当前代码事实为准，不以旧设计文档为准。

如果出现冲突，优先级如下：
1. 当前仓库实际文件结构
2. 当前运行链路与测试覆盖
3. 历史设计文档

当前对 OMI 的最准确定义是：

> 它已经不是一个“后端架构还没搭起来”的项目，而是一个 Agent runtime 已经基本成立、但桌面端产品体验明显落后的本地 AI Agent 工作台。
