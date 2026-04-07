# OMI Agent 迁移执行总计划（纵切版）

更新时间：2026-04-04  
负责人：Codex（执行文档）  
适用仓库：`/Users/zhangyanqi/IdeaProjects/omi`  
参考仓库：
- `/Users/zhangyanqi/Documents/Agent/claude-code-main`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk-typescript-main`

---

## 0. 本版文档变更说明

1. 删除 `T00 [P0] 冻结任务`（不再保留）。
2. 任务编排从“全仓先 P0 再全仓 P1”改为“功能纵切一次做完”。
3. 每个任务都补齐：
- OMI 改造锚点（文件+行号）
- 参考实现锚点（文件+行号）
- 验收定义（DoD）
- 测试覆盖要求
4. `worktree` 相关按当前决策默认关闭（只保留非全局 `chdir` 的接口语义，不做真实启用路径）。

---

## 1. 目标与第一性原则

### 1.1 最终目标

能力达到 `claude-code-main` 级别，不追求 UI 形态一致，追求执行语义一致：
- 会话/分支/恢复可重建
- 权限/审批强约束
- 工具执行链稳定
- 子代理与 MCP 为真实执行系统
- 观测与控制面可审计

### 1.2 第一性原则（执行约束）

1. 迁移本质是运行时闭环正确性，不是代码行数迁移。  
2. 状态唯一真源在持久层和显式状态机。  
3. 安全闸门先于能力扩张。  
4. 禁止兼容双轨（除非少爷明确要求）。  
5. 分包边界不破坏（遵循 `AGENTS.md`）。

---

## 2. 执行编排（纵切，无重复开发）

### 2.1 为什么不再分两批全局推进

旧方式：全局 P0 -> 全局 P1，会导致同一文件二次大改。  
新方式：按功能包一次完成 `P0 必做 + 同写集 P1 补强`，再过门禁，减少返工和冲突。

### 2.2 功能包与写集所有权

- `F1` Session/Loop/Recovery：`packages/agent/src/{query-engine,recovery,agent-session}.ts` + `packages/store/src/*`
- `F2` Provider/Approval/Permission/PlanMode：`packages/provider/src/model-client/*` + `packages/agent/src/permissions/*` + `packages/agent/src/modes/plan-mode.ts`
- `F3` SubAgent/Skill/Fork/MCP：`packages/agent/src/{subagent-manager,task-mailbox,skills/executor}.ts` + `packages/provider/src/{mcp-client,mcp-registry}.ts`
- `F4` Tool Runtime/Surface/Memory：`packages/tools/src/*` + `packages/memory/src/*`
- `F5` Runner Protocol/SDK/Observability：`packages/protocol/src/index.ts` + `apps/runner/src/{request-handler,diagnostics}.ts` + `packages/agent/src/telemetry.ts`
- `F6` Gate：`packages/*/test/**` + `apps/runner/test/**` + 本文档

规则：一个功能包未通过 DoD 与测试门禁，不进入下一个功能包。

---

## 3. 任务总览（T01-T18）

- `T01-T03`：F1
- `T04-T05,T10`：F2
- `T07-T09`：F3
- `T06,T13-T16`：F4
- `T11,T17-T18`：F5
- `T12`：F6

> 说明：`T00` 已彻底移除，不存在冻结前置任务。

---

## 4. 详细任务定义

## F1 Session / Loop / Recovery

### T01 [P0] Session lineage 修复 + 索引 + 回滚语义文档化

**要实现**
- 修复压缩写入 `branch_summary` 时 `parentId` 与 `lineageDepth` 被重置问题。
- 给分支/检查点查询补齐索引。
- migration 回滚策略文档化为“部分可逆”（明确新增列不回滚）。

**OMI 改造锚点**
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/agent-session.ts:635`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/query-engine.ts:1093`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/query-engine.ts:1157`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/store/src/schema.ts:129`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/store/src/sqlite-store.ts:1007`

**参考实现锚点**
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/bootstrap/state.ts:101`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/utils/sessionStorage.ts:1041`
- `/Users/zhangyanqi/Documents/Agent/claude-code-main/src/utils/sessionStorage.ts:3414`

**DoD**
- 新增 `branch_summary` 记录不再断 lineage。
- branch/checkpoint 查询走索引。
- 回滚文档明确“可逆范围/不可逆范围”。

**测试**
- lineage 连续性单测。
- 分支切换与历史重建集成测试。
- migration up/down + 一致性检查测试。

---

### T02 [P0] Query Loop：Plan 单一状态源 + Context Health 门控 + max-output 真续写

**要实现**
- `isPlanMode()` 不再使用启发式判定，改读统一状态源。
- `checkContextHealth()` 接入主决策分支。
- `max_output_recovery` 不止状态切换，要注入真实续写消息。

**OMI 改造锚点**
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/query-engine.ts:1196`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/query-engine.ts:1180`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/query-engine.ts:355`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/modes/plan-mode.ts:86`

**参考实现锚点**
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk-typescript-main/src/tools/plan-tools.ts:14`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk-typescript-main/src/engine.ts:294`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk-typescript-main/src/engine.ts:303`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/bootstrap/state.ts:1353`

**DoD**
- Plan 模式判定仅来自显式状态。
- context health 可触发门控行为。
- max-output 发生后自动续跑，不需用户再次输入。

**测试**
- 状态迁移测试（含 plan in/out）。
- context health 边界测试。
- max-output 连续恢复测试。

---

### T03 [P0] Recovery Engine：checkpoint 真恢复 + 稳定去重 ID + 错误分类升级

**要实现**
- `restoreFromCheckpoint()/shouldSkipTool()` 接入 Query 主流程。
- 工具调用去重 ID 稳定（事件级唯一，不依赖重建顺序）。
- 错误分类优先读取协议/错误码，再 fallback 字符串匹配。

**OMI 改造锚点**
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/recovery.ts:612`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/recovery.ts:637`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/recovery.ts:26`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/provider/src/model-client/pi-ai-client.ts:104`

**参考实现锚点**
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/utils/conversationRecovery.ts:357`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/utils/conversationRecovery.ts:382`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/utils/sessionStorage.ts:4475`

**DoD**
- 从 checkpoint 恢复后不会重放已执行写工具。
- 工具调用去重稳定。
- 错误分类可解释、可测试、可扩展。

**测试**
- 429/5xx/网络波动/中断恢复注入测试。
- 写工具幂等与防重放测试。

---

### T14 [P1-同写集补强] Compaction fallback 摘要结构化可复原

**要实现**
- 无 summarizer 时 fallback 摘要从弱文本升级为可复原结构。
- 与 lineage 修复一致落库，不再重置血缘。

**OMI 改造锚点**
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/query-engine.ts:1048`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/query-engine.ts:1093`

**参考实现锚点**
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk-typescript-main/src/utils/compact.ts:59`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk-typescript-main/src/utils/compact.ts:74`

**DoD**
- fallback 摘要可用于后续恢复/审计，不是仅展示文案。

---

## F2 Provider / Approval / Permission / PlanMode

### T04 [P0] Provider 协议统一：审批单一真源 + 强阻塞 + 事件唯一 ID

**要实现**
- `requiresApproval()` 不再恒 false。
- `onToolCallStart` 支持 async 并被 `await`。
- normalizer 从 `toolName->id` 改为事件级唯一键。
- 删除“事后补发 tool requested”路径。

**OMI 改造锚点**
- `/Users/zhangyanqi/IdeaProjects/omi/packages/provider/src/model-client/pi-ai-client.ts:114`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/provider/src/model-client/pi-ai-client.ts:123`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/provider/src/model-client/pi-ai-client.ts:286`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/provider/src/model-client/types.ts:238`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/provider/src/model-client/normalizer.ts:124`

**参考实现锚点**
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/services/tools/toolHooks.ts:323`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/services/tools/toolHooks.ts:393`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/services/tools/toolExecution.ts:616`

**DoD**
- 审批未通过时工具执行不可进入执行层。
- 多次同名工具调用不冲突。

---

### T05 [P0] Permission Engine：ask 强制落地 + path_prefix canonical 匹配

**要实现**
- `preflightCheck` 不只拦 deny，ask 必须强制走审批链路。
- `path_prefix` 匹配引入 realpath/canonical。

**OMI 改造锚点**
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/permissions/evaluator.ts:151`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/permissions/rules.ts:151`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/permissions/rules.ts:190`

**参考实现锚点**
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/utils/permissions/pathValidation.ts:470`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/utils/permissions/filesystem.ts:1104`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/utils/permissions/filesystem.ts:1341`

**DoD**
- ask 规则在执行层绝不漏拦。
- 软链/相对路径不能绕过 path_prefix。

---

### T10 [P0] Plan Mode + Worktree：单一状态源 + allowedPrompts 闭环 + 去全局 chdir

**要实现**
- Plan 状态来源统一（不再 Query/Mode 各自维护）。
- `allowedPrompts` 接入权限裁决闭环。
- 去除进程级 `chdir`；命令执行使用 `cwd` 参数。

**OMI 改造锚点**
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/modes/plan-mode.ts:86`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/query-engine.ts:1196`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/modes/worktree-mode.ts:166`

**参考实现锚点**
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/bootstrap/state.ts:531`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk-typescript-main/src/tools/worktree-tools.ts:30`
- `/Users/zhangyanqi/Documents/Agent/claude-code-main/src/utils/worktree.ts:838`

**DoD**
- Plan 下写工具拒绝 100%。
- 并发执行场景不再有全局 cwd 污染。
- worktree 当前默认关闭但接口语义正确。

---

## F3 SubAgent / Skill / Fork / MCP

### T07 [P0] Skill 2.0：fork 真实隔离（非模拟）

**要实现**
- fork 执行从“模拟输出文本”升级为真实隔离执行路径。
- 如不满足隔离条件，默认禁用 fork 并标注实验特性。

**OMI 改造锚点**
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/skills/executor.ts:206`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/skills/executor.ts:66`

**参考实现锚点**
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/utils/swarm/spawnInProcess.ts:104`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/utils/swarm/inProcessRunner.ts:1176`
- `/Users/zhangyanqi/Documents/Agent/claude-code-main/src/utils/worktree.ts:897`

**DoD**
- fork 具备真实生命周期、输出与错误回传。

---

### T08 [P0] SubAgent：wait 真终态 + close tombstone + markAsRead 实现

**要实现**
- `wait()` 不再“前台立即 completed”。
- `close()` 不立即抹除，保留短期 tombstone 供审计。
- `markAsRead()` 实现真实已读状态。

**OMI 改造锚点**
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/subagent-manager.ts:559`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/subagent-manager.ts:592`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/subagent-manager.ts:643`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/task-mailbox.ts:256`

**参考实现锚点**
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/utils/swarm/inProcessRunner.ts:682`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/utils/swarm/inProcessRunner.ts:1355`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/utils/swarm/inProcessRunner.ts:404`

**DoD**
- 子代理 wait 仅在真实终态返回。
- close 后可排障追踪。
- mailbox 已读可查询可验证。

---

### T09 [P0] MCP 控制平面：状态机补全 + transport 暴露收敛 + 重连退避

**要实现**
- `degraded/needs_auth` 从声明态变真实迁移态。
- 未实现 transport（如 websocket）不对外暴露为可用。
- 自动重连改 `backoff + jitter + lock`。
- `dispose()` 必须 `await disconnect()`。

**OMI 改造锚点**
- `/Users/zhangyanqi/IdeaProjects/omi/packages/provider/src/mcp-client.ts:5`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/provider/src/mcp-client.ts:431`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/provider/src/mcp-client.ts:535`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/provider/src/mcp-registry.ts:474`

**参考实现锚点**
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/services/mcp/client.ts:338`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/services/mcp/client.ts:1226`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/services/mcp/client.ts:1344`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/services/mcp/client.ts:2138`

**DoD**
- 断连恢复稳定，状态迁移可观测。
- 不存在“声称支持但运行时报错”的 transport。

---

## F4 Tool Runtime / Tool Surface / Memory

### T06 [P0] Runtime 闭环：去关键 fallback

**要实现**
- 工具 runtime 不再默认落到内存/空实现。
- 关键依赖缺失时 fail-closed，而不是静默降级。

**OMI 改造锚点**
- `/Users/zhangyanqi/IdeaProjects/omi/packages/tools/src/runtime.ts:161`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/tools/src/builtins.ts:370`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/tools/src/subagent.ts:221`

**参考实现锚点**
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/services/tools/toolExecution.ts:344`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/services/tools/toolExecution.ts:616`

**DoD**
- 生产语义不依赖隐式 fallback。

---

### T13 [P1-同写集补强] Tool Surface：schema parse + ToolOutput 全链统一

**要实现**
- 工具参数去 `as any`，统一 schema parse。
- 执行链统一 `ToolOutput`（含结构化 data/meta/content）。
- task runtime 支持持久化注入。

**OMI 改造锚点**
- `/Users/zhangyanqi/IdeaProjects/omi/packages/tools/src/task-tools.ts:159`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/tools/src/web-tools.ts:75`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/tools/src/definitions.ts:62`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/tools/src/registry.ts:247`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/tools/src/runtime.ts:161`

**参考实现锚点**
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk-typescript-main/src/tool-helper.ts:72`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk-typescript-main/src/tool-helper.ts:98`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/services/tools/toolExecution.ts:616`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/services/tools/toolExecution.ts:1273`

**DoD**
- 参数错误在入口失败，不进入工具业务逻辑。
- 工具输出一致可审计。

---

### T15 [P1-同写集补强] Memory：YAML/frontmatter 完整解析 + index regex 放宽 + recall 深注入

**要实现**
- frontmatter 解析由简化版升级到完整 YAML 语义。
- `MEMORY.md` 行格式 regex 放宽（保留兼容合法变体）。
- `buildPromptWithRecall` 从空 query 全量召回改为相关召回。

**OMI 改造锚点**
- `/Users/zhangyanqi/IdeaProjects/omi/packages/memory/src/memory-recall.ts:38`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/memory/src/memory-types.ts:69`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/memory/src/memory-inject.ts:329`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/memory/src/memory-inject.ts:348`

**参考实现锚点**
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/utils/frontmatterParser.ts:126`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/utils/frontmatterParser.ts:149`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/memdir/findRelevantMemories.ts:39`
- `/Users/zhangyanqi/Documents/Agent/claude-code-main/src/services/SessionMemory/sessionMemory.ts:317`

**DoD**
- 记忆召回在主循环可控且高相关。
- 忽略记忆指令可一轮内生效。

---

### T16 [P1] 工具/命令覆盖面扩张

**要实现**
- 补齐与参考仓库差距最大的工具族：web/mcp-resource/agent-task/plan-control。
- 每个工具具备：schema、权限属性、并发属性、错误码、审计字段。

**OMI 改造锚点**
- `/Users/zhangyanqi/IdeaProjects/omi/packages/tools/src/builtins.ts`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/protocol/src/index.ts`

**参考实现锚点**
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk-typescript-main/src/tools/index.ts:161`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/tools/WebSearchTool/WebSearchTool.ts:153`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/tools/ListMcpResourcesTool/ListMcpResourcesTool.ts:40`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/tools/AgentTool/AgentTool.tsx:197`

**DoD**
- 能力覆盖差距主要剩策略调优，不再是工具缺失。

---

## F5 Runner Protocol / SDK / Observability

### T11 [P0] Runner 协议：schema 收紧 + 订阅投递 + 去内部路径依赖

**要实现**
- `z.any` 关键路径收紧。
- `run.events.subscribe` 从登记升级为真投递。
- runner 跨包依赖仅走公开导出。

**OMI 改造锚点**
- `/Users/zhangyanqi/IdeaProjects/omi/packages/protocol/src/index.ts:15`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/protocol/src/index.ts:243`
- `/Users/zhangyanqi/IdeaProjects/omi/apps/runner/src/request-handler.ts:3`
- `/Users/zhangyanqi/IdeaProjects/omi/apps/runner/src/request-handler.ts:474`

**参考实现锚点**
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/entrypoints/sdk/controlSchemas.ts:37`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/entrypoints/sdk/controlSchemas.ts:111`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/entrypoints/sdk/coreSchemas.ts:45`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/bridge/replBridge.ts:1749`

**DoD**
- 订阅 API 有可观测事件流。
- 协议对象可静态校验且语义稳定。

---

### T17 [P1] SDK/生态接口产品化

**要实现**
- 建立可对外承诺的协议层：版本化、类型生成、订阅约定。
- 对照 reference 的 core/control schema 组织方式做结构整理。

**OMI 改造锚点**
- `/Users/zhangyanqi/IdeaProjects/omi/packages/protocol/src/index.ts`
- `/Users/zhangyanqi/IdeaProjects/omi/apps/runner/src/request-handler.ts`

**参考实现锚点**
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/entrypoints/sdk/coreSchemas.ts:5`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/entrypoints/sdk/coreSchemas.ts:1233`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/entrypoints/sdk/controlSchemas.ts:7`

**DoD**
- 第三方接入不依赖读取实现细节。

---

### T18 [P1] 观测护栏：采样/队列上限落地 + 持久化 sink + 指标修正

**要实现**
- `sampleRate/maxQueueSize` 真正生效。
- 审计/诊断增加持久化 sink（可插拔）。
- `activeSessions` 口径修正，不再近似 runs.size。

**OMI 改造锚点**
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/telemetry.ts:265`
- `/Users/zhangyanqi/IdeaProjects/omi/packages/agent/src/telemetry.ts:283`
- `/Users/zhangyanqi/IdeaProjects/omi/apps/runner/src/diagnostics.ts:321`

**参考实现锚点**
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/services/analytics/firstPartyEventLoggingExporter.ts:345`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/services/analytics/firstPartyEventLoggingExporter.ts:430`
- `/Users/zhangyanqi/Documents/Agent/open-agent-sdk/src/bridge/replBridge.ts:1250`

**DoD**
- 观测系统有背压和采样控制。
- 关键指标可用于发布门禁。

---

## F6 Gate / 验收

### T12 [P0] 门禁与失败注入

**要实现**
- 建立按功能包的 gate：`F1 -> F2 -> F3 -> F4 -> F5 -> F6`。
- 失败注入场景：429、超时、流中断、工具异常、DB 重启。

**基线参考**
- `/Users/zhangyanqi/Documents/Agent/claude-code-main/docs/test-plans/01-tool-system.md`
- `/Users/zhangyanqi/Documents/Agent/claude-code-main/docs/test-plans/04-permission-system.md`
- `/Users/zhangyanqi/Documents/Agent/claude-code-main/docs/test-plans/05-model-routing.md`

**DoD**
- P0 用例 100% 通过。
- 每个功能包至少一条失败注入回归。

---

## 5. 协议/类型变更清单（实现必须同步更新）

1. `ModelClientCallbacks`：
- `onToolCallStart/onToolCallEnd/onToolResult/onUpdate` 支持 `Promise<void>`，调用方 `await`。

2. `PermissionEvaluator.preflightCheck`：
- 从 `string | null` 升级为结构化裁决对象（`allow/ask/deny + reason + matchedRule`）。

3. Recovery 输入：
- 支持 provider 协议错误码与 HTTP 状态优先分类。

4. SubAgent 协议：
- `wait/close` 返回终态证明字段（状态来源、时间戳、是否 tombstone）。

5. Runner 协议：
- `run.events.subscribe` 与 `unsubscribe` 成对定义并文档化事件载荷。

6. 工具执行链：
- 统一 `ToolOutput`，移除散装 `content/details` 变体。

---

## 6. 里程碑与顺序（按功能包）

- `M1`：F1 完成并过 gate
- `M2`：F2 完成并过 gate
- `M3`：F3 完成并过 gate
- `M4`：F4 完成并过 gate
- `M5`：F5 完成并过 gate
- `M6`：F6 总验收

禁止跳步。

---

## 7. 风险与预案

1. **同写集并发改动冲突**  
预案：按功能包 owner 严格锁写集。

2. **恢复链路误重放写工具**  
预案：checkpoint + 写工具去重 ID 双保险。

3. **MCP 重连风暴**  
预案：backoff+jitter+锁，限制并发重连。

4. **Plan/Permission 语义分叉**  
预案：Plan 状态单一真源 + ask 强制执行层落地。

5. **Memory 注入污染上下文**  
预案：相关性召回+预算裁剪+忽略记忆硬开关。

---

## 8. 已确认决策（本版）

1. 已删除 `T00`，不设冻结前置。  
2. 执行编排采用“功能纵切一次做完”，不采用全局双批次返工模式。  
3. `worktree` 默认关闭，不打开真实隔离执行路径。  
4. 不写兼容双轨代码。  
5. 不破坏 OMI 分包边界与导出边界。

