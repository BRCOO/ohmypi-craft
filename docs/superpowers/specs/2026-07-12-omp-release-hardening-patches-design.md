# OMP 发布硬化补丁设计

**日期：** 2026-07-12  
**状态：** 已实现

## 背景

`release:win` 与 Release QA 在验收中暴露几类残余风险：安装产物已写出但父进程因缓冲/超时被判失败；smoke 在 `.tmp/` 留下未忽略目录导致报告 `dirty`；Windows 代码签名未配置；AI 设置页缺少真实 UI 覆盖；Browser/LSP/GitHub/SSH 尚无 RPC 实时状态；缺少干净机器/断网与升级路径的自动化证据。

## 目标

1. **release:win 产物恢复** — 长构建使用流式子进程，避免 `spawnSync` maxBuffer；若进程失败/超时但 NSIS 安装包已新鲜生成，恢复为通过并记录说明。
2. **`.tmp` 清理** — 将 `.tmp/` 加入 `.gitignore`；smoke 成功后清理运行目录，并在套件结束时修剪陈旧 smoke 目录。
3. **正式 Windows 代码签名** — 当 `WIN_CSC_LINK` / `CSC_LINK` / `CSC_NAME` 存在时启用 Authenticode；本地无证书保持未签名并在质量报告中记录 `signing` 字段。
4. **AI 设置 UI 测试** — 抽取 `OmpAiDiagnosticsPanel`，单元测试覆盖功能数量、失败状态、未接入诊断；提供 Electron/Playwright 脚本 `test:ui:ai-settings`。
5. **诊断诚实性** — Browser/LSP/GitHub/SSH 继续显示「暂未接入诊断」，为后续 RPC telemetry 预留常量与 test id。
6. **干净机器 / 断网 / 升级** — smoke 场景 `offline-install` 与 `upgrade`（可选；缺前置时 skip 不阻断）。

## 非目标

- 不实现 Browser/LSP/GitHub/SSH 的真实 RPC 遥测（仅保持正确空态）。
- 不在仓库中提交证书或密码。
- 不要求开发者本机始终安装 `playwright-core`（UI e2e 无依赖时 skip）。

## 验证

- `bun test scripts/quality/__tests__`
- `bun test apps/electron/src/renderer/pages/settings/__tests__/omp-ai-diagnostics-panel.test.tsx`
- `bun run quality:quick`
- （可选）`bun add -d playwright-core && bun run test:ui:ai-settings:strict` 在已打包 `win-unpacked` 上
- （可选）`bun run release:win` 全链路

## 签名环境变量

| 变量 | 用途 |
| --- | --- |
| `WIN_CSC_LINK` 或 `CSC_LINK` | `.pfx` 路径或 base64 证书 |
| `CSC_KEY_PASSWORD` | 证书密码 |
| `CSC_NAME` | 可选证书主体名 |
| `OMP_PREVIOUS_INSTALLER` | 升级场景的上一版 Setup.exe |
| `OMP_BUILD_TIMEOUT_MS` | 构建软超时（默认 45 分钟） |
| `OMP_SMOKE_TIMEOUT_MS` | smoke 软超时（默认 30 分钟） |
