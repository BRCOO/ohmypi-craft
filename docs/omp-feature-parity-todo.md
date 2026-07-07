# OMP 功能完整对齐 Todo

> 扫描日期：2026-07-06
>
> 当前仓库：`D:\ALL PROJECT\ohmypi-craft`
>
> OMP 上游：`D:\ALL PROJECT\oh-my-pi-upstream`
>
> 当前分支：`codex/omp-rpc-backend`

## 1. 目标与结论

本文档用于把 `ohmypi-craft` 从“Craft 产品壳 + OMP 基础 RPC 对话后端”推进到“可完整使用 OMP 核心能力的桌面产品”。

本次扫描覆盖：

- OMP RPC 的 39 个标准命令。
- OMP RPC 输出帧、会话事件、扩展 UI、Host Tool、Host URI 和子智能体事件。
- OMP 的 30 个公开内置工具及隐藏运行时工具。
- OMP 的 58 个内置斜杠命令，其中 27 个支持 RPC/ACP，31 个依赖 TUI。
- OMP 的模型、认证、会话、压缩、重试、队列、Todo、子智能体、技能、扩展、插件、MCP、记忆、浏览器、LSP、计划和目标系统。
- OMP 设置系统的 10 个设置页及其功能分组。

当前直接发送的标准 OMP RPC 命令已从 6/39 提升到 13/39：

- `prompt`
- `steer`
- `follow_up`
- `abort`
- `abort_and_prompt`
- `get_state`（用于独立模型发现和真实会话启动同步）
- `get_available_models`
- `get_available_commands`
- `set_model`
- `set_thinking_level`
- `set_steering_mode`
- `set_follow_up_mode`
- `set_interrupt_mode`

这不等于 OMP 内核只运行了 13/39 的能力。`omp --mode rpc` 仍会加载 OMP 自身的工具、项目配置、技能、扩展和 MCP。但这些能力中的很大一部分没有桌面入口、状态同步、事件呈现、持久化或错误恢复。

### 状态标记

- **已接入**：功能可从桌面端正常使用并有基本验证。
- **部分接入**：OMP 内核能运行，但桌面端缺少控制、状态、反馈或完整协议处理。
- **未接入**：当前桌面端没有发送命令或消费事件。
- **需决策**：OMP TUI 专属能力，需要决定做桌面等价物、复用 Craft 能力还是明确不支持。

### 优先级

- **P0**：会造成挂起、错误状态、数据不一致或核心能力名存实亡。
- **P1**：OMP 的关键产品能力，成熟版本必须具备。
- **P2**：重要增强能力或管理能力。
- **P3**：高级、边缘或可由现有 Craft 能力替代的功能。

---

## 2. 已经具备的 OMP 能力

以下项目不属于缺失项，但应保留回归测试：

- [x] 从工作目录启动真实 `omp --mode rpc` 子进程。
- [x] 发送普通用户提示词并接收流式文本。
- [x] 接收工具开始和工具结束事件。
- [x] 支持停止当前生成。
- [x] 支持处理中追加 `steer` 消息。
- [x] 支持处理中选择 `steer` / `follow_up` / `abort_and_prompt` 投递策略。
- [x] 发现 OMP 返回的全部模型。
- [x] 发现 OMP 返回的动态斜杠命令并接入 `/` 自动补全。
- [x] 把 OMP 模型规范化为 `provider/modelId`。
- [x] 在发送下一条提示前调用 `set_model`。
- [x] 接入 `available_commands_update` 热更新。
- [x] 接入 `set_steering_mode`、`set_follow_up_mode`、`set_interrupt_mode` 运行时队列策略控制。
- [x] 把 OMP 队列控制状态同步到会话 DTO 和输入框控制菜单。
- [x] 已用真实 DeepSeek 模型完成基础调用验证。
- [x] 已接入扩展 UI：`select`、`confirm`、`input`、`editor`、`cancel`。
- [x] 已接入扩展宿主动作：`notify`、`setStatus`、`setWidget`、`setTitle`、`set_editor_text`、`open_url`。
- [x] OMP 自动压缩开始/结束能显示基础状态消息。
- [x] 子进程启动失败、退出和请求超时有基础错误处理。

---

## 3. P0：协议正确性与不会挂起

### 3.1 修复 RPC `response.data` 解包

当前 `OmpRpcEventAdapter` 在处理 `response` 时把除公共字段外的所有字段放入 `response.data`，导致上游原本的 `data` 变成 `response.data.data`。

- [x] 按上游协议直接读取 `raw.data`。
- [ ] 保留兼容旧 OMP 帧的兜底逻辑，但不能污染标准响应结构。
- [ ] 为 `get_state`、`get_available_models`、`set_model` 和无数据响应分别增加单元测试。
- [x] 对错误响应保留 `command`、`id`、`error` 和原始帧，便于诊断。

验收标准：相关请求拿到的数据结构与 OMP `RpcResponse` 类型完全一致，不需要调用方知道适配器的额外包装。

### 3.2 修复纯斜杠命令导致会话永久处理中

OMP 的 `/model`、`/stats`、`/context` 等 RPC/ACP 命令可能返回 `{ agentInvoked: false }`，不会产生 `agent_end`。当前后端只在 `agent_end` 时结束 `EventQueue`，因此会一直处理中。

- [x] 处理 `prompt` 响应中的 `data.agentInvoked`。
- [x] 处理独立的 `prompt_result` 帧。
- [x] 当 `agentInvoked:false` 时输出已有 `command_output`，随后只发一次 `complete`。
- [x] 当 `agentInvoked:true` 时继续等待正常的 `agent_end`。
- [x] 防止响应和 `agent_end` 同时到达时产生两个 `complete`。
- [ ] 覆盖同步命令、异步命令、技能命令、文件模板命令和扩展命令测试。

验收标准：输入 `/stats`、`/context`、`/model` 等不会卡住，命令结果可见，输入框恢复可用。

### 3.3 正确建立运行时会话状态

上游 RPC `ready` 帧当前只输出 `{ type: "ready" }`，不保证包含 `sessionId`。当前适配器尝试从 `ready.sessionId` 更新 SDK 会话 ID，因此正常情况下拿不到会话 ID。

- [x] `ready` 后在同一个运行时子进程调用 `get_state`。
- [x] 从 `get_state.data.sessionId`、`sessionFile`、`sessionName` 初始化运行时状态。
- [x] 不再依赖非标准的 `ready.sessionId`，但保留向后兼容。
- [x] 把运行时 `get_state` 与模型发现进程的 `get_state` 分开；不能用临时发现进程的会话状态代表真实会话。
- [ ] 子进程重启后重新同步状态、模型、思考等级、队列策略和自动维护设置。

验收标准：每个 Craft 会话都能明确关联一个真实 OMP sessionId/sessionFile，崩溃重启后不会悄悄换成空会话。

### 3.4 建立类型化 OMP RPC 客户端

当前后端用 `Record<string, unknown>` 发送所有命令，协议漂移很难在编译期发现。

- [x] 从 OMP 上游同步或生成精简的 `RpcCommand`、`RpcResponse`、事件帧类型。
- [x] 已覆盖当前直接发送的提示、模型、思考、命令发现和队列控制命令类型。
- [ ] 为每种命令定义返回数据类型和默认超时。
- [ ] 区分普通 request/response、无响应 side channel 和长时操作。
- [ ] 为登录、压缩、导出等长操作配置单独超时。
- [x] 对未知帧计数并记录采样日志，而不是完全静默丢弃。
- [ ] 增加协议版本/OMP 版本探测和兼容性警告。

### 3.5 完善输入附件协议

当前 OMP 后端只把文本和文件路径拼进提示词，没有使用 RPC 原生 `images` 字段，也忽略 `ChatOptions`。

- [x] 把 `FileAttachment.type === 'image'` 转成 OMP `ImageContent[]`。
- [x] 传递 base64、MIME 类型和必要的尺寸限制。
- [x] 对没有 base64 但有本地路径的图片执行安全读取或明确降级到 `inspect_image`。
- [x] 区分 PDF、Office、音频和未知附件的处理策略。
- [x] 传递 `streamingBehavior`。
- [x] 传递单次 `thinkingOverride`，或在发送前临时调用 `set_thinking_level` 并在结束后恢复。
- [ ] 增加视觉模型、纯文本模型、超大图片和损坏附件测试。（已覆盖序列化、超大图片和损坏附件；尚缺真实视觉/纯文本模型矩阵。）

验收标准：支持视觉的 OMP 模型能直接收到图片块，而不是只看到一个路径字符串。

---

## 4. OMP RPC 39 个命令逐项 Todo

| # | RPC 命令 | 当前状态 | Todo |
|---:|---|---|---|
| 1 | `prompt` | 已接入 | 已支持图片、`streamingBehavior`、`prompt_result`、`agentInvoked:false` 和完整响应关联。 |
| 2 | `steer` | 已接入 | 已支持图片 steer、处理中投递和队列状态同步；仍需把失败反馈做成可见 UI。 |
| 3 | `follow_up` | 已接入 | 已增加“当前轮结束后发送”投递入口、队列计数和状态同步；仍需更细的待发送队列详情。 |
| 4 | `abort` | 已接入 | 区分用户停止、重定向、关闭会话和崩溃原因。 |
| 5 | `abort_and_prompt` | 已接入 | 已作为处理中投递策略接入；仍需真实 OMP 端到端冒烟验证“停止并立即改问”的时序。 |
| 6 | `new_session` | 未接入 | 把 Craft 新会话与 OMP 新会话建立一一映射，支持 `parentSession`。 |
| 7 | `get_state` | 启动同步已接入 | 继续用于恢复、重连和调试页，并把状态接入对应 UI。 |
| 8 | `get_available_commands` | 已接入 | 启动后拉取动态命令并驱动输入框自动补全；仍需补参数 schema 展示和逐来源回归。 |
| 9 | `set_todos` | 未接入 | 把桌面 Todo 编辑结果同步回 OMP。 |
| 10 | `set_host_tools` | 未接入 | 把 Craft 数据源、会话操作和宿主工具注册给 OMP。 |
| 11 | `set_host_uri_schemes` | 未接入 | 让 OMP 能读写 Craft 数据源 URI。 |
| 12 | `set_subagent_subscription` | 未接入 | 支持 `off/progress/events`，桌面默认建议 `progress`。 |
| 13 | `get_subagents` | 未接入 | 增加当前子智能体列表和状态恢复。 |
| 14 | `get_subagent_messages` | 未接入 | 增加子智能体详情、增量读取和会话跳转。 |
| 15 | `set_model` | 已接入 | 增加失败回滚、当前模型状态确认和运行中切换限制。 |
| 16 | `cycle_model` | 未接入 | 可由模型选择器替代，但需要保留快捷键或明确不支持。 |
| 17 | `get_available_models` | 已接入 | 改为可复用缓存，显示不可用原因、能力和认证状态。 |
| 18 | `set_thinking_level` | 已接入 | Craft 会话等级与单轮 override 均会发送给 OMP，单轮结束后恢复会话等级。 |
| 19 | `cycle_thinking_level` | 未接入 | 接入快捷切换，并显示 OMP 返回的实际 effort。 |
| 20 | `set_steering_mode` | 已接入 | 输入框控制菜单可设置 `all/one-at-a-time`，并同步 OMP 队列状态；仍需持久化/恢复验证。 |
| 21 | `set_follow_up_mode` | 已接入 | 输入框控制菜单可设置 `all/one-at-a-time`，并同步 OMP 队列状态；仍需持久化/恢复验证。 |
| 22 | `set_interrupt_mode` | 已接入 | 输入框控制菜单可设置 `immediate/wait`；仍需与停止按钮语义做一次真实场景验收。 |
| 23 | `compact` | 未接入 | 增加手动压缩、焦点说明和结果摘要。 |
| 24 | `set_auto_compaction` | 未接入 | 增加会话级开关并从 `get_state` 恢复。 |
| 25 | `set_auto_retry` | 未接入 | 增加会话级开关并显示当前状态。 |
| 26 | `abort_retry` | 未接入 | 重试倒计时时提供取消按钮。 |
| 27 | `bash` | 未接入 | 支持 OMP 的直接用户 Bash 模式，而不必让模型调用 bash 工具。 |
| 28 | `abort_bash` | 未接入 | 支持停止直接 Bash 命令。 |
| 29 | `get_session_stats` | 未接入 | 接入 token、费用、时长、消息和工具统计。 |
| 30 | `export_html` | 未接入 | 增加 OMP 原生 HTML 导出和打开所在位置。 |
| 31 | `switch_session` | 未接入 | 定义 Craft session 与 OMP sessionFile 的切换规则。 |
| 32 | `branch` | 未接入 | 当前 `_supportsBranching=false`；接入基于 OMP entryId 的真实分支。 |
| 33 | `get_branch_messages` | 未接入 | 分支菜单必须使用 OMP entryId，而非仅用 Craft 消息 ID。 |
| 34 | `get_last_assistant_text` | 未接入 | 用于复制、继续、外部动作和恢复验证。 |
| 35 | `set_session_name` | 未接入 | 双向同步 Craft 标题和 OMP sessionName。 |
| 36 | `handoff` | 未接入 | 支持上下文交接、保存路径和新会话跳转。 |
| 37 | `get_messages` | 未接入 | 用于启动恢复、完整性校验和 OMP/Craft 对账。 |
| 38 | `get_login_providers` | 未接入 | 显示 OMP 原生认证供应商、可用性和登录状态。 |
| 39 | `login` | 未接入 | 接入 OAuth URL、进度、回调、取消和失败恢复。 |

---

## 5. RPC 输出帧与事件完整性

### 5.1 基础响应和状态帧

- [x] `ready`：完成后主动获取真实状态。
- [ ] `response`：正确解包 `data`，记录命令耗时。
- [x] `prompt_result`：决定是否等待 `agent_end`。
- [x] `command_output`：以 OMP Command 卡片展示，保留 Markdown/代码块，并在 slash prompt 上下文中显示命令名。
- [x] `available_commands_update`：更新命令缓存和输入框补全。
- [ ] `config_update`：已同步思考等级和队列策略；仍需补齐模型、自动维护和其他运行时配置。
- [ ] `session_info_update`：同步标题和 sessionId。
- [ ] `session_shutdown`：区分正常关闭、切换、错误和被外部终止。
- [ ] `extension_error`：显示扩展来源、错误堆栈摘要和禁用/重试动作。
- [ ] `stderr`：不要把所有 stderr 都当用户错误；区分诊断日志和致命错误。

### 5.2 Agent 会话事件

- [ ] `message_start`：建立稳定的 OMP messageId/turnId 映射。
- [ ] `message_update`：区分文本 delta、thinking delta 和其他内容块。（文本与 thinking 已区分；其他内容块仍待补齐。）
- [ ] `message_end`：保存 stopReason、usage、provider metadata 和错误信息。
- [ ] `tool_execution_start`：保留 intent、displayName、参数和父子关系。
- [ ] `tool_execution_update`：当前被完全忽略；接入流式 stdout、进度和部分结果。
- [ ] `tool_execution_end`：支持结构化内容、图片、artifact URI 和非文本结果。
- [ ] `turn_start/turn_end`：使用上游 ID，不要只生成本地递增 ID。
- [ ] `agent_start/agent_end`：保证每轮只完成一次并保存终止原因。
- [ ] `auto_compaction_start/end`：显示动作、原因、是否跳过、是否重试和错误。
- [ ] `auto_retry_start/end`：显示次数、倒计时、错误和取消按钮。
- [ ] `retry_fallback_applied/succeeded`：显示模型回退链和最终模型。
- [ ] `thinking_level_changed`：同步配置值、实际值和 auto 解析结果。
- [ ] `todo_reminder/todo_auto_clear`：同步 Todo 面板。
- [ ] `goal_updated`：同步 Goal 状态。
- [ ] `ttsr_triggered`：显示命中的规则及注入说明。
- [ ] `irc_message`：设计跨会话消息呈现；当前每个 Craft 会话独立 OMP 进程可能阻断 IRC 注册表。
- [ ] `notice`：区分 info/warning/error，保留 source。
- [ ] `user_bash/user_python` 等用户执行事件：映射为可恢复的命令消息。

### 5.3 子智能体帧

- [ ] 消费 `subagent_lifecycle`。
- [ ] 消费 `subagent_progress`。
- [ ] 消费 `subagent_event`。
- [ ] 保存 `parentToolCallId` 和嵌套层级。
- [ ] 增加子智能体列表、运行中数量和完成状态。
- [ ] 增加子智能体消息增量读取和错误重试。
- [ ] 支持隔离 worktree、patch、branch、apply/merge 结果展示。
- [ ] 主会话恢复时调用 `get_subagents` 重建 UI。

### 5.4 Host Tool 帧

- [ ] 实现 `host_tool_call` 分发。
- [ ] 实现 `host_tool_cancel`。
- [ ] 返回 `host_tool_update` 流式进度。
- [ ] 返回 `host_tool_result`，保留结构化内容和 `isError`。
- [ ] 对宿主工具执行权限、超时、取消和并发做统一治理。
- [ ] 防止 OMP 工具名与 Craft 内置工具名冲突。

### 5.5 Host URI 帧

- [ ] 实现 `host_uri_request` 的 read/write。
- [ ] 实现 `host_uri_cancel`。
- [ ] 返回 `host_uri_result` 的 content、contentType、notes、immutable 和错误。
- [ ] 为 Craft API、MCP、本地文件夹及未来数据源分配稳定 URI scheme。
- [ ] 对 URI 写操作应用 Craft 权限和审计。

---

## 6. OMP 30 个内置工具逐项对齐

OMP 工具会在子进程中按 OMP 设置加载，但“能在引擎里运行”不等于“桌面端完整支持”。

| 工具 | 当前内核状态 | 桌面端缺口 Todo |
|---|---|---|
| `read` | 可运行 | 显示 hashline、artifact、二进制/图片结果和读取摘要。 |
| `bash` | 可运行 | 接入流式 update、PTY/交互输入、后台任务、停止和命令元数据。 |
| `edit` | 可运行 | 显示结构化 diff、冲突、no-op、LSP 延迟诊断和回滚。 |
| `ast_grep` | 可运行/取决于设置 | 增加 AST 匹配结果专用展示和设置入口。 |
| `ast_edit` | 可运行/取决于设置 | 增加 AST 编辑预览和结果展示。 |
| `ask` | 基本可用 | 通过扩展 UI 验证选项、超时、取消及多次并发请求。 |
| `debug` | 条件启用 | 增加开发者设置、输出隔离和生产环境限制。 |
| `eval` | 可运行/取决于运行时 | 接入 JS/Python/Ruby/Julia 流式输出、保留内核和停止。 |
| `ssh` | 条件启用 | 接入主机管理、认证错误、known_hosts 和风险提示。 |
| `github` | 条件启用 | 接入 GitHub 认证、缓存状态、结构化结果和错误动作。 |
| `glob` | 可运行 | 增加大量结果折叠、artifact 和路径跳转。 |
| `grep` | 可运行 | 增加匹配位置、代码预览和跳转。 |
| `lsp` | 条件启用 | 接入诊断、跳转、代码动作、延迟诊断和服务器状态。 |
| `inspect_image` | 可运行 | 与附件系统连接，显示检查的图片和模型说明。 |
| `browser` | 条件启用 | 决定使用 OMP 浏览器还是 Craft 浏览器面板；接入 tab、截图、可见/无头状态和停止。 |
| `checkpoint` | 条件启用 | 保存 checkpoint 状态并在桌面显示可回退点。 |
| `rewind` | 条件启用 | OMP 回退后同步 Craft 消息、文件状态和 Todo，避免双重时间线。 |
| `task` | 可运行 | 接入子智能体订阅、进度、隔离 worktree、patch 和详情页。 |
| `job` | 可运行 | 增加后台任务面板、完成通知、取消和跨轮投递状态。 |
| `irc` | 条件启用 | 解决“一 Craft 会话一 OMP 进程”导致的跨会话注册表隔离。 |
| `todo` | 条件启用 | 映射 OMP TodoPhase/TodoItem，支持编辑、同步和恢复。 |
| `web_search` | 条件启用 | 接入供应商配置、凭据、引用和错误反馈。 |
| `search_tool_bm25` | 条件启用 | 显示发现到的工具、激活状态和来源。 |
| `write` | 可运行 | 显示创建/覆盖差异、编码、权限和 LSP 反馈。 |
| `memory_edit` | 条件启用 | 增加记忆条目查看、编辑和敏感信息警告。 |
| `retain` | 条件启用 | 显示保留内容、后端和成功状态。 |
| `recall` | 条件启用 | 显示召回来源、得分和注入范围。 |
| `reflect` | 条件启用 | 显示反思任务、结果和写入的记忆。 |
| `learn` | 条件启用 | 显示学习目标、生成的技能/记忆和撤销入口。 |
| `manage_skill` | 条件启用 | OMP 修改技能后刷新 Craft 技能列表，并解决两套技能目录冲突。 |
| `grep` 的旧别名 `search` | 兼容能力 | 在日志和 UI 中统一显示 canonical 名称。 |
| `glob` 的旧别名 `find` | 兼容能力 | 在日志和 UI 中统一显示 canonical 名称。 |

隐藏/运行时工具也需要处理：

- [ ] `yield`：显示让出控制和后台结果注入。
- [ ] `resolve`：呈现预览确认和计划/目标模式动作。
- [ ] `goal`：与 Goal UI 状态同步。
- [ ] `report_finding`：结构化展示审查发现。
- [ ] `report_tool_issue`：开发/AutoQA 模式下展示问题报告。

---

## 7. 斜杠命令完整对齐

### 7.1 27 个 RPC/ACP 可用命令

先完成动态命令发现和纯命令完成状态修复，再逐个验证：

- [ ] `/model`：当前模型、按 ID 切换、失败回滚。
- [ ] `/fast`：on/off/status 和状态同步。
- [ ] `/advisor`：on/off/status/dump；configure 需要桌面编辑器替代。
- [ ] `/export`：输出路径、打开文件和失败反馈。
- [ ] `/dump`：展示完整 transcript 和 LLM request sidecar 的敏感信息警告。
- [ ] `/share`：决定使用 OMP 分享还是 Craft 分享，避免双实现冲突。
- [ ] `/browser`：headless/visible 状态与桌面浏览器集成。
- [ ] `/todo`：查看、编辑、导入、导出、append/start/done/drop。
- [ ] `/session`：显示 OMP session 元数据并与 Craft session 对账。
- [ ] `/jobs`：后台任务列表、状态和取消。
- [ ] `/usage`：供应商额度、重置和错误。
- [ ] `/stats`：会话统计。
- [ ] `/changelog`：版本对应的更新日志。
- [ ] `/tools`：活动工具、发现工具和来源。
- [ ] `/context`：上下文占用、系统提示和维护状态。
- [ ] `/mcp`：add/list/remove/test/reauth/unauth/enable/disable/resources/prompts/notifications/search/reconnect/reload。
- [ ] `/ssh`：add/list/remove。
- [ ] `/fresh`：刷新 provider session，并明确是否保留当前 Craft transcript。
- [ ] `/compact`：默认、soft、remote、snapcompact 和自定义 focus。
- [ ] `/shake`：elide/images 及结果展示。
- [ ] `/memory`：后端状态、记忆操作和配置。
- [ ] `/rename`：双向同步标题。
- [ ] `/move`：移动 OMP 会话工作目录，并同步 Craft 工作目录。
- [ ] `/marketplace`：市场源和搜索管理。
- [ ] `/plugins`：安装、启用、禁用、卸载和列表。
- [ ] `/reload-plugins`：刷新命令、工具、扩展和设置状态。
- [ ] `/force`：明确其安全语义并接入权限提示。

所有命令的共同 Todo：

- [ ] 输入 `/` 时展示名称、别名、描述、参数提示、子命令和来源。（名称、子命令、来源已接入；别名、参数提示和描述呈现仍需完善。）
- [x] 支持来源标签：builtin、skill、extension、custom、mcp_prompt、file。
- [x] 处理 `available_commands_update` 热更新。
- [x] 命令输出不创建虚假的 assistant 消息，而是渲染为 OMP Command 结果卡片。
- [ ] 命令错误可以重试、复制诊断或打开对应设置。

### 7.2 31 个 TUI 专属命令的桌面等价物决策

这些命令不会出现在 RPC `get_available_commands`，不能假设输入原命令就能工作。每项必须选择“实现桌面等价物”“扩展上游 RPC”“复用 Craft”或“明确不支持”。

- [ ] `/settings`：映射到 OMP 设置页，而不是仅打开 Craft 设置。
- [ ] `/setup` / `/providers`：映射到 OMP 供应商设置与登录。
- [ ] `/plan`：实现 OMP Plan Mode 桌面状态和计划审查。
- [ ] `/plan-review`：实现计划审查重开。
- [ ] `/goal`：实现 Goal 设置、show、pause、resume、drop、budget。
- [ ] `/guided-goal`：实现目标访谈流程。
- [ ] `/loop`：实现重复提示、次数/时长限制和停止。
- [ ] `/switch`：复用模型选择器并保留临时切换语义。
- [ ] `/collab`：评估 OMP 实时协作与 Craft 分享功能的关系。
- [ ] `/join`：如保留 OMP collab，支持加入共享会话。
- [ ] `/leave`：如保留 OMP collab，支持退出。
- [ ] `/copy`：复用桌面复制选择器，支持 code/cmd。
- [ ] `/hotkeys`：复用快捷键页并补 OMP 专属动作。
- [ ] `/extensions`：增加 OMP 扩展列表、状态、错误和重载。
- [ ] `/agents`：增加 OMP agent 定义和子智能体查看。
- [ ] `/branch`：使用 RPC `branch` 实现桌面入口。
- [ ] `/fork`：上游 RPC 当前无直接 fork 命令；需扩展协议或设计等价流程。
- [ ] `/tree`：实现会话树/分支树。
- [ ] `/login`：使用 RPC `login` 和 `get_login_providers`。
- [ ] `/logout`：上游 RPC 当前无 logout；需扩展协议或安全调用 CLI。
- [ ] `/new`：使用 RPC `new_session`。
- [ ] `/drop`：定义桌面端丢弃/删除当前 OMP 会话的安全语义。
- [ ] `/handoff`：使用 RPC `handoff`。
- [ ] `/resume`：使用 `switch_session` 和会话选择器。
- [ ] `/btw`：为旁路问题增加 RPC 能力或桌面等价物。
- [ ] `/tan`：确认上游语义并增加桌面等价物。
- [ ] `/omfg`：确认上游语义并增加桌面等价物。
- [ ] `/retry`：实现最后一轮重试和重试状态。
- [ ] `/debug`：增加 OMP 诊断面板，生产环境受控。
- [ ] `/exit`：映射到关闭当前窗口/会话，不应直接杀死整个宿主。
- [ ] `/quit`：映射到退出应用并完成 OMP dispose/记忆收尾。

### 7.3 动态命令来源

- [ ] OMP Skill 命令。
- [ ] OMP Extension 命令。
- [ ] OMP Custom Command。
- [ ] MCP Prompt 命令。
- [ ] 文件 Slash Command。
- [ ] 命令名称冲突和保留字提示。
- [ ] 插件重载后命令缓存失效。

---

## 8. 模型、思考和供应商能力

### 8.1 模型元数据

- [ ] 保存并展示 OMP 模型的 provider、id、name、context window、能力和成本元数据。
- [ ] 标记视觉、thinking、工具调用和服务层级支持情况。
- [ ] 显示模型为何不可用：未认证、被禁用、配置过滤或运行时错误。
- [ ] 支持 OMP `enabledModels`、`disabledProviders`、provider order、model tags 和 model roles。
- [ ] 模型发现缓存要按 OMP 命令、配置根、工作目录和认证状态失效。

### 8.2 思考等级

- [ ] 覆盖 `off/low/medium/high/xhigh/max/auto` 映射差异。
- [x] `setThinkingLevel` 必须发送 `set_thinking_level`，不能只修改 Craft 本地字段。
- [x] 消费 `thinking_level_changed`。
- [ ] 显示 configured、effective、resolved 三种状态。
- [ ] 模型切换后重新校验可用等级。
- [x] 单轮 override 完成后恢复会话等级。

### 8.3 登录和认证

- [ ] `get_login_providers` 驱动 OMP 登录页。
- [ ] OAuth 登录支持 `open_url`、launchUrl、进度和取消。
- [ ] 对需要 API key 交互而 RPC 不支持的供应商给出明确终端指引或扩展上游协议。
- [ ] 增加 logout 能力设计。
- [ ] 当前 OMP connection 的 `validateStoredConnection` 不能永远返回 success。
- [ ] 当前 OMP connection 的 `testConnection` 不能永远返回 null。
- [ ] 增加 OMP 命令路径、版本、认证库、配置目录和模型访问诊断。

---

## 9. 会话、分支、恢复和持久化

### 9.1 明确双会话模型

当前同时存在 Craft session 和 OMP session。必须定义哪个是事实来源，以及如何对账。

- [ ] 建立 Craft sessionId ↔ OMP sessionId ↔ OMP sessionFile 映射。
- [ ] 保存映射到持久化元数据。
- [ ] 打开已有 Craft 会话时恢复对应 OMP session，而不是新建空 OMP 会话。
- [ ] 使用 `get_messages` 对账消息数量、角色和最后消息。
- [ ] 定义 Craft 消息与 OMP entryId/messageId 的映射。
- [ ] 子进程崩溃后自动重连原会话。
- [ ] 如果原 OMP sessionFile 不存在，显示可恢复错误而不是静默重开。
- [ ] 避免 Craft 和 OMP 双方同时压缩/改写历史导致分叉。

### 9.2 分支与树

- [ ] `get_branch_messages` 获取可分支用户消息。
- [ ] `branch` 返回后更新两边的 session 映射。
- [ ] 支持 OMP fork；若需上游新 RPC，先提交协议扩展。
- [ ] 显示父会话、子会话和 branch point。
- [ ] 分支后同步 Todo、MCP 选择、记忆上下文和 artifact。
- [ ] 为 rewind/checkpoint 与 branch 的组合增加一致性测试。

### 9.3 Handoff、导出和移动

- [ ] `handoff` 生成新上下文并跳转到新会话。
- [ ] 显示 handoff savedPath 和失败恢复。
- [ ] `export_html` 支持默认路径、自定义路径和打开文件。
- [ ] `set_session_name` 双向同步。
- [ ] `/move` 后同步工作目录、会话文件和 Craft workspace 状态。

---

## 10. 压缩、重试、上下文和用量

### 10.1 压缩

- [ ] 手动 compact。
- [ ] auto compaction 开关。
- [ ] soft/remote/snapcompact 策略。
- [ ] 显示触发原因：threshold、overflow、idle、incomplete。
- [ ] 显示动作：context-full、handoff、shake、snapcompact。
- [ ] 显示 skipped、aborted、willRetry 和 errorMessage。
- [ ] 压缩完成后刷新 context usage 和消息视图。

### 10.2 重试与模型回退

- [ ] auto retry 开关。
- [ ] 显示 attempt/maxAttempts/delay/error。
- [ ] 取消等待中的 retry。
- [ ] 显示 fallback from/to/role。
- [ ] 成功回退后同步当前模型。
- [ ] 区分 provider 错误、速率限制、上下文溢出和空响应。

### 10.3 上下文与统计

- [ ] 消费 `get_state.contextUsage`。
- [ ] 接入 `get_session_stats`。
- [ ] 显示输入、输出、缓存读写、总 token、费用和上下文百分比。
- [ ] 显示当前 system prompt、工具描述和上下文构成的安全摘要。
- [ ] 原始 dump/LLM request 文件必须提示可能包含密钥和私密上下文。

---

## 11. Todo、计划、目标和高级代理模式

### 11.1 OMP Todo

- [ ] 定义 OMP TodoPhase/TodoItem 与 Craft 状态系统的关系，不能直接混为同一种概念。
- [ ] 从 `get_state.todoPhases` 恢复 Todo。
- [ ] 用 `set_todos` 保存桌面编辑。
- [ ] 消费 reminder 和 auto-clear 事件。
- [ ] 支持导入、导出、append、start、done、drop。
- [ ] 子智能体 Todo 与主会话 Todo 分开显示。

### 11.2 Plan Mode

- [ ] 显示 Plan Mode 是否开启。
- [ ] 支持提交、审查、修改、接受和拒绝计划。
- [ ] 支持重新打开 plan review。
- [ ] 显示计划文件引用。
- [ ] 与 Craft Explore/Execute 模式做明确映射，避免两个模式互相打架。

### 11.3 Goal Mode

- [ ] set/show/pause/resume/drop。
- [ ] token budget 设置和剩余预算。
- [ ] guided goal 访谈。
- [ ] 消费 `goal_updated`。
- [ ] 显示自动继续、暂停、完成和阻塞原因。

### 11.4 Advisor、Loop、TTSR 和 Magic Keywords

- [ ] Advisor 开关、模型角色、状态、dump 和配置。
- [ ] Loop 模式、次数/时长限制和停止。
- [ ] TTSR 规则触发、来源和注入内容。
- [ ] `/btw`、`/tan`、`/omfg` 等旁路能力的桌面等价物。

---

## 12. Skills、Extensions、Plugins 和 Marketplace

### 12.1 Skills

- [ ] 区分 Craft Skill 与 OMP Skill 的目录、优先级和来源。
- [ ] 展示 OMP Skill 的 user/project/path 来源。
- [ ] 支持 Skill 命令发现和参数提示。
- [ ] OMP `manage_skill` 修改后刷新桌面列表。
- [ ] 显示加载警告、名称冲突和禁用状态。

### 12.2 Extensions

- [ ] OMP 扩展列表、路径、来源、启用状态和错误。
- [ ] 扩展重载后刷新命令和工具。
- [ ] 多个并发 blocking UI 请求的队列与取消。
- [ ] 扩展 UI 请求随会话切换正确归属和清理。
- [ ] `setTitle`：启动 OMP 时配置 RPC title opt-in，否则上游默认不会发标题。
- [ ] 对上游 RPC 不支持的 UI 能力给出明确边界：custom component、header/footer、同步 getEditorText、工具展开和自定义 editor component。

### 12.3 Plugins / Marketplace

- [ ] 列出已安装插件和版本。
- [ ] 安装、更新、启用、禁用和卸载。
- [ ] Marketplace 源管理和搜索。
- [ ] 自动更新设置和失败恢复。
- [ ] 插件变更后热重载命令、工具、扩展和设置。
- [ ] 对插件代码执行给出信任和权限提示。

---

## 13. MCP、Craft 数据源和 URI 桥

当前 Craft 的 API/MCP/本地文件夹数据源与 OMP 自己的 MCP 配置是两套系统。

- [ ] 决定统一由 OMP 管理 MCP，还是由 Craft 管理后通过 Host Tool/URI 暴露。
- [ ] 避免同一个 MCP server 在 Craft 和 OMP 中重复启动。
- [ ] 把 Craft source tools 注册为 OMP host tools。
- [ ] 把 Craft 数据对象映射为稳定 URI。
- [ ] MCP OAuth、资源、提示、通知和重连状态进入桌面 UI。
- [ ] 支持 OMP tool discovery/BM25 激活状态。
- [ ] 保存每个会话的 MCP tool 选择并在恢复时同步。
- [ ] 对 MCP 写操作复用 Craft 权限、审计和敏感操作提示。

---

## 14. OMP 设置系统对齐

OMP 上游设置分为 10 个页签。当前 Craft 设置并未系统性映射这些值。需要建立“OMP 设置”命名空间，避免修改 Craft 设置却不影响 OMP。

### Appearance

- [ ] Theme：桌面不复刻终端主题，但需决定是否映射品牌主题。
- [ ] Status Line：TUI 专属，标记不适用或映射为桌面状态栏。
- [ ] Display：thinking、token、cache、streaming 等非终端选项需要桌面入口。
- [ ] Images：auto resize、block images、text-model image description。

### Model

- [ ] Thinking。
- [ ] Sampling。
- [ ] Prompt。
- [ ] Retry & Fallback。
- [ ] Advisor。
- [ ] Vision。

### Interaction

- [ ] Input 和队列策略。
- [ ] Approvals。
- [ ] Notifications。
- [ ] Speech/STT/TTS。
- [ ] Collab。
- [ ] Magic Keywords。
- [ ] Startup & Updates。
- [ ] Agent 行为。
- [ ] Git 集成。
- [ ] macOS Power 设置标记为平台特定。

### Context

- [ ] General。
- [ ] Compaction。
- [ ] Rules/TTSR。
- [ ] Experimental。

### Memory

- [ ] General。
- [ ] Auto-Learn。
- [ ] Mnemopi。
- [ ] Hindsight。

### Files

- [ ] Editing。
- [ ] Reading。
- [ ] Read Summaries。
- [ ] LSP。

### Shell

- [ ] Bash。
- [ ] Eval & Runtimes。

### Tools

- [ ] Available Tools。
- [ ] Todos。
- [ ] Grep & Browser。
- [ ] GitHub。
- [ ] Output Limits。
- [ ] Execution。
- [ ] Discovery & MCP。
- [ ] Developer。

### Tasks

- [ ] Modes。
- [ ] Subagents。
- [ ] Isolation。
- [ ] Commands & Skills。

### Providers

- [ ] Services。
- [ ] Fireworks。
- [ ] Tiny Model。
- [ ] Protocol。
- [ ] Timeouts。
- [ ] Privacy。

设置基础设施 Todo：

- [ ] 读取 OMP effective settings，而不是只读 Craft 配置。
- [ ] 区分全局、项目、overlay 和运行时 override。
- [ ] 显示设置来源和是否被项目设置覆盖。
- [ ] 修改设置后触发需要的重载或重启。
- [ ] 提供“打开 OMP config.yml”和“恢复默认值”。
- [ ] 对无法通过 RPC 修改的设置增加安全写入方案或上游协议扩展。

---

## 15. 记忆系统

- [ ] 检测当前 memory backend：off/local/hindsight/mnemopi 等。
- [ ] 显示后端健康状态、存储位置和认证错误。
- [ ] 支持 recall/retain/reflect 的可视化结果。
- [ ] 支持 memory edit 和删除确认。
- [ ] 显示自动召回和自动学习是否发生。
- [ ] 会话切换、fork、branch 和 handoff 后正确重建 memory sessionId。
- [ ] 应用退出时等待或明确中止 Mnemopi consolidate。
- [ ] 对记忆中的敏感信息提供查看和清理入口。

---

## 16. 浏览器、GitHub、SSH、LSP 和运行时集成

- [ ] Browser：决定 OMP 自带浏览器和 Craft browser panel 的唯一控制面。
- [ ] Browser：展示 tab、URL、截图、headless、进程状态和崩溃恢复。
- [ ] GitHub：认证、缓存、速率限制和结构化对象跳转。
- [ ] SSH：连接配置、认证、known_hosts、超时和危险命令确认。
- [ ] LSP：服务器生命周期、诊断、代码动作、延迟诊断和多语言状态。
- [ ] Eval：JS/Python/Ruby/Julia 可用性、解释器配置、保留 kernel 和清理。
- [ ] Web Search：供应商选择、凭据、引用、配额和错误。
- [ ] Tiny Model：标题、自动 thinking、memory 等辅助模型的安装和状态。
- [ ] STT/TTS：如果产品需要语音，接入模型、设备、语音和提交触发设置；否则明确不支持。

---

## 17. OMP CLI 专属能力的产品决策

以下顶层 CLI 能力不一定都应做成 GUI，但必须明确处理方式，不能因为 RPC 对话可用就宣称完整支持：

- [ ] `acp`
- [ ] `agents`
- [ ] `auth-broker`
- [ ] `auth-gateway`
- [ ] `bench`
- [ ] `commit`
- [ ] `complete`
- [ ] `completions`
- [ ] `config`
- [ ] `dry-balance`
- [ ] `gallery`
- [ ] `gc`
- [ ] `grep`
- [ ] `grievances`
- [ ] `install`
- [ ] `join`
- [ ] `launch`
- [ ] `models`
- [ ] `plugin`
- [ ] `read`
- [ ] `say`
- [ ] `setup`
- [ ] `shell`
- [ ] `ssh`
- [ ] `stats`
- [ ] `tiny-models`
- [ ] `token`
- [ ] `ttsr`
- [ ] `update`
- [ ] `usage`
- [ ] `web-search`
- [ ] `worktree`

每项选择以下一种交付方式：

- 桌面原生入口。
- 调用 OMP CLI 并展示结果。
- 打开集成终端执行。
- 由 Craft 已有功能替代。
- 明确标记为桌面版不支持。

---

## 18. 安全、权限和隔离

OMP 当前 RPC 协议并没有使用现有适配器中的标准 `permission_response` 命令；OMP 工具审批更多通过 OMP 自身策略和 RPC Extension UI confirm 完成。Craft 权限模式不能假装已经控制 OMP。

- [ ] 明确 OMP approval mode 与 Craft safe/ask/allow-all 的映射。
- [ ] 启动 OMP 时设置对应的 autoApprove/approval 配置。
- [ ] Extension UI confirm 要显示工具名、风险、参数和作用域。
- [ ] “始终允许”必须写入 OMP 可识别的策略，不能继续被 `_alwaysAllow` 参数静默忽略。
- [ ] Host Tool/URI 使用同一套权限决策。
- [ ] 子智能体隔离 worktree 和 merge/apply 操作需要独立确认。
- [ ] 插件、扩展、自定义工具和 MCP 首次执行显示来源和信任信息。
- [ ] 对 dump、日志、导出和记忆中的密钥进行敏感信息提示与可选脱敏。

---

## 19. 错误处理与运行时诊断

- [ ] 检测 `omp` 不存在、版本过旧、命令不可执行和路径包含空格。
- [x] 显示实际解析到的命令和版本。
- [ ] 区分启动超时、认证失败、模型不可用、协议错误和 OOM。
- [x] 保存最近 stderr，但避免把普通诊断当聊天错误。
- [x] 对未知帧、丢失响应和重复 ID 提供计数。
- [x] 子进程退出时保存 exit code/signal 和最后活动命令。
- [ ] 支持安全重启 OMP 会话并恢复状态。
- [ ] 增加诊断导出，包含脱敏后的状态、版本、命令能力和事件计数。
- [x] OMP connection 测试必须执行真实 ready/get_state/get_available_models 流程。

---

## 20. 测试与验收矩阵

### 单元测试

- [ ] 39 个 RPC 命令的序列化和响应解包测试。
- [ ] 所有已知输出帧的 adapter fixture 测试。
- [ ] unknown frame、重复 complete、乱序 response 和进程退出测试。
- [x] 图片、文本、PDF、Office、音频附件测试。
- [x] 模型和思考等级映射测试。
- [ ] Todo、subagent、Host Tool、Host URI 状态 reducer 测试。

### 集成测试

- [x] 启动真实本地 OMP，完成 ready/get_state。
- [ ] 普通 prompt。
- [x] 纯命令 prompt (`/stats`) 不挂起。
- [ ] Skill 命令。
- [ ] Extension blocking UI。
- [ ] Tool streaming update。
- [ ] 图片 prompt。
- [x] 模型和思考等级切换。
- [ ] compact/retry。
- [ ] subagent progress/messages。
- [ ] session switch/branch/handoff/export。
- [ ] OAuth 登录。
- [ ] Host Tool 和 Host URI。

### Electron 端到端

- [ ] 开发环境完整 OMP 扩展流程。
- [ ] 打包应用完整 OMP 扩展流程。
- [ ] 应用重启恢复 OMP 会话。
- [ ] OMP 子进程崩溃后恢复。
- [ ] 多 Craft 会话并行 OMP 进程。
- [ ] 窗口关闭时子进程、浏览器、eval kernel 和记忆安全清理。
- [ ] Windows 安装包找得到正确 OMP 命令和配置目录。

---

## 21. 推荐实施顺序

### Phase A：协议可信（P0）

- [ ] 类型化 RPC 客户端。（当前直接发送命令已类型化；完整 39 命令返回类型、超时和长操作分类待补齐。）
- [x] 修复 response.data。
- [x] 修复 `agentInvoked:false` 挂起。
- [x] 真实会话 get_state。
- [x] 图片和 thinking。
- [ ] 完整事件日志与未知帧诊断。

### Phase B：核心 OMP 产品能力（P1）

- [x] 动态斜杠命令。（基础发现、补全和热更新已接入；逐命令验证和富展示在 7.1 继续跟踪。）
- [ ] 子智能体实时视图。
- [ ] Todo。
- [ ] compact/retry/context/stats。
- [ ] session resume/branch/handoff/export。
- [ ] 登录和供应商状态。

### Phase C：宿主融合（P1/P2）

- [ ] Host Tools。
- [ ] Host URI。
- [ ] Craft Sources 与 OMP MCP 统一。
- [ ] 权限和安全策略统一。
- [ ] Browser/LSP/GitHub/SSH 专用体验。

### Phase D：高级 OMP 模式（P2/P3）

- [ ] Plan/Goal/Advisor/Loop。
- [ ] Memory/Auto-Learn。
- [ ] Plugins/Marketplace。
- [ ] Collab/Share 决策。
- [ ] CLI 专属能力决策。

---

## 22. 完成定义

只有满足以下条件，才能对外称为“OMP 功能完整桌面版”：

- [ ] 所有 39 个 RPC 命令已接入，或有书面且用户可见的不支持说明。
- [ ] 所有 RPC 输出帧均被处理、记录或明确忽略，不存在静默丢失关键状态。
- [ ] OMP 的模型、思考、工具、技能、扩展、MCP、Todo、子智能体、会话和认证均有可操作入口。
- [ ] Craft 与 OMP 的会话、权限、数据源和设置没有相互矛盾的双重事实来源。
- [ ] 应用重启、子进程崩溃、模型失败和网络失败不会丢失会话或永久卡住。
- [ ] Windows 开发版和打包版都通过真实 OMP 端到端测试。
- [ ] 所有刻意不支持的 TUI/CLI 功能均有替代方案或明确产品说明。

---

## 23. 主要源码依据

### OMP 上游

- `packages/coding-agent/src/modes/rpc/rpc-types.ts`
- `packages/coding-agent/src/modes/rpc/rpc-mode.ts`
- `packages/coding-agent/src/modes/rpc/rpc-client.ts`
- `packages/coding-agent/src/session/agent-session.ts`
- `packages/coding-agent/src/session/session-manager.ts`
- `packages/coding-agent/src/slash-commands/builtin-registry.ts`
- `packages/coding-agent/src/slash-commands/available-commands.ts`
- `packages/coding-agent/src/tools/builtin-names.ts`
- `packages/coding-agent/src/tools/index.ts`
- `packages/coding-agent/src/config/settings-schema.ts`
- `packages/coding-agent/src/extensibility/`
- `packages/coding-agent/src/mcp/`
- `packages/coding-agent/src/task/`

### 当前项目

- `packages/shared/src/agent/backend/omp/omp-rpc-backend.ts`
- `packages/shared/src/agent/backend/omp/omp-rpc-adapter.ts`
- `packages/shared/src/agent/backend/omp/omp-model-discovery.ts`
- `packages/shared/src/agent/backend/internal/drivers/omp.ts`
- `packages/server-core/src/sessions/SessionManager.ts`
- `apps/electron/src/renderer/App.tsx`
- `apps/electron/src/renderer/components/app-shell/input/structured/ExtensionUiRequest.tsx`
- `docs/superpowers/specs/2026-07-05-omp-rpc-backend-design.md`
- `docs/superpowers/specs/2026-07-05-omp-extension-ui-bridge-design.md`
