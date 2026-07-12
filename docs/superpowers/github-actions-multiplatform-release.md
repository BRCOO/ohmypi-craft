# GitHub Actions 三平台云端构建操作说明

配套设计：`docs/superpowers/specs/2026-07-12-github-actions-multiplatform-release-design.md`  
Workflow：`.github/workflows/release-electron.yml`

## 触发方式

| 触发 | 行为 |
| --- | --- |
| `push` 到 `main` 或当前开发分支 `codex/omp-rpc-backend` | 三平台生产构建，上传 Artifact（保留 14 天），**不**创建 GitHub Release |
| `push` `v*` 标签（如 `v0.10.5`） | 三平台构建全部成功后，创建/更新 GitHub Release 并上传 Assets |
| `workflow_dispatch` | 手动选分支运行；默认只上传 Artifact。若填写 `release_tag`（如 `v0.10.5`）且版本校验通过，则创建/更新 Release |

普通功能分支 push **不会**跑完整三平台生产打包。当前开发分支 `codex/omp-rpc-backend` 是过渡例外，合并到 `main` 后可移除该分支触发器；其他分支需要时用 Actions 页面手动 `workflow_dispatch`。

开发包（更快、非生产）仍可用既有 workflow：`.github/workflows/package-electron.yml`。

## 下载 Artifact（main / 手动）

1. 打开仓库 **Actions** → **Release Electron**。
2. 选中目标 run。
3. 页面底部 Artifacts：
   - `oh-my-pi-windows-x64-<sha>`
   - `oh-my-pi-macos-<sha>`（含 arm64 + x64 DMG/ZIP）
   - `oh-my-pi-linux-x64-<sha>`
4. 每个 Artifact 内含安装包、`SHA256SUMS.txt`、`build-meta-*.json`；Windows 另含 `release:win` 质量报告。

## 创建正式版本标签

标签版本必须与 `apps/electron/package.json` 的 `version` 一致（标签 `v0.10.5` ↔ 版本 `0.10.5`）。

```bash
# 1. 确认版本号已 bump
# 2. 提交并推送到目标提交
git tag v0.10.5
git push origin v0.10.5
```

或在 Actions 手动运行时填写 `release_tag=v0.10.5`（会在缺失时创建并推送该标签到当前 commit）。

Release body 自动写入版本、提交 SHA、签名状态摘要和资产列表；**不会**写入证书内容或 Secrets。

## OMP 运行时

打包需要嵌入 OMP 二进制。CI 从 `can1357/oh-my-pi` GitHub Release 下载，版本钉在：

- `apps/electron/resources/omp/VERSION`（例如 `v16.3.6`）
- 可用仓库变量/环境覆盖：`OMP_RUNTIME_TAG` / `OMP_RUNTIME_VERSION`

本地也可：

```bash
bun run scripts/ci/fetch-omp-runtime.ts --targets=win32-x64
bun run scripts/ci/fetch-omp-runtime.ts --targets=darwin-arm64,darwin-x64
bun run scripts/ci/fetch-omp-runtime.ts --targets=linux-x64
```

## 签名 Secrets（可选）

无 Secrets 时各平台生成**可测试的未签名包**，报告与 Release body 标记 `unsigned`。配置后自动启用签名。

### Windows Authenticode

| Secret | 说明 |
| --- | --- |
| `WIN_CSC_LINK` 或 `CSC_LINK` | PFX 路径或 base64 证书内容 |
| `CSC_KEY_PASSWORD` | 证书密码 |
| `CSC_NAME` | 可选证书主题覆盖 |

### macOS 签名 / 公证

| Secret | 说明 |
| --- | --- |
| `CSC_LINK` / `APPLE_CERTIFICATE_BASE64` | 证书材料 |
| `CSC_KEY_PASSWORD` | 证书密码 |
| `CSC_NAME` / `APPLE_SIGNING_IDENTITY` | 签名身份 |
| `APPLE_ID` | Apple ID |
| `APPLE_TEAM_ID` | Team ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | App 专用密码 |

缺少完整公证凭据时允许未签名或仅签名构建，但不得在对外说明中宣称已 notarize。标签 Release 若在已配置凭据时签名失败，构建会失败，避免发布不可验证包。

### Linux

默认不签名，仅提供 `SHA256SUMS.txt`。

## 平台入口

| 平台 | Runner | 构建入口 | 主要产物 |
| --- | --- | --- | --- |
| Windows | `windows-latest` | `bun run release:win` | NSIS Setup、质量报告、blockmap/yml |
| macOS | `macos-latest` | `bun run electron:dist:mac` | arm64/x64 DMG + ZIP |
| Linux | `ubuntu-latest` | `bun run electron:dist:linux` | x64 AppImage |

Windows 走完整质量门禁（`quality:verify`、包完整性、embedded runtime、AI Settings UI smoke、Release QA smoke）。macOS/Linux 做产物存在性、OMP/SDK 资源与 SHA-256 校验，不伪装跑 Windows 安装升级 smoke。

## 权限与并发

- 默认 `contents: read`；仅 `release` job 使用 `contents: write`。
- 同一 `github.ref` 并发组，新 push 取消旧构建。
- 任一平台失败则不创建/更新 GitHub Release；已上传的平台 Artifact 仍可下载排查。

## 本地辅助命令

```bash
bun run scripts/ci/release-meta.ts
bun run scripts/ci/verify-platform-artifacts.ts --platform=windows
bun run scripts/ci/assemble-release.ts --input=./arts --output=./out --version=0.10.5 --tag=v0.10.5 --commit=<sha>
bun test scripts/ci/__tests__
```

## 故障排查

| 现象 | 建议 |
| --- | --- |
| prepare 报 tag 与 version 不一致 | 对齐 `apps/electron/package.json` 与标签，或改标签 |
| Fetch OMP 404 | 检查 `resources/omp/VERSION` 是否对应上游 Release tag |
| Windows 构建极久/超时 | job 超时 180 分钟；可看 `release:win` 报告与 Artifact 是否已写出 |
| macOS 未签名被 Gatekeeper 拦截 | 预期（无证书）；或配置 Apple Secrets |
| Release 未创建 | 确认三平台 build 全绿且 `is_release=true`（标签或 dispatch 输入） |
