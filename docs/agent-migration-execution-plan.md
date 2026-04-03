# OMI Agent 迁移执行总计划（目标：能力达到 claude-code-main 级别）

更新时间：2026-04-02
负责人：Codex（执行草案）
适用仓库：`/Users/zhangyanqi/IdeaProjects/omi`
参考仓库：
- `/Users/zhangyanqi/Documents/Agent/claude-code-main`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk-typescript-main`

---

## 0. 文档定位与最终目标

这份文档不是“能力清单”，而是**可执行迁移计划**，用于把 OMI 的 Agent 能力升级到 claude-code-main 同等级成熟度（重点在内核与控制面，不追求 UI 1:1）。

最终目标（必须同时满足）：
1. 会话体系：支持分支、可回放、可恢复、可审计。
2. 故障恢复：支持中断恢复、API 异常恢复、工具中断恢复、长上下文恢复。
3. Skill 体系：支持文件化技能、前置条件、权限约束、inline/fork 两种执行。
4. SubAgent 体系：支持受控委派、任务邮箱、并发协作、冲突隔离。
5. MCP 体系：支持连接生命周期、工具/资源统一管理、权限一致治理。
6. 上下文工程：支持预算、微压缩、自动压缩、压缩后自动续跑。
7. 记忆系统：支持结构化记忆写入、召回、注入、压缩联动。
8. 多 Agent 协作：支持 coordinator/squad 两类协作拓扑。
9. 协议适配：在 OpenAI Chat + OpenAI Responses + Claude 协议下完整实现以上能力。

---

## 1. 第一性原理（执行约束）

1. Agent 的本质是“可持续闭环执行系统”，不是函数集合。
- 闭环最小单元：状态持久化、上下文构建、执行循环、工具边界、故障恢复。

2. 迁移目标是“行为与可靠性对齐”，不是代码逐行照搬。
- 可以 copy 架构、算法、模块划分。
- 不能把外部项目的协议假设（Claude 专有）原样带入 OMI。

3. 单一真相必须在持久层。
- 会话、分支、run、tool call、审批、恢复点，都必须可从 DB 重建。

4. 安全边界必须先于能力扩展。
- 权限规则、Plan 模式、工作区隔离、危险工具审批必须先落地。

5. 禁止长期兼容双轨。
- 新内核上线后必须删除旧路径，不保留隐式 fallback 分叉实现。

---

## 2. 范围与非范围

### 2.1 In Scope（本次必须完成）

- session kernel 重建（branch lineage + run checkpoint + replay）
- query loop 状态机化
- recovery 引擎（重试、断点续跑、错误分类）
- permission policy engine（allow/ask/deny）
- skill 系统（frontmatter + 动态发现 + inline/fork）
- subagent + multi-agent 协作
- mcp 客户端生命周期与资源工具
- context pipeline + compaction pipeline
- memory write/recall/inject 流程
- OpenAI Chat + OpenAI Responses + Claude 三协议统一适配层
- runner protocol 升级为控制平面
- 全链路验收测试与发布门禁

### 2.2 Out of Scope（本次不做）

- claude-code-main 的 TUI/CLI UX 等前端体验完全复制
- terminal-native CLI 产品形态重构（当前阶段明确不做）
- OAuth 产品流程、市场插件运营能力
- 与本次目标无关的视觉层功能

---

## 3. 基线评估（OMI 当前状态）

基于当前代码扫描（2026-04-02）：
- Agent 核心：`packages/agent/src/agent-session.ts`、`session-manager.ts` 已存在。
- Store 层：`session_history_entries`、`session_runtime`、`tool_calls` 等表已存在。
- Tool 层：目前核心内置为 `read/bash/edit/write/ls/grep/find`。
- Memory 层：已有 compaction 能力，但尚未形成完整自动策略闭环。
- Provider 层：当前基于 `@mariozechner/pi-agent-core`，需做协议统一抽象。
- Protocol 层：已有 RPC，但控制平面命令不足（权限/模式/分支/MCP 控制不足）。

关键差距：
1. Session tree 语义仍偏弱，branch 与 run checkpoint 体系不完整。
2. Query loop 仍有逻辑耦合，状态机未完全显式化。
3. 权限策略偏粗，规则来源和冲突决策不够完善。
4. Skill/SubAgent/MCP 缺少“体系化运行模型”。
5. 三协议（OpenAI Chat/OpenAI Responses/Claude）未形成统一事件语义层。

---

## 4. 参考源优先级与迁移策略

### 4.1 参考优先级

P1（结构优先，易吸收）：
- `open-agent-sdk-typescript-main`
- 用于类型体系、模块拆分、工具定义接口、轻量 engine 组织。

P2（能力优先，需重写）：
- `open-agent-sdk`
- 用于 Query Loop、Permission、Compaction、Skill、SubAgent、MCP 等成熟逻辑参考。
- 注意：大量 `@ts-nocheck`，必须“按行为重写 + 强类型落地”。

P3（目标行为与测试标准）：
- `claude-code-main`
- 用于能力模型、系统架构、流程边界、测试计划。
- 由于已有 MIT LICENSE，可在遵守 LICENSE 前提下引用实现思路和部分代码。

### 4.2 Copy/Adapt/Rewrite 规则

1. Copy：工具 schema、协议 schema、无 provider 绑定的纯函数工具。
2. Adapt：与文件系统、MCP、任务系统相关的模块。
3. Rewrite：与单一协议强耦合的 query/api 逻辑，必须按“三协议统一抽象”重建。

---

## 5. 目标架构（OMI）

遵循 `omi/AGENTS.md` 分包边界，不新增反向依赖：

1. `packages/store`
- session/run/tool/review/runtime 的持久化与重建。

2. `packages/agent`
- query-engine、state machine、recovery、session kernel、subagent orchestration。

3. `packages/provider`
- ProviderAdapter + OpenAIChatAdapter + OpenAIResponsesAdapter + ClaudeMessagesAdapter + MCP bridge。

4. `packages/tools`
- registry、tool metadata、permissions hints、task/plan/mcp/agent 工具。

5. `packages/memory`
- context builder、budget、microcompact/autocompact、memory recall/inject。

6. `packages/protocol`
- runner 控制平面命令与事件定义。

7. `packages/settings`
- 策略配置治理（model/retry/compact/permission defaults）。

---

## 6. 协议核心设计（OpenAI Chat + OpenAI Responses + Claude）

### 6.1 内部统一抽象（强制）

新增统一内部模型（示意）：
- `ModelTurnRequest`
- `ModelStreamEvent`
- `ModelToolCall`
- `ModelUsage`
- `ModelErrorClass`

目标：
- OpenAI Chat / OpenAI Responses / Claude Messages 由 `pi-ai` 负责协议细节，OMI 只消费并映射统一事件语义；query loop 不感知外部协议差异。

### 6.2 必须解决的协议差异（通过 pi-ai 承担）

1. Tool call 编码差异
- Chat/Responses/Claude 的工具调用编码差异由 `pi-ai` 处理。
- OMI 只验证映射后事件是否满足 `tool_call_start/tool_call_end/tool_result` 统一语义。

2. 流式差异
- 各协议流式颗粒度差异由 `pi-ai` 处理。
- OMI 只负责组装内部统一事件序列：`assistant_delta + tool_call + tool_result + usage`。

3. 用量与错误差异
- usage 字段和错误类型映射由 `pi-ai` 提供基础能力。
- OMI 统一归类为：`prompt_too_long / max_output / rate_limit / network / auth`。

### 6.3 协议验收目标

- 同一用例在 Chat / Responses / Claude 上行为一致（终止原因、工具序列、恢复策略一致）
- 差异仅体现在 provider adapter 内部，不泄漏到 session/query/tool 层

### 6.4 外部 npm 包策略（允许引入）

可引入外部包，但必须满足：
- 只为“协议适配、流式解析、schema 校验、重试与观测”引包，不为业务状态机引包。
- 协议层默认且唯一依赖 `@mariozechner/pi-ai`；不在 OMI 内直连 `openai` / `@anthropic-ai/sdk`。
- 仅当 `pi-ai` 尚未支持且出现明确阻塞时，先向 `pi-ai` 升级或提补丁，不在本项目引入直连分支。
- 每个新增包需附带：用途、替代方案评估、版本锁定策略、许可证检查。

### 6.5 三协议路由规则（已定）

- 不设置全局默认优先级，不做“Chat 优先”或“Claude 优先”的隐式规则。
- 路由只由用户选择的 `providerConfig + model` 决定。
- `providerConfig.protocol` 是唯一路由键（示例：MiniMax 配置为 Claude 协议，则该模型走 `pi-ai` 的 Claude 协议路径）。
- 禁止运行时隐式跨协议回退；回退只允许在同协议内做模型降级。

---

## 7. 里程碑与总体排期

建议 6 个里程碑，按依赖顺序执行：

- M0：迁移护栏与基线测试
- M1：Session Kernel + Query Loop + Recovery
- M2：Permission + Tool Registry + Protocol Adapter
- M3：Context/Compaction + Memory 系统
- M4：Skill + SubAgent + MCP + Plan/Worktree
- M5：Multi-Agent 协作 + 控制平面 + 全量验收

发布原则：
- 里程碑不通过，不进入下一阶段。
- 每个里程碑必须有回滚点和可重复验收脚本。

---

## 8. Workstream 详细执行清单

## WS-00 迁移护栏与基线固化（P0）

目标：保证迁移期间可验证、可回滚。

来源参考：
- `claude-code-main/docs/test-plans/*.md`
- `open-agent-sdk-typescript-main/src/types.ts`

落地位置：
- `packages/*/test/**`
- `docs/agent-migration-execution-plan.md`（本文件持续更新）

任务：
- [ ] 建立能力基线用例集（session/recovery/tool/permission/mcp/skill/subagent）。
- [ ] 建立“失败注入”测试工具（429、超时、流中断、工具异常、DB重启）。
- [ ] 统一测试命名和目录（按包平级 `test/**`）。
- [ ] 建立里程碑门禁脚本（typecheck + unit + integration + e2e）。
- [ ] 建立迁移日志模板：每个 WS 记录“变更点/风险/回滚命令”。

验收：
- [ ] 基线测试通过率 >= 95%。
- [ ] 每个 P0 能力至少 1 条集成回归用例。

回滚点：
- 任何 WS 引入关键回归时可回退到 M0 tag。

---

## WS-01 Session Kernel 重建（P0）

目标：将会话体系升级为“分支可追溯 + run 级可恢复 + DB 可重建”。

参考来源：
- `open-agent-sdk-typescript-main/src/session.ts`
- `open-agent-sdk/src/utils/sessionStorage.ts`
- `claude-code-main/docs/conversation/multi-turn.mdx`

目标文件：
- `packages/store/src/schema.ts`
- `packages/store/src/sqlite-store.ts`
- `packages/store/src/history.ts`
- `packages/agent/src/session-manager.ts`
- `packages/agent/src/agent-session.ts`

Schema 变更（建议）：
- `session_history_entries` 增加：`branch_id`, `lineage_depth`, `origin_run_id`
- `runs` 增加：`origin_run_id`, `resume_from_checkpoint`, `terminal_reason`
- 新表 `run_checkpoints`：
  - `id`, `run_id`, `session_id`, `phase`, `payload`, `created_at`
- 新表 `session_branches`：
  - `id`, `session_id`, `head_entry_id`, `title`, `created_at`, `updated_at`

任务：
- [ ] 统一 ID 链路：`sessionId/runId/historyEntryId/toolCallId/checkpointId`。
- [ ] 分支模型：支持 branch create/switch/list，history entry 具备 ancestry。
- [ ] `continueFromHistoryEntry` 改为 branch-aware 重建。
- [ ] 运行时快照版本化（snapshot schema version）。
- [ ] DB 重启恢复时，active run 和 queued run 可正确重建。
- [ ] transcript 持久化改为关键节点增量落盘。

验收：
- [ ] 任意 run 可仅凭 DB 重建执行上下文。
- [ ] 从历史节点继续，不污染原 branch。
- [ ] 重启后 pending approval / queued run 状态不丢失。

回滚策略：
- [ ] 保留 migration down SQL。
- [ ] store 层每次 schema 升级附带数据一致性检查脚本。

---

## WS-02 Query Loop 状态机化（P0）

目标：明确化“预处理 -> 模型 -> 工具 -> 继续/终止”的状态迁移。

参考来源：
- `open-agent-sdk/src/query.ts`
- `open-agent-sdk/src/QueryEngine.ts`
- `claude-code-main/docs/conversation/the-loop.mdx`

目标文件：
- 新增 `packages/agent/src/query-engine.ts`
- 新增 `packages/agent/src/query-state.ts`
- 改造 `packages/agent/src/agent-session.ts`

状态定义（建议）：
- `init`
- `preprocess_context`
- `calling_model`
- `streaming_response`
- `executing_tools`
- `post_tool_merge`
- `terminal`
- `recovering`

任务：
- [ ] 将当前执行循环从 `agent-session.ts` 拆至 `query-engine.ts`。
- [ ] 显式状态对象：messages、turnCount、recoveryCount、compactTracking、budget。
- [ ] 统一终止原因枚举：`completed|max_turns|budget_exceeded|canceled|error`。
- [ ] 工具执行模式参数化：`sequential|parallel` + 并发安全白名单。
- [ ] 每轮输出状态事件（可订阅，可审计）。

验收：
- [ ] 15+ 状态迁移路径单测覆盖。
- [ ] 并行只读工具 + 串行写工具无状态污染。
- [ ] 终止原因与事件日志一致。

---

## WS-03 Recovery Engine（P0）

目标：将恢复从“会话级近似”提升到“run checkpoint 精准恢复”。

参考来源：
- `open-agent-sdk/src/query.ts`（PTL/max_output/retry）
- `open-agent-sdk-typescript-main/src/utils/retry.ts`
- `claude-code-main/docs/conversation/the-loop.mdx`

目标文件：
- 新增 `packages/agent/src/recovery.ts`
- 改造 `packages/agent/src/agent-session.ts`
- 改造 `packages/store/src/sqlite-store.ts`

恢复点设计：
- `before_model_call`
- `after_model_stream`
- `after_tool_batch`
- `before_terminal_commit`

任务：
- [ ] 构建错误分类器：network/rate_limit/auth/prompt_too_long/max_output/tool_error/cancelled。
- [ ] 指数退避 + retry-after 解析 + 总预算控制。
- [ ] prompt-too-long 流程：context collapse / reactive compact / fail terminal。
- [ ] max_output 流程：首次增大上限，后续恢复消息续跑，限制次数。
- [ ] run lineage：retry/resume 必须记录 `origin_run_id`。
- [ ] 防重放：已执行写工具不可重复执行。

验收：
- [ ] 故障注入（429/5xx/network timeout/tool timeout）恢复成功率 >= 98%。
- [ ] 用户中断后可安全恢复，不出现重复写操作。

---

## WS-04 Provider 协议统一层（三协议）（P0）

目标：摆脱单协议耦合，构建 OMI 自有三协议统一模型调用层。

参考来源：
- `open-agent-sdk/src/services/api/*`
- `open-agent-sdk-typescript-main/src/engine.ts`
- `claude-code-main/src/services/api/*`

目标文件：
- 新增 `packages/provider/src/model-client/types.ts`
- 新增 `packages/provider/src/model-client/pi-ai-client.ts`
- 新增 `packages/provider/src/model-client/protocol-router.ts`
- 新增 `packages/provider/src/model-client/normalizer.ts`
- 改造 `packages/provider/src/providers.ts`

任务：
- [ ] 定义 `ModelClient` 接口（stream + usage + tool calls + errors）。
- [ ] 实现 `PiAiModelClient`（统一经由 `pi-ai` 发起模型调用）。
- [ ] 实现 `providerConfig.protocol + model` 路由到 `pi-ai` 的配置映射，不新增协议直连分支。
- [ ] 实现事件标准化（assistant_delta/tool_call_start/tool_call_end/usage/update/error）。
- [ ] 协议差异隔离：query 层不出现 Chat/Responses/Claude 分支。
- [ ] 流式中断与取消一致语义。
- [ ] 协议调用统一经由 `pi-ai`，不在 OMI 维护官方 SDK 直连适配器。

验收：
- [ ] 同一 prompt + tools 在三种协议（由 `pi-ai` 驱动）输出一致终止语义。
- [ ] 三种协议都支持 tool call 循环、恢复、usage 统计。
- [ ] `packages/provider` 不新增 `openai` / `@anthropic-ai/sdk` 直连调用点。

---

## WS-05 Permission Policy Engine（P0）

目标：从固定审批升级为规则引擎（allow/ask/deny + 多来源优先级）。

参考来源：
- `open-agent-sdk/src/utils/permissions/permissions.ts`
- `claude-code-main/docs/safety/permission-model.mdx`

目标文件：
- 新增 `packages/agent/src/permissions/rules.ts`
- 新增 `packages/agent/src/permissions/evaluator.ts`
- 新增 `packages/agent/src/permissions/tracking.ts`
- 改造 `packages/provider/src/providers.ts`
- 改造 `packages/tools/src/tools.ts`

规则来源顺序（已定）：
- `session > project > user > managed > default`

任务：
- [ ] 支持规则粒度：工具名、命令模式、路径前缀、MCP server 前缀。
- [ ] 工具曝光前 deny 过滤（模型不可见）。
- [ ] 执行前二次校验（防绕过）。
- [ ] 拒绝追踪（denial tracking）防死循环。
- [ ] Plan 模式下强制只读。
- [ ] 规则持久化与变更审计。

验收：
- [ ] 规则冲突优先级单测覆盖。
- [ ] MCP 工具与内置工具权限隔离正确。
- [ ] 连续拒绝不导致 agent 卡死循环。

---

## WS-06 Tool Surface 扩展与治理（P0）

目标：从 7 个工具扩展到完整 coding-agent 工具面（20+ 核心能力）。

参考来源：
- `open-agent-sdk-typescript-main/src/tools/*`
- `open-agent-sdk/src/tools/*`
- `claude-code-main/docs/tools/*.mdx`

目标文件：
- `packages/tools/src/*`
- `packages/tools/src/tools.ts`
- 新增 `packages/tools/src/registry.ts`
- 新增 `packages/tools/src/definitions.ts`

第一批必迁（P0）：
- `glob`
- `notebook_edit`
- `web_fetch`
- `web_search`
- `tool_search`
- `ask_user`
- `task.create/update/get/list/stop/output`
- `plan.enter/plan.exit`
- `mcp.resource.list/read`
- `subagent.spawn/send/wait/close`

任务：
- [ ] 统一 ToolDefinition：schema、isReadOnly、isConcurrencySafe、riskLevel。
- [ ] registry + filter 机制替代硬编码 map。
- [ ] 每个工具定义错误码和审计字段。
- [ ] 写工具定义幂等/冲突策略。
- [ ] 所有工具输出结构化，避免纯文本歧义。

验收：
- [ ] 每工具至少 3 类测试：成功/参数错误/权限拒绝。
- [ ] 默认工具集可跑通完整 coding loop（探索->编辑->验证->总结）。

---

## WS-07 Context Engineering + Compaction Pipeline（P0）

目标：形成可持续长会话的上下文工程闭环。

参考来源：
- `open-agent-sdk/src/services/compact/*`
- `open-agent-sdk/src/services/tokenEstimation.ts`
- `claude-code-main/docs/context/compaction.mdx`
- `claude-code-main/docs/context/token-budget.mdx`

目标文件：
- `packages/memory/src/compaction.ts`
- 新增 `packages/memory/src/context-budget.ts`
- 新增 `packages/memory/src/context-pipeline.ts`
- 改造 `packages/agent/src/query-engine.ts`

管线顺序（建议）：
1. tool result budget
2. micro compact
3. context collapse
4. auto compact
5. compact-and-continue

任务：
- [ ] 动态阈值：按模型上下文窗口 + 输出预留计算。
- [ ] tool result budget：大输出裁剪 + 索引摘要。
- [ ] microcompact：旧工具输出衰减清理。
- [ ] autocompact：阈值触发 + 失败熔断。
- [ ] compact boundary 标记与保留段注解。
- [ ] 压缩后自动续跑（不要求用户二次输入）。

验收：
- [ ] 100+ turn 会话稳定，无线性失控。
- [ ] 压缩前后任务目标一致，关键上下文不丢失。
- [ ] PTL 场景可恢复（至少一条成功路径）。

---

## WS-08 Memory 系统重建（P0）

目标：构建“写入-召回-注入-验证”闭环记忆系统。

参考来源：
- `claude-code-main/docs/context/project-memory.mdx`
- `open-agent-sdk/src/memdir/*`

目标文件：
- 新增 `packages/memory/src/memory-types.ts`
- 新增 `packages/memory/src/memory-recall.ts`
- 新增 `packages/memory/src/memory-inject.ts`
- 改造 `packages/store/src/sqlite-store.ts`
- 改造 `packages/store/src/schema.ts`

记忆类型（建议）：
- `user`
- `feedback`
- `project`
- `reference`

数据源边界（已定）：
- 静态上下文文件：`CLAUDE.md`（以及系统规则文件）从文件读取。
- 动态记忆：当前阶段使用文件记忆（`MEMORY.md` + 记忆文件目录）。
- 数据库记忆方案暂不启用，后续单独评估。

默认读取行为（运行时）：
1. 读取当前会话分支上下文。
2. 加载 `MEMORY.md` 索引。
3. 根据索引读取候选记忆文件（按 query + scope + 去重）。
4. 按注入预算裁剪并注入上下文。
5. 若用户显式“忽略记忆”，本轮跳过 2~4。

任务：
- [ ] 定义记忆文件结构（frontmatter: title/description/type/tags/updatedAt）。
- [ ] 实现 `MEMORY.md` 索引加载与校验（链接有效性、重复项去重）。
- [ ] 实现相关性召回（query + 最近工具去噪 + 去重）。
- [ ] 实现系统提示注入策略（预算内注入）。
- [ ] 实现记忆漂移防御（引用前验证）。
- [ ] 与 compaction 联动（保留关键记忆）。
- [ ] 记录记忆注入事件（run 可审计、可重放）。

验收：
- [ ] 多轮会话可复用已确认偏好。
- [ ] 无关记忆不频繁污染上下文。
- [ ] 用户要求忽略记忆时，系统可完全停用记忆引用。

### WS-08 数据库方案（延期，不在当前范围）

数据库记忆方案（表变更、索引、迁移脚本）已评估过，但当前阶段按决策不启用。  
启用时机：文件记忆方案稳定后，再单独开启一轮“DB memory migration”工作流。

---

## WS-09 Skill 系统 2.0（P0）

目标：技能可声明、可发现、可权限约束、可隔离执行。

参考来源：
- `claude-code-main/docs/extensibility/skills.mdx`
- `open-agent-sdk/src/tools/SkillTool/*`

目标文件：
- 新增 `packages/agent/src/skills/loader.ts`
- 新增 `packages/agent/src/skills/frontmatter.ts`
- 新增 `packages/agent/src/skills/executor.ts`
- 新增 `packages/agent/src/skills/discovery.ts`

任务：
- [ ] 定义 `SKILL.md` frontmatter schema（when_to_use/allowed_tools/model/effort/context）。
- [ ] 支持技能目录加载与去重（realpath identity）。
- [ ] 支持条件激活（paths 匹配触发）。
- [ ] 支持 inline 与 fork 双执行模式。
- [ ] 技能权限白名单注入（command 级 allow rules）。
- [ ] 技能注入预算控制（按上下文窗口分配）。

验收：
- [ ] 技能可被自动匹配并执行。
- [ ] skills 在权限、模型、effort 上可局部覆盖。
- [ ] fork 技能不会污染主会话上下文。

---

## WS-10 SubAgent 与多 Agent 协作（P0）

目标：可控子代理委派 + 协作拓扑 + 结果回收。

参考来源：
- `open-agent-sdk/src/tools/AgentTool/*`
- `open-agent-sdk-typescript-main/src/tools/agent-tool.ts`
- `claude-code-main/docs/agent/sub-agents.mdx`
- `claude-code-main/docs/agent/coordinator-and-swarm.mdx`

目标文件：
- 新增 `packages/agent/src/subagent-manager.ts`
- 新增 `packages/agent/src/task-mailbox.ts`
- 新增 `packages/agent/src/multi-agent/coordinator.ts`
- 新增 `packages/agent/src/multi-agent/swarm.ts`
- 改造 `packages/tools/src/*subagent*`

隔离策略（已定）：
- SubAgent 默认共享主工作目录（与 `claude-code-main` 一致）。
- 仅在显式隔离参数或多会话场景下启用 worktree。
- 多会话默认采用 worktree 隔离，避免会话间文件写冲突。

任务：
- [ ] 定义子代理任务模型：owner/writeScope/status/deadline/output。
- [ ] 实现 spawn/send/wait/close 工具链。
- [ ] 实现 mailbox 协议（task-notification 风格事件）。
- [ ] 支持前台转后台执行。
- [ ] 支持协调者模式（中心编排）与 swarm 模式（任务认领）。
- [ ] 子代理输出结构化回传主会话。

验收：
- [ ] 3 路并行子任务稳定执行。
- [ ] 子代理失败不污染主 run。
- [ ] coordinator 模式可进行任务分配与结果综合。

---

## WS-11 MCP 控制平面（P0）

目标：MCP 成为运行时一等公民，而非附属工具源。

参考来源：
- `open-agent-sdk/src/services/mcp/client.ts`
- `open-agent-sdk/src/tools/ListMcpResourcesTool/*`
- `claude-code-main/docs/extensibility/mcp-protocol.mdx`

目标文件：
- 新增 `packages/provider/src/mcp-client.ts`
- 新增 `packages/provider/src/mcp-registry.ts`
- 新增 `packages/tools/src/mcp-resource-tools.ts`
- 改造 `packages/provider/src/providers.ts`

任务：
- [ ] 连接状态机：`connecting/connected/degraded/disconnected/needs_auth`。
- [ ] 本地/远程传输分层（stdio/http/sse/ws）。
- [ ] 连接缓存与失效策略。
- [ ] 工具发现与资源发现缓存。
- [ ] mcp tool/resource 与权限规则统一对齐。
- [ ] 断连重连不打断主循环。

验收：
- [ ] MCP server 重启后可自动恢复。
- [ ] mcp 工具权限、审计链路与 builtin 一致。
- [ ] 资源工具（list/read）可稳定使用。

---

## WS-12 Plan Mode + Worktree 隔离（P0）

目标：规划与执行硬隔离，支持可审阅执行路径。

参考来源：
- `open-agent-sdk/src/tools/EnterPlanModeTool/*`
- `open-agent-sdk/src/tools/ExitPlanModeTool/*`
- `open-agent-sdk/src/tools/EnterWorktreeTool/*`
- `claude-code-main/docs/safety/plan-mode.mdx`
- `claude-code-main/docs/agent/worktree-isolation.mdx`

目标文件：
- 新增 `packages/agent/src/modes/plan-mode.ts`
- 新增 `packages/agent/src/modes/worktree-mode.ts`
- 改造 `packages/agent/src/session-manager.ts`
- 改造 `packages/tools/src/*plan*`、`*worktree*`

任务：
- [ ] EnterPlan：模式切换 + 审批节点。
- [ ] Plan 模式只读工具池。
- [ ] ExitPlan：计划审批 + 恢复执行态。
- [ ] allowedPrompts 机制（已批准语义命令自动放行）。
- [ ] EnterWorktree/ExitWorktree 生命周期与安全清理。
- [ ] 变更检测 fail-closed（未知状态拒绝删除 worktree）。

验收：
- [ ] Plan 模式下写工具必须被拒绝。
- [ ] Worktree 清理不会误删有变更目录。
- [ ] 模式切换前后上下文、审批队列不丢失。

---

## WS-13 Runner 协议升级（控制平面）（P0）

目标：从业务 RPC 变成可编排控制平面 API。

参考来源：
- `open-agent-sdk-typescript-main/src/types.ts`
- `open-agent-sdk/src/entrypoints/agentSdkTypes.ts`
- `claude-code-main/docs/introduction/architecture-overview.mdx`

目标文件：
- `packages/protocol/src/index.ts`
- `apps/runner/src/request-handler.ts`
- `apps/runner/src/protocol.ts`

新增命令（建议）：
- `session.branch.create/list/switch`
- `session.mode.enter/exit`
- `permission.rule.list/add/delete`
- `run.state.get`
- `run.events.subscribe`
- `mcp.server.list/connect/disconnect`
- `skill.list/refresh`
- `agent.spawn/send/wait/close`

任务：
- [ ] 命令 schema 全部强类型化。
- [ ] 结果 schema 全部结构化。
- [ ] event schema 建立版本号与兼容策略（短期）。
- [ ] desktop/runner 协议一次性切换，不保留旧字段双轨。

验收：
- [ ] 客户端无需解析自由文本判断状态。
- [ ] 控制面 API 覆盖 session/run/permission/mcp/agent 全链路。

---

## WS-14 观测性与运维护栏（P1）

目标：可监控、可调试、可审计。

参考来源：
- `open-agent-sdk/src/services/analytics/*`
- `claude-code-main/docs/test-plans/*`

目标文件：
- 新增 `packages/agent/src/telemetry.ts`
- 新增 `packages/agent/src/audit-log.ts`
- 新增 `apps/runner/src/diagnostics.ts`

任务：
- [ ] run 生命周期事件标准化（开始/状态迁移/结束/恢复/失败）。
- [ ] tool call 审计日志（含权限裁决来源）。
- [ ] compaction 观测（触发原因、释放 token、失败次数）。
- [ ] subagent 观测（spawn/finish/fail/background）。
- [ ] MCP 连接观测（状态变化、重连次数、认证失败）。

验收：
- [ ] 任意异常可在日志中定位到 runId + toolCallId + decision。
- [ ] 关键指标可用于发布门禁（SLO 见第 10 节）。

---

## WS-15 测试矩阵与发布门禁（P0）

目标：迁移结果可证实、可持续回归。

目标目录：
- `packages/agent/test/**`
- `packages/provider/test/**`
- `packages/tools/test/**`
- `packages/memory/test/**`
- `packages/store/test/**`
- `apps/runner/test/**`

矩阵定义：
- `packages/agent/test/**` 覆盖 session / recovery / permission / skill / subagent
- `packages/provider/test/**` 覆盖 mcp / 协议路由
- `packages/tools/test/**` 覆盖工具注册与执行
- `packages/memory/test/**` 覆盖 context / compaction / recall / inject
- `packages/store/test/**` 覆盖 session history / runtime persistence
- `packages/protocol/test/**` 覆盖 runner 协议 schema / parse
- `apps/runner/test/**` 覆盖 runner request handler / diagnostics
- `packages/core/test/**`、`packages/extensions/test/**`、`packages/prompt/test/**`、`packages/settings/test/**` 作为支撑矩阵，纳入最终门禁

任务：
- [ ] 单元测试：状态机、权限引擎、schema、协议适配。
- [ ] 集成测试：session lineage、resume/retry、plan/worktree、mcp、subagent。
- [ ] 端到端测试：desktop -> runner -> agent -> provider -> tools。
- [ ] 混沌测试：流中断、并发工具冲突、DB 重启恢复。
- [ ] 长会话压测：100/200/300 turn。

发布门禁：
- `pnpm ws15:matrix`：只验证 WS-15 核心矩阵是否具备可执行测试文件。
- `pnpm ws15:gate`：先跑核心矩阵，再跑支撑矩阵，最后做 workspace typecheck。
- [ ] P0 用例通过率 100%。
- [ ] 全量自动化通过率 >= 95%。
- [ ] 无 P0/P1 已知缺陷。
- [ ] 无兼容双轨遗留。
- [ ] 门禁命令可重复执行，且不会把空测试目录当作通过。

---

## 9. 迁移执行顺序（严格依赖）

必须按以下顺序，不得跳跃：

1. WS-00
2. WS-01 + WS-02 + WS-03
3. WS-04 + WS-05
4. WS-06
5. WS-07 + WS-08
6. WS-09 + WS-11
7. WS-10 + WS-12
8. WS-13
9. WS-14 + WS-15

原因：
- 先把状态和恢复做稳，再扩工具面；
- 先把协议抽象做稳，再上复杂协作；
- 最后收敛控制平面与运维门禁。

---

## 10. 最终验收目标（量化）

### 10.1 P0 能力验收（必须全部通过）

1. Session/Recovery
- 从任意 history entry 继续成功率 >= 99%
- 进程重启后 run 恢复成功率 >= 98%
- 重试不重复执行写工具（0 容忍）

2. Context/Compaction
- 200 turn 任务型会话无崩溃
- 压缩后关键任务目标保持率 >= 95%
- PTL 场景可恢复成功率 >= 90%

3. Permission/Safety
- deny 工具不可见且不可执行（双重校验）
- plan mode 写工具拒绝率 100%

4. Skill/SubAgent/Multi-Agent
- inline/fork skill 均可运行
- 3 路子代理并发稳定，主会话无污染
- coordinator 模式可完成“分配 -> 汇总 ->交付”

5. MCP
- 断连自动恢复成功率 >= 95%
- mcp 工具权限裁决准确率 100%

6. 三协议一致性
- OpenAI Chat / OpenAI Responses / Claude 关键行为一致率 >= 95%
- 三协议均支持 tool loop + recovery + usage 统计

### 10.2 工程质量验收

- typecheck 全绿，无 `@ts-nocheck` 新增
- 所有新增模块包含单测
- 回归套件执行时间可控（目标 < 15 分钟）

---

## 11. 风险清单与预案

1. 协议语义不一致（Chat vs Responses vs Claude）
- 预案：先完成 `ModelClient` 统一事件层，再替换 query engine。

2. Session schema 迁移破坏历史数据
- 预案：先写 migration 校验器，先读后写、双向迁移脚本。

3. SubAgent 并发导致写冲突
- 预案：write scope 声明 + 工作区隔离 + 冲突检测。

4. MCP 稳定性不足
- 预案：连接状态机 + 重连退避 + fail-open/fail-close 策略分级。

5. Context 压缩误伤关键信息
- 预案：compact boundary + 保留段 + post-compact 验证 hook。

---

## 12. 回滚策略（分阶段）

1. 数据层回滚
- 每次 schema migration 都要有 down script。
- 每次升级前自动备份 DB。

2. 运行层回滚
- 里程碑级 feature gate（短期开关，仅用于回滚窗口）。
- 一旦里程碑稳定，移除旧实现，不保留双轨。

3. 发布回滚
- runner 协议版本号带 gate。
- desktop 与 runner 同步灰度，异常可回退到前一稳定 tag。

---

## 13. 逐模块迁移映射（可直接抄的入口）

### 13.1 Session/Loop/Recovery

可优先参考：
- `open-agent-sdk/src/query.ts`
- `open-agent-sdk/src/QueryEngine.ts`
- `open-agent-sdk/src/utils/sessionStorage.ts`
- `claude-code-main/docs/conversation/the-loop.mdx`

落地到：
- `packages/agent/src/query-engine.ts`
- `packages/agent/src/recovery.ts`
- `packages/store/src/sqlite-store.ts`

### 13.2 Permission

可优先参考：
- `open-agent-sdk/src/utils/permissions/permissions.ts`
- `open-agent-sdk/src/utils/permissions/denialTracking.ts`

落地到：
- `packages/agent/src/permissions/*`

### 13.3 Compaction/Context

可优先参考：
- `open-agent-sdk/src/services/compact/autoCompact.ts`
- `open-agent-sdk/src/services/compact/compact.ts`
- `open-agent-sdk/src/services/compact/microCompact.ts`

落地到：
- `packages/memory/src/compaction.ts`
- `packages/memory/src/context-pipeline.ts`

### 13.4 Skill

可优先参考：
- `open-agent-sdk/src/tools/SkillTool/SkillTool.ts`
- `open-agent-sdk/src/skills/loadSkillsDir.ts`

落地到：
- `packages/agent/src/skills/*`

### 13.5 SubAgent

可优先参考：
- `open-agent-sdk/src/tools/AgentTool/AgentTool.tsx`
- `open-agent-sdk/src/tools/AgentTool/runAgent.ts`
- `open-agent-sdk-typescript-main/src/tools/agent-tool.ts`

落地到：
- `packages/agent/src/subagent-manager.ts`
- `packages/agent/src/task-mailbox.ts`

### 13.6 MCP

可优先参考：
- `open-agent-sdk/src/services/mcp/client.ts`
- `open-agent-sdk-typescript-main/src/mcp/client.ts`

落地到：
- `packages/provider/src/mcp-client.ts`
- `packages/tools/src/mcp-resource-tools.ts`

---

## 14. 实施阶段验收模板（每个 WS 复用）

每完成一个 WS，必须输出：
1. 变更文件清单
2. 新增/修改 schema 清单
3. 通过的测试清单
4. 未解决风险清单
5. 回滚命令/步骤

未完成以上 5 项，不允许标记 WS 完成。

---

## 15. 少爷需要确认的架构决策（实施前必须定版）

当前无待确认架构决策（已全部定版）。

---

## 16. 已确认决策（2026-04-02）

1. 产品形态：保持 `desktop + runner` 架构。
2. CLI：当前阶段不做 terminal-native CLI 需求。
3. Plan Mode：强制“绝对只读”。
4. 三协议路由：不设全局优先级，严格按用户选择的 `providerConfig + model`（`providerConfig.protocol`）路由。
5. 记忆持久化：当前阶段使用文件记忆（`MEMORY.md` + 记忆文件目录）；数据库记忆方案延期。
6. 权限优先级：固定为 `session > project > user > managed > default`。
7. SubAgent 默认共享主工作目录；仅显式隔离或多会话场景启用 worktree。
8. 协议依赖策略：OMI 仅维护语义层，模型协议实现完全委托 `pi-ai`，不直连官方 SDK。
