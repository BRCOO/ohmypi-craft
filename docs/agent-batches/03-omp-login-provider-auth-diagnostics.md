# Batch 03 — OMP 登录、Provider 状态与连接诊断

> 适合派给一个独立 agent 执行。目标是把 OMP 从“keyless local backend”升级为有真实 provider/login 状态的桌面连接。

## 目标

接入 OMP 原生登录和 provider 状态，让 onboarding、设置页、模型发现和连接测试不再只是“假成功”。

本批重点处理：

- `get_login_providers`
- `login`
- 登录期间的 `open_url` / progress / cancel / error
- OMP connection 的 `testConnection`
- OMP connection 的 `validateStoredConnection`
- OMP 路径、版本、配置、认证库、模型访问诊断

## 要写什么

1. 协议层
   - 为 `get_login_providers` 和 `login` 补齐 typed command/response。
   - 解析 provider id、display name、auth type、authenticated、available、reason、login methods。
   - 登录长操作要有 timeout、cancel、错误保留。

2. 后端动作
   - `OmpRpcBackend` 暴露获取登录 providers 的方法。
   - 暴露启动登录的方法，处理 OAuth URL 打开、进度、成功、失败、取消。
   - 登录完成后刷新模型发现缓存和 provider 状态。

3. Craft connection 集成
   - `testConnection` 不再永远返回 `null`。
   - `validateStoredConnection` 不再永远 success。
   - 区分这些状态：
     - OMP CLI 找不到
     - OMP CLI 版本不兼容
     - OMP 可启动但无可用 provider
     - provider 未登录
     - provider 已登录但模型不可用
     - 模型发现失败

4. Onboarding / Settings UI
   - Provider select 中 OMP entry 显示真实状态。
   - OMP 设置页或 API setup 区域显示 provider 列表和登录按钮。
   - OAuth 登录需要打开外部浏览器/系统浏览器，并显示“等待登录完成”。
   - 登录失败给出可复制诊断。

5. 诊断导出
   - 增加 OMP 诊断摘要：cli path、version、cwd、config root、auth root 是否存在、provider 状态、模型发现耗时/错误。
   - 诊断中不要泄漏 API key、token、cookie、完整 auth 文件内容。

## 边界

本批不要做：

- 不实现 logout，除非上游已经有明确 RPC；否则只写设计缺口。
- 不直接编辑 OMP 配置文件，除非已有安全 API 或用户显式选择。
- 不复制 Craft 现有 provider auth 逻辑去绕过 OMP；OMP provider 状态以 OMP 为准。
- 不把所有模型元数据完整产品化；只处理登录/可用性/诊断。
- 不在日志里输出 token、API key、OAuth callback code。

## 交付物

- `get_login_providers` / `login` 协议类型、解析和测试。
- OMP provider 状态后端动作。
- OMP connection test/validate 的真实实现。
- Onboarding/settings 登录 UI。
- 安全诊断摘要。
- 模型发现缓存按认证状态失效。
- 更新 `docs/omp-feature-parity-todo.md` 认证/Provider 条目。

## 必须看什么

先用 CodeGraph：

```powershell
codegraph explore "OMP login providers validateStoredConnection testConnection ProviderSelectStep OAuthConnect model fetcher"
```

然后读：

- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\omp\omp-rpc-protocol.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\omp\omp-rpc-backend.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\omp\omp-rpc-diagnostics.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\server-core\src\model-fetchers\omp.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\agent\backend\internal\drivers\omp.ts`
- `D:\ALL PROJECT\ohmypi-craft\packages\shared\src\config\provider-metadata.ts`
- `D:\ALL PROJECT\ohmypi-craft\apps\electron\src\renderer\components\onboarding\ProviderSelectStep.tsx`
- `D:\ALL PROJECT\ohmypi-craft\apps\electron\src\renderer\components\apisetup\OAuthConnect.tsx`
- `D:\ALL PROJECT\oh-my-pi-upstream\packages\coding-agent\src\modes\rpc\rpc-types.ts`
- `D:\ALL PROJECT\oh-my-pi-upstream\packages\coding-agent\src\modes\rpc\rpc-mode.ts`

## 建议执行顺序

1. 从上游确认 `get_login_providers` / `login` 的真实返回。
2. 先写协议解析测试，锁定 response shape。
3. 实现后端 provider 状态读取和登录动作。
4. 改 connection driver 的 test/validate。
5. 接 onboarding/settings UI。
6. 做真实登录 smoke；如果没有可登录 provider，至少验证未登录/不可用/CLI 缺失三类状态。

## 验收标准

- OMP CLI 不存在时，连接测试明确失败。
- OMP 可启动但未登录时，UI 显示需要登录，而不是显示成功。
- 登录流程能打开 URL、显示等待状态、完成后刷新 provider/model 状态。
- 模型列表能反映登录后的可用性变化。
- 诊断可复制，但不包含密钥。
- 测试通过：
  - `bun test packages/shared/src/agent/backend/omp/__tests__/omp-rpc-protocol.test.ts`
  - `bun test packages/shared/src/agent/backend/omp/__tests__/omp-rpc-backend.test.ts`
  - `bun run typecheck:shared`
  - `cd packages/server-core && bun run typecheck`
  - `cd apps/electron && bun run typecheck`

## 交接说明

完成后写清：

- 支持了哪些登录 provider 字段。
- 没有实现 logout 的原因或上游协议缺口。
- `testConnection` 和 `validateStoredConnection` 的状态矩阵。
- smoke 使用的 provider，不要写入任何凭据。

