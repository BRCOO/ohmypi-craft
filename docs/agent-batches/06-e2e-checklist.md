# Batch 06 — Windows OMP E2E Checklist

> 本清单用于在 Windows 开发版和打包版 Electron 应用上验证 OMP 集成成熟度。
> 自动化测试覆盖不到的体验项（窗口生命周期、打包路径、系统浏览器唤起等）必须手工执行并记录结果。

## 环境

| 项目 | 开发版 (dev) | 打包版 (packaged) |
|---|---|---|
| 日期 | 2026-07-10 | 待填写 |
| 执行人 | Kimi Code CLI smoke | 待填写 |
| Windows 版本 | Windows 11 Pro 24H2 (Build 26200) | 待填写 |
| OMP CLI 版本 | omp/16.3.0 | 待填写 |
| 安装路径（打包版） | N/A | 待填写 |
| 工作目录 | `D:/ALL PROJECT/ohmypi-craft` | 待填写 |

## 启动与发现

- [x] 应用能正常启动，不因为 OMP 路径缺失而崩溃。
- [x] Settings > AI 中 “Oh My Pi runtime” 显示 `Runtime ready`（由模型刷新成功间接验证）。
- [ ] 点击 Recheck 后 OMP 诊断能在 15 秒内返回（未手测）。
- [x] OMP 模型列表能刷新并显示至少一个可用模型（日志显示获取到 22 个模型）。
- [x] 版本兼容性警告（如有）显示正确且不阻塞启动（本次无警告）。

## 登录与 Provider

- [ ] OMP Provider 列表显示正确（已登录/未登录/不可用）（未手测）。
- [ ] 对未登录 Provider 点击 Login 能打开系统浏览器并完成回调（未手测）。
- [ ] 登录成功后模型可用性自动刷新（未手测）。

## 普通对话

- [ ] 新建 OMP 会话后发送普通文本 prompt（未手测）。
- [ ] 助手回复以流式文本呈现，不重复创建消息（未手测）。
- [ ] 点击停止按钮能中断生成并恢复输入框（未手测）。
- [ ] 输入 `/stats` 或 `/context` 等纯命令后不会永久卡住（未手测）。

## 工具与权限

- [ ] 触发 `read`/`bash`/`write` 等工具时显示 Craft 权限弹窗（未手测）。
- [ ] 选择 “Allow this time” 后工具正常执行（未手测）。
- [ ] 选择 “Always allow” 后同类型工具不再弹窗（未手测）。
- [ ] 工具结果以专用卡片展示，错误状态可见（未手测）。

## Host Tool / Host URI

- [ ] OMP 通过 `host_tool_call` 调用 Craft 注册工具（如 `call_llm`）并成功返回（未手测；单元测试已覆盖）。
- [ ] OMP 通过 `craft-session://current/artifacts/<name>` 写入文件，文件落在会话 data 目录（未手测；单元测试已覆盖）。
- [ ] 越权写入（如 `craft-session://current/todos`）被拒绝并记录审计（未手测；单元测试已覆盖）。
- [ ] `craft-workspace://current/sources` 返回脱敏 source 快照，不含凭证（未手测；单元测试已覆盖）。

## Todo、子智能体、分支

- [ ] OMP Todo 卡片显示在 composer 上方，能 start/complete/drop task（未手测；组件测试已覆盖）。
- [ ] 子智能体运行中时在子智能体栏显示进度（未手测；单元测试已覆盖）。
- [ ] 打开子智能体能加载 transcript 且不重复追加（未手测；单元测试已覆盖）。
- [ ] 从历史用户消息创建 OMP 分支后进入新会话（未手测；单元测试已覆盖）。

## Handoff / Export

- [ ] 会话菜单 Handoff 成功并显示产物路径（未手测；单元测试已覆盖）。
- [ ] Export HTML 成功并打开文件（未手测；单元测试已覆盖）。

## 崩溃与恢复

- [ ] 手动结束 OMP 子进程后，应用能检测到退出并给出错误（未手测；单元测试已覆盖）。
- [x] 重新打开同一会话时恢复到原 OMP sessionFile（启动日志加载了已有会话 `260706-gentle-basalt`）。
- [ ] 应用重启后能恢复之前的 OMP 会话状态（未手测）。

## 窗口与生命周期

- [x] 应用能创建窗口并渲染主界面（启动日志：`Created window for first workspace`）。
- [ ] 关闭窗口时 OMP 子进程正常退出（未手测）。
- [ ] 多 Craft 会话并行时各自有独立 OMP 进程（未手测）。
- [ ] 打包版能从安装目录正确解析 OMP 命令和配置目录（本项仅适用 packaged）。

## 结果汇总

| 环境 | 通过 | 失败 | 跳过 | 备注 |
|---|---|---|---|---|
| 开发版 | 6 | 0 | 20+ | 仅完成启动、模型发现、会话恢复等自动化可观测项；完整手测项待补充。 |
| 打包版 | 待填写 | 待填写 | 待填写 | 待填写 |

## 已知限制与剩余风险

- Plan/Goal/Advisor/Loop/TTSR 等能力依赖上游 OMP RPC 扩展，当前桌面端仅显示 Todo 和子智能体状态。
- Browser/LSP/GitHub/SSH/MCP 子系统状态目前不由 OMP RPC 报告，Settings 中显示 “Not reported”。
