# Batch 01 — OMP 子智能体实时 UI 与 transcript

> 状态：**已完成**（2026-07-09）。
>
> 已实现：后端状态聚合、`set_subagent_subscription` / `get_subagents` / `get_subagent_messages` 接入、Craft DTO/动作、桌面可发现入口与详情抽屉、Task/Agent 工具卡跳转、协议/后端/reducer/renderer 测试。
>
> 仍待后续批次：真实 OMP smoke、subagent_event 协议确认、worktree/patch/branch/apply/merge 结果展示。
>
> 适合派给一个独立 agent 执行。开始前先用 CodeGraph 定位相关符号；不要先做大范围 grep。

## 目标

把 OMP 的子智能体能力从“后端已经能订阅/拉取”推进到“桌面用户能看见、能恢复、能打开详情、能定位 transcript”的成熟体验。

本批重点处理 OMP RPC：

- `set_subagent_subscription`
- `get_subagents`
- `get_subagent_messages`
- 子智能体相关事件：`subagent_lifecycle`、`subagent_progress`、`subagent_event` 等上游事件形态

当前基线：OMP RPC 后端已经有部分订阅、快照和 transcript 读取能力，但 Craft 桌面层还缺少完整实时呈现、恢复和详情页。

## 要写什么

1. 后端状态聚合
   - 在 OMP 后端维护稳定的子智能体状态表：id、name/role、status、progress、startedAt/endedAt、summary、lastMessage、error、parentTask/parentTool。
   - 支持从 `get_subagents` 恢复快照。
   - 支持从实时事件增量更新状态。
   - 支持按子智能体 id 增量读取 transcript，并记录 cursor/offset，避免重复消息。

2. SessionManager / transport DTO
   - 把子智能体状态暴露到 Craft 会话 DTO。
   - 会话重新打开、OMP 子进程重启、页面刷新后，能恢复子智能体快照。
   - 为“打开详情 / 加载更多 transcript / 重试加载”提供安全的后端动作。

3. Renderer UI
   - 增加子智能体列表入口：可以放在任务栏、会话右侧面板或 active tasks 区域，但必须可发现。
   - 每个子智能体显示状态、进度、最后输出摘要、错误状态。
   - 详情页展示 transcript，支持加载更多、错误重试、空状态。
   - 如果子智能体由 OMP `task` 工具创建，要能从工具卡片跳到对应子智能体详情。

4. 测试
   - 协议/适配器测试覆盖事件解析。
   - 后端测试覆盖订阅、快照恢复、transcript cursor、失败重试。
   - Renderer 组件测试覆盖空列表、运行中、完成、失败、加载更多。

## 边界

本批不要做：

- 不实现子智能体 worktree 合并、apply patch、patch review。
- 不实现 OMP `/fork`、`/collab`、实时多人协作。
- 不做自定义 agent 定义编辑器。
- 不重构 Craft 全局任务系统；只做 OMP 子智能体状态到现有 UI 的最小桥接。
- 不把子智能体 transcript 混入主会话消息流，除非只是显示跳转/引用。

如果发现上游事件字段不足，只先在文档里记录协议缺口，不要临时发明无法兼容的字段名。

## 交付物

- 后端子智能体状态模型和 DTO。
- 实时事件消费和 snapshot 恢复。
- transcript 读取 API，含 cursor/offset。
- 桌面子智能体列表和详情 UI。
- 从 OMP task 工具卡跳转到详情的入口。
- 单元测试/组件测试。
- 更新 `docs/omp-feature-parity-todo.md` 中子智能体相关条目。

## 必须看什么

先用 CodeGraph：

```powershell
codegraph explore "OmpRpcBackend subagent subscription get_subagents get_subagent_messages SessionManager session dto active tasks"
```

然后读这些文件：

- `D:\ALL PROJECT\ohmypi-craft\docs\omp-feature-parity-todo.md`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\omp\omp-rpc-protocol.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\omp\omp-rpc-adapter.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\omp\omp-rpc-backend.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\omp\omp-todo-state.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\server-core\src\sessions\SessionManager.ts`
- `D:\ALL PROJECT\ohmypi-craft\apps\electron\src\renderer\components\app-shell\ActiveTasksBar.tsx`
- `D:\ALL PROJECT\ohmypi-craft\apps\electron\src\renderer\components\app-shell\ChatDisplay.tsx`
- `D:\ALL PROJECT\oh-my-pi-upstream\packages\coding-agent\src\modes\rpc\rpc-types.ts`
- `D:\ALL PROJECT\oh-my-pi-upstream\packages\coding-agent\src\modes\rpc\rpc-mode.ts`

## 建议执行顺序

1. 确认上游子智能体事件字段和 `get_subagents` / `get_subagent_messages` 返回结构。
2. 在协议层补齐类型、解析器和 fixtures。
3. 在 `OmpRpcBackend` 建立子智能体状态 store，并写纯后端测试。
4. 接入 SessionManager DTO/动作。
5. 写 UI 列表和详情，先走假数据/fixture，再接真实 DTO。
6. 做真实 OMP smoke：让 OMP 触发一个 `task` 工具或能产生子智能体的流程。

## 验收标准

- 一个运行中的 OMP 子智能体能在 UI 中实时出现并更新进度。
- 会话重开后，已存在子智能体状态可以恢复。
- 打开子智能体详情能看到 transcript，并且不会重复追加旧消息。
- transcript 加载失败时有可见错误和重试入口。
- OMP 子进程重启后不会把旧子智能体误标成新的。
- 测试通过：
  - `bun test packages/shared/src/agent/backend/omp/__tests__/omp-rpc-protocol.test.ts`
  - `bun test packages/shared/src/agent/backend/omp/__tests__/omp-rpc-backend.test.ts`
  - 相关 renderer 测试
  - `bun run typecheck:shared`
  - `cd packages/server-core && bun run typecheck`
  - `cd apps/electron && bun run typecheck`

## 交接说明

完成后在 PR/提交说明里写清楚：

- 支持了哪些 OMP 子智能体事件。
- 哪些字段是从上游直接映射，哪些是 Craft 本地推导。
- 是否还有上游协议缺口。
- 是否做过真实 OMP smoke，使用的触发方式是什么。

