# GitHub Actions 三平台云端构建设计

**日期：** 2026-07-12  
**状态：** 已确认，待实现  
**范围：** OMP Craft Electron 桌面应用的 Windows、macOS、Linux 云端构建与发布自动化

## 1. 背景与目标

当前仓库已经具备本地 Electron 打包脚本、Windows `release:win` 质量门禁，以及一个手动触发的三平台开发包 workflow。缺少的是一条面向日常开发和正式发布的统一 GitHub Actions 流程：开发者推送代码后可以在 GitHub 云端得到可下载的三平台产物，创建版本标签后可以自动生成 GitHub Release。

本设计目标：

1. 在 GitHub 托管的 Windows、macOS、Linux runner 上分别构建生产安装包。
2. `main` 分支每次 push 自动生成三平台构建产物，供 QA 和验收使用。
3. 推送 `v*` 版本标签时，自动创建或更新 GitHub Release，并将三平台包作为 Release Assets 上传。
4. Windows 保留现有完整 `quality:verify`、安装包构建、AI Settings UI smoke 和 Release QA smoke。
5. 无代码签名凭据时允许生成可测试的未签名包，但报告和产物元数据必须明确标记；凭据配置后自动启用签名。
6. 构建产物不进入 Git 历史，不依赖开发者本机环境。

## 2. 非目标与边界

本批只解决 CI/CD 构建与发布编排，不改变应用运行时行为。

明确不包含：

- 不在仓库中提交 `.exe`、`.dmg`、`.zip`、`.AppImage` 或其他构建产物。
- 不在本批设计新的自动更新服务器、下载站或 `publish` provider；Release Assets 只是构建交付渠道。
- 不强制引入 Apple Developer 证书、Windows Authenticode 证书或 Linux GPG 签名；这些通过可选 Secrets 接入。
- 不让每个功能分支自动执行完整三平台生产打包，以避免 runner 额度和构建时间失控。
- 不把未稳定的普通提交自动标记为正式版本；正式 Release 只由 `v*` 标签触发。
- 不替换现有本地 `release:win`、开发包脚本或既有手动 workflow，除非实现时确认需要抽取共享步骤。

## 3. 触发与发布模型

### 3.1 主分支 push

当代码推送到 `main` 时触发三平台构建。每个平台构建完成后上传独立 Artifact，保留 14 天。Artifact 用于：

- QA 下载并安装验证；
- 对比不同提交的包；
- 在没有版本标签时提供临时验收包。

主分支构建不创建 GitHub Release，也不覆盖任何持久化下载地址。

### 3.2 版本标签 push

当推送匹配 `v*` 的标签（例如 `v0.10.6`）时触发同一套三平台构建。所有平台成功后：

1. 读取仓库版本与标签版本，验证两者一致；
2. 汇总各平台 Artifact；
3. 创建或更新对应 GitHub Release；
4. 将 Windows、macOS、Linux 安装包和校验文件上传为 Release Assets。

标签构建必须使用 `contents: write` 权限；普通 `main` push 只需要 `contents: read` 和 Artifact 写入权限。

### 3.3 其他分支与手动运行

普通分支 push 不触发完整三平台生产构建。workflow 保留 `workflow_dispatch`，允许维护者从 GitHub Actions 页面手动选择分支运行，用于发布前验收或排查 CI 环境问题。手动运行默认只上传 Artifact，不自动创建 Release，除非显式提供版本标签输入且通过版本校验。

## 4. Workflow 结构

建议新增一个职责明确的 workflow（例如 `.github/workflows/release-electron.yml`），而不是把正式发布逻辑继续堆入现有开发包 workflow。

### 4.1 Job 拆分

```text
prepare
  ├─ 读取版本、提交 SHA、触发类型
  ├─ 计算是否为 release tag
  └─ 输出构建元数据

build (matrix: windows / macos / linux)
  ├─ checkout
  ├─ setup Bun
  ├─ bun install --frozen-lockfile
  ├─ 平台生产构建
  ├─ 平台包完整性检查
  ├─ Windows 额外执行 release QA
  └─ 上传平台 Artifact

release (仅 release tag，needs: build)
  ├─ 下载所有平台 Artifact
  ├─ 生成统一 SHA-256 清单
  ├─ 创建/更新 GitHub Release
  └─ 上传 Release Assets
```

### 4.2 Runner 矩阵

| 平台 | Runner | 目标架构 | 主要产物 |
| --- | --- | --- | --- |
| Windows | `windows-latest` | x64 | NSIS 安装包、必要的 blockmap/yml、QA 报告 |
| macOS | `macos-latest` | arm64、x64（按脚本支持情况） | DMG、ZIP、校验文件 |
| Linux | `ubuntu-latest` | x64 | AppImage、校验文件 |

macOS 是否在同一 runner 上构建 universal/双架构，由现有 `electron:dist:mac` 和 electron-builder 配置决定；如果构建脚本需要分别构建两个架构，workflow 应在 macOS job 内按架构串行执行，不能假设 Linux/Windows 的跨平台行为。

## 5. 平台构建与质量门禁

### 5.1 公共步骤

每个平台都执行：

1. `actions/checkout@v4`，固定到触发提交。
2. `oven-sh/setup-bun@v2`，版本与仓库锁定版本一致。
3. `bun install --frozen-lockfile`。
4. 运行平台相关的发布元数据验证。
5. 执行生产 Electron 构建脚本。
6. 检查预期产物存在且文件大小大于零。
7. 生成 SHA-256 清单，清单与产物一起上传。

构建不得依赖开发者本机缓存；可以使用 Bun/npm/electron-builder 缓存，但缓存命中失败必须能够从干净 runner 重新完成。

### 5.2 Windows

Windows job 使用现有 `release:win` 作为正式入口，因为它已经包含：

- `quality:verify`；
- Windows 安装包构建；
- 包完整性和 embedded runtime 检查；
- 打包后的 AI Settings UI Playwright smoke；
- 安装、离线安装、升级和 OMP 功能 smoke。

若 release 脚本已经产生质量报告，workflow 应直接收集这些报告，而不是重新实现一套平行检查。

### 5.3 macOS 与 Linux

macOS 使用现有生产构建脚本，至少验证：

- DMG/ZIP 产物存在；
- app bundle 中包含目标架构的 SDK、OMP runtime 和 Bun/uv 资源；
- 产物命名与版本一致；
- SHA-256 清单生成成功。

Linux 使用现有生产构建脚本，至少验证：

- AppImage 产物存在且非空；
- unpacked app 中包含目标架构 SDK 与 OMP runtime；
- AppImage 可被识别为 Linux 可执行包；
- 产物命名与版本一致；
- SHA-256 清单生成成功。

本批不要求在 macOS/Linux runner 上执行 Windows 专属的安装升级 smoke，也不把 Windows UI smoke 伪装成跨平台通用测试。

## 6. 签名与 Secrets

### 6.1 Windows Authenticode

可选配置：

- `WIN_CSC_LINK` 或 `CSC_LINK`：PFX 路径或 base64 内容；
- `CSC_KEY_PASSWORD`：证书密码；
- `CSC_NAME`：可选证书主题覆盖。

Secrets 只在 GitHub Actions 进程环境中注入，不写入日志，不写入构建产物。没有这些 Secrets 时，构建保持 unsigned，并在 quality/release 报告中记录 `signing: unsigned`。

### 6.2 macOS 签名与公证

可选配置：

- Apple signing identity、证书和密码；
- `APPLE_ID`、`APPLE_TEAM_ID`、`APPLE_APP_SPECIFIC_PASSWORD`；
- 对应的 certificate/import 相关 Secrets。

缺少完整凭据时允许构建未签名 DMG/ZIP，但不能宣称已完成 notarization。签名和公证失败必须使标签 Release 失败，避免发布一个看似正式但不可验证的 macOS 包。

### 6.3 Linux

Linux 默认不做发行版签名；只提供 SHA-256 清单。后续如需 GPG/Sigstore，应另立设计。

## 7. Artifact 与 Release 约定

### 7.1 Artifact 命名

Artifact 名称包含平台、架构和提交/版本信息，例如：

- `oh-my-pi-windows-x64-<sha>`
- `oh-my-pi-macos-arm64-<sha>`
- `oh-my-pi-linux-x64-<sha>`

这样可以避免并行运行或重跑时互相覆盖。

### 7.2 Release Assets

Release Asset 使用现有 electron-builder 产物命名，不通过 workflow 重命名破坏更新元数据。额外上传：

- `SHA256SUMS.txt`；
- 每个平台的 quality/release QA JSON 报告；
- 必要的 updater metadata（例如 `.yml`、`.blockmap`，仅当构建实际产生）。

Release body 自动写入：版本、提交 SHA、构建时间、签名状态、各平台产物列表和 QA 报告链接。禁止在 Release body 中写入证书内容、Secrets 或本机路径。

## 8. 并发、失败与重跑

- 同一分支只保留最新一次构建：使用 `concurrency`，新 push 取消旧的未完成构建。
- 同一版本标签不允许两个不同提交同时发布；release job 在上传前验证标签指向的 SHA。
- 任一平台构建失败，标签 Release job 不执行；三平台 Artifact 仍保留用于诊断。
- `workflow_dispatch` 重跑不应删除已有 Release Asset，除非明确指定同一版本并通过覆盖策略。
- 缓存故障、下载重试和 runner 临时失败允许手动重跑；产物验证失败不得被 `continue-on-error` 隐藏。

## 9. 权限与供应链安全

workflow 默认使用最小权限：

```yaml
permissions:
  contents: read
```

只有 release job 使用：

```yaml
permissions:
  contents: write
```

第三方 actions 固定到官方主版本（`actions/checkout@v4`、`actions/upload-artifact@v4` 等），不执行来自构建产物的脚本。上传 Release 前重新计算文件哈希，确保下载的 Artifact 与发布的 Asset 一致。

## 10. 可观测性与交付

每次 workflow 运行应在摘要中显示：

- 触发类型、分支、标签和提交 SHA；
- 每个平台构建耗时和结果；
- 签名状态；
- Artifact/Release 链接；
- SHA-256 清单位置；
- 失败 job 的下一步诊断提示。

日志中不输出 token、证书密码、PFX 内容、完整 Secrets 环境变量或用户本机路径。

## 11. 验收标准

实现完成后必须满足：

1. 推送到 `main` 能自动启动三平台矩阵构建。
2. 三个平台均能在 GitHub Actions 页面下载对应 Artifact。
3. 推送 `v*` 标签能在三平台全部成功后创建/更新 GitHub Release。
4. Windows 标签构建通过现有 `release:win` 质量门禁和 Release QA；失败时不创建正式 Release。
5. macOS 产出 DMG/ZIP，Linux 产出 AppImage，所有产物都有 SHA-256 记录。
6. 无签名 Secrets 时报告明确显示 unsigned，不因缺少签名凭据而误报为已签名。
7. 配置签名 Secrets 后，Windows/macOS 的签名状态由报告和 Release body 反映。
8. 构建不向 Git 提交任何安装包或临时目录。
9. 同一分支的旧构建会按并发策略取消；标签发布不会因重复 job 产生错配资产。
10. workflow 文档说明如何下载 Artifact、创建标签和配置签名 Secrets。

## 12. 实现顺序

1. 新增/整理三平台发布 workflow，先实现 `main` push 的 Artifact 流程。
2. 加入 Windows `release:win` 和 macOS/Linux 包完整性检查。
3. 加入标签版本校验与 GitHub Release job。
4. 加入 SHA-256 清单、报告上传和 workflow summary。
5. 在无签名 Secrets 的 CI 环境跑通三平台构建。
6. 通过仓库 Secrets 接入签名后，单独验证签名分支，不把签名凭据作为默认要求。

