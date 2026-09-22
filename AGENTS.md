# Codex Limit Island 项目约定

## 项目范围

- 这是 Windows 上的 Tauri 2 + React + TypeScript 悬浮组件，显示 Codex App 的五小时、每周额度，以及 Hook 提供的会话活动状态。
- 保持改动集中在当前需求。不要顺手重构取数、状态选择和窗口行为；需要调整这些行为时，先核对调用链与现有测试。
- 不提交、推送或发布，除非用户明确要求。

## 关键链路

- `src-tauri/src/lib.rs` 启动 Codex App 自带的 `codex.exe app-server`，调用 `account/rateLimits/read`。按 `windowDurationMins` 识别五小时和每周窗口。不要读取或记录登录令牌。
- Codex 命令型 Hook 用 Windows 自带的 `curl.exe` 把标准输入 JSON POST 到 `127.0.0.1:17321/api/codex/hook`。`src-tauri/src/activity.rs` 只在内存中保留状态所需字段，不持久化提示词、工具参数或工具输出。灵动岛未运行时事件会丢失。
- `src/App.tsx` 每分钟调用 `read_limits`，通过 Tauri 的 `activity-updated` 事件实时接收会话状态；`read_activity` 只用于窗口初次加载。`src/islandState.ts` 负责选择灵动岛模式。调整状态规则时，同时检查 Hook 事件映射和 UI 选择逻辑。
- 用户级 Hook 配置在 `%USERPROFILE%\.codex\hooks.json`，不属于项目文件。修改 Hook 命令会触发 Codex 重新信任；不要绕过信任机制，也不要把本机绝对路径写进仓库配置。

## 构建与验证

- Windows PowerShell 使用 `npm.cmd`。前端验证：`npm.cmd run build`；Rust 验证：`cargo test --lib --quiet --manifest-path src-tauri/Cargo.toml`。
- 安装包构建：`npm.cmd run tauri build`；安装包输出在 `src-tauri/target/release/bundle/nsis`。构建成功只能证明产物生成；真实 Hook 流程还需要 Codex 已信任命令、重启后发送消息，并检查本地 HTTP 响应与界面状态。
- 运行中的 `src-tauri/target/release/codexlimit.exe` 可能占用构建产物。重建前只停止路径精确匹配的本项目进程，完成后避免同时运行多个实例。

## 编码要求

- 遵循现有目录、命名和代码风格；业务文案与错误消息优先使用中文。
- 保留错误信息，不用空 `catch`、伪造成功状态或吞掉 Hook 失败。
- 排障时只读取必要字段，展示日志时不要泄露会话 ID、目录或其他私人内容。
