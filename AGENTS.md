# OMI 分包与测试规范

## 1. 第一性原则
- 包边界的本质是职责边界：一个包只做一类事情。
- 依赖方向必须单向：高层编排依赖底层能力，底层不能反向依赖高层。
- 导出面必须最小化：只导出该包职责内的稳定 API，不做跨包聚合转发。

## 2. 分包规范
- `packages/core`: 领域模型、通用 schema、基础工具函数。
- `packages/protocol`: RPC 命令、事件、结果 schema 与解析。
- `packages/agent`: 运行编排、会话 runtime、执行管线。
- `packages/provider`: 模型 provider 适配、模型注册与解析。
- `packages/tools`: 工具注册表与内建工具实现。
- `packages/store`: 持久化接口与 sqlite 实现（同包）。
- `packages/memory`: 历史压缩、摘要、检索与运行时消息构建。
- `packages/extensions`: 插件/扩展加载与 hook 运行时。
- `packages/settings`: 用户设置、默认值、优先级规则。
- `packages/prompt`: 系统提示词与提示词组装。

## 3. 依赖约束
- 禁止出现 `kernel/db` 这类历史别名与重复抽象。
- `agent` 不得 re-export `provider/memory/extensions/prompt/settings`。
- 仅在确有必要时新增跨包依赖；新增前先确认是否违反职责边界。

## 4. 测试目录规范
- 每个有 `src` 的模块，必须有与 `src` 平级的 `test` 目录。
- 测试文件统一放在 `test/**` 下，不在 `src/**` 内放测试文件。
- 允许在 `test` 下保留与源码对应的子目录结构，便于定位。

## 5. 测试代码规范
- 测试框架统一使用 `vitest`，禁止混用 `bun:test`。
- 命名统一：`*.test.ts` / `*.test.tsx`。
- 单测按行为命名，`it(...)` 描述应直接表达预期行为。
- 断言优先验证可观察行为（状态、事件、输出），避免依赖实现细节。
- 新功能必须至少包含：成功路径 + 失败/边界路径。

## 6. TypeScript 与配置规范
- 各模块 `tsconfig.json` 的 `include` 必须覆盖：
  - `src/**/*.ts`
  - `src/**/*.tsx`
  - `test/**/*.ts`
  - `test/**/*.tsx`
- `vitest` 别名与构建别名保持一致，避免“构建可过、测试失败”的路径分裂。
