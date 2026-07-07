# OMP command and queue control plane design

日期：2026-07-07

状态：等待用户复审

范围：第 3 批，承接 `2026-07-07-omp-multimodal-thinking-diagnostics-design.md`

## 背景

前两批已经让 OMP RPC 后端具备可信的基础对话能力：真实 `omp --mode rpc` 生命周期、模型发现、图片附件、thinking、基础诊断和不会因纯命令永久挂起。下一块最影响“像不像 OMP”的能力，不是继续雕界面颜色，而是让桌面端能看见并驱动 OMP 自己的命令和中途输入控制。

当前 `ohmypi-craft` 仍有几个明显断点：

- 输入框 `/` 菜单是 Craft 静态命令，类型上把 command id 限定为 `PermissionMode | 'compact'`，无法承载 OMP 返回的动态命令、技能命令、扩展命令、MCP prompt 或文件命令。
- OMP 上游已经有 `get_available_commands` 和 `available_commands_update`，但当前桌面端没有请求、缓存、展示或失效这些命令。
- 处理中输入目前主要走 Craft 的 `redirect/queue` 抽象。OMP 原生已经提供 `steer`、`follow_up` 和 `abort_and_prompt`，当前只使用了最窄的纯文本 `steer`。
- `get_state` 已能解析 `steeringMode`、`followUpMode`、`interruptMode` 和 `queuedMessageCount`，但这些值还没有成为桌面端可理解的控制状态。

本设计把第 3 批定义为“OMP 命令与队列控制面”：让桌面端发现 OMP 动态命令，让处理中消息使用 OMP 原生控制语义，并把队列策略状态同步到 renderer。

## 目标

1. 桌面输入框能展示 OMP RPC 返回的动态 slash command。
2. OMP builtin、skill、extension、custom、MCP prompt、file 命令都保留来源信息和参数提示。
3. 处理中输入能区分“立即 steer”“当前轮结束后 follow-up”“停止并立即改问 abort-and-prompt”。
4. `steer`、`follow_up`、`abort_and_prompt` 都能复用第 2 批图片附件转换逻辑。
5. 队列策略通过 OMP 原生命令设置，并从 OMP runtime state 恢复。
6. Craft 非 OMP provider 的现有 mid-stream 行为不变。
7. 有自动化测试覆盖协议、后端、SessionManager 路由和 renderer 菜单行为。
8. 有真实 OMP smoke 验证命令发现和队列控制命令可用。

## 非目标

本批不实现以下能力：

- 子智能体实时视图。
- OMP Todo 面板和 `set_todos`。
- 手动 compact、auto retry、session stats 的完整 UI。
- Craft session 与 OMP sessionFile 的长期恢复映射。
- Host Tool、Host URI、MCP 统一治理。
- OMP 登录、供应商状态和 OAuth 流程。
- 所有 39 个 RPC 命令的一次性全量接入。

这些能力继续留在后续批次，避免第 3 批过胖。

## 上游协议依据

从 `D:\ALL PROJECT\oh-my-pi-upstream` 审计到的相关协议：

- `get_available_commands` 返回 `{ commands: RpcAvailableSlashCommand[] }`。
- `available_commands_update` 主动推送同一组命令。
- `RpcAvailableSlashCommand` 字段为 `name`、`aliases?`、`description?`、`input?: { hint? }`、`subcommands?`、`source`。
- `source` 枚举为 `builtin | skill | extension | custom | mcp_prompt | file`。
- `steer` 接收 `{ message, images? }`。
- `follow_up` 接收 `{ message, images? }`。
- `abort_and_prompt` 接收 `{ message, images? }`。
- `set_steering_mode` 接收 `{ mode: 'all' | 'one-at-a-time' }`。
- `set_follow_up_mode` 接收 `{ mode: 'all' | 'one-at-a-time' }`。
- `set_interrupt_mode` 接收 `{ mode: 'immediate' | 'wait' }`。
- `get_state` 包含 `isStreaming`、`isCompacting`、`steeringMode`、`followUpMode`、`interruptMode`、`queuedMessageCount` 等运行时状态。

## 设计决策

采用“协议优先 + UI 合并展示”的方案。

后端先建立一组 typed OMP control API，SessionManager 只在当前 session 的 provider 是 OMP 时使用这些原生命令。renderer 的 slash menu 不直接理解 RPC；它接收归一化后的命令元数据，把本地 Craft 命令和 OMP 动态命令分组展示。

这个方案比“只做 `/` 菜单”更接近 OMP 产品能力，也比“一口气接所有 Phase B 能力”更可控。它把第 3 批的完成标准限定在命令发现、处理中投递和队列模式三件事上。

## 架构

### 1. 协议层

文件：

- `packages/shared/src/agent/backend/omp/omp-rpc-protocol.ts`
- `packages/shared/src/agent/backend/omp/omp-rpc-adapter.ts`
- `packages/shared/src/agent/backend/omp/omp-rpc-backend.ts`

新增类型：

- `OmpRpcAvailableSlashCommandSource`
- `OmpRpcAvailableSlashCommand`
- `OmpRpcAvailableCommandsResponseData`
- `OmpRpcAvailableCommandsUpdateFrame`
- `OmpSteeringMode`
- `OmpFollowUpMode`
- `OmpInterruptMode`

扩展 `OmpRpcCommand`：

- `get_available_commands`
- `follow_up`
- `abort_and_prompt`
- `set_steering_mode`
- `set_follow_up_mode`
- `set_interrupt_mode`

新增解析函数：

- `parseOmpAvailableSlashCommand`
- `parseOmpAvailableCommandsResponseData`
- `parseOmpAvailableCommandsUpdate`
- `parseOmpQueueControlState`

适配器消费 `available_commands_update` 时不转成普通聊天消息，而是作为后端控制状态交给 `OmpRpcBackend` 缓存。未知或不完整命令会被诊断计数并忽略，不应污染 UI。

### 2. OMP 后端控制 API

`OmpRpcBackend` 新增能力：

- `getAvailableCommands(): Promise<OmpRpcAvailableSlashCommand[]>`
- `getCachedAvailableCommands(): OmpRpcAvailableSlashCommand[]`
- `setSteeringMode(mode: OmpSteeringMode): Promise<void>`
- `setFollowUpMode(mode: OmpSteeringMode): Promise<void>`
- `setInterruptMode(mode: OmpInterruptMode): Promise<void>`
- `followUp(message: string, attachments?: FileAttachment[]): Promise<boolean>`
- `abortAndPrompt(message: string, attachments?: FileAttachment[]): Promise<boolean>`
- `redirect(message: string, attachments?: FileAttachment[]): boolean`
- `getOmpControlState(): OmpControlState`

`redirect` 保持同步布尔返回，以兼容 `AgentBackend` 既有接口；附件版能力由新的 OMP 专用方法提供。SessionManager 对 OMP backend 做能力检测后调用专用方法，非 OMP backend 继续走原接口。

图片处理复用 `prepareOmpPrompt`。如果图片读取失败，行为与第 2 批一致：可降级的附件变成文本 warning；协议非法或超大 base64 仍返回失败，不静默丢图。

### 3. SessionManager 中途消息路由

文件：

- `packages/server-core/src/sessions/SessionManager.ts`
- `packages/shared/src/agent/backend/types.ts`

新增一个 provider-aware 路由分支：

- OMP session 正在处理时：
  - 默认行为为 `steer`，调用 OMP 原生 `steer`。
  - 用户选择“结束后追加”时调用 `follow_up`。
  - 用户选择“停止并改问”时调用 `abort_and_prompt`。
  - RPC 命令失败时，回退到现有 Craft 本地 queue，保证用户消息不丢。
- 非 OMP session 正在处理时：
  - 保持现有 `resolveMidStreamBehavior`、`agent.redirect` 和本地 `messageQueue` 逻辑。

用户消息事件状态：

- `accepted`：OMP 已接受 steer / follow_up / abort_and_prompt。
- `queued`：OMP 原生命令不可用或失败，进入 Craft 本地 FIFO replay。
- `processing`：本地 FIFO replay 开始执行。

`managed.wasInterrupted` 只在 abort-and-prompt 或本地 abort/queue 路径上设置；普通 follow-up 不应让下一轮收到“上一轮被打断”的 system reminder。

### 4. renderer 状态与命令传递

文件：

- `packages/shared/src/protocol/dto.ts`
- `apps/electron/src/shared/types.ts`
- `apps/electron/src/transport/channel-map.ts`
- `packages/server-core/src/handlers/rpc/sessions.ts`
- `apps/electron/src/renderer/pages/ChatPage.tsx`
- `apps/electron/src/renderer/components/app-shell/input/InputContainer.tsx`
- `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx`

新增 session-scoped OMP control DTO：

```ts
interface OmpControlStateDto {
  availableCommands: OmpAvailableCommandDto[];
  queue: {
    steeringMode: 'all' | 'one-at-a-time';
    followUpMode: 'all' | 'one-at-a-time';
    interruptMode: 'immediate' | 'wait';
    queuedMessageCount: number;
    isStreaming: boolean;
    isCompacting: boolean;
  };
  updatedAt: number;
}
```

`SessionManager` 在以下时机推送状态：

- OMP backend ready 后完成 `get_state` 和 `get_available_commands`。
- 收到 `available_commands_update`。
- 收到 `config_update` 或状态变化帧。
- 设置 queue mode 成功后。
- prompt / steer / follow_up / abort_and_prompt 失败后刷新一次状态。

renderer 只消费 DTO，不直接发 OMP RPC。所有状态修改通过 `sessionCommand` 或专门的 session RPC handler 回到 server-core，保持单一控制入口。

### 5. slash command menu 分层

文件：

- `apps/electron/src/renderer/components/ui/slash-command-menu.tsx`
- `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx`

现有 `SlashCommandId = PermissionMode | 'compact'` 太窄。改为分层类型：

```ts
type LocalSlashCommandId = PermissionMode | 'compact';

type OmpSlashCommandId = {
  provider: 'omp';
  name: string;
  subcommand?: string;
};

type SlashCommandId = LocalSlashCommandId | OmpSlashCommandId;
```

菜单分组：

- Modes：Craft permission modes。
- Local commands：Craft `compact` 等本地命令。
- OMP builtins：source 为 `builtin` 的命令。
- OMP skills：source 为 `skill` 的命令。
- OMP extensions：source 为 `extension` 的命令。
- OMP custom / MCP / files：source 为 `custom`、`mcp_prompt`、`file` 的命令。
- Recent working directories：保留现有文件夹入口。

选择行为：

- 本地命令沿用当前逻辑：权限模式立即切换，compact 执行本地 compact 行为。
- OMP 命令不立即执行；选择后把文本替换为 `/<name> ` 或 `/<name> <subcommand> `，并把光标放到参数位置。
- 如果命令有 `input.hint`，输入提示或菜单副文本显示该 hint。
- 如果命令有 aliases，过滤时 aliases 可命中，但插入 canonical `name`。

这样避免把 OMP `/model` 误当成本地“切模型”动作，也避免动态命令选择后突然绕过用户输入直接执行。

### 6. 队列控制 UI

本批只做轻量入口，不做复杂设置页。

在 composer 或输入框底部增加一个 OMP 专属控制菜单，仅当当前 session 使用 OMP provider 时显示：

- Mid-stream：立即引导（steer）/ 结束后追加（follow-up）/ 停止并改问（abort-and-prompt）。
- Steering mode：all / one-at-a-time。
- Follow-up mode：all / one-at-a-time。
- Interrupt mode：immediate / wait。

状态文案简短展示：

- `OMP · steer · queue 0`
- `OMP · follow-up · queue 2`
- `OMP · interrupt waits`

如果当前 provider 不是 OMP，不显示这些控件，避免让用户误以为 Claude/Pi/Craft backend 也支持同一语义。

## 数据流

### 启动与命令发现

1. `OmpRpcBackend.ensureSubprocess()` 启动 `omp --mode rpc`。
2. 收到 `ready` 后调用 `get_state`。
3. 紧接着调用 `get_available_commands`。
4. 后端缓存命令和 queue state。
5. SessionManager 推送 `omp_control_state_changed` 给 renderer。
6. FreeFormInput 把 OMP 命令合并进 slash sections。

### 命令元数据更新

1. OMP 输出 `available_commands_update`。
2. adapter 解析并交给 backend。
3. backend 替换缓存，记录 `updatedAt`。
4. SessionManager 推送最新状态。
5. renderer 菜单下一次打开时显示最新命令。

### 处理中输入

1. 用户在处理中输入消息。
2. renderer 带上所选 OMP delivery mode。
3. SessionManager 判断当前 session provider 是否为 OMP。
4. OMP 分支调用 `steer`、`follow_up` 或 `abort_and_prompt`。
5. 成功则发 `user_message accepted`。
6. 失败则发 `user_message queued` 并进入 Craft 本地 replay。

### 队列模式切换

1. 用户在 OMP 控制菜单里修改 mode。
2. renderer 发 session command。
3. SessionManager 调用 OMP backend 对应 setter。
4. backend 发送 RPC 并更新本地状态。
5. SessionManager 推送新状态。

## 错误处理

- `get_available_commands` 失败：不影响聊天。UI 显示本地命令，OMP 命令区域不出现，并在诊断里记录失败。
- `available_commands_update` 帧 malformed：忽略该帧，保留上一版命令缓存。
- 动态命令 name 为空、包含空白或不是字符串：丢弃该命令并计数。
- OMP 原生 `steer/follow_up/abort_and_prompt` 失败：用户消息进入本地 queue，renderer 看见 queued 状态，不丢消息。
- 图片附件转换失败：与第 2 批一致，能降级则 warning，协议非法则命令失败并回退。
- mode setter 失败：UI 恢复上一版状态，并显示 toast 或 inline warning。
- OMP 子进程重启：ready 后重新同步 state 和 commands；旧 generation 的 update 帧不应覆盖新 generation 状态。
- 非 OMP provider：不接收 OMP 控制 DTO，不显示 OMP 控件，不改变既有行为。

## 测试计划

### shared 单元测试

- `OmpRpcCommand` 序列化覆盖 `get_available_commands`、`follow_up`、`abort_and_prompt` 和三个 mode setter。
- `parseOmpAvailableCommandsResponseData` 接受标准响应并拒绝 malformed command。
- `parseOmpAvailableCommandsUpdate` 正确解析 source、aliases、input hint 和 subcommands。
- `OmpRpcBackend` ready 后会请求 `get_state` 和 `get_available_commands`。
- `OmpRpcBackend.followUp` / `abortAndPrompt` 复用图片转换。
- stale generation 的 available commands update 不覆盖新进程状态。

### server-core 测试

- OMP session processing 时默认中途输入调用 native steer。
- 用户选择 follow-up 时调用 native follow_up，不设置 interrupted reminder。
- 用户选择 abort-and-prompt 时调用 native abort_and_prompt，并设置正确中断语义。
- native command 失败时消息进入 Craft 本地 queue。
- 非 OMP provider 的 mid-stream 行为保持旧测试预期。
- queue mode setter 成功后向 renderer 推送 OMP control state。

### renderer/UI 测试

- slash menu 同时显示本地命令和 OMP 动态命令。
- aliases 能过滤命令，但插入 canonical name。
- 选择 OMP 命令只插入文本，不立即执行。
- subcommand 选择插入 `/<name> <subcommand> `。
- source badge 或 source group 文案正确。
- 非 OMP session 不显示 OMP 队列控制菜单。

### 真实 OMP smoke

- `omp --version` 可读。
- ready 后 `get_state` 成功。
- `get_available_commands` 返回非空命令列表。
- `/stats` 作为 prompt 不挂起。
- `set_steering_mode`、`set_follow_up_mode`、`set_interrupt_mode` 至少各成功一次。
- 真实处理中发送一次 steer。
- 真实处理中发送一次 follow_up。
- 真实处理中发送一次 abort_and_prompt。

## 验收标准

第 3 批完成时，以下证据必须成立：

- 自动化测试覆盖协议、后端、server-core 和 renderer 路径。
- 真实 OMP smoke 覆盖命令发现和队列控制。
- `/` 菜单能显示 OMP 上游返回的全部可用命令来源，而不是只显示 Craft 静态命令。
- 选择 OMP slash command 后插入 canonical 命令文本，用户仍可编辑参数后发送。
- 处理中消息能按 OMP 原生 steer、follow-up、abort-and-prompt 三种语义投递。
- OMP 原生投递失败不会丢消息，会回退本地 queue。
- 非 OMP provider 行为和 UI 不回归。

## 后续批次衔接

第 3 批完成后，建议进入第 4 批“子智能体实时视图”。原因是动态 slash command 会让 `/agents`、`/task`、skill/extension 命令入口出现；如果子智能体事件仍不可见，用户会感觉 OMP 能力被触发了但桌面端看不懂进度。

第 5 批可处理 OMP Todo，第 6 批处理 compact/retry/context/stats，第 7 批处理 session resume/branch/handoff/export，第 8 批处理登录供应商状态和最终端到端成熟度收口。
