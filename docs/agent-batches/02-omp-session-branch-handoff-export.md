# Batch 02 — OMP 会话、分支、handoff 与导出产品化

> 适合派给一个独立 agent 执行。目标是把已经存在的后端动作变成完整桌面入口和可验证流程。

## 目标

把 OMP 会话操作从“后端接口已经存在/部分被调用”推进到“用户可以在桌面里可靠使用”。

本批重点处理：

- `new_session`
- `switch_session`
- `branch`
- `get_branch_messages`
- `get_last_assistant_text`
- `set_session_name`
- `handoff`
- `export_html`

当前基线：后端已具备 OMP session 映射、恢复、分支接口、handoff/export 解析、最后 assistant 文本 fallback。桌面菜单、结果展示、错误恢复和端到端验证仍不完整。

## 要写什么

1. 新建/恢复/切换会话入口
   - 桌面 UI 提供明确的 OMP 新会话入口。
   - 已有 Craft 会话打开时，继续恢复对应 OMP sessionFile。
   - 切换失败要显示具体原因：sessionFile 缺失、OMP 启动失败、协议错误、权限问题。

2. 分支流程
   - 用 `get_branch_messages` 获取可分支用户消息。
   - 在消息菜单或会话菜单中提供“从这里创建 OMP 分支”的入口。
   - 调用 `branch` 后更新 Craft session 与 OMP sessionId/sessionFile 映射。
   - 分支后的新会话标题、父会话、branch point 能显示给用户。

3. 连续性与最后回答
   - 保留当前 `get_last_assistant_text` fallback。
   - 桌面端提供“复制最后回答 / 从最后回答继续 / 诊断连续性”的最小入口，或者明确记录不做入口的原因。
   - 继续流程不要错误复用截断的 Craft 本地最后消息。

4. Handoff
   - 桌面入口调用 OMP `handoff`。
   - 成功后展示 savedPath，并提供打开文件/打开所在目录/新会话继续。
   - 失败时展示上游错误和可重试入口。

5. Export HTML
   - 桌面入口调用 `export_html`。
   - 支持默认路径；如已有 UI 能选择路径，可接自定义路径。
   - 成功后展示路径并提供打开文件。

6. Rename 同步
   - Craft rename 时继续同步到 live OMP。
   - 明确处理 OMP `session_info_update` 是否覆盖 Craft 标题：默认不要覆盖用户显式改过的 Craft 标题，除非有产品决策。

## 边界

本批不要做：

- 不实现完整会话树/时间线大重构。
- 不实现 OMP fork/collab。
- 不实现 `/move` 改工作目录。
- 不把 OMP session 存储当成唯一真相重写 Craft 持久化。
- 不解决所有 rewind/checkpoint 组合问题，只要分支主流程稳定。

## 交付物

- 会话菜单/消息菜单里的 OMP 新建、分支、handoff、export 入口。
- 分支候选消息列表或 inline 入口。
- handoff/export 成功卡片与错误卡片。
- session 映射更新和恢复测试。
- 分支连续性测试。
- 更新 `docs/omp-feature-parity-todo.md` 会话/分支/handoff/export 条目。

## 必须看什么

先用 CodeGraph：

```powershell
codegraph explore "OMP session actions branch handoff export get_last_assistant_text SessionManager CompactSessionMenu SessionMenu"
```

然后读：

- `D:\ALL PROJECT\ohmypi-craft\docs\superpowers\specs\2026-07-07-omp-session-actions-menu-design.md`
- `D:\ALL PROJECT\ohmypi-craft\docs\superpowers\specs\2026-07-07-omp-session-continuity-design.md`
- `D:\ALL PROJECT\ohmypi-craft\packages\server-core\src\sessions\omp-session-actions.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\server-core\src\sessions\omp-session-manager-actions.test.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\server-core\src\sessions\SessionManager.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\omp\omp-rpc-backend.ts`
- `D:\ALL PROJECT\ohmypi-craft\apps\electron\src\renderer\components\app-shell\SessionMenu.tsx`
- `D:\ALL PROJECT\ohmypi-craft\apps\electron\src\renderer\components\app-shell\CompactSessionMenu.tsx`
- `D:\ALL PROJECT\ohmypi-craft\apps\electron\src\renderer\components\app-shell\TaskActionMenu.tsx`
- `D:\ALL PROJECT\ohmypi-craft\apps\electron\src\renderer\components\app-shell\ChatDisplay.tsx`
- `D:\ALL PROJECT\oh-my-pi-upstream\packages\coding-agent\src\modes\rpc\rpc-types.ts`

## 建议执行顺序

1. 先跑现有 session action 测试，确认基线。
2. 补齐后端动作返回 DTO：成功路径、路径字段、错误字段、关联 session 映射。
3. 接 renderer 菜单和结果展示。
4. 给分支流程补最小端到端测试：候选消息 -> branch -> 新 session 映射。
5. 做真实 OMP smoke：创建会话、重命名、导出、handoff、分支。

## 验收标准

- 用户能从桌面创建 OMP 新会话。
- 用户能从一条历史用户消息创建 OMP 分支，并进入分支后的新会话。
- handoff/export 成功后能看到产物路径并打开。
- sessionFile 缺失不会静默开空会话；必须明确报错。
- Craft 标题和 OMP 标题不会互相覆盖造成惊喜。
- 测试通过：
  - `bun test packages/server-core/src/sessions/omp-session-manager-actions.test.ts`
  - `bun test packages/shared/src/agent/backend/omp/__tests__/omp-rpc-backend.test.ts`
  - `bun run typecheck:shared`
  - `cd packages/server-core && bun run typecheck`
  - `cd apps/electron && bun run typecheck`

## 交接说明

完成后写清：

- 哪些动作已接桌面入口。
- 哪些动作只保留后端能力。
- 分支后 Craft session 和 OMP session 的映射更新策略。
- handoff/export 的真实 smoke 结果和产物路径示例。

