# OMI Agent 能力迁移清单（融合式重建）

更新时间：2026-04-02

## 0. 第一性原则（先定边界）

1. Agent 体系的本质不是“功能数量”，而是 4 个核心能力：
- 状态真相：会话、分支、运行态、审批态是否可重建。
- 故障恢复：超长上下文、API 异常、工具中断后是否可继续。
- 安全边界：权限规则是否可声明、可审计、可执行。
- 可扩展性：工具池、MCP、多代理、控制面是否可持续扩展。

2. 迁移策略必须是“能力切片迁移”，不是整仓替换。
- 保留 OMI 的 `desktop + runner + db` 架构。
- 按能力域做模块级移植与重写融合。
- 禁止兼容双轨（旧逻辑与新逻辑并存长期运行）。

3. 代码来源优先级（按可落地与风险排序）：
- P1: `open-agent-sdk-typescript-main`（有 LICENSE，类型结构清晰，便于吸收接口与组织方式）。
- P2: `open-agent-sdk`（能力面最全，适合迁移核心算法与流程，但有大量 `@ts-nocheck`，需强制类型化重写）。
- P3: `claude-code-main`（当前已有 MIT LICENSE）。

## 1. 当前基线（OMI 现状）

已具备骨架：
- 会话编排与运行态：`/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/orchestrator.ts`
- 会话执行与恢复入口：`/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/agent-session.ts`
- 运行态存储与排队/阻塞：`/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/session-manager.ts`
- Provider 桥接与工具审批钩子：`/Users/zhangyanqi/IdeaProjects/omi/packages/provider/src/providers.ts`
- Runner 控制面入口：`/Users/zhangyanqi/IdeaProjects/omi/apps/runner/src/request-handler.ts`

主要短板：
- 工具面偏窄，内置工具集中在 7 个：`/Users/zhangyanqi/IdeaProjects/omi/packages/tools/src/tools.ts`
- 权限模型较粗（固定工具集合审批），缺少规则层级与 deny/filter 预裁剪。
- 压缩/恢复成熟度仍不足（虽有 compaction 入口，但未形成完整管线）。
- 多代理、Plan/Worktree、MCP 资源控制面能力弱。

## 2. 总体迁移路线（12 个 Workstream）

## WS-01 会话模型与持久化语义升级

目标：将 OMI 会话从“线性历史 + 局部恢复”升级为“分支可追溯 + 运行态可重建”。

来源文件：
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk-typescript-main/src/session.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/utils/sessionStorage.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/QueryEngine.ts`

落地文件（OMI）：
- `/Users/zhangyanqi/IdeaProjects/omi/packages/store/src/schema.ts`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/store/src/sqlite-store.ts`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/store/src/history.ts`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/session-manager.ts`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/agent-session.ts`

任务清单：
- [ ] 统一会话记录主键体系：`sessionId/runId/historyEntryId/toolCallId` 全链路可追踪。
- [ ] 强化 lineage 字段：每个历史条目具备 `parentId` 与 `branchId`。
- [ ] 引入“运行时快照版本号”字段，保证恢复时 schema 校验可控。
- [ ] 将 `continueFromHistoryEntry` 变为 branch-aware（按 ancestry 重建 prompt）。
- [ ] 将 transcript 持久化策略从“事后汇总”改为“关键点增量落盘”。

测试与验收：
- [ ] 单测：branch 创建、切换、回放、一致性校验。
- [ ] 集成：中断后恢复到指定 history entry 结果一致。
- [ ] 验收：任意 run 均可从 DB 独立重建运行态，不依赖 UI 事件拼装。

## WS-02 Query Loop 状态机迁移

目标：把 OMI 的执行循环升级为明确状态机，统一“调用模型 -> 工具执行 -> 继续/终止”。

来源文件：
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/query.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/QueryEngine.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/services/tools/StreamingToolExecutor.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/services/tools/toolOrchestration.ts`

落地文件（OMI）：
- 新增：`/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/query-engine.ts`
- 改造：`/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/agent-session.ts`
- 改造：`/Users/zhangyanqi/IdeaProjects/omi/packages/provider/src/providers.ts`

任务清单：
- [ ] 抽离 `QueryEngine`，禁止 `agent-session.ts` 内聚合过多循环逻辑。
- [ ] 引入显式 `State` 对象，包含 messages、turnCount、recoveryCount、compactionTracking。
- [ ] 统一终止理由：`completed|max_turns|budget_exceeded|canceled|error`。
- [ ] 将工具执行策略参数化：`sequential|parallel`，并定义只读工具并发白名单。
- [ ] 工具调用结果统一为结构化 `tool_result` block，减少字符串拼接歧义。

测试与验收：
- [ ] 单测：状态转移覆盖（至少 15 条路径）。
- [ ] 集成：并发工具 + 串行写工具混合场景稳定。
- [ ] 验收：循环中无隐式共享变量导致的状态污染。

## WS-03 上下文压缩与预算管线

目标：形成“预处理预算 -> 微压缩 -> 自动压缩 -> 压缩后继续”的完整链路。

来源文件：
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/services/compact/autoCompact.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/services/compact/compact.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/utils/toolResultStorage.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/query.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk-typescript-main/src/utils/compact.ts`

落地文件（OMI）：
- `/Users/zhangyanqi/IdeaProjects/omi/packages/memory/src/compaction.ts`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/memory/src/messages.ts`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/agent-session.ts`
- 新增：`/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/compaction-policy.ts`

任务清单：
- [ ] 引入阈值触发压缩策略（按模型上下文窗口动态计算阈值）。
- [ ] 实装 tool result budget（超大输出自动裁剪并保留索引摘要）。
- [ ] 实装 micro-compact（先截断，再压缩，避免一次性重摘要成本过高）。
- [ ] 实装 auto-compact 失败计数与熔断策略。
- [ ] 压缩后自动续跑（不要求用户再次输入 prompt）。

测试与验收：
- [ ] 单测：阈值触发、失败熔断、续跑逻辑。
- [ ] 压测：长会话 100+ turns 无内存线性失控。
- [ ] 验收：压缩前后任务目标一致，关键上下文不丢失。

## WS-04 精准恢复与重试机制

目标：把恢复从“会话级近似”提升到“run 级精确恢复”。

来源文件：
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/query.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/QueryEngine.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk-typescript-main/src/engine.ts`

落地文件（OMI）：
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/agent-session.ts`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/session-manager.ts`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/store/src/sqlite-store.ts`

任务清单：
- [ ] 定义恢复点：`before_model_call`、`after_model_stream`、`after_tool_batch`。
- [ ] retry 记录结构化失败原因（API、工具、权限、预算、取消）。
- [ ] max_output_tokens / prompt_too_long 等错误进入专门恢复分支。
- [ ] 统一 resume/retry 的 run lineage（新 run 指向 origin run）。
- [ ] 失败后可选择“继续当前分支”或“新分支恢复”。

测试与验收：
- [ ] 故障注入：网络抖动、API 429、工具超时、强制取消。
- [ ] 验收：恢复后不会重复执行已确认的写工具。

## WS-05 权限边界模型升级

目标：从固定工具审批升级为规则引擎（allow/deny/ask + 多来源优先级）。

来源文件：
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/utils/permissions/permissions.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/tools.ts`

落地文件（OMI）：
- 新增：`/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/permissions/rules.ts`
- 新增：`/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/permissions/evaluator.ts`
- 改造：`/Users/zhangyanqi/IdeaProjects/omi/packages/provider/src/providers.ts`
- 改造：`/Users/zhangyanqi/IdeaProjects/omi/packages/tools/src/tools.ts`
- 改造：`/Users/zhangyanqi/IdeaProjects/omi/packages/protocol/src/index.ts`

任务清单：
- [ ] 引入规则来源：`session/project/user/default`。
- [ ] 规则粒度支持：工具名、命令模式、路径前缀、MCP server 前缀。
- [ ] 工具曝光前执行 deny 过滤（模型看不到禁用工具）。
- [ ] 工具执行前执行二次权限校验（防绕过）。
- [ ] 审批结果持久化，支持一次性/会话内/长期策略。

测试与验收：
- [ ] 单测：冲突规则优先级。
- [ ] 集成：同名 MCP 工具与 builtin 工具权限隔离。
- [ ] 验收：权限变更即时生效，且全链路可审计。

## WS-06 工具面扩充（从 7 个到核心 20+）

目标：先补“编码质量提升最关键工具”，再补外围工具。

第一批（必须）：
- Glob, NotebookEdit, WebFetch, WebSearch, AskUserQuestion, ToolSearch
- TaskCreate/Update/Get/List/Stop/Output
- EnterPlanMode/ExitPlanMode
- ListMcpResources/ReadMcpResource

来源文件：
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk-typescript-main/src/tools/index.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/tools.ts`

落地文件（OMI）：
- `/Users/zhangyanqi/IdeaProjects/omi/packages/tools/src/`（按工具拆文件）
- `/Users/zhangyanqi/IdeaProjects/omi/packages/tools/src/tools.ts`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/tools/src/index.ts`

任务清单：
- [ ] 定义统一 ToolDefinition 接口（输入 schema、只读标记、并发安全标记）。
- [ ] 工具注册从硬编码 map 迁移到 registry + filter 机制。
- [ ] 每个新工具必须定义：输入校验、错误码、审计日志。
- [ ] 写操作工具必须声明幂等策略与冲突策略。

测试与验收：
- [ ] 每个工具最少 3 类测试：成功、参数错、权限拒绝。
- [ ] 验收：默认工具组合可完成完整 coding loop（读->搜->改->验证）。

## WS-07 MCP 生命周期与资源工具

目标：把 MCP 从“接入能力”提升为“运行时一等公民”。

来源文件：
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/services/mcp/client.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/tools/ListMcpResourcesTool/ListMcpResourcesTool.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/tools/ReadMcpResourceTool/ReadMcpResourceTool.ts`

落地文件（OMI）：
- 新增：`/Users/zhangyanqi/IdeaProjects/omi/packages/provider/src/mcp-client.ts`
- 新增：`/Users/zhangyanqi/IdeaProjects/omi/packages/provider/src/mcp-registry.ts`
- 改造：`/Users/zhangyanqi/IdeaProjects/omi/packages/provider/src/providers.ts`
- 改造：`/Users/zhangyanqi/IdeaProjects/omi/packages/tools/src/tools.ts`

任务清单：
- [ ] 增加 MCP 连接状态机：connecting/connected/degraded/disconnected。
- [ ] 实现资源读取工具与权限绑定（server-level deny）。
- [ ] 工具池组装时合并 MCP 工具并去重。
- [ ] 断线重连策略与会话隔离策略。

测试与验收：
- [ ] MCP server 停止/恢复场景下，主循环不中断。
- [ ] 验收：MCP 工具权限策略与 builtin 一致。

## WS-08 多代理与任务协同

目标：具备可控子代理委派，不破坏主会话一致性。

来源文件：
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/tools/AgentTool/AgentTool.tsx`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk-typescript-main/src/tools/agent-tool.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk-typescript-main/src/tools/team-tools.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk-typescript-main/src/tools/send-message.ts`

落地文件（OMI）：
- 新增：`/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/subagent-manager.ts`
- 新增：`/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/task-mailbox.ts`
- 改造：`/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/session-manager.ts`
- 改造：`/Users/zhangyanqi/IdeaProjects/omi/packages/tools/src/tools.ts`

任务清单：
- [ ] 定义 delegate 任务模型（owner、write-scope、deadline、status）。
- [ ] 引入 mailbox 事件（spawn/send/wait/close）。
- [ ] 子代理写集冲突检测（禁止覆盖主代理未提交改动）。
- [ ] 任务输出结构化回收至主会话 history。

测试与验收：
- [ ] 并行子任务 3 路运行稳定。
- [ ] 验收：子代理失败不污染主代理运行态。

## WS-09 Plan Mode 与 Worktree 模式

目标：将“规划态”和“执行态”硬隔离，支持可审阅执行。

来源文件：
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/tools/EnterPlanModeTool/EnterPlanModeTool.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/tools/EnterWorktreeTool/EnterWorktreeTool.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/tools/ExitWorktreeTool/ExitWorktreeTool.ts`

落地文件（OMI）：
- 新增：`/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/modes/plan-mode.ts`
- 新增：`/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/modes/worktree-mode.ts`
- 改造：`/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/session-manager.ts`
- 改造：`/Users/zhangyanqi/IdeaProjects/omi/packages/protocol/src/index.ts`

任务清单：
- [ ] Plan mode 下强制只读工具池。
- [ ] ExitPlan 时恢复执行态模型和权限。
- [ ] Worktree 进入/退出有显式生命周期与清理逻辑。
- [ ] 计划审批通过后自动切换执行态并继续 run。

测试与验收：
- [ ] Plan mode 禁写校验。
- [ ] 验收：模式切换不会丢失上下文与审批队列。

## WS-10 Runner 协议升级为控制平面

目标：把 runner RPC 从“内部调用集合”升级为“可编排控制面 API”。

来源参考：
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/entrypoints/agentSdkTypes.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk-typescript-main/src/types.ts`

落地文件（OMI）：
- `/Users/zhangyanqi/IdeaProjects/omi/packages/protocol/src/index.ts`
- `/Users/zhangyanqi/IdeaProjects/omi/apps/runner/src/request-handler.ts`
- `/Users/zhangyanqi/IdeaProjects/omi/apps/runner/src/protocol.ts`

任务清单：
- [ ] 新增权限规则 API：`permission.rule.list/add/delete`。
- [ ] 新增模式 API：`session.mode.enter/exit`。
- [ ] 新增分支 API：`session.branch.list/switch/create`。
- [ ] 新增压缩策略 API：`session.compaction.policy.get/set`。
- [ ] 新增运行态观测 API：`run.state.get`、`run.events.subscribe`。

测试与验收：
- [ ] 协议 schema 单测与 handler 分发覆盖。
- [ ] 验收：客户端无需推断字符串结果，全部结构化。

## WS-11 模型与设置治理

目标：把 provider/model/effort/queue/compaction 策略从散落逻辑收敛到统一配置域。

来源参考：
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/QueryEngine.ts`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk-typescript-main/src/agent.ts`

落地文件（OMI）：
- `/Users/zhangyanqi/IdeaProjects/omi/packages/provider/src/model-registry.ts`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/provider/src/model-resolver.ts`
- 新增：`/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/runtime-policy.ts`

任务清单：
- [ ] 默认模型、默认 effort、auto-compact、auto-retry、queue 策略统一配置。
- [ ] session 级 override 与全局默认的优先级固定化。
- [ ] 切模型时保留 run 连续性与预算上下文。

测试与验收：
- [ ] 模型切换回归测试。
- [ ] 验收：策略热更新可见且可回滚。

## WS-12 测试矩阵与发布闸门

目标：迁移后能力可证实，而非“看起来可用”。

落地文件（OMI）：
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/test/`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/provider/test/`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/tools/test/`
- `/Users/zhangyanqi/IdeaProjects/omi/apps/runner/test/`

任务清单：
- [ ] QueryLoop 状态机测试。
- [ ] 权限规则冲突与审批生命周期测试。
- [ ] 压缩与恢复组合测试（阈值触发 + API 溢出 + 自动续跑）。
- [ ] MCP 断连与重连测试。
- [ ] 多代理并行与写集冲突测试。
- [ ] runner 协议端到端测试。

发布闸门：
- [ ] 关键路径自动化通过率 >= 95%。
- [ ] 新增能力均有结构化事件可观测。
- [ ] 无兼容双轨遗留代码。

## 3. 迁移批次（建议 4 个里程碑）

Milestone A（底座可用）：
- WS-01 + WS-02 + WS-05
- 目标：会话可重建、循环可控、权限成体系。

Milestone B（长会话稳定）：
- WS-03 + WS-04 + WS-11
- 目标：长上下文可持续运行，恢复可靠。

Milestone C（能力扩展）：
- WS-06 + WS-07 + WS-09
- 目标：工具面与模式面达到可用阈值。

Milestone D（协同与发布）：
- WS-08 + WS-10 + WS-12
- 目标：多代理与控制面上线，测试闭环。

## 4. 强制执行规则（防止迁移失败）

1. 不做兼容层：
- 迁移到新模块后，旧路径删除，不保留长期开关。

2. 不直接复制无许可证代码：
- `claude-code-main` 仅做行为参考，不直接落地源码。

3. 每个 WS 必须包含“验收标准 + 回归测试 + 回滚点”：
- 未满足即不可进入下一个里程碑。

4. 迁移顺序不可打乱：
- 必须先做状态与权限底座，再做工具扩展和多代理。

## 5. 执行前需要少爷确认的 3 个架构决策

1. 权限规则是否采用 `session > project > user > default` 的固定优先级。
2. Plan Mode 是否强制只读（不允许任何写工具例外）。
3. 子代理是否默认禁止直接写主工作目录（仅通过受控工具回传）。
