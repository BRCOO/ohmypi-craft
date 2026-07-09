# Batch 06 — Sources/MCP/权限收口与最终 E2E 成熟度

> 适合派给一个能做架构收口和端到端验收的 agent。这个批次最好放在前几批之后执行。

## 目标

把 OMP 与 Craft 的 Sources、MCP、权限、Host URI、专业工具面板和端到端测试收口，确保产品不只是功能多，而是边界安全、状态一致、能稳定发布。

本批重点处理：

- Craft Sources 与 OMP MCP/工具发现的关系。
- Host URI 剩余 scheme 和权限审计。
- OMP 内置工具的桌面权限与结果呈现。
- Browser/LSP/GitHub/SSH 等专业工具状态面板。
- Windows dev 和 packaged Electron 的真实 E2E 验收。

## 要写什么

1. Sources 与 MCP 决策
   - 写一份短 decision note：Craft Sources 和 OMP MCP 谁是启动/配置/权限事实源。
   - 明确哪些数据从 Craft 同步给 OMP，哪些只读展示，哪些禁止写。
   - 对 MCP add/list/remove/test/reauth/enable/disable/resources/prompts/notifications/search/reconnect/reload 做桌面等价物或暂缓说明。

2. Host URI 完整化
   - 继续扩展 `craft-session://`、`craft-workspace://`。
   - 为 Craft API、MCP、本地文件夹、未来数据源设计稳定 URI scheme。
   - 读写都必须走 Craft 权限和审计。
   - 任意 workspace/source/todo 写入默认拒绝，除非有明确 scope 和权限确认。

3. 权限策略
   - 对 OMP 内置工具映射 Craft 权限：read、write/edit、bash、browser、web_search、github、ssh、mcp、memory。
   - approval mode、always allow、per-tool allowlist 要和 OMP 行为一致。
   - 权限日志只记录必要元数据，不记录敏感正文。

4. 专业工具状态面板
   - Browser：决定使用 OMP browser 还是 Craft browser 面板，至少显示 visible/headless/tab/screenshot/status。
   - LSP：显示诊断、server 状态、延迟和失败。
   - GitHub：显示认证状态、结构化结果、错误动作。
   - SSH：显示主机管理、known_hosts/认证错误和风险提示。
   - MCP：显示 active servers、resources、prompts、tool discovery/BM25 结果。

5. 最终 E2E
   - 编写 Windows dev app 和 packaged app 的验收清单。
   - 覆盖：启动、模型发现、登录状态、普通 prompt、工具调用、权限弹窗、Host Tool、Host URI、Todo、子智能体、分支、handoff/export、崩溃恢复。
   - 记录必须手测的项目和可自动化的项目。

## 边界

本批不要做：

- 不在没有 decision note 的情况下重构 Sources/MCP 双系统。
- 不把 OMP 配置文件作为随意写入目标。
- 不绕过 Craft 权限直接执行高风险操作。
- 不把 secrets 写进日志、诊断、URI notes 或测试快照。
- 不为每个 OMP 内置工具做精美专属 UI；优先做安全、状态、错误和最小可用呈现。

## 交付物

- Sources/MCP ownership decision note。
- Host URI scheme 扩展和权限测试。
- OMP 工具权限映射表和实现。
- Browser/LSP/GitHub/SSH/MCP 最小状态面板或可见诊断入口。
- E2E checklist/scripts。
- `docs/omp-feature-parity-todo.md` 最终收口更新。

## 必须看什么

先用 CodeGraph：

```powershell
codegraph explore "OMP Host URI MCP sources permissions pre-tool-use browser lsp github ssh SessionManager"
```

然后读：

- `D:\ALL PROJECT\ohmypi-craft\docs\superpowers\specs\2026-07-09-omp-host-uri-artifacts-design.md`
- `D:\ALL PROJECT\ohmypi-craft\docs\superpowers\specs\2026-07-09-omp-host-tool-cooperative-abort-design.md`
- `D:\ALL PROJECT\ohmypi-craft\docs\omp-feature-parity-todo.md`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\omp\omp-rpc-backend.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\omp\omp-rpc-protocol.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\mcp`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\sources`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\core\pre-tool-use.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\server-core\src\sessions\SessionManager.ts`
- `D:\ALL PROJECT\ohmypi-craft\apps\electron\src\renderer\components\app-shell\SourcesListPanel.tsx`
- `D:\ALL PROJECT\ohmypi-craft\apps\electron\src\renderer\components\app-shell\ChatDisplay.tsx`
- `D:\ALL PROJECT\oh-my-pi-upstream\packages\coding-agent\src\modes\rpc\rpc-types.ts`

## 建议执行顺序

1. 先写 Sources/MCP decision note，不要先改代码。
2. 按 decision note 扩 Host URI。
3. 接权限策略和审计。
4. 给高风险工具做状态和错误呈现。
5. 编写并执行 E2E checklist。
6. 最后回填 `docs/omp-feature-parity-todo.md`，标记成熟度剩余项。

## 验收标准

- Sources/MCP ownership 被文档化，并且代码实现遵守它。
- Host URI 的读写 scope 明确，越权写入被拒绝。
- OMP 高风险工具调用会走 Craft 权限。
- 诊断/日志不泄漏 secret。
- Browser/LSP/GitHub/SSH/MCP 至少有可见状态和错误解释。
- Windows dev app 和 packaged app 都完成一次人工 E2E。
- 测试通过：
  - OMP Host URI/Host Tool 单测
  - permission/pre-tool-use 相关测试
  - `bun run typecheck:shared`
  - `cd packages/server-core && bun run typecheck`
  - `cd apps/electron && bun run typecheck`

## 交接说明

完成后写清：

- Sources/MCP ownership 决策。
- 新增 URI scheme 和权限规则。
- 哪些工具已经走 Craft 权限，哪些仍是 OMP 内部控制。
- E2E 实测环境、步骤、失败项和剩余风险。

