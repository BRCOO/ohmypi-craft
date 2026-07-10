# Batch 05 — OMP Todo、Plan、Goal 与高级代理模式

> 状态：**已完成**（2026-07-10）。
>
> 已实现：OMP Todo 协议解析、reducer、Markdown 导入/导出、后端状态桥接、`OmpTodoCard` 桌面组件及组件测试。
>
> Plan Mode / Goal Mode / Advisor / Loop / TTSR 因上游 OMP 当前只在 TUI 暴露、RPC 无稳定事件/命令，已在本批次文档中记录暂缓说明和产品映射建议。
>
> 适合派给一个产品/状态流都能处理的 agent。目标是把 OMP 的“工作方式”补出来，而不只是补 RPC 命令。

## 目标

产品化 OMP 的 Todo、Plan Mode、Goal Mode、Advisor、Loop/TTSR 等高级代理模式，让桌面端能表达 OMP 的工作节奏和状态。

本批优先级：

1. Todo 完整闭环。
2. Plan Mode 最小可用。
3. Goal Mode 最小可用。
4. Advisor / Loop / TTSR / magic keywords 做明确入口、状态或暂缓说明。

## 要写什么

1. OMP Todo 完整闭环
   - 明确定义 OMP `TodoPhase` / `TodoItem` 和 Craft 现有 todo/task 状态的关系。
   - 从 `get_state.todoPhases` 恢复 Todo。
   - UI 支持查看、编辑、导入、导出、append、start、done、drop。
   - 编辑后用 `set_todos` 同步回 OMP。
   - 区分主会话 Todo 和子智能体 Todo。
   - 消费 reminder / auto-clear / todo update 相关事件，如果上游有。

2. Plan Mode
   - 显示当前是否处于 OMP Plan Mode。
   - 支持提交计划、审查计划、修改、接受、拒绝。
   - 支持重新打开 plan review。
   - 显示计划文件引用或计划内容摘要。
   - 明确映射 Craft Explore/Execute 和 OMP Plan Mode，避免两个模式语义冲突。

3. Goal Mode
   - 支持 set/show/pause/resume/drop。
   - 支持 token budget 设置和剩余预算展示。
   - 消费 `goal_updated` 或等价事件。
   - 展示自动继续、暂停、完成、阻塞原因。
   - guided goal 如果上游只在 TUI 可用，先做等价桌面流程设计或标记暂缓。

4. Advisor / Loop / TTSR
   - Advisor：状态、开关、dump/configure 的最小入口。
   - Loop：重复 prompt、次数/时长限制、停止入口。
   - TTSR/magic keywords：显示触发状态、来源和注入摘要；如果暂缓，写明原因和后续协议需求。

## 边界

本批不要做：

- 不把 OMP Todo 和 Craft 任务系统强行合并成同一个概念。
- 不做 marketplace/plugins/skills 完整管理。
- 不实现长期记忆编辑；memory 只做与 Goal/Advisor 必要的状态引用。
- 不改 Host Tool/Host URI 基础设施。
- 不把 TUI-only 命令直接塞进 slash 输入假装可用；要么实现桌面等价物，要么明确不可用/暂缓。

## 交付物

- OMP Todo 状态模型、编辑动作、导入/导出动作。
- Todo UI 完整操作入口。
- Plan Mode 状态卡和 review UI。
- Goal Mode 状态卡和动作入口。
- Advisor/Loop/TTSR 的状态/入口/暂缓说明。
- 状态恢复和操作测试。
- 更新 `docs/omp-feature-parity-todo.md` 第 11 节及相关 slash command 条目。

## 必须看什么

先用 CodeGraph：

```powershell
codegraph explore "OMP todo plan goal set_todos OmpTodoCard Plan approval Goal SessionManager"
```

然后读：

- `D:\ALL PROJECT\ohmypi-craft\docs\superpowers\specs\2026-07-08-omp-todo-bridge-design.md`
- `D:\ALL PROJECT\ohmypi-craft\docs\omp-feature-parity-todo.md`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\omp\omp-todo.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\omp\omp-todo-state.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\omp\omp-rpc-protocol.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\omp\omp-rpc-backend.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\server-core\src\sessions\SessionManager.ts`
- `D:\ALL PROJECT\ohmypi-craft\apps\electron\src\renderer\components\app-shell\OmpTodoCard.tsx`
- `D:\ALL PROJECT\ohmypi-craft\apps\electron\src\renderer\components\app-shell\ChatDisplay.tsx`
- `D:\ALL PROJECT\ohmypi-craft\packages\session-tools-core`
- `D:\ALL PROJECT\oh-my-pi-upstream\packages\coding-agent\src\modes\rpc\rpc-types.ts`

## 建议执行顺序

1. 先把 Todo 状态关系写清楚，必要时新增一小段 decision note。
2. 完成 Todo 恢复、编辑、导入/导出和测试。
3. 再做 Plan Mode：状态展示和 review 最小闭环。
4. 再做 Goal Mode：状态展示和 set/pause/resume/drop。
5. 最后补 Advisor/Loop/TTSR 的入口或暂缓标记。

## 验收标准

- OMP Todo 可以从状态恢复、编辑后同步回 OMP。
- Todo 导入/导出不会破坏 phase/item 结构。
- 主会话和子智能体 Todo 不混在一起。
- Plan Mode 有清晰状态和 review 操作。
- Goal Mode 有清晰预算、暂停/恢复/完成/阻塞状态。
- TUI-only 能力不会在 UI 中显示成“看似可用但实际无效”。
- 测试通过：
  - OMP todo 状态单测
  - OMP backend RPC 测试
  - renderer Todo/Plan/Goal 组件测试
  - `bun run typecheck:shared`
  - `cd packages/server-core && bun run typecheck`
  - `cd apps/electron && bun run typecheck`

## 交接说明

### OMP Todo（已完成）

- OMP `TodoPhase` / `TodoItem` 与 Craft 本地的 `sessionStatus`/`task` 标签是独立概念；OMP Todo 只作为 OMP 会话的运行时快照展示，不写入 Craft JSONL。
- 支持从 `get_state.todoPhases` 恢复、通过 `set_todos` 写回完整快照。
- Reducer 覆盖 add/rename/remove phase、add/edit/start/complete/abandon/reopen/remove task；Start 会降级原 in-progress，Done/Drop 会自动提升下一个 pending。
- Markdown 导入/导出支持相位和四种状态标记（`[ ]`、`[~]`、`[x]`、`[-]`），导入前会提示隐藏的 `details`/`notes` 元数据可能丢失。
- 桌面 `OmpTodoCard` 显示在 OMP 会话的 composer 上方；子智能体 Todo 单独展示，不与主 Todo 混在一起。
- 组件测试覆盖：当前任务摘要、空状态、等待状态、子智能体摘要、pending action badge。

### Plan Mode（已决策 / 待上游 RPC 扩展）

- 上游 OMP Plan Mode 主要通过 TUI `resolve` 工具、`local://` plan artifact 和内部 `PlanModeState` 驱动；当前 RPC 模式没有稳定的 `plan_mode_*` 事件帧。
- 本批次明确产品映射：当 OMP 通过 `host_tool_call`/`extension_ui_request` 请求 plan approval 时，复用现有 `CompactAcceptPlanDrawer` / plan approval 消息组件；在 RPC 协议未暴露前，不把 Plan Mode 做成虚假可用入口。
- 与 Craft Explore/Execute 的关系：Craft Explore/Execute 控制“是否允许工具自动执行”，OMP Plan Mode 控制“是否先提交计划再执行”；两者并存时以 OMP Plan Mode 为准，Craft 执行模式只影响计划批准后的工具调用策略。

### Goal Mode（已决策 / 待上游 RPC 扩展）

- 上游 `GoalModeState` 和 `GoalRuntime` 当前未通过 RPC 暴露 `goal_updated` 事件或 `set_goal` 命令。
- 本批次明确：不预先实现虚假状态卡；实际同步需上游协议扩展或探测到等价的 `extension_ui_request`/`host_tool_call`。

### Advisor / Loop / TTSR / Magic Keywords（已暂缓）

- Advisor、Loop、TTSR、`/btw`、`/tan`、`/omfg` 等能力目前主要依赖 TUI 状态或内部提示注入，RPC 协议未提供对应命令/事件。
- 本批次暂不实现虚假入口；后续如需支持，必须先向上游确认 RPC 扩展方案或设计桌面等价流程。

## 验收记录

- `bun run typecheck:all` ✅
- `bun run scripts/check-i18n-parity.ts` ✅
- OMP 相关测试 175 pass / 0 fail ✅
- `OmpTodoCard` 组件测试 5 pass / 0 fail ✅
- Plan Mode / Goal Mode / Advisor / Loop / TTSR 已按本批次约定记录暂缓说明，未实现虚假入口。

