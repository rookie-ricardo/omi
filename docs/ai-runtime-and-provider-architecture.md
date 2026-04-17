# AI 运行时与模型提供商架构全景

> 本文档涵盖：双运行时架构、Provider 系统三层设计、Claude Agent SDK 第三方模型集成、
> In-Process MCP Bridge 跨界调用机制、Native Agent Loop 实现、统一 SSE 事件合约。
>
> 数据来源：代码库深度分析（2026-04-15）  
> 核心文件：`src/lib/claude-client.ts`、`src/lib/ai-provider.ts`、`src/lib/provider-catalog.ts`、
> `src/lib/provider-resolver.ts`、`src/lib/agent-loop.ts`、`src/lib/runtime/`

源码代码路径：/Users/rookie/CodeSpace/CodePilot
---

## 一、架构总览

CodePilot 同时维护两套完全独立的 Agent Loop，共享一个统一的 Provider 系统，向上暴露同一套 SSE 事件流。

```
前端（React）
    ↕ useSSEStream hook
    ↕ SSE 事件流（17 种 EventType）——对前端完全透明，不感知运行时

streamClaude()  ← 唯一入口（claude-client.ts）
    │
    ├── detectTransport()   检测 Provider 协议能力
    ├── resolveRuntime()    选择运行时
    │
    ├─── [A] Claude Code SDK Runtime  (sdk-runtime.ts)
    │         @anthropic-ai/claude-agent-sdk query()
    │         子进程模式 / 环境变量注入配置
    │         内置完整工具集 + In-Process MCP Bridge
    │
    └─── [B] Native Runtime  (native-runtime.ts)
              Vercel AI SDK streamText()
              进程内模式 / SDK 工厂函数
              支持所有 protocol（含 OpenAI、Gemini）

Provider 系统（三层）
    ├── Layer 1: Provider Catalog  (provider-catalog.ts)  — 28+ 预设定义
    ├── Layer 2: Provider Resolver (provider-resolver.ts) — 统一解析优先级链
    └── Layer 3: 双出口
          ├── toClaudeCodeEnv()  → 环境变量 → Claude Agent SDK 子进程
          └── toAiSdkConfig()   → AiSdkConfig → Vercel AI SDK 工厂
```

---

## 二、Provider 系统三层设计

### Layer 1：Provider Catalog（provider-catalog.ts）

整个系统的"配置字典"，定义 28+ 个厂商预设（VendorPreset）。

**Protocol 枚举**（决定走哪个 SDK 工厂）：

| Protocol | 含义 | 代表厂商 |
|---|---|---|
| `anthropic` | Anthropic Messages API 格式 | 官方 Anthropic、GLM、Kimi、MiniMax、火山方舟、Moonshot |
| `openai-compatible` | OpenAI Chat Completions 格式 | OpenAI、Groq、DeepSeek |
| `openrouter` | OpenRouter（OpenAI 兼容 + 特殊头） | OpenRouter |
| `bedrock` | AWS Bedrock（IAM 认证） | AWS Bedrock |
| `vertex` | Google Vertex AI（GCP 认证） | Google Vertex |
| `google` | Google Generative AI（文本） | Gemini |
| `gemini-image` | Google Gemini 图片生成 | Gemini Image |

**AuthStyle 枚举**（决定注入哪个认证头）：

| AuthStyle | 行为 |
|---|---|
| `api_key` | 注入 `ANTHROPIC_API_KEY` → `X-Api-Key` 头 |
| `auth_token` | 注入 `ANTHROPIC_AUTH_TOKEN` → `Authorization: Bearer` 头；同时显式清空 `ANTHROPIC_API_KEY=''` |
| `env_only` | 不注入 API Key，靠 AWS IAM / GCP SA 认证 |

**关键标记 `sdkProxyOnly: true`**：

标记为 `true` 的 Provider（GLM、Kimi、MiniMax、Moonshot、火山方舟、小米 MiMo）虽然接受 Anthropic 格式请求，但由于在流式异常处理、beta 头兼容性、工具调用边界情况等方面行为不一致，**只能通过 Claude Agent SDK 子进程调用，不能用 Vercel AI SDK 的 `createAnthropic()` 直接调用**。

```typescript
// provider-catalog.ts 示例
{
  key: 'glm-cn',
  protocol: 'anthropic',      // 接受 Anthropic 格式的请求
  authStyle: 'auth_token',    // 用 Bearer Token 认证
  baseUrl: 'https://open.bigmodel.cn/api/anthropic',
  sdkProxyOnly: true,         // 仅走 Claude Agent SDK 子进程
  defaultEnvOverrides: {
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-4.5-air',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5-turbo',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.1',
  },
}
```

### Layer 2：Provider Resolver（provider-resolver.ts）

所有消费方（聊天路由、Bridge、Onboarding）通过同一个函数解析 Provider，优先级链：

```
1. 请求中明确传入的 providerId（最高）
2. 会话绑定的 sessionProviderId
3. 全局默认 default_provider_id（用户在 Settings 设置）
4. env 模式：读取 ~/.claude/settings.json 或系统环境变量（最低）
```

输出 `ResolvedProvider` 对象，包含 protocol、authStyle、envOverrides、headers、roleModels、settingSources 等，供两个出口使用。

### Layer 3：双出口

**出口 A：`toClaudeCodeEnv()`** → Claude Agent SDK 子进程

这是 SDK 接入第三方模型的核心机制。Claude Agent SDK 本身**只认环境变量**，CodePilot 在每次调用前注入正确的环境变量：

```typescript
// 伪代码：核心注入逻辑
function toClaudeCodeEnv(baseEnv, resolved) {
  // 步骤1：清理全部 ANTHROPIC_* 变量，防止上次 Provider 泄漏
  for (key of Object.keys(env)) {
    if (key.startsWith('ANTHROPIC_') || MANAGED_ENV_KEYS.has(key)) delete env[key];
  }

  // 步骤2：按 authStyle 注入认证
  if (authStyle === 'auth_token') {
    env.ANTHROPIC_AUTH_TOKEN = apiKey;
    env.ANTHROPIC_API_KEY = '';      // 必须显式清空
  } else {
    env.ANTHROPIC_API_KEY = apiKey;
  }

  // 步骤3：注入 Base URL（关键！让 SDK 把请求打到第三方）
  env.ANTHROPIC_BASE_URL = provider.base_url;  // 如 "https://open.bigmodel.cn/api/anthropic"

  // 步骤4：注入角色模型映射（让 SDK 知道用哪个模型做什么角色）
  env.ANTHROPIC_MODEL = roleModels.default;
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = roleModels.haiku;
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = roleModels.sonnet;
  // ...

  // 步骤5：注入厂商特有覆盖（如 API_TIMEOUT_MS）
  for (const [key, value] of Object.entries(resolved.envOverrides)) {
    env[key] = value;
  }
}
```

对于 Bedrock/Vertex 等云服务，SDK 识别特殊标记环境变量：

| 服务商 | 触发变量 |
|---|---|
| AWS Bedrock | `CLAUDE_CODE_USE_BEDROCK=1` + AWS IAM 变量 |
| Google Vertex | `CLAUDE_CODE_USE_VERTEX=1` + GCP 变量 |

**出口 B：`toAiSdkConfig()`** → Vercel AI SDK 工厂

```typescript
// ai-provider.ts：根据 sdkType 选择工厂
switch (config.sdkType) {
  case 'anthropic':
    createAnthropic({ apiKey, baseURL, headers: { 'anthropic-beta': '...' } });

  case 'claude-code-compat':
    createClaudeCodeCompatModel({ apiKey, baseUrl, modelId });  // 特殊适配器

  case 'openai':
    createOpenAI({ baseURL, apiKey });  // OpenAI / OpenRouter / Groq

  case 'google':
    createGoogleGenerativeAI({ apiKey });  // Gemini 文本

  case 'bedrock':
    createAmazonBedrock({ region });  // AWS IAM

  case 'vertex':
    createVertexAnthropic({ project, region });  // GCP
}
```

**第三方 Anthropic 代理的 baseURL 正规化**：

`@ai-sdk/anthropic` 会在 baseURL 后自动追加 `/messages`。用户若输入裸域名（如 `https://proxy.example.com`），系统自动追加 `/v1`，确保最终路径为 `https://proxy.example.com/v1/messages`。

---

## 三、运行时选择逻辑（claude-client.ts）

```
streamClaude(options)
    │
    ├── openai-oauth 提供商？
    │       └── Yes → 强制 Native Runtime（OpenAI OAuth 不支持 Claude Agent SDK）
    │
    ├── CLI 已禁用（cli_enabled=false）？
    │       └── Yes → 强制 Native Runtime
    │
    ├── detectTransport() → TransportCapability
    │       ├── isNativeCompatible() = false（sdkProxyOnly 提供商）
    │       │       └── 强制 Claude Code SDK Runtime
    │       │
    │       └── isNativeCompatible() = true
    │               └── 继续往下
    │
    └── resolveRuntime(getSetting('agent_runtime'))
            ├── 用户明确设置了 'claude-code-sdk' → 使用 SDK Runtime
            ├── 用户明确设置了 'native' → 使用 Native Runtime
            └── 'auto'（默认）：
                    ├── SDK Runtime 可用（Claude CLI 已安装）→ SDK Runtime
                    └── 否则 → Native Runtime
```

**TransportCapability 三种值**（provider-transport.ts）：

| 值 | 触发条件 | 是否 native-compatible |
|---|---|---|
| `standard-messages` | 官方 Anthropic API、OpenAI、Google | ✅ |
| `claude-code-compat` | 第三方 Anthropic 代理（非 api.anthropic.com） | ✅ |
| `cloud-managed` | AWS Bedrock、Google Vertex | ✅ |

注：目前所有 transport 都是 native-compatible，`sdkProxyOnly` 的强制路由发生在 transport 检测之前（通过 Provider Catalog 的标记直接判断，不经过 transport 逻辑）。

---

## 四、Claude Agent SDK Runtime（SDK 子进程模式）

### 工作原理

`query()` 是 Claude Agent SDK 的核心 API，在 Next.js 进程外 **spawn 一个 Node.js 子进程**运行 Claude CLI 的核心逻辑，子进程完全通过读取环境变量来感知配置（哪个服务商、哪个模型、工具权限等）。

```
Next.js 进程（Host）
    │ spawn
    ▼
Claude Agent SDK 子进程
    ├── 读取 ANTHROPIC_BASE_URL → 打到指定服务商
    ├── 读取 ANTHROPIC_MODEL → 使用指定主模型
    ├── 读取 ANTHROPIC_DEFAULT_HAIKU_MODEL → 小任务模型
    ├── 内置工具集（Read、Write、Bash、Glob、Grep…）
    ├── MCP 工具集（来自 queryOptions.mcpServers）
    ├── 工具调用 → canUseTool() 回调 → Host 进程处理权限
    └── 多轮循环直到任务完成

Host 进程
    ├── 收到 SDK 消息 → 解析 → 转成 SSE 事件
    ├── canUseTool() → 发 permission_request SSE → 等待用户批准
    └── MEDIA_RESULT_MARKER → 注入 MediaBlock 到 tool_result SSE
```

### In-Process MCP Bridge（跨运行时能力调用的核心机制）

Claude Agent SDK 子进程想调用 Vercel AI SDK 的能力（如 Gemini 图片生成），**不是通过进程间通信，而是通过 In-Process MCP Server**——这些 MCP Server 由 `createSdkMcpServer()` 创建，运行在 **Host（Next.js）进程内**，和 Claude Agent SDK 子进程通过 MCP 协议通信，但 handler 实际执行在 Host 进程中，可以直接调用 Vercel AI SDK。

```
Claude Agent SDK 子进程
    │  调用 MCP 工具 codepilot_generate_image
    │  (通过 MCP 协议 stdio/IPC 传输)
    ▼
In-Process MCP Server（在 Host Next.js 进程中运行）
    │  handler 直接调用 Node.js 进程内的函数
    ▼
generateSingleImage() (image-generator.ts)
    │  使用 Vercel AI SDK
    ▼
generateImage({ model: google.image('gemini-3.1-flash-image-preview') })
    │
    ▼
图片写入磁盘 → localPath + 特殊标记 __MEDIA_RESULT__ 返回给子进程
    │
    ▼（Host 进程拦截 SDK 消息）
claude-client.ts 检测到 MEDIA_RESULT_MARKER
    │
    ▼
转成 SSE tool_result 事件，附带 media: MediaBlock[]
    │
    ▼
前端收到 → 渲染图片
```

### 内置 In-Process MCP 服务一览

所有 MCP Server 在 `claude-client.ts` 的 `streamClaudeSdk()` 中按需动态注册（关键词门控或始终注册）：

| Server 名 | 工具 | 实现层 | 注册条件 |
|---|---|---|---|
| `codepilot-image-gen` | `codepilot_generate_image` | Vercel AI SDK + `@ai-sdk/google` | 对话含图片关键词 |
| `codepilot-media` | `codepilot_import_media` | 本地文件系统 | 对话含图片关键词 |
| `codepilot-memory` | `codepilot_search_memory` | SQLite | 在 Assistant 工作区时始终注册 |
| `codepilot-notify` | `codepilot_notify` | Electron API | 始终注册 |
| `codepilot-widget` | `codepilot_load_widget_guidelines` | 本地渲染规范 | 对话含可视化关键词 |
| `codepilot-cli-tools` | `codepilot_cli_tools_*` | 本地工具库 DB | 对话含安装工具关键词 |
| `codepilot-dashboard` | `codepilot_dashboard_*` | SQLite | 对话含仪表盘关键词 |

这些 MCP 工具被加入 `queryOptions.allowedTools` 白名单，SDK 会自动批准，无需用户逐一确认。

---

## 五、Native Runtime（Vercel AI SDK 进程内模式）

### 工作原理

`agent-loop.ts` 的 `runAgentLoop()` 在 Next.js 进程内直接调用 Vercel AI SDK `streamText()`，**手动维护 while 循环**（不使用 AI SDK 自带的 `maxSteps`），以便在每个 step 之间插入权限检查、DB 持久化、Doom Loop 检测、上下文溢出处理等逻辑。

```
runAgentLoop()
    │
    ├── 0. 同步 MCP 连接（syncMcpConnections）
    ├── 0b. 组装工具（assembleTools + 权限包装）
    ├── 1. 创建模型（createModel → ai-provider.ts）
    ├── 2. 从 DB 加载对话历史（buildCoreMessages）
    │
    └── while (stepCount < maxSteps):
            │
            ├── streamText({ model, messages, tools, maxSteps: 1 })
            │       → 流式输出 text/thinking/tool_calls
            │
            ├── onStepFinish():
            │       ├── finishReason === 'tool-calls' → 执行工具
            │       │       ├── 权限检查（PermissionChecker）
            │       │       │     → 发 permission_request SSE → 等待批准
            │       │       ├── 执行工具
            │       │       ├── 追加 tool_result 到 conversationHistory
            │       │       └── 发 tool_result SSE
            │       │
            │       ├── Doom Loop 检测（同一工具连续 3 次 → 中断）
            │       ├── 上下文溢出检测（pruneOldToolResults）
            │       └── stepCount++
            │
            └── finishReason === 'stop' → break（任务完成）
```

**常量配置**：
- `DEFAULT_MAX_STEPS = 50`（最大迭代步数）
- `DOOM_LOOP_THRESHOLD = 3`（同一工具连续调用超过 3 次视为 Doom Loop）
- `KEEPALIVE_INTERVAL_MS = 15_000`（心跳间隔）

### DeepSeek R1 等 `<think>` 推理模型的处理

通过 Vercel AI SDK 的中间件自动提取推理内容（Middleware Pipeline）：

```typescript
// ai-provider.ts applyMiddleware()
if (config.sdkType === 'openai') {
  // 自动将 <think>...</think> 标签内容提取为 thinking block
  middlewares.push(extractReasoningMiddleware({ tagName: 'think' }));
}
```

---

## 六、统一 SSE 事件合约

两个运行时输出完全相同格式的 SSE 事件流，前端通过 `useSSEStream` hook 消费，不感知底层是哪个运行时。

每条 SSE 事件的格式：
```
data: {"type":"<EventType>","data":"<payload>"}\n\n
```

### 17 种 SSE EventType

| type | 方向 | 含义 |
|---|---|---|
| `text` | 运行时→前端 | 模型回复的文字内容（流式） |
| `thinking` | 运行时→前端 | 模型的推理过程（Anthropic Extended Thinking） |
| `tool_use` | 运行时→前端 | 模型决定调用某个工具（含工具名和参数） |
| `tool_result` | 运行时→前端 | 工具执行结果（含 `media` 字段 for 图片） |
| `tool_output` | 运行时→前端 | 工具执行的 stdout/stderr 输出 |
| `permission_request` | 运行时→前端 | 需要用户批准某个工具调用 |
| `status` | 运行时→前端 | 状态通知（resuming session、fallback 等） |
| `result` | 运行时→前端 | 最终结果 + token 用量（会话结束） |
| `error` | 运行时→前端 | 错误（含分类代码） |
| `keep_alive` | 运行时→前端 | 心跳（每 15s，防止连接超时） |
| `done` | 运行时→前端 | 流结束信号 |
| `rewind_point` | 运行时→前端 | 可回退检查点（文件 checkpoint） |
| `skill_nudge` | 运行时→前端 | 技能推荐提示 |
| `task_notification` | 运行时→前端 | 任务完成通知 |
| `image_gen_request` | 运行时→前端 | Design Agent 模式的生图请求（已弃用，用 MCP 替代） |
| `show-widget` | 运行时→前端 | Generative UI 组件渲染指令 |
| `artifact` | 运行时→前端 | 代码/文本 Artifact |

### 进程内事件总线（event-bus.ts）

独立于 SSE，供进程内横切关注点使用（DB 持久化、日志、Bridge 通知等），**不传给前端**：

```typescript
type RuntimeEventType =
  | 'session:start'      // 会话开始
  | 'session:end'        // 会话结束
  | 'tool:pre-use'       // 工具调用前
  | 'tool:post-use'      // 工具调用后
  | 'permission:request' // 权限请求
  | 'permission:resolved'// 权限已处理
  | 'compact:before'     // 上下文压缩前
  | 'compact:after';     // 上下文压缩后
```

---

## 七、多模型 Agent 协作

### Claude Agent SDK 的原生子代理

Claude Agent SDK 的 `query()` 支持 `agents` 参数，可以配置子代理定义（每个子代理有独立的工具集、步数限制、模型覆盖）。子代理**继承父任务的 Provider 环境变量**——因为它们运行在同一个 SDK 子进程的上下文中。

CodePilot 通过 `ClaudeStreamOptions.agents` 传递子代理配置到 `queryOptions.agents`。

### Native Runtime 的跨模型调用

Native Runtime 目前不支持自动派发子代理（无内置 Agent 工具）。但由于它本身是 Vercel AI SDK，工具调用的 handler 可以直接调用其他模型——这是进程内调用，完全自由组合。

---

## 八、整体数据流

```
用户输入
    │ POST /api/chat/messages
    ▼
streamClaude()
    │ Provider 解析 → Runtime 选择
    │
    ├── [SDK Runtime]
    │     │ toClaudeCodeEnv() → 注入环境变量
    │     │ query({ prompt, options, mcpServers: [in-process MCPs] })
    │     │
    │     │ ← SDK 子进程 SSE 消息流
    │     │
    │     ├── 检测 MEDIA_RESULT_MARKER → 注入 MediaBlock
    │     └── 转换为标准 SSE 事件流
    │
    └── [Native Runtime]
          │ toAiSdkConfig() → 创建 LanguageModel
          │ runAgentLoop() → streamText() 手动循环
          │
          └── 转换为标准 SSE 事件流

    ↓ 统一 SSE 事件流
useSSEStream (前端 Hook)
    ↓
MessageList 渲染 + db.ts 持久化
```

---

## 九、关键文件导航

| 文件 | 职责 |
|---|---|
| `src/lib/provider-catalog.ts` | 28+ Provider 预设定义，Protocol / AuthStyle / sdkProxyOnly |
| `src/lib/provider-resolver.ts` | 统一解析链；`toClaudeCodeEnv()`；`toAiSdkConfig()` |
| `src/lib/provider-transport.ts` | Transport capability 检测（决定走哪个路径） |
| `src/lib/ai-provider.ts` | Vercel AI SDK 模型工厂（6 个 SDK 分支 + 中间件管道） |
| `src/lib/claude-client.ts` | `streamClaude()` 入口；SDK 子进程调用；In-Process MCP 注册；MEDIA_RESULT_MARKER 解析 |
| `src/lib/agent-loop.ts` | Native Agent Loop（手动 while 循环 + Doom Loop 检测） |
| `src/lib/agent-tools.ts` | 工具组装（内置工具 + MCP 工具 + 权限包装） |
| `src/lib/image-gen-mcp.ts` | `codepilot-image-gen` In-Process MCP（调用 Vercel AI SDK Gemini） |
| `src/lib/media-import-mcp.ts` | `codepilot-media` In-Process MCP（媒体文件导入） |
| `src/lib/image-generator.ts` | Gemini 图片生成实现（Vercel AI SDK `generateImage()`） |
| `src/lib/runtime/types.ts` | `AgentRuntime` 接口定义 |
| `src/lib/runtime/registry.ts` | Runtime 注册表和选择逻辑（resolveRuntime） |
| `src/lib/runtime/sdk-runtime.ts` | Claude Agent SDK Runtime 实现 |
| `src/lib/runtime/native-runtime.ts` | Native Runtime 实现 |
| `src/lib/runtime/event-bus.ts` | 进程内生命周期事件总线 |
| `src/lib/provider-doctor.ts` | Provider 诊断（5 探针 + 修复建议） |

---

## 十、常见问题 Q&A

**Q：为什么 GLM、Kimi 等已经兼容 Anthropic 协议，还标 `sdkProxyOnly: true`？**

A：协议格式兼容不等于行为完全一致。Vercel AI SDK 的 `createAnthropic()` 直接连接时，在流式错误恢复、`anthropic-beta` 头兼容、工具调用的边界情况等方面，这些第三方代理的行为与官方 API 存在细微差异，可能导致解析错误。走 Claude Agent SDK 子进程路径更稳定，因为 SDK 自身对这些差异有专门处理。

**Q：Claude Agent SDK 子进程能调用 OpenAI / Gemini 模型吗？**

A：不能。Claude Agent SDK 只能通过 `ANTHROPIC_BASE_URL` 指向的 Anthropic 协议服务商。要使用 OpenAI/Gemini，必须使用 Native Runtime。

**Q：生图任务中，Vercel AI SDK（Gemini）是在哪个进程里运行的？**

A：在 **Host（Next.js）进程**中。`createSdkMcpServer()` 创建的 In-Process MCP Server 注册在 Host 进程里，`codepilot_generate_image` 的 handler 直接调用 Host 进程内的 `generateSingleImage()`，进而调用 `@ai-sdk/google` 发起 Gemini API 请求。Claude Agent SDK 子进程只是通过 MCP 协议触发了这个调用，自己并不感知 Gemini SDK。

**Q：两个运行时的工具调用有什么区别？**

A：
- **SDK Runtime**：工具调用由 Claude Agent SDK 子进程内部的循环管理，Host 通过 `canUseTool()` 回调介入权限检查，无法在工具调用之间修改对话上下文。
- **Native Runtime**：工具调用完全在 Host 进程内，每次 step 后都可以自由修改 `conversationHistory`，支持 Doom Loop 检测、上下文剪枝、文件 Checkpoint 等自定义逻辑。

**Q：前端如何知道 Claude 在做什么（执行哪个工具）？**

A：通过 `tool_use` SSE 事件——模型决定调用工具时，两个运行时都会发送 `{ type: 'tool_use', data: { name, input } }`，前端据此渲染工具调用 UI。结果返回时发 `tool_result`，含 `media` 字段（图片等）。

---

## 十一、完整应用架构

> 本节从零开始描述整个 CodePilot 应用的所有模块和交互逻辑，供接手开发者全面理解。

### 11.1 进程模型（Electron + Next.js）

CodePilot 是一个 **Electron 壳 + Next.js 独立服务器** 的双进程架构，不同于常见的 Electron 直接嵌入 Web 资源的方式：

```
macOS / Windows
  └── Electron 主进程 (electron/main.ts)
        ├── 启动 Next.js 独立服务器 (UtilityProcess)
        │     └── Node.js 进程，监听随机可用端口（默认 3000）
        │           ├── SQLite WAL 模式（~/.codepilot/codepilot.db）
        │           ├── 所有 API Route Handlers（/api/**）
        │           └── React SSR 页面
        │
        ├── BrowserWindow
        │     └── 加载 http://localhost:{port}
        │           └── Next.js App Router 页面（CSR 接管）
        │
        ├── TerminalManager（IPC：xterm.js ↔ node-pty）
        ├── Tray 图标（后台通知）
        └── 自动更新（electron-updater）

  Claude Agent SDK 子进程（按需 spawn，非常驻）
        └── 由 @anthropic-ai/claude-agent-sdk 的 query() 内部 spawn
              ├── 读取 Host 注入的环境变量（Provider 配置）
              └── 通过 stdio 与 Host 进程双向通信
```

**关键设计选择**：
- Next.js 独立服务器模式（`output: 'standalone'`）：所有服务端逻辑运行在 UtilityProcess 中，与 Electron 主进程隔离，崩溃不影响主窗口
- SQLite 在 Next.js 进程内访问（`better-sqlite3` 同步 API），利用 WAL 模式支持并发读
- `sanitizedProcessEnv()`：防止 `__NEXT_PRIVATE_*` 变量泄漏到子进程（会破坏其他 Next.js 项目的构建）

---

### 11.2 数据库 Schema（~/.codepilot/codepilot.db）

SQLite WAL 模式，`busy_timeout = 5000ms`，`foreign_keys = ON`。数据库路径可通过 `CLAUDE_GUI_DATA_DIR` 环境变量覆盖。

迁移策略：`migrateDb()` 使用 `safeAddColumn()` 幂等增加列，多 Worker 并发通过文件锁（`.migration-lock`）保护。

#### 核心业务表

```
chat_sessions          会话（一个会话 = 一个 Agent 任务上下文）
messages               消息（role: user | assistant，content 是 JSON MessageContentBlock[]）
tasks                  任务项（session 内的 pending/in_progress/completed/failed 任务）
settings               KV 配置（全局设置，如 default_provider_id、theme_mode）
```

#### Provider 体系表

```
api_providers          用户配置的 Provider（含 API key、baseURL、协议、角色模型映射）
provider_models        Provider 下挂的模型列表（含 capabilities_json、variants_json）
```

#### 媒体生成表

```
media_generations      单次图片生成记录（含 local_path、thumbnail_path、tags）
media_tags             图片标签（用于 Gallery 分类）
media_jobs             批量生成任务（draft→planning→planned→running→completed）
media_job_items        批量任务中的单个生成项（含重试次数、关联 media_generation）
media_context_events   批量任务同步到 Chat 会话的上下文事件
```

#### IM Bridge 表

```
channel_bindings       IM chat ↔ CodePilot session 绑定（UNIQUE: channel_type + chat_id）
channel_offsets        各适配器的轮询偏移水位（用于 Telegram offset、Discord snowflake）
channel_dedupe         消息去重（按 dedup_key，含 expires_at 自动过期）
channel_outbound_refs  已发出消息的平台 message_id（用于编辑/删除消息）
channel_audit_logs     进出消息审计日志
channel_permission_links 权限请求 ↔ IM 消息关联（跨平台权限 approve/deny）
```

#### 定时任务表

```
scheduled_tasks        定时任务（cron / interval / once，含 priority、permanent 标志）
task_run_logs          任务执行历史（含 duration_ms、result、error）
```

#### 关键字段说明

| 字段 | 含义 |
|---|---|
| `chat_sessions.sdk_session_id` | Claude Agent SDK 的会话 ID（用于跨轮次 resume） |
| `chat_sessions.runtime_status` | `idle` \| `running` \| `waiting_permission`（实时状态） |
| `chat_sessions.context_summary` | 自动压缩后的上下文摘要（LLM 生成） |
| `chat_sessions.permission_profile` | `default` \| `full_access`（全局工具权限模式） |
| `messages.is_heartbeat_ack` | 1 = 心跳确认消息（可从对话历史中剪除） |
| `api_providers.role_models_json` | `{ default?, small?, haiku?, sonnet?, opus?, reasoning? }` 语义角色→实际模型 ID 映射 |
| `api_providers.env_overrides_json` | 覆盖传给 SDK 子进程的环境变量 |
| `scheduled_tasks.permanent` | 1 = 永久任务（不随设置 UI 删除） |

---

### 11.3 会话与消息管理

#### 会话生命周期

```
用户点击 New Chat
    │
    ├── 前端从 settings 读取 default_provider_id + default_model
    ├── POST /api/chat/sessions → createSession() → SQLite INSERT
    └── router.push('/chat/{id}')

[id]/page.tsx 挂载
    │
    ├── GET /api/chat/sessions/{id} → 加载 session 元数据
    ├── GET /api/chat/sessions/{id}/messages → 加载历史消息
    └── 订阅 Stream Session Manager（如有进行中的流）

用户发送消息
    │
    ├── MessageInput → StreamSessionManager.startStream()
    ├── POST /api/chat/messages（SSE 响应流）
    │     ├── 组装上下文（assembleContext）
    │     ├── streamClaude() → 运行时派发
    │     ├── 流式写入 SSE 事件
    │     └── 流结束 → 保存 assistant message 到 DB
    └── 前端消费 SSE → 渲染消息
```

#### 消息内容格式（MessageContentBlock[]）

```typescript
// messages.content 存储为 JSON 数组，支持多种 block 类型
type MessageContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }       // Extended Thinking
  | { type: 'tool_use'; id; name; input }
  | { type: 'tool_result'; tool_use_id; content; is_error?; media?: MediaBlock[] }
  | { type: 'code'; language; code }
```

#### 会话 Resume 机制

- SDK Runtime：保存 `sdk_session_id`，下次调用 `query()` 时传入 `session_id`，SDK 从 `~/.claude/` 内部状态文件 resume
- Native Runtime：每轮从 SQLite 重新加载完整历史（通过 `buildCoreMessages()` + `message-normalizer.ts`），无需外部 resume

---

### 11.4 系统提示词 5 层组装（context-assembler.ts）

每次请求前，`assembleContext()` 按层次组装完整系统提示词：

```
Layer 1: Workspace Prompt（仅 Assistant 工作区会话）
         └── soul.md + user.md + claude.md + memory hint
         └── 每次组装前先执行增量 workspace reindex

Layer 2: Session System Prompt
         └── 用户在设置中为该会话配置的自定义 prompt

Layer 3: Assistant Project Instructions（仅 Assistant 工作区）
         └── onboarding/checkin 指令（心跳日历触发）

Layer 4: CLI Tools Context（关键词门控）
         └── 检测到当前 session 关联的 CLI 工具时注入上下文

Layer 5: Widget Guidelines / System Prompt Append
         └── Generative UI 规范（可视化关键词触发）
         └── Skill 注入（/skillName 触发时追加 skill 指令）
```

注：Desktop 入口有所有 5 层；Bridge 入口无 Layer 5（无 Generative UI）。

`assembleContext()` 还会返回：
- `generativeUIEnabled`：是否注册 `codepilot-widget` MCP server
- `isAssistantProject`：是否在 Assistant 工作区（影响 codepilot-memory MCP 注册）

---

### 11.5 上下文管理系统

#### 上下文估算（context-estimator.ts）

使用启发式 `roughTokenEstimate()` 估算消息的 token 数量（约 4 字符 = 1 token），避免额外 API 调用。

#### 上下文压缩（context-compressor.ts）

触发条件：估算 token 数超过上下文窗口的 **80%**。

压缩流程：
1. 调用 `resolveAuxiliaryModel('compact')` 获取压缩专用模型（优先 small/haiku 角色）
2. 用小模型对旧消息生成摘要（不是向量，是自然语言摘要）
3. 摘要写入 `chat_sessions.context_summary`
4. 后续请求使用 `[摘要] + [近期消息]` 替代完整历史

有熔断器机制：连续压缩失败 3 次后自动禁用该 session 的压缩，避免无限重试。

辅助模型解析的 5 层 fallback：
```
1. 环境变量 AUXILIARY_COMPACT_PROVIDER / _MODEL（per-task 覆盖）
2. 主 Provider 的 roleModels.small（若非 sdkProxyOnly）
3. 主 Provider 的 roleModels.haiku
4. 其他非 sdkProxyOnly Provider 的 small/haiku 槽
5. 主 Provider + 主模型（终极 fallback，永不为 null）
```

#### 上下文剪枝（context-pruner.ts）

`pruneOldToolResults()`：在 Native Runtime 的每次 step 间，清理超出 token 预算的旧 `tool_result` 内容（保留工具调用结构，清空内容字符串），防止工具调用结果占满上下文窗口。

---

### 11.6 权限系统（permission-checker.ts）

三级权限模式，每个 Session 独立：

| 模式 | 含义 | Bash 行为 | Write/Edit 行为 |
|---|---|---|---|
| `explore` | 只读探索 | 仅允许 cat/ls/git read 等 | 全部 deny |
| `normal` | 标准模式（默认） | npm/npx/git 自动通过，其他 ask | 全部 allow（.env 文件 ask） |
| `trust` | 完全信任 | 全部 allow（危险命令除外） | 全部 allow |

规则引擎：`PermissionRule[]` 数组，用 `findLast` 语义（最后匹配规则优先），允许精确规则覆盖通配规则。

Session 级别自动审批：用户在对话中点击 "Allow for session" → 追加到 `sessionApprovals` Map → 同 Session 内相同工具+相同 pattern 自动通过。

**`permission_profile: 'full_access'`** → `bypassPermissions = true` → 完全跳过权限包装（适用于批量生图、定时任务等无需人工审批的场景）。

---

### 11.7 内置代码工具（src/lib/tools/）

Native Runtime 提供的核心编码工具（Claude Code 同款），由 `createBuiltinTools()` 组装：

| 工具 | 文件 | 功能 |
|---|---|---|
| `Read` | `tools/read.ts` | 读取文件内容（含行范围） |
| `Write` | `tools/write.ts` | 创建/覆写文件 |
| `Edit` | `tools/edit.ts` | 精确字符串替换（oldString → newString） |
| `Glob` | `tools/glob.ts` | 按 glob 模式查找文件 |
| `Grep` | `tools/grep.ts` | 文件内容正则搜索 |
| `Bash` | `bash.ts` | 执行 shell 命令（含 timeout） |
| `Agent` | `tools/agent.ts` | 启动子 Agent（Native 内部递归调用） |
| `Skill` | `tools/skill.ts` | 执行 Skill（inline 注入或 fork 模式） |

`Agent` 工具是 Native Runtime 内部实现多模型协作的入口：子 Agent 继承父 Agent 的 Provider/Model，但可以有独立的工具集和步数限制。

---

### 11.8 Built-in MCP-equivalent 工具组（builtin-tools/）

这些工具在 **Native Runtime** 中以 Vercel AI SDK tool 形式提供，功能与 SDK Runtime 的 In-Process MCP Server 完全对应：

| 工具组 | 工具名 | 注册条件 |
|---|---|---|
| `codepilot-notify` | `codepilot_notify`, `codepilot_get_pending_confirmations` 等 | 始终 |
| `codepilot-memory-search` | `codepilot_memory_search`, `codepilot_memory_recent`, `codepilot_memory_write` | workspace 模式 |
| `codepilot-dashboard` | `codepilot_dashboard_read_*`, `codepilot_dashboard_cli_*` 等 5 个 | 关键词门控 |
| `codepilot-media` | `codepilot_generate_image`, `codepilot_import_media` | 关键词门控 |
| `codepilot-cli-tools` | `codepilot_cli_*` 6 个工具 | 关键词门控 |
| `codepilot-widget-guidelines` | `codepilot_widget_guidelines` | 始终 |

---

### 11.9 外部 MCP 服务器连接（mcp-connection-manager.ts）

管理用户在设置中配置的**外部** MCP 服务器（区别于内置 In-Process MCP）：

```typescript
interface MCPServerConfig {
  command?: string;       // stdio 模式：可执行文件路径
  args?: string[];        // stdio 参数
  env?: Record<string, string>;
  url?: string;           // SSE / HTTP 模式
  transport?: 'stdio' | 'sse' | 'http';
}
```

连接池为单例（`connections: Map<string, McpConnection>`），每个工具被赋予 `mcp__{serverName}__{toolName}` 格式的限定名。

- **SDK Runtime**：将 `mcpServers` 配置直接传给 `queryOptions.mcpServers`，SDK 子进程自行管理连接
- **Native Runtime**：`syncMcpConnections()` 在每次 AgentLoop 启动前同步连接池，`buildMcpToolSet()` 将工具包装为 Vercel AI SDK `tool()` 实例

---

### 11.10 Skill 系统

Skill 是用户可安装的"提示词宏"，分 4 种类型：

| SkillKind | 含义 | 调用方式 |
|---|---|---|
| `agent_skill` | 代理能力（含 allowed_tools 约束） | /skillName 触发 |
| `slash_command` | Claude Code 内置斜杠命令 | /command |
| `sdk_command` | SDK 通过 query capabilities 返回的命令 | /command |
| `codepilot_command` | CodePilot 内置命令（如 /compact） | /command |

**Skill 发现**（`skill-discovery.ts`）：
- 全局 Skills：`~/.claude/skills/**`（Claude Code 生态）
- 项目 Skills：`{working_directory}/.claude/skills/**`
- 已安装 Skills：`{working_directory}/.codepilot/skills/**`（通过 Marketplace 安装）
- SDK 命令：从 `AgentSdkCapabilities` 缓存读取（SDK 初始化后捕获）

**Skill 执行**（`skill-executor.ts`）：
- Inline 模式：将 skill body（含 `$arg` 变量替换）注入为用户 prompt，拼入当前对话
- Fork 模式：启动子 Agent，限制工具集为 `allowedTools`（通过 `Agent` 工具实现）

**技能市场 Nudge**（`skill-nudge.ts`）：统计对话中不同工具调用次数，超过阈值时发 `skill_nudge` SSE 事件，引导用户发现相关 Skill。

---

### 11.11 Assistant 工作区系统

Assistant 工作区是 CodePilot 的"个人 AI 助理"模式，区别于代码 Agent 模式：

**工作区文件结构**（`${workspacePath}/`）：
```
claude.md          AI 行为规则（相当于 CLAUDE.md）
soul.md            助理人格描述
user.md            用户画像（偏好、习惯、背景）
memory.md          长期记忆（只追加）
memory/daily/      每日记忆文件（{YYYY-MM-DD}.md）
.assistant/state.json  工作区元数据（onboarding 状态、心跳配置等）
```

**Buddy 系统**（`buddy.ts`）：
- 每个工作区有一个唯一的 AI 伴侣（动物形象 + 稀有度）
- 16 种动物（cat/duck/dragon/...），5 级稀有度（common/uncommon/rare/epic/legendary）
- 基于 `hash(workspacePath + createdAt)` 确定性生成，全局公平分布
- epic/legendary Buddy：记忆提取间隔从 3 轮缩短到 2 轮

**记忆提取**（`memory-extractor.ts`）：
- 每 N 轮（取决于 Buddy 稀有度）自动运行
- 调用轻量 LLM（`generateTextFromProvider`，非流式）从对话中提炼值得记忆的信息
- 检测到对话中已有 memory 写操作时跳过（互斥，避免重复写入）

**心跳系统**（`heartbeat.ts`）：
- 配置为启用时，定时（每日或每隔 N 小时）自动触发一次 AI 响应
- 用于维持"持续陪伴"感：每天早晨问候、日程提醒等
- `isWithinActiveHours()` 检查是否在用户配置的活跃时段内

**Workspace 索引**（`workspace-indexer.ts`）：
- 对 `.md` 文件建立内容索引，供 `codepilot_memory_search` MCP 工具使用
- 增量索引：每次请求前触发，超时 5s 则跳过（保持响应性）

---

### 11.12 Bridge 系统（IM 桥接）

Bridge 将 IM 平台（Telegram、Discord、Slack）接入 CodePilot 会话，让用户在手机上也能与 Agent 交互。

**架构**（`src/lib/bridge/`）：

```
外部 IM 平台（Telegram Bot / Discord Bot / Slack App）
    │ 轮询 / Webhook
    ▼
BaseChannelAdapter（channel-adapter.ts）
    │ InboundMessage
    ▼
BridgeManager（bridge-manager.ts）
    │ 消息去重（channel_dedupe）+ 安全校验（validators.ts）
    ▼
ChannelRouter（channel-router.ts）
    │ 根据 channel_type + chat_id 查 channel_bindings → 找到 CodePilot session
    ▼
ConversationEngine（conversation-engine.ts）
    │ 调用 assembleContext() + streamClaude()
    ▼
DeliveryLayer（delivery-layer.ts）
    │ 将 SSE 流式内容实时推送回 IM（流式预览 + 最终消息）
    ▼
外部 IM 平台
```

**流式预览**（Telegram 专属）：
- 每 700ms 编辑一次"草稿"消息，最小 delta 20 字符
- 防抖：若内容无变化则不编辑
- 降级（degraded mode）：永久失败时切换为仅发最终消息

**权限交互**：
- 用户触发需要权限的工具调用 → Bridge 通过 `channel_permission_links` 发 Inline 按钮到 IM
- 用户在 IM 点击 "Approve" / "Deny" → `PermissionBroker` 解析 callback → 写入 `permission_registry` → Agent 继续执行

**安全**（`bridge/security/validators.ts`）：
- `validateWorkingDirectory()`：防止路径穿越（`../`）
- `isDangerousInput()`：检测 prompt injection 尝试
- `validateMode()`：限制模式只能是 code/plan/ask

---

### 11.13 媒体生成 Pipeline

#### 单次生图（chat 内嵌）

由 In-Process MCP `codepilot_generate_image` 触发，流程见第四节。

#### 批量生图 Job（media-jobs）

用于大批量图片生成，有独立的状态机：

```
draft → planning → planned → running → completed
             ↓                  ↓
           failed            paused（可续）
```

- `draft`：用户创建 job，上传参考文档
- `planning`：Agent 解析文档，生成所有 item 的 prompt 列表
- `planned`：plan 完成，等待用户确认
- `running`：`job-executor.ts` 并发执行 items（并发度可配置，有重试机制）
- 每个 item 执行完成 → 写 `media_generations` → 更新 item 状态

`media_context_events`：批量 job 完成后，可将生成结果（图片路径列表）以事件形式同步到某个 Chat 会话，让 Agent 感知刚才批量生成了哪些图片。

#### Gallery（图片管理）

- `media_generations` 表存储所有图片（含 `favorited` 标志）
- `media_tags` + `tags JSON` 字段支持多标签分类
- 缩略图在生成时自动创建（`thumbnail_path`）

---

### 11.14 定时任务调度（task-scheduler.ts）

运行在 Next.js 进程，使用 `setInterval` 每 10s 轮询，通过 `globalThis` 保证 HMR 后不重复启动。

**调度类型**：
- `cron`：标准 cron 表达式（`0 9 * * 1-5` = 工作日早 9 点）
- `interval`：固定间隔（`30m`、`2h` 等）
- `once`：一次性任务（执行后自动删除）

**容错机制**：
- 指数退避：30s → 1m → 5m → 15m（连续失败递增）
- 自动禁用：连续失败 10 次后标记 `disabled`
- 错过任务恢复：启动时检查 `next_run < now` 的任务并补跑
- 7 天过期：超过 7 天未运行的 recurring 任务自动标为 expired

**Session 任务**（内存态，不持久化）：`getSessionTasks()` 存在 `globalThis.__codepilot_session_tasks__` 中，页面刷新后消失，用于对话内部的临时任务。

---

### 11.15 前端状态架构

#### AppShell（layout/AppShell.tsx）

全局 UI 框架，管理以下全局状态：
- **ChatListPanel**：会话列表（左侧栏，可折叠，宽度 180-300px）
- **PanelZone**：右侧面板（File Tree / Git / Terminal / Preview / Image Gen）
- **SplitContext**：分屏模式（最多 2 个会话同时可见）
- **ImageGenContext / BatchImageGenContext**：图片生成全局状态
- **UpdateContext**：自动更新检查
- **SetupCenter**：首次配置向导
- **Toaster**：全局通知 Toast

#### Stream Session Manager（stream-session-manager.ts）

**客户端单例**（`globalThis.__streamSessions__`），完全独立于 React 生命周期。

核心职责：
- 持有活跃流的 `AbortController`（用户切换 session 时不取消流，后台继续运行）
- 维护每个 session 的 `SessionStreamSnapshot`（当前 streaming 状态的快照）
- 通过 `addListener/removeListener` 机制，React 组件挂载时订阅快照，卸载时取消订阅
- `rewindPoints`：记录文件 checkpoint（`file-checkpoint.ts`），用户可回滚文件修改

#### SSE 消费链

```
POST /api/chat/messages → SSE 响应
    │
    ▼（客户端）
StreamSessionManager.startStream()
    │ consumeSSEStream()（useSSEStream.ts 的纯函数）
    │
    ▼ 每条 SSE 事件 → handleSSEEvent() switch/case
    │
    ├── type:text    → snapshot.accumulatedText += delta
    ├── type:thinking → snapshot.accumulatedThinking += delta
    ├── type:tool_use → snapshot.toolUsesArray.push(tool)
    ├── type:result  → 保存 tokenUsage，finalMessageContent 写入 DB
    ├── type:permission_request → 触发 PermissionPrompt 组件
    ├── type:init    → 更新模型列表/斜杠命令缓存
    └── type:done    → 清理活跃流，触发 onResult
    │
    ▼ 每次状态变更
snapshot 快照（不可变新对象）→ 通知所有监听器
    │
    ▼
ChatView.tsx / [id]/page.tsx
    └── useStreamSubscription(sessionId) → Re-render
```

---

### 11.16 模型角色（Role Models）语义映射

`role_models_json` 是让 Provider 支持多模型分工的核心机制：

```json
{
  "default": "claude-opus-4-5",       // 主对话模型
  "small": "claude-haiku-3-5",        // 轻量任务（上下文压缩等）
  "haiku": "claude-haiku-3-5",        // 同上（备用槽）
  "sonnet": "claude-sonnet-4-5",      // SDK 子进程默认 SONNET 角色
  "opus": "claude-opus-4-5",          // SDK 子进程默认 OPUS 角色
  "reasoning": "claude-sonnet-4-5"    // 深度推理任务
}
```

这些映射通过两条路径分别注入：
1. **SDK 子进程**：`toClaudeCodeEnv()` 写入 `ANTHROPIC_DEFAULT_HAIKU_MODEL` 等环境变量
2. **辅助服务**：`resolveAuxiliaryModel(useCase)` 从角色映射中查找合适模型，供上下文压缩、记忆提取等后台任务使用

---

### 11.17 Generative UI（Widget 系统）

Claude 在对话中可以生成 React 组件（Widget），实时在界面渲染交互式 UI。

**工作原理**：
1. 关键词检测（含"可视化"、"图表"、"仪表盘"等）→ 注册 `codepilot-widget` MCP server
2. MCP Server 提供 `codepilot_load_widget_guidelines` 工具 → 返回组件规范和可用图表库
3. Claude 调用工具获取规范 → 生成 React 组件 JSX 代码
4. 通过 `show-widget` SSE 事件发送组件代码
5. 前端沙箱渲染（`widget-sanitizer.ts` 安全过滤）→ 显示交互组件

Widget CSS 通过 `widget-css-bridge.ts` 将 Tailwind 类映射到内联样式（沙箱无法加载外部 CSS）。

---

### 11.18 完整文件索引

#### src/lib/ 核心模块

| 文件/目录 | 职责 |
|---|---|
| `db.ts` | SQLite 数据库单例、所有表 schema、迁移逻辑 |
| `claude-client.ts` | 所有 AI 流的唯一入口；Runtime 派发；MCP 注册；MEDIA_RESULT_MARKER 解析 |
| `agent-loop.ts` | Native Runtime 的手动 while 循环 Agent Loop |
| `agent-tools.ts` | 工具组装（内置 + MCP + 权限包装） |
| `agent-system-prompt.ts` | Native Runtime 系统提示词（6 个章节：Identity/Tasks/Actions/Tools/Tone/Output） |
| `context-assembler.ts` | 5 层系统提示词组装（Desktop 和 Bridge 共用） |
| `context-compressor.ts` | 自动上下文压缩（80% 阈值 + 熔断器） |
| `context-pruner.ts` | 工具结果剪枝（防上下文溢出） |
| `context-estimator.ts` | Token 数估算（启发式） |
| `provider-catalog.ts` | 28+ 厂商预设（Protocol / AuthStyle / sdkProxyOnly） |
| `provider-resolver.ts` | 统一解析链；`toClaudeCodeEnv()`；`toAiSdkConfig()` |
| `provider-transport.ts` | Transport capability 检测 |
| `ai-provider.ts` | Vercel AI SDK 模型工厂（6 个 SDK 分支 + 中间件管道） |
| `provider-doctor.ts` | Provider 诊断（5 探针 + 修复建议） |
| `permission-checker.ts` | 三级权限模式（explore/normal/trust）+ 规则引擎 |
| `permission-registry.ts` | 待审批权限请求的内存注册表 |
| `mcp-connection-manager.ts` | 外部 MCP 服务器连接池（stdio/sse/http） |
| `mcp-loader.ts` | 从 settings 加载用户配置的 MCP 服务器 |
| `mcp-tool-adapter.ts` | 外部 MCP 工具 → Vercel AI SDK tool() 适配 |
| `image-gen-mcp.ts` | In-Process MCP: codepilot-image-gen（Gemini 生图） |
| `media-import-mcp.ts` | In-Process MCP: codepilot-media（媒体导入） |
| `image-generator.ts` | Gemini 图片生成（Vercel AI SDK `generateImage()`） |
| `skill-executor.ts` | Skill 执行（inline / fork 模式） |
| `skill-discovery.ts` | Skill 发现（全局 + 项目 + 已安装 + SDK 命令） |
| `skill-nudge.ts` | 技能推荐提示（工具使用计数统计） |
| `assistant-workspace.ts` | Assistant 工作区：文件加载/写入、日记、状态迁移 |
| `memory-extractor.ts` | 自动记忆提取（每 N 轮调用轻量 LLM） |
| `heartbeat.ts` | 心跳模板和活跃时段判断 |
| `buddy.ts` | Buddy 系统（确定性动物伴侣生成） |
| `workspace-indexer.ts` | Markdown 文件增量索引（供 memory_search 使用） |
| `task-scheduler.ts` | 定时任务调度（cron/interval/once + 指数退避） |
| `job-executor.ts` | 批量媒体生成任务执行器 |
| `stream-session-manager.ts` | 客户端流管理单例（独立于 React 生命周期） |
| `agent-sdk-capabilities.ts` | SDK 能力缓存（模型列表/斜杠命令/账户信息） |
| `error-classifier.ts` | 错误分类（网络错误/认证错误/速率限制等） |
| `message-builder.ts` | buildCoreMessages()：DB 消息 → Vercel AI SDK 格式 |
| `message-normalizer.ts` | 消息格式化（块级内容 → 字符串） |
| `text-generator.ts` | 非流式文本生成（供记忆提取、定时任务使用） |
| `bridge/` | IM 桥接系统（Telegram/Discord/Slack） |
| `builtin-tools/` | Native Runtime 内置 MCP 等价工具组 |
| `tools/` | 核心编码工具（Read/Write/Edit/Bash/Glob/Grep/Agent/Skill） |
| `runtime/` | AgentRuntime 接口、注册表、SDK/Native 两个实现 |

#### src/app/ 路由

| 路由 | 功能 |
|---|---|
| `/chat` | 新建会话页（NewChatPage） |
| `/chat/[id]` | 已有会话页（ChatView） |
| `/gallery` | 图片 Gallery |
| `/settings` | 设置页（Provider 管理、MCP 配置等） |
| `/setup` | 首次配置向导 |
| `/skills` | Skill 市场 |
| `/mcp` | MCP 服务器配置 |
| `/extensions` | 插件管理 |
| `/api/chat/messages` | **核心**：SSE 流式 AI 响应 |
| `/api/chat/sessions` | 会话 CRUD |
| `/api/providers` | Provider CRUD + 模型列表 |
| `/api/sdk` | SDK 状态查询（版本、模型等） |
| `/api/tasks` | 定时任务 CRUD |
| `/api/bridge` | Bridge 状态管理 |
| `/api/media` | 媒体生成管理 |
| `/api/workspace` | Assistant 工作区操作 |

#### 核心前端组件

| 组件 | 文件 | 说明 |
|---|---|---|
| `AppShell` | `components/layout/AppShell.tsx` | 全局布局框架 |
| `ChatListPanel` | `components/layout/ChatListPanel.tsx` | 会话列表 |
| `PanelZone` | `components/layout/PanelZone.tsx` | 右侧面板路由 |
| `MessageList` | `components/chat/MessageList.tsx` | 消息列表渲染 |
| `MessageInput` | `components/chat/MessageInput.tsx` | 消息输入框（含 @ / # 弹出层） |
| `PermissionPrompt` | `components/chat/PermissionPrompt.tsx` | 工具权限确认弹窗 |
| `SetupCenter` | `components/setup/SetupCenter.tsx` | 首次配置中心 |

#### 关键 Hooks

| Hook | 用途 |
|---|---|
| `useSSEStream` | 纯函数 SSE 解析（`handleSSEEvent` switch/case） |
| `useStreamSubscription` | 订阅 StreamSessionManager 快照 |
| `usePanel` | 右侧面板状态（PanelContext） |
| `useSplit` | 分屏会话管理 |
| `useImageGen / useBatchImageGen` | 图片生成全局状态 |
| `useAssistantWorkspace` | 工作区状态（Buddy + Onboarding） |
| `useProviderModels` | Provider 模型列表（含缓存） |
| `useTranslation` | i18n（en/zh，`src/i18n/en.ts` & `zh.ts`） |
