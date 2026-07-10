# Batch 04 — OMP 事件完整性、运行时状态与诊断面板

> 适合派给一个偏协议/后端质量的 agent。目标是减少“能跑但看不清、坏了不知道为什么”的成熟度缺口。

## 目标

把 OMP RPC 输出帧和运行时状态处理补到产品级：稳定 id 映射、完整 tool/message 事件、配置同步、错误分级、版本兼容警告和可导出的诊断。

本批重点处理：

- `message_start` / `message_update` / `message_end`
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end`
- `config_update`
- `session_info_update`
- `session_shutdown`
- `extension_error`
- `stderr`
- `ready` / protocol version / OMP version compatibility

## 要写什么

1. 稳定消息/turn/tool id 映射
   - 建立 OMP messageId / turnId / toolCallId 到 Craft message/tool event 的明确映射。
   - 重复、乱序、缺失 end 事件时不崩溃，并记录诊断。
   - Craft UI 中同一条消息不要因为 delta 事件变成多条。

2. 内容块完整性
   - 区分 text delta、thinking delta、tool output、image/artifact/content block。
   - 对 OMP 未识别内容块做安全降级展示。
   - 工具 update 支持 stdout/stderr/progress/artifact URI/image metadata。

3. 配置和状态同步
   - `config_update` 不只同步思考等级和队列策略，还要同步模型、auto compaction、auto retry、运行时开关。
   - `session_info_update` 同步 sessionId、sessionFile、title，但不要无脑覆盖用户显式修改的 Craft title。
   - `session_shutdown` 区分正常关闭、切换、崩溃、外部终止。

4. 错误与 stderr 分级
   - `extension_error` 显示扩展来源、错误摘要、堆栈摘要和可操作建议。
   - `stderr` 分为 debug/noise/warn/fatal，不要把所有 stderr 都当用户错误。
   - 子进程退出时把最近关键诊断挂到错误卡片。

5. 版本/兼容性诊断
   - 启动后探测 OMP version/protocol version。
   - 当版本未知或低于当前适配器预期时，给出非阻塞 warning。
   - 增加“复制 OMP 诊断”或导出诊断对象的能力。

## 边界

本批不要做：

- 不做完整新 UI 大页；优先复用现有错误卡、状态条、诊断弹窗。
- 不改 Source/MCP 权限模型。
- 不实现登录流程；登录归 Batch 03。
- 不做所有 OMP slash command 的产品化。
- 不在诊断里泄漏 prompt 全文、API key、token、cookie、私密文件内容。

## 交付物

- 完整协议 fixture 和解析测试。
- `OmpRpcEventAdapter` 的 message/tool 事件稳定映射。
- OMP runtime state 扩展：version、config、session shutdown、recent diagnostics。
- UI 可见 warning/error/status 呈现。
- 诊断复制/导出入口。
- 更新 `docs/omp-feature-parity-todo.md` 事件完整性和诊断条目。

## 必须看什么

先用 CodeGraph：

```powershell
codegraph explore "OmpRpcEventAdapter message_start tool_execution_update config_update diagnostics runtime state ChatDisplay"
```

然后读：

- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\omp\omp-rpc-adapter.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\omp\omp-rpc-protocol.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\omp\omp-rpc-diagnostics.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\omp\omp-runtime-state.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\omp\__tests__\omp-rpc-protocol.test.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\omp\__tests__\omp-rpc-backend.test.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\core\src\types\message.ts`
- `D:\ALL PROJECT\ohmypi-craft\apps\electron\src\renderer\components\app-shell\ChatDisplay.tsx`
- `D:\ALL PROJECT\ohmypi-craft\packages\ui\src\components\chat`
- `D:\ALL PROJECT\oh-my-pi-upstream\packages\coding-agent\src\modes\rpc\rpc-types.ts`

## 建议执行顺序

1. 用上游 `rpc-types.ts` 列出所有当前事件帧。
2. 为每类事件补 fixtures，先写失败/乱序/未知字段测试。
3. 改 adapter 和 runtime state。
4. 接 UI 状态/错误/诊断显示。
5. 用真实 OMP 跑一次正常 prompt、工具调用、扩展错误、子进程退出场景。

## 验收标准

- 长消息流不会重复创建 assistant message。
- 工具流式输出能持续更新同一张工具卡。
- OMP config/session 变更能同步到 Craft 状态。
- extension_error/stderr/session_shutdown 用户可见且可诊断。
- 未知事件不会导致会话挂起。
- 版本不兼容时有 warning，不会静默错配。
- 测试通过：
  - `bun test packages/shared/src/agent/backend/omp/__tests__/omp-rpc-protocol.test.ts`
  - `bun test packages/shared/src/agent/backend/omp/__tests__/omp-rpc-backend.test.ts`
  - `bun run typecheck:shared`
  - `cd packages/server-core && bun run typecheck`
  - `cd apps/electron && bun run typecheck`

## 交接说明

Batch 04 已完成。当前实现覆盖以下 OMP event frame：

- `message_start` / `message_update` / `message_end`：建立 OMP messageId → Craft turnId 映射，文本/thinking delta 分路，重复 end 去重，保存 sdkMessageId、stopReason、usage 和 provider metadata。
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end`：toolCallId 稳定映射到 Craft toolUseId，update 支持 stdout/stderr/progress/artifact URI，end 支持结构化/图片/非文本结果。
- `config_update`：同步模型、思考等级、队列策略、自动压缩/重试等运行时开关。
- `session_info_update`：同步 sessionId、sessionFile、title，不覆盖用户显式修改的 Craft 标题。
- `session_shutdown`：区分 normal/switch/crash/external，fatal 级才产生聊天错误。
- `extension_error`：按 recoverable 分级为 info/error，显示扩展来源和错误摘要。
- `stderr`：按 debug/noise/warn/fatal 分级，避免把普通诊断当用户错误。
- `ready`：读取 protocolVersion/ompVersion，启动后通过 `get_state` 获取真实会话状态，版本不兼容时给出非阻塞 warning。

降级策略：

- 未知 frame 只计数并采样日志，不会挂起会话。
- 乱序/缺失 end 通过 `messageMap` 和 `completedThinkingBlocks` 去重兜底。
- 未识别内容块降级为纯文本或 JSON 快照，不抛异常。
- 版本探测失败不阻塞启动，仅写入诊断 warning。

诊断字段清单（`getOmpDiagnosticsSummary` / Settings AI 页“复制 OMP 诊断”）：

- CLI 路径、来源（config/env/default）、原始命令、CWD、OMP 版本、协议版本。
- 模型数量、默认模型、最近运行错误码/错误信息。
- Provider 列表、已登录数、可用数、总数。
- Agent/config/auth 目录存在性。
- `versionCompatibility.compatible` / `warning`。

隐私保护策略：

- 诊断对象不包含 API key、token、OAuth code、完整 prompt、消息正文、session 内容。
- URI/artifact 审计只记录路径/大小/结果，不记录正文。
- 登录进度日志不输出 callback code。

版本兼容策略：

- `MIN_OMP_VERSION = 0.0.0`，`MIN_PROTOCOL_VERSION = 1`。
- 未知版本视为兼容但带 warning；版本低于阈值才报不兼容。
- 适配器优先向前兼容，不因为 OMP 领先而拒绝运行。

