# OMI Agent 产品文档

副标题：以 Claude Agent SDK 为核心的双 Runtime Agent 方案与代码库实现盘点

更新时间：2026-04-18

## 1. 产品定位

OMI 的目标不是再造一套外置 Agent Loop，而是以 `Claude Agent SDK` 为主引擎，保留 `pi-agent-core` 作为第二运行时，做一层薄而稳定的编排系统：

- Anthropic 协议模型走 `Claude Agent SDK`
- OpenAI 协议模型走 `pi-agent-core`
- 会话层使用稳定的 `query() + resume`
- 标准编码工具优先复用 Claude SDK 原生能力
- OMI 只保留自己真正独特的能力：会话、历史分支、审批、权限、技能、记忆、任务、扩展

明确非目标：

- 不再维护一套与 SDK 对抗的外层 agent loop
- 不再重建 Claude Code 同款标准工具
- 当前阶段不把 hook 作为核心产品面

## 2. 产品原则

### 2.1 设计原则

- SDK-first：SDK 已有能力不在外层重复实现
- 双 Runtime：Claude 路径追求能力最大化，pi 路径承担协议兼容与补位
- 会话优先：所有能力都应服务于可持续、可恢复、可审计的 session
- fail-closed：工具执行、权限、审批、工作区切换默认保守
- 薄编排：编排层负责路由和状态，不负责重复发明底层机制

### 2.2 产品边界

一个强大的 AI Agent，最少应具备以下 12 类能力：

1. 会话管理
2. Agentic runtime 与模型路由
3. 工具调用与权限审批
4. 历史分支与恢复
5. 任务与 review 流
6. 技能与提示词注入
7. 记忆注入与召回
8. MCP 与外部扩展
9. SubAgent / 多 Agent
10. 计划模式与隔离执行
11. 可观测性与事件流
12. 设置、模型、Provider 管理

## 3. 目标产品能力

### 3.1 会话管理

用户应该能：

- 创建、列出、查看、重命名 session
- 连续对话，不丢失上下文
- 在历史节点继续对话，形成 branch
- 恢复中断 run，而不是只能重新开始
- 看到 run、tool、review 的状态

### 3.2 Runtime 与模型路由

系统应该能：

- 根据 provider 协议自动选择 runtime
- Anthropic 路径最大化使用 Claude Agent SDK 能力
- OpenAI 路径维持独立兼容运行时
- 暴露 reasoning / thinking 等级
- 支持 provider 切换、模型切换、工作目录切换

### 3.3 工具与权限

系统应该能：

- 区分标准工具、OMI 工具、MCP 工具、runtime 原生工具
- 在工具请求前做 preflight
- 对危险工具做审批阻塞
- 记录工具输入、输出、失败、拒绝原因
- 同时覆盖 Claude 原生 tool 和 OMI 自定义 tool

### 3.4 历史、分支与恢复

系统应该能：

- 持久化 run lineage
- 从历史节点继续
- 从失败或阻塞 run 重试/恢复
- 保存运行时快照
- 在进程重启后仍可恢复 runtime 所需最小状态
- 对 Claude 原生 session resume 做持久化，而不是仅内存级恢复

### 3.5 任务与 Review

系统应该能：

- 从对话中形成任务
- 任务有 inbox / active / review / done 生命周期
- run 失败后自动产生 review 请求
- 后续支持人工 review、二次执行、归档

### 3.6 技能与提示词注入

系统应该能：

- 从 workspace / user / bundled 三层发现 skill
- 根据 prompt 自动匹配 skill
- 把 skill 安全注入系统提示词
- 将 skill 限制在允许工具集合内
- 支持 skill 作为工具或命令被调用

### 3.7 记忆

系统应该能：

- 支持基于 `MEMORY.md` 的索引记忆
- 根据 query 召回相关记忆
- 在 token budget 内注入记忆
- 在回答前验证记忆是否仍然有效
- 把 session/task/workspace 级记忆写回持久层

### 3.8 MCP 与扩展

系统应该能：

- 管理外部 MCP server
- 聚合 MCP tools / resources / prompts
- 在权限体系中识别 MCP server 维度
- 将 MCP server 注入 Claude runtime
- 将扩展能力作为稳定的产品面暴露给 runner / desktop

### 3.9 SubAgent / 多 Agent

系统应该能：

- 在 Claude runtime 中声明子 Agent
- 在 pi runtime 中补齐对应的 SubAgent 路径
- 提供任务拆分、职责边界、结果回传
- 支持串行或并行的子 Agent 执行策略
- 将子 Agent 视为一等能力，而不是隐藏参数

### 3.10 计划模式与隔离执行

系统应该能：

- 支持 plan-only 模式
- 支持 worktree 隔离执行
- 在 plan 阶段限制只读工具
- 将 plan 审批与执行权限关联

### 3.11 可观测性

系统应该能：

- 统一 run 事件流
- 透传 SDK 原生事件
- 记录工具生命周期
- 记录失败与恢复链路
- 为 UI / RPC 提供稳定订阅接口

### 3.12 设置与 Provider 管理

系统应该能：

- 管理 provider config
- 管理模型目录与可用模型
- 存储 API Key
- 根据协议能力决定 runtime 与 API 变体

## 4. 当前代码库实现盘点

状态定义：

- `已实现`：产品面已连通，且有明确调用路径
- `部分实现`：底层代码存在，但产品面不完整或缺关键持久化/接口
- `未实现`：只有概念、类型或零散基础设施
- `明确收缩`：能力被主动移除，不应误判为缺陷

| 能力 | 状态 | 结论 |
| --- | --- | --- |
| Session CRUD | 已实现 | runner 与 orchestrator 都已连通 |
| 双 Runtime 路由 | 已实现 | Anthropic -> Claude SDK，其他 -> pi-agent-core |
| Claude `query()` 主循环 | 已实现 | Claude runtime 已由 SDK 驱动 |
| Claude 原生 session auto-resume | 部分实现 | 仅内存游标，不可跨进程稳定恢复 |
| run retry / resume lineage | 已实现 | DB 与 runtime snapshot 已建模 |
| 历史分支 continue | 已实现 | 有 branch summary 与 history continue 路径 |
| 工具审批与 fail-closed | 已实现 | OMI tool 与 Claude built-in tool 都纳入生命周期 |
| Claude 标准工具集 | 明确收缩 | 交给 `claude_code` preset，OMI 不再重复实现 |
| OMI 自定义工具 | 已实现但极简 | 当前只保留 `skill` |
| Skills 自动发现与注入 | 已实现 | 发现、匹配、注入、命令化路径存在 |
| Memory recall / inject 产品闭环 | 部分实现 | memory 包完整，但 agent 主流程未接入 |
| MCP client / registry | 部分实现 | provider 包有实现，但未接入主执行链 |
| 外部扩展 / 插件运行时 | 部分实现 | UI 与类型存在，核心扩展运行面未打通 |
| Claude SubAgent | 部分实现 | provider 支持透传 `agents`，上层无产品面 |
| pi 路径 SubAgent | 未实现 | 未见对应 orchestrator/runtime 抽象 |
| Plan mode | 部分实现 | 有内部状态机，runner 未暴露为正式控制面 |
| Worktree mode | 部分实现 | 有内部实现，未进入主产品流程 |
| Task 生命周期 | 部分实现 | DB 与 runtime 有，runner 无完整命令面 |
| Review 请求 | 部分实现 | 失败时会生成 final review，请求流未公开 |
| 事件订阅与 SDK passthrough | 已实现 | runner event + `sdk.*` 透传已具备 |
| Provider / Model 管理 | 已实现 | 保存、删除、切换、列举均可用 |
| 独立 `protocol` 包 | 未实现为独立包 | 已并入 `@omi/core`，与目标分包不一致 |
| 独立 `extensions` 包 | 未实现 | 扩展相关代码散落在 `provider/agent/desktop` |

## 5. 代码证据与判断

### 5.1 已实现能力

#### A. Session、Run、History、Tool 基础闭环

实现证据：

- RPC 命令定义在 `packages/core/src/protocol.ts`
- runner 支持命令在 `apps/runner/src/request-handler.ts`
- 编排入口在 `packages/agent/src/orchestrator.ts`
- 执行主流程在 `packages/agent/src/agent-session.ts`
- 运行时快照在 `packages/agent/src/session-manager.ts`
- 持久化契约在 `packages/store/src/contracts.ts`

当前已打通的公开命令面：

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

#### B. 双 Runtime 已成立

实现证据：

- 路由逻辑在 `packages/provider/src/runtimes/resolver.ts`
- 统一 facade 在 `packages/provider/src/providers.ts`
- Claude runtime 在 `packages/provider/src/runtimes/claude-agent-sdk-provider.ts`
- pi runtime 在 `packages/provider/src/runtimes/pi-agent-provider.ts`

当前策略：

- `anthropic-messages` -> `claude-agent-sdk`
- `openai-chat` / `openai-responses` -> `pi-agent-core`

#### C. Claude SDK 能力已经真正接进主链路

实现证据：

- `query()` 已作为 Claude 主执行入口使用
- `claude_code` preset 默认开启
- `canUseTool` 已桥接到 OMI 权限系统
- `onSdkMessage` 已透传为 `sdk.*` 事件
- `agents` 参数已在 provider 层透传

关键文件：

- `packages/provider/src/runtimes/claude-agent-sdk-provider.ts`
- `packages/provider/test/runtimes/claude-agent-sdk-provider.test.ts`

#### D. 权限与审批闭环已成立

实现证据：

- 规则模型在 `packages/agent/src/permissions/rules.ts`
- 评估器在 `packages/agent/src/permissions/evaluator.ts`
- 生命周期处理在 `packages/agent/src/agent-session.ts`

关键结论：

- OMI 自定义 tool 走 `onToolLifecycle`
- Claude built-in tool 也通过 `canUseTool` 回流到同一审批体系
- 默认策略是 fail-closed

#### E. Skills 已经是产品级能力

实现证据：

- 发现与匹配在 `packages/agent/src/skills/discovery.ts`
- 资源加载在 `packages/agent/src/resource-loader.ts`
- 系统提示词注入在 `packages/prompt/src/system-prompt.ts`
- 执行时注册在 `packages/agent/src/agent-session.ts`

当前能力：

- workspace / user / bundled 三层 skill
- prompt 触发 skill 匹配
- skill 可变成 `/skill:*` 命令
- skill 工具限制会过滤到受支持工具

### 5.2 部分实现能力

#### A. 稳定版 `query() + resume` 只完成了一半

现状：

- Claude provider 内有 `sessionCursors: Map<string, string>`
- 第二次同 session 调用时会自动把上一次 `session_id` 填入 `options.resume`
- 这条路径在测试里已覆盖

实现证据：

- `packages/provider/src/runtimes/claude-agent-sdk-provider.ts`
- `packages/provider/test/runtimes/claude-agent-sdk-provider.test.ts`

本质缺口：

- Claude 原生 session cursor 只存在内存 `Map`
- `providerMeta.sessionId` 没有持久化进 `store`
- `session_runtime` snapshot 里也没有 SDK cursor 字段
- 进程重启后无法稳定 resume 原生 Claude session

结论：

- 单进程连续会话可用
- 跨进程、跨重启的稳定 resume 还没落地

#### B. SubAgent 只有 provider 透传，没有产品面

现状：

- `ProviderRunInput` 里有 `agents?: Record<string, ...>`
- Claude provider 会把 `input.agents` 直接透传给 SDK options

实现证据：

- `packages/provider/src/providers.ts`
- `packages/provider/src/runtimes/claude-agent-sdk-provider.ts`

缺口：

- `orchestrator` 没有 `subagent.create` / `subagent.run` 之类入口
- `runner` 没有命令面
- `agent-session` 不会基于任务自动构造子 Agent 定义
- `pi-agent-core` 路径没有对应的 SubAgent 抽象
- 工具面测试明确断言 `subagent.spawn` 不存在

实现证据：

- `packages/tools/test/runtime-fail-closed.test.ts`

结论：

- Claude SDK 的 SubAgent 能力“理论可接”
- OMI 还没有把它做成真正可用的产品能力

#### C. Memory 包完整，但主流程没接入

现状：

- `memory-recall.ts`、`memory-inject.ts`、`messages.ts` 都在
- 有 token budget、索引裁剪、召回与校验逻辑

实现证据：

- `packages/memory/src/memory-recall.ts`
- `packages/memory/src/memory-inject.ts`

缺口：

- `agent-session` 构建 `systemPrompt` 时没有调用 `MemoryInjector`
- 运行时没有基于 query 做 memory recall
- store 有 `writeMemory/searchMemories`，但当前执行主链未形成读写闭环

结论：

- Memory 是“包级完成、产品级未接通”

#### D. MCP 基础设施存在，但未成为一等产品面

现状：

- provider 包有 `McpClient`、`McpRegistry`
- Claude provider 能把 OMI 本地工具包装为 in-process MCP server

实现证据：

- `packages/provider/src/mcp-client.ts`
- `packages/provider/src/mcp-registry.ts`
- `packages/provider/src/runtimes/claude-agent-sdk-provider.ts`

缺口：

- 外部 MCP server 没有从 orchestrator 注入到 run
- runner 没有 `mcp.server.*`、`mcp.tool.*`、`mcp.resource.*` 命令面
- 权限规则虽然支持 `mcp__*` 和 `mcp_server` 匹配，但主链没有外部 MCP 工具来源

结论：

- 现在只有“OMI tool -> Claude MCP bridge”
- 还没有“外部 MCP 生态 -> OMI 产品面”

#### E. Task / Review / Plan / Worktree 都处于半成品状态

Task 与 Review：

- DB、runtime、task-tool runtime 存在
- run 失败时会创建 `final_review`
- 但 runner 没有 task/review 的完整命令面

实现证据：

- `packages/agent/src/task-runtime.ts`
- `packages/agent/src/agent-session.ts`
- `packages/store/src/contracts.ts`

Plan：

- `PlanStateManager` 已实现
- `/plan` 在 Anthropic 路径保留原样，在 OpenAI 路径重写为 plan-only prompt
- 但 plan mode 不是正式 RPC 控制面

实现证据：

- `packages/agent/src/modes/plan-mode.ts`
- `packages/agent/src/orchestrator.ts`

Worktree：

- `WorktreeStateManager` 已实现，且删除策略 fail-closed
- 但没有进入 runner 主命令面

实现证据：

- `packages/agent/src/modes/worktree-mode.ts`

### 5.3 明确收缩能力

这部分不是“没做完”，而是“主动删掉，避免重复”。

#### A. 标准 coding tools 交给 Claude SDK

当前策略：

- `bash/read/write/edit/grep/find/ls` 不再由 OMI 自己暴露
- `claude_code` preset 承担标准工具集
- OMI 只保留自有工具，目前是 `skill`

实现证据：

- `packages/provider/src/runtimes/claude-agent-sdk-provider.ts`
- `packages/tools/src/builtins.ts`
- `packages/tools/test/runtime-fail-closed.test.ts`

#### B. 公开命令面主动变窄

当前 runner 只保留 session/run/tool/provider/git 这几个核心族群，不再公开旧的多代理、计划、web、cron 类控制面。

实现证据：

- `apps/runner/src/request-handler.ts`
- `docs/claude-first-runtime-architecture.md`

## 6. 与目标分包结构的偏差

按目标结构，你希望存在：

- `core`
- `protocol`
- `agent`
- `provider`
- `tools`
- `store`
- `memory`
- `extensions`
- `settings`
- `prompt`

当前实际情况：

- 已存在：`core/agent/provider/tools/store/memory/settings/prompt`
- 未独立存在：`protocol/extensions`

偏差判断：

### 6.1 `protocol`

当前 RPC schema 已合并进 `packages/core/src/protocol.ts`。

优点：

- 减少了空壳 schema 包

代价：

- 与目标“协议独立包”不一致
- `core` 同时承担领域模型与 runner 协议契约，边界不够纯

### 6.2 `extensions`

当前扩展相关能力散落在：

- `packages/provider/src/mcp-client.ts`
- `packages/provider/src/mcp-registry.ts`
- `packages/agent/src/slash-commands.ts`
- `apps/desktop/src/renderer/components/views/Plugins.tsx`

问题本质：

- “扩展”还不是一个清晰职责包，只是若干零散点位

## 7. 当前系统最值得优先补的 5 个缺口

### P0. 持久化 Claude 原生 resume cursor

目标：

- 将 Claude `session_id` 写入 `session_runtime` 或 run/provider metadata
- `resumeRun()` 与正常 follow-up 都能跨进程恢复

原因：

- 这是“稳定版 `query() + resume`”与“单进程凑合能用”的分水岭

### P1. 把 SubAgent 做成一等产品面

目标：

- 在 `agent` 包定义子 Agent 描述与调度接口
- Claude runtime 直接透传到 SDK
- pi runtime 增加对应补位实现
- runner 增加最小控制面或自动化调度面

原因：

- 你明确要用 Claude SDK 的全部能力，SubAgent 是当前最明显的缺口

### P2. 打通 Memory 闭环

目标：

- query 前 recall
- system prompt 注入 memory
- answer 前校验 memory 漂移
- 用户确认时写回 memory

原因：

- 现在 memory 像一个独立库，不像主产品能力

### P3. 把外部 MCP / 扩展真正接进运行链

目标：

- orchestrator 可注册/加载 MCP server
- run 时将外部 MCP server 注入 Claude runtime
- 统一权限、事件与错误模型

原因：

- 这决定 OMI 是“一个会调自己工具的 Agent”，还是“一个可扩展平台”

### P4. 收紧包边界

目标：

- 明确 `protocol` 是否继续留在 `core`
- 真正抽出 `extensions` 包
- 减轻 `agent-session` 与 `orchestrator` 的职责过载

原因：

- 能力继续增长后，不先收边界，就会再次回到 God object

## 8. 产品结论

OMI 当前已经具备一个强 AI Agent 的骨架，而且最重要的方向是对的：Claude 路径回归 SDK-first，标准工具回归 SDK 原生，双 Runtime 也已跑通。真正的问题不在“有没有 Agent”，而在“还有几块关键器官没接上”。

结论可以压缩成三句：

- 核心单 Agent 编码助手已经成立，且 Claude 路径能力最强
- `query() + resume`、Memory、MCP、SubAgent 这四块还没有形成完整产品闭环
- 下一阶段不该继续铺功能面，而该补齐持久化恢复、子 Agent、一等扩展与记忆闭环

## 9. 建议的下一份文档

这份文档之后，建议紧接着补一份《OMI Agent vNext 技术设计》。

那份设计只解决四件事：

1. Claude resume cursor 存储模型
2. SubAgent 统一抽象与双 runtime 落地
3. MCP / extensions 包拆分与注入链路
4. memory inject/recall/write-back 主流程接线

如果这四件事做对，OMI 就会从“架构方向正确的 Agent”进入“产品能力完整的 Agent”。
