# OMI 迁移 pi-coding-agent 能力执行计划（不含 Extension）

## 0. 目标与约束

- 目标：将 OMI 的核心 coding-agent 能力迁移到接近 `pi-mono/packages/coding-agent`，优先补齐可执行能力而非 UI。
- 范围：**不迁移 Extension 平台能力**（按少爷要求）。
- 存储策略：保留 OMI 的 SQLite 架构；迁移 session tree 语义与算法，不切换到 JSONL 文件存储。
- 兼容策略：允许破坏性升级；不保留旧协议/旧工具名兼容层。

## 1. 任务总览

状态图例：`[TODO]` 未开始, `[IN_PROGRESS]` 进行中, `[DONE]` 已完成, `[BLOCKED]` 阻塞

### Phase A: 基线与变更护栏

- [x] A1 `[DONE]` 建立迁移总计划文档（本文件）
- [ ] A2 `[TODO]` 为关键链路补测试基线（run lifecycle / tool approval / history continue）
- [ ] A3 `[TODO]` 在文档中记录破坏性变更清单（协议、工具名、数据模型）

验收标准：
- 迁移计划与任务状态可追踪；
- 基线测试可稳定复现。

### Phase B: 工具系统迁移（高优先级）

- [x] B1 `[DONE]` 从 pi 迁移并落地核心工具：`read` `write` `edit` `bash` `grep` `find` `ls`
- [x] B2 `[DONE]` 替换 OMI 旧工具：`read_file/write_file/patch_file/list_dir/run_shell/search_workspace`
- [x] B3 `[DONE]` 审批策略重建（按工具能力分级）
- [x] B4 `[DONE]` 工具输出结构统一（支持 diff、截断信息、命令执行元数据）
- [x] B5 `[DONE]` 增加工具测试：成功路径 + 失败/边界路径

验收标准：
- 旧工具实现移除；
- 新工具可被 provider 直接调用；
- `packages/tools` 测试通过。

### Phase C: Provider/Agent Loop 控制增强

- [x] C1 `[DONE]` provider 对接新工具集与新审批策略
- [ ] C2 `[TODO]` 明确化 run 内部状态机事件（tool requested/started/finished/blocked）
- [ ] C3 `[TODO]` 在 AgentSession 中加入可插入的 loop 阶段钩子（planning/verify 预留）

验收标准：
- 新工具链路贯通：prompt -> tool call -> approval -> result -> assistant；
- 关键事件可追踪。

### Phase D: Session Tree 语义迁移（保留 SQLite）

- [ ] D1 `[TODO]` 对齐 pi session tree 核心语义：entry parent、branch leaf、branch summary
- [ ] D2 `[TODO]` 完善历史点继续执行语义（continue from entry）
- [ ] D3 `[TODO]` 补充分支导航所需查询与测试

验收标准：
- 可从任意历史点继续，且上下文重建稳定。

### Phase E: 规划层与验证循环

- [ ] E1 `[TODO]` 引入显式 planning 阶段（plan 生成与确认策略）
- [ ] E2 `[TODO]` 引入 verify loop：测试/类型检查/失败后修复重试
- [ ] E3 `[TODO]` 增加 run 级策略：最大迭代、失败退出条件

验收标准：
- 可形成 `plan -> execute -> verify -> (repair)` 闭环。

### Phase F: 上下文与 Compaction 强化

- [ ] F1 `[TODO]` 迁移 pi compaction cut-point 关键逻辑并适配 OMI 消息模型
- [ ] F2 `[TODO]` 优化 token 估算策略（按模型维度可扩展）
- [ ] F3 `[TODO]` 引入重要性优先级保留策略（关键决策/约束优先）

验收标准：
- 长上下文下恢复稳定；
- compaction 后可继续工作。

### Phase G: 多模型编排

- [ ] G1 `[TODO]` 增加 operation-level 模型选择（plan/execute/compact/verify）
- [ ] G2 `[TODO]` 增加主备模型降级策略
- [ ] G3 `[TODO]` 增加模型策略配置落地（settings + runtime）

验收标准：
- 同一 session 可按阶段使用不同模型。

### Phase H: 协议与前端联动（破坏性升级）

- [ ] H1 `[TODO]` runner/protocol 升级为新工具与新运行态字段
- [ ] H2 `[TODO]` desktop 全量对接新协议（不保留旧调用）
- [ ] H3 `[TODO]` 升级文档与开发说明

验收标准：
- 前后端只使用新协议；
- 端到端可运行。

## 2. 执行顺序（当前）

1. Phase B（工具迁移）
2. Phase C（provider 对接）
3. Phase D（session tree）
4. Phase E（planning + verify loop）
5. Phase F（上下文与 compaction）
6. Phase G（多模型）
7. Phase H（协议与前端收口）

## 3. 当前执行状态

- 总状态：`[IN_PROGRESS]`
- 当前进行：Phase C（C2/C3）+ Phase D（预研中）
- 当前验收负责人：主代理（Codex）

## 4. 破坏性变更清单（持续更新）

- 工具名集合替换为：`read/write/edit/bash/grep/find/ls`。
- 删除旧工具名：`read_file/write_file/patch_file/list_dir/run_shell/search_workspace`。
- Provider 工具标签与审批策略将按新工具能力重建。
- 旧 runner/desktop 若写死旧工具名或旧输出字段，将需要同步升级。
