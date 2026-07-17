# OMP 终端与桌面端功能对齐技术方案

> 状态：Proposal
> 日期：2026-07-16
> 范围：`oh-my-pi-upstream` 终端、`ohmypi-craft` 桌面端、共享 OMP RPC 协议与服务端会话层

## 1. 背景与目标

当前桌面端已经覆盖 OMP 的主要对话链路、模型/思考等级、Plan/Goal/Loop、Todo、资源目录和大部分 RPC 安全命令。剩余差距集中在终端专属的交互界面、会话树、实时协作、OAuth/MCP 会话管理、控制中心、快捷键和高级设置。

本方案的目标是：

1. 把终端尚未在桌面端完整提供的能力逐项补齐。
2. 统一上游 OMP、共享协议、服务端 SessionManager、Electron IPC 和 Renderer UI 的契约。
3. 所有 UI 入口都必须连接真实的 RPC/IPC 行为，能力缺失时显示明确的不可用原因。
4. 保持旧版 OMP 可运行：通过 capability negotiation 做版本兼容，禁止因新增能力导致现有对话不可用。
5. 每项能力都具备单元测试、协议测试、桌面组件测试和打包版 smoke test。

本方案不是把终端 TUI 的视觉布局照搬到桌面，而是保持行为语义、状态机、权限边界和数据结果一致，使用桌面端更适合的页面、对话框、抽屉和状态卡片呈现。

## 2. 现状与差距分类

### 2.1 已对齐或已有等价入口

- 动态 `/` 命令目录及 OMP 内置命令解析。
- 模型、供应商、供应商特定思考等级。
- Plan、Plan Review、Goal、Loop 的 RPC 状态和基础 UI。
- Todo 查看、修改、Markdown 导入导出。
- Skills、MCP、Agents 的发现、启停和基础资源管理。
- Session 新建、恢复、删除、重命名、Branch、Handoff、HTML 导出。
- 登录、上下文压缩、自动压缩、自动重试、队列模式、Steer/Follow-up/Abort-and-Prompt。
- 消息复制、工具结果展示、子 Agent 生命周期和转录查看。

### 2.2 完全缺失

1. MCP OAuth/Smithery 会话管理：`reauth`、`unauth`、`smithery-login`、`smithery-logout`、`reconnect`、`notifications`。
2. OMP 实时协作：`collab`、`join`、`leave`，包括参与者、只读访客、实时 relay 状态。
3. OMP OAuth provider 注销：`/logout [provider]`。
4. `btw` 临时旁问、`tan` 后台切题 Agent、`omfg` TTSR 规则生成。
5. OMP Debug Tools Selector。
6. 语音输入 STT。

### 2.3 部分对齐或语义不一致

1. Session Fork/Tree：已有 Branch，但缺少独立 fork 和树状 lineage 导航。
2. Extension Control Center：扩展命令可执行，但缺少扩展总览、启停、重载和状态面板。
3. Marketplace 图形浏览器：显式安装命令可用，但没有搜索、选择、安装、升级和卸载界面。
4. Agent Control Center：已有资源目录和运行中的子 Agent 信息，但缺少模型覆盖、完整检查器、创建向导和 reload。
5. Guided Goal：手动输入 `/guided-goal` 可用，但缺少专用引导式 UI。
6. Temporary Model：桌面选择模型会写入会话设置，缺少“不持久化、仅当前运行上下文”的明确模式。
7. Retry：桌面重发上一条用户消息，OMP 重试的是最后失败的 Agent turn，状态语义不同。
8. Queue Dequeue：桌面可设置队列模式和整体停止，缺少按消息 ID 单独移除队列项。
9. Prompt History、外部编辑器、Copy Picker 和 OMP 专用快捷键没有完整移植。
10. OMP 高级设置没有完整映射到桌面端。

## 3. 总体架构原则

### 3.1 能力协商优先

OMP 进程启动后，桌面端首先执行 `get_state` 和 `get_capabilities`。服务端返回：

```ts
interface OmpCapabilityManifest {
  protocolVersion: string
  runtimeVersion?: string
  commands: string[]
  events: string[]
  features: Record<string, {
    supported: boolean
    reason?: string
    minProtocolVersion?: string
  }>
}
```

Renderer 只根据真实 manifest 创建入口。能力不支持时：

- 不在快捷入口中显示；或显示为 disabled，并说明“当前 OMP 版本不支持”。
- 不发送未经支持的命令。
- 不显示“已成功” toast。
- 日志中记录 `capability_missing`，但不影响普通对话。

### 3.2 三层契约必须同时存在

新增功能必须同时完成：

1. OMP 上游 RPC command/event 和终端原生命令映射。
2. `packages/shared/src/agent/backend/omp/omp-rpc-protocol.ts` 的类型、定义、超时和响应校验。
3. `packages/server-core` 的 SessionManager/handler、Electron channel map、Renderer 状态和 UI。

任何只有 Renderer 按钮、只有 slash 文本、或只有服务端 handler 而没有 capability 声明的实现都视为未完成。

### 3.3 状态来源单一化

- OMP 实时状态以 OMP RPC event 为准。
- 桌面端只做缓存和视图投影，不自行推测 Goal、Loop、MCP、Collab 或 Subagent 状态。
- 所有 mutating command 返回新的完整状态快照或 revision。
- Renderer 使用 `requestId`、`revision` 和 `updatedAt` 丢弃过期响应。

### 3.4 安全边界

- OAuth token、Smithery key、Collab room key、MCP credential 不进入 renderer 日志、session transcript 或导出 HTML。
- 所有文件写入限定在 OMP user/project 配置目录和 workspace 目录。
- Debug 面板只暴露白名单工具，不允许从 UI 直接执行任意 shell。
- 外部编辑器必须使用参数数组启动，不拼接 shell 字符串。
- Collab 参与者、只读权限、relay URL 和 room key 必须由服务端校验。

## 4. 协议基础设施改造（P0）

### 4.1 共享协议扩展

在 `packages/shared/src/agent/backend/omp/omp-rpc-protocol.ts` 增加以下类型族：

- `OmpCapabilityManifest`
- `OmpMcpServerState`、`OmpMcpNotificationState`
- `OmpOAuthProviderState`
- `OmpCollabState`、`OmpCollabParticipant`
- `OmpSessionTreeNode`、`OmpSessionTreeState`
- `OmpExtensionState`、`OmpMarketplaceResult`
- `OmpAgentDefinitionState`
- `OmpQueueItem`
- `OmpDebugToolDefinition`、`OmpDebugResult`
- `OmpTranscriptionResult`

命令按 category 增加：`auth`、`mcp`、`collab`、`extensions`、`marketplace`、`agents`、`tree`、`queue`、`debug`、`audio`、`settings`。

### 4.2 统一响应结构

所有新增 command 采用现有 request/response 机制，并统一错误结构：

```ts
interface OmpRpcError {
  code: string
  message: string
  retryable?: boolean
  capability?: string
  details?: Record<string, unknown>
}
```

长任务使用生命周期 event：`started`、`progress`、`completed`、`failed`、`cancelled`。UI 不根据本地 promise 完成推断后端状态。

### 4.3 版本兼容

- 新增命令必须能被旧 OMP 安全拒绝。
- Desktop backend 在启动阶段保存 capability manifest。
- 对没有 manifest 的旧 OMP，退回 `get_available_commands`，只启用已有命令。
- 协议类型新增字段全部可选；不可识别 event 必须被忽略而非使连接断开。
- 每个能力有 `featureId`，例如 `mcp.oauth`、`collab.live`、`session.tree`。

## 5. P1：MCP OAuth、Smithery、重连和通知

### 5.1 OMP RPC 命令

新增：

```ts
| { type: 'get_mcp_state' }
| { type: 'mcp_reauth'; serverName: string }
| { type: 'mcp_unauth'; serverName: string }
| { type: 'mcp_reconnect'; serverName: string }
| { type: 'get_mcp_notifications' }
| { type: 'set_mcp_notifications'; enabled: boolean }
| { type: 'smithery_login' }
| { type: 'smithery_logout' }
```

事件：

- `mcp_server_state_update`
- `mcp_oauth_start`
- `mcp_oauth_complete`
- `mcp_notification`
- `mcp_reconnect_progress`

### 5.2 OAuth 流程

1. Renderer 请求 `mcp_reauth`。
2. OMP 返回 `oauthUrl`、`stateId` 和过期时间。
3. Electron main 通过系统浏览器打开 URL。
4. 回调由现有 deep-link/本地 callback 机制接收，token 只写入 OMP credential store。
5. OMP 推送完成事件和新的服务器状态。
6. Renderer 刷新 MCP 目录及工具数量。

取消、超时、用户拒绝和回调 state 不匹配都必须有明确错误码。

### 5.3 桌面 UI

在 `OmpResourceDirectory` 的 MCP 条目操作中增加：

- Reauthorize
- Remove authorization
- Reconnect
- Notifications 状态/订阅设置

在 OMP Feature Center 增加 Smithery 登录状态卡和 Login/Logout 按钮。已有 `mcp add/list/remove/test/enable/disable/reload` 保持不变。

### 5.4 验收

- OAuth 成功后无需重启桌面即可调用 MCP 工具。
- `unauth` 后服务器工具不可继续使用，UI 显示未授权。
- reconnect 只影响指定服务器，不重建整个 OMP session。
- notifications 开关能反映 OMP 实际订阅状态。
- token 不出现在 renderer、日志和导出文件。

## 6. P1：实时 Collab

### 6.1 RPC 命令

```ts
| { type: 'get_collab_state' }
| { type: 'start_collab'; readOnly?: boolean }
| { type: 'join_collab'; invite: string; readOnly?: boolean }
| { type: 'leave_collab' }
| { type: 'stop_collab' }
| { type: 'set_collab_presence'; displayName?: string; status?: string }
```

事件：

- `collab_state_update`
- `collab_participant_joined`
- `collab_participant_left`
- `collab_message`
- `collab_connection_update`

### 6.2 状态模型

```ts
type OmpCollabRole = 'host' | 'guest' | 'readonly'
type OmpCollabConnection = 'off' | 'connecting' | 'connected' | 'reconnecting' | 'error'

interface OmpCollabState {
  connection: OmpCollabConnection
  role?: OmpCollabRole
  roomId?: string
  inviteUrl?: string
  webUrl?: string
  participants: OmpCollabParticipant[]
  error?: string
}
```

### 6.3 桌面 UI

- Session header 增加 Collab 状态按钮。
- Host 显示邀请链接、二维码、参与者、只读开关和 Stop。
- Guest 显示当前 host、参与者、Leave。
- 只读访客禁止发送 prompt、steer、tool permission 和资源修改。
- 断线时显示 reconnect 状态，不伪造在线状态。
- 分享静态链接与 Collab 邀请链接分开，避免混淆。

### 6.4 验收

- 两个桌面客户端可加入同一 room，并实时看到消息、状态和参与者变化。
- 只读访客无法发送或修改资源。
- host 离开、relay 断线、room 过期均可恢复或明确结束。
- room key 不写入 session transcript、日志或普通分享链接。

## 7. P1：Provider OAuth 注销

### 7.1 RPC

新增：

```ts
| { type: 'logout'; providerId: string }
```

此命令指 OMP OAuth provider 注销，不等同于 Craft 应用账号退出。

### 7.2 UI

在 OMP provider 列表的已登录条目上增加 Logout，并在完成后刷新：

- provider authenticated 状态
- 可用模型列表
- 当前连接可用性

如果当前会话正在使用被注销 provider，禁止静默切换模型，必须显示重新登录或切换连接提示。

## 8. P2：Session Fork、Tree 和跨会话映射

### 8.1 设计原则

桌面端不能把 OMP 的 session path 直接替换到当前 Craft session 中，否则会造成 transcript、权限、统计和 workspace 归属混乱。每一个 OMP fork/tree 节点都必须映射到一个 Craft session。

在 session metadata 增加：

```ts
interface OmpSessionLineage {
  ompSessionPath: string
  parentOmpSessionPath?: string
  branchEntryId?: string
  rootOmpSessionPath?: string
  depth: number
}
```

### 8.2 RPC

```ts
| { type: 'get_session_tree' }
| { type: 'fork_session'; entryId: string; name?: string }
| { type: 'switch_session'; sessionPath: string }
```

已有 `branch` 保留，用于当前 session 的 branch point 操作；新增 `fork_session` 必须返回新节点信息。

### 8.3 UI

- SessionMenu 增加 Fork。
- Session navigator 增加 Tree view，可展开/折叠、显示当前节点、父节点和分支点。
- 普通列表仍显示所有会话，不强制用户使用 Tree。
- 删除父会话前提示子分支影响；默认只删除当前节点。
- 从旧版没有 lineage metadata 的会话加载时，按 root 节点兼容显示。

### 8.4 验收

- 从任意历史 entry fork 后生成新 Craft session。
- 新分支只包含分支点之前的可见消息，并保持 OMP provider session continuity。
- Tree 切换不会覆盖当前会话 transcript。
- 重启桌面后 parent/child/当前节点关系不丢失。

## 9. P2：Extension Control Center 与 Marketplace

### 9.1 Extension RPC

```ts
| { type: 'get_extensions' }
| { type: 'set_extension_enabled'; id: string; enabled: boolean }
| { type: 'reload_extensions' }
| { type: 'uninstall_extension'; id: string }
```

返回扩展来源、版本、状态、错误、提供的 commands/skills/MCP/agents 和 reload 是否需要重启。

### 9.2 Marketplace RPC

```ts
| { type: 'search_marketplace'; query: string; page?: number }
| { type: 'get_marketplace_item'; id: string }
| { type: 'install_marketplace_item'; id: string; version?: string }
| { type: 'update_marketplace_item'; id: string; version?: string }
| { type: 'uninstall_marketplace_item'; id: string }
```

安装过程使用长任务 event，返回下载、校验、解压、启用和失败阶段。下载来源必须经过 allowlist/签名校验，不能让 Renderer 直接下载并执行任意文件。

### 9.3 UI

新增 Extension Center 页面：

- Installed / Available / Updates 三个视图。
- 搜索、来源过滤、版本、权限和提供能力展示。
- Enable/Disable/Reload/Uninstall。
- 安装前显示权限和文件变更。
- OMP 版本不支持时显示能力提示。

已有 slash marketplace 命令继续保留，图形界面只是同一后端能力的另一入口。

## 10. P2：Agent Control Center

### 10.1 RPC

```ts
| { type: 'get_agent_definitions' }
| { type: 'set_agent_enabled'; id: string; enabled: boolean }
| { type: 'set_agent_model_override'; id: string; model?: string }
| { type: 'create_agent'; spec: OmpAgentCreateSpec }
| { type: 'update_agent'; id: string; patch: OmpAgentPatch }
| { type: 'reload_agents' }
```

`OmpAgentCreateSpec` 至少包括 identifier、whenToUse、systemPrompt、modelOverride、source scope。

### 10.2 UI

在现有 Agent 资源目录上增加：

- 来源 tab：All、Project、User、Bundled。
- 搜索和详情 inspector。
- 启停开关。
- 模型覆盖及思考等级。
- Create Agent 向导和高级 YAML/Markdown 编辑器。
- Reload discovered agents。
- 与运行中 Subagent 面板分开：一个管理定义，一个查看运行实例。

## 11. P3：BTW、TAN、OMFG

### 11.1 `/btw` 临时旁问

RPC：`ask_side_question`。

- 读取当前上下文，但不向主 transcript 插入 user/assistant turn。
- 结果显示在 ephemeral side panel，可复制、关闭或转为正式消息。
- 默认不调用写入型工具；如需工具必须单独显示权限确认。
- 不改变主 Agent 的 model、plan、goal、todo 状态。

### 11.2 `/tan` 后台切题 Agent

RPC：`start_tangential_agent`、`get_tangential_agents`、`cancel_tangential_agent`。

- 使用 detached subagent 生命周期。
- 默认不阻塞主 prompt。
- 在 Subagent drawer 中显示运行、完成、失败和取消。
- 用户可选择“仅通知摘要”或“完成后插入上下文”。
- 任务必须有独立 token/time budget。

### 11.3 `/omfg` TTSR 规则生成

RPC：`propose_ttsr_rule`、`confirm_ttsr_rule`、`list_ttsr_rules`、`delete_ttsr_rule`。

- 先生成规则预览，不直接写配置。
- 用户确认后才写入 OMP config。
- 规则必须展示匹配条件、注入文本、作用范围和优先级。
- 写入后支持撤销和测试样例。

## 12. P3：Debug Tools Selector

### 12.1 设计

新增 `get_debug_tools` 和 `run_debug_tool`。工具必须由 OMP 白名单定义，例如：

- runtime diagnostics
- protocol probe
- terminal capabilities
- model/provider resolution
- MCP connection diagnostics
- session state dump（敏感字段脱敏）

禁止把任意 Bash 作为 debug tool 暴露给 Renderer。

### 12.2 UI

新增 Debug drawer：工具列表、参数表单、运行进度、结构化结果、复制脱敏报告。支持 Export diagnostics，但导出前必须显示敏感信息过滤状态。

## 13. P3：语音输入 STT

### 13.1 采集与转写

- Renderer 只负责 microphone permission 和录音状态。
- Electron main 负责录音文件生命周期和大小限制。
- 通过 `transcribe_audio` RPC 调用 OMP 当前配置的 STT provider；若 OMP 不支持，则通过 capability 隐藏按钮。
- 音频采用短时临时文件或受限 base64 payload，最大时长和大小由协议声明。
- 转写完成后只回填 composer，不自动发送。

### 13.2 交互

- 点击麦克风开始/结束。
- 支持按住快捷键录音；松开后转写。
- 转写中可取消。
- 失败时保留原输入，不覆盖已有文本。

### 13.3 验收

- 无麦克风权限时不会崩溃，提示授权路径。
- 录音文件在完成/取消/失败后都被清理。
- STT 结果不写入 prompt history，除非用户确认发送。

## 14. P4：语义和生产力对齐

### 14.1 Guided Goal 专用 UI

复用已存在的 `guided_goal_turn` RPC：

- 新增 Guided Goal modal。
- 每轮显示 OMP 的问题和用户输入。
- 支持 Back、Skip、Cancel、Finish。
- 最大轮数由 OMP 返回，不由 Renderer 硬编码。
- 结束后显示 objective、budget、mode，并允许确认启用。

### 14.2 Temporary Model

扩展模型状态：

```ts
type OmpModelSelectionSource = 'default' | 'session' | 'temporary'
```

新增：`set_temporary_model`、`clear_temporary_model`。临时模型只影响当前 OMP 运行上下文，不写全局连接、不改变默认模型。UI 用临时 badge 标识，关闭会话后自动恢复。

### 14.3 Exact Retry

新增 `retry_last_turn` 和 `get_retry_state`。服务端保存最后失败 turn 的 stable ID，retry 必须：

- 不复制 user 消息。
- 重用原始 prompt、attachments、model 和 thinking level。
- 允许用户在真正重试前取消。
- 明确区分 retry、auto-retry 和普通 resend。

### 14.4 Queue Dequeue

新增：

```ts
| { type: 'get_queue_state' }
| { type: 'dequeue_message'; messageId: string }
| { type: 'reorder_queue'; messageIds: string[] }
```

桌面队列卡片显示每条消息、模式、时间和删除按钮。删除操作使用 optimistic UI，但必须等待服务端 revision 确认；冲突时回滚并刷新队列。

### 14.5 Prompt History

建立 workspace-scoped prompt history：

- 默认保留最近 200 条去重 prompt。
- 支持 `Ctrl+R` 搜索、上下键选择。
- 用户可以关闭持久化或清空历史。
- 不写入 token、credential、文件内容和隐私字段。

### 14.6 External Editor

Electron main 增加 `open_external_editor` IPC：

1. 以临时文件写入当前 draft。
2. 使用配置的 editor executable 和参数数组启动。
3. 等待进程退出并读取文件。
4. 超时、取消或失败时保留原 draft。
5. Windows、macOS、Linux 使用不同的安全解析逻辑，不拼接 shell 命令。

Web/远程客户端默认不提供此能力，仅桌面本地 capability 开启。

### 14.7 Copy Picker

新增 Copy Picker overlay：

- 按消息、代码块、tool result、当前 prompt 分组。
- 支持键盘上下选择和搜索。
- 复制前显示纯文本/Markdown 选项。
- 复制失败时显示系统剪贴板错误，不标记成功。

## 15. P4：快捷键对齐

把 OMP shortcut 映射到桌面 action registry，而不是在组件中散落监听。首批 action：

- thinking cycle/toggle
- model cycle forward/backward
- temporary model selector
- plan toggle
- tool expand
- follow-up
- retry
- dequeue
- session tree/fork
- prompt history
- STT
- external editor

Shortcuts 页面展示实际绑定、冲突和平台差异。若某 action 当前 capability 不支持，页面显示 disabled/unsupported，而不是可执行快捷键。

## 16. P4：OMP 高级设置对齐

### 16.1 设置 schema RPC

新增：

```ts
| { type: 'get_settings_schema' }
| { type: 'get_settings'; scope?: 'global' | 'project' | 'effective' }
| { type: 'set_settings'; scope: 'global' | 'project'; patch: Record<string, unknown>; expectedRevision?: number }
```

schema 返回 path、type、label、description、tab、group、options、default、effective value、sensitive、restartRequired 和 appliesTo。

### 16.2 设置分类

- `runtime`：必须在桌面端提供，例如 memory backend、provider concurrency、MCP notifications、worktree/isolation、collab endpoint、auto-learning。
- `desktop-equivalent`：映射到现有 AI、Input、Workspace、Permissions、OMP 页面。
- `tui-only`：终端颜色、状态栏、终端渲染和按键布局等，不强制移植。
- `advanced-raw`：提供可验证的高级配置编辑器，不在普通页面堆叠 296 个选项。

### 16.3 写入规则

- schema 校验在 OMP 端执行，桌面只做即时提示。
- global/project 作用域明确显示。
- sensitive 字段只显示 masked value，禁止回显完整 token。
- 写入后返回新 revision；存在冲突时要求刷新再保存。
- 需要重启的设置明确提示并提供 Restart OMP。

## 17. 文件与模块影响范围

### OMP 上游

- `packages/coding-agent/src/modes/rpc/rpc-types.ts`
- `packages/coding-agent/src/modes/rpc/rpc-mode.ts`
- `packages/coding-agent/src/modes/rpc/rpc-goal-loop.ts`
- `packages/coding-agent/src/slash-commands/builtin-registry.ts`
- `packages/coding-agent/src/modes/controllers/mcp-command-controller.ts`
- Collab、MCP、agent dashboard、extension dashboard 对应模块

### 共享协议和 Agent backend

- `packages/shared/src/agent/backend/omp/omp-rpc-protocol.ts`
- `packages/shared/src/agent/backend/omp/omp-rpc-adapter.ts`
- `packages/shared/src/agent/backend/omp/omp-rpc-backend.ts`
- `packages/shared/src/agent/backend/omp/omp-rpc-protocol.test.ts`

### 服务端

- `packages/server-core/src/sessions/SessionManager.ts`
- `packages/server-core/src/handlers/rpc/sessions.ts`
- `packages/server-core/src/handlers/rpc/llm-connections.ts`
- `packages/server-core/src/services/omp-feature-center.ts`
- `packages/shared/src/protocol/dto.ts`
- `packages/shared/src/protocol/events.ts`

### Electron main/transport

- `apps/electron/src/transport/channel-map.ts`
- `apps/electron/src/shared/types.ts`
- `apps/electron/src/main/handlers/*`
- `apps/electron/src/main/deep-link.ts`
- 外部编辑器、麦克风、系统浏览器和剪贴板相关 handler

### Renderer

- `apps/electron/src/renderer/components/ui/slash-command-menu.tsx`
- `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx`
- `apps/electron/src/renderer/components/app-shell/SessionMenu.tsx`
- `apps/electron/src/renderer/hooks/useSessionMenuActions.ts`
- `apps/electron/src/renderer/pages/settings/OmpFeatureCenterSettingsPage.tsx`
- `apps/electron/src/renderer/components/app-shell/settings/OmpResourceDirectory.tsx`
- 新增 Collab、Tree、Extension、Agent、Debug、STT、Settings schema 页面/组件

## 18. 分阶段实施计划

### P0：协议和能力基础

- capability manifest、feature IDs、统一错误和 event envelope。
- 旧 OMP 兼容 fallback。
- shared/server/renderer 的 contract tests。

### P1：认证与实时连接

- MCP OAuth/Smithery/reconnect/notifications。
- OMP provider logout。
- Collab host/guest/readonly。

### P2：会话与控制中心

- Fork/Tree lineage。
- Extension Control Center、Marketplace。
- Agent Control Center。

### P3：终端专属工具

- BTW、TAN、OMFG。
- Debug Tools Selector。
- STT。

### P4：行为和设置完整性

- Guided Goal 专用 UI。
- Temporary Model、Exact Retry、Queue Dequeue。
- Prompt History、External Editor、Copy Picker。
- 快捷键对齐和高级设置 schema。

每个阶段都必须先完成协议、后端、UI、测试和打包 smoke，不允许只提交界面层。

## 19. 测试与验收矩阵

### 19.1 协议层

- 每个新增 request 都能被旧版本安全拒绝。
- success/error/timeout/cancel/reconnect 均有 fixture。
- event 顺序、requestId、revision 和 stale response 有测试。
- 敏感字段脱敏测试。

### 19.2 服务端

- SessionManager 状态变更和持久化测试。
- workspace/session 权限边界测试。
- 并发 mutation 和 revision conflict 测试。
- OMP 进程退出、重启、降级和能力缺失测试。

### 19.3 Renderer

- capability 缺失时入口隐藏/禁用且原因正确。
- 成功 toast 只在真实 response 后出现。
- loading、cancel、error、retry、stale response 均有组件测试。
- 键盘操作和鼠标操作结果一致。

### 19.4 打包和集成

每个 release-resource 目录的 bundled `omp.exe` 都要运行：

1. 启动与握手。
2. capability manifest。
3. slash command discovery。
4. model/thinking/plan/goal/loop。
5. MCP list/test/reconnect mock。
6. session fork/tree。
7. settings read/write。
8. OMP 进程重启恢复。

外部 OAuth、Smithery、Collab relay、STT 使用可控 mock server；真实服务只做手工验收，不作为 CI 必需依赖。

## 20. Definition of Done

某项功能只有同时满足以下条件才算完成：

- OMP 终端命令与桌面操作的输入、输出和状态语义有映射说明。
- RPC command/event 已加入共享类型、定义、超时和 capability manifest。
- 服务端 handler 有权限、错误、取消和重启恢复处理。
- Renderer 入口不是静态假按钮，能力缺失时正确降级。
- 至少有协议测试、服务端测试、Renderer 测试和 packaged smoke。
- 不泄漏 token、room key、API key、文件内容或敏感诊断。
- README/CLI 文档和变更日志已更新。
- 在旧版 OMP 和最新版 bundled OMP 上均完成兼容验证。

## 21. 风险与决策记录

### 高风险

- Collab 涉及 relay、加密、访客权限和断线恢复，必须先定义安全模型再做 UI。
- OAuth/MCP 回调跨 Electron main、deep-link、OMP 子进程，不能复用普通登录成功状态推断。
- Fork/Tree 如果直接复用当前 Craft session，会造成 transcript 和 session identity 污染，因此必须采用 lineage 映射。

### 中风险

- Marketplace 安装是代码执行边界，必须有来源校验、权限预览和回滚。
- STT 受平台麦克风权限、音频编码和远程部署限制，桌面端与 Web 端需要不同 capability。
- 高级设置数量较大，优先 schema 驱动和分类，不手工复制终端页面。

### 明确不做的事情

- 不把终端 TUI 的布局、颜色和状态栏逐像素搬到桌面。
- 不通过 Renderer 直接启动任意 shell 或修改 OMP 配置文件。
- 不用静态 slash 列表冒充能力支持。
- 不为旧 OMP 猜测不存在的响应格式；能力缺失就明确降级。

## 22. 参考实现入口

- OMP 内置命令注册：[builtin-registry.ts](<D:/ALL PROJECT/oh-my-pi-upstream/packages/coding-agent/src/slash-commands/builtin-registry.ts:278>)
- OMP RPC 命令定义：[rpc-types.ts](<D:/ALL PROJECT/oh-my-pi-upstream/packages/coding-agent/src/modes/rpc/rpc-types.ts:708>)
- Goal/Loop/Guided Goal RPC：[rpc-goal-loop.ts](<D:/ALL PROJECT/oh-my-pi-upstream/packages/coding-agent/src/modes/rpc/rpc-goal-loop.ts:195>)
- MCP 终端子命令：[mcp-command-controller.ts](<D:/ALL PROJECT/oh-my-pi-upstream/packages/coding-agent/src/modes/controllers/mcp-command-controller.ts:331>)
- 共享 OMP RPC 协议：[omp-rpc-protocol.ts](<D:/ALL PROJECT/ohmypi-craft/packages/shared/src/agent/backend/omp/omp-rpc-protocol.ts:708>)
- 桌面 OMP Feature Center：[omp-feature-center.ts](<D:/ALL PROJECT/ohmypi-craft/packages/server-core/src/services/omp-feature-center.ts:64>)
- 桌面资源目录：[OmpResourceDirectory.tsx](<D:/ALL PROJECT/ohmypi-craft/apps/electron/src/renderer/components/app-shell/settings/OmpResourceDirectory.tsx:69>)
- 桌面 Branch/Handoff/Export：[useSessionMenuActions.ts](<D:/ALL PROJECT/ohmypi-craft/apps/electron/src/renderer/hooks/useSessionMenuActions.ts:264>)
- OMP 快捷键定义：[keybindings.ts](<D:/ALL PROJECT/oh-my-pi-upstream/packages/coding-agent/src/config/keybindings.ts:20>)
- OMP 高级设置 schema：[settings-schema.ts](<D:/ALL PROJECT/oh-my-pi-upstream/packages/coding-agent/src/config/settings-schema.ts:468>)
