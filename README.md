# Codex 限额岛

Windows 上的 Tauri + React 悬浮组件，显示 Codex App 的五小时与每周剩余额度和重置时间。

## 取数方式

Rust 后端查找 `%LOCALAPPDATA%\OpenAI\Codex\bin\<版本>\codex.exe`，启动 Codex App 自带的 `app-server`，通过标准输入输出发送 `account/rateLimits/read`。使用 `windowDurationMins` 区分 300 分钟与 10080 分钟窗口，并计算 `100 - usedPercent`。程序不读取登录令牌，也不要求单独安装或登录 Codex CLI。需要先登录 Codex App。

Codex Hook 使用 Windows 自带的 `curl.exe` 将事件 POST 到灵动岛监听的 `127.0.0.1:17321/api/codex/hook`。Rust 后端仅在内存中保存状态所需字段，并通过 Tauri 事件实时通知 React；灵动岛未运行时事件直接丢失。Hook 命令配置在用户级 `%USERPROFILE%\.codex\hooks.json`，修改后需在 Codex 中重新信任并重启。

## 开发

需要 Node.js、Rust、Windows WebView2 和 Tauri 所需的 Windows 编译工具。

```powershell
npm.cmd install
npm.cmd run tauri dev
```

构建安装包：

```powershell
npm.cmd run tauri build
```

安装包输出在 `src-tauri\target\release\bundle\nsis`。窗口默认置顶；点击窗口查看详情。额度每分钟刷新一次，Hook 状态实时更新。
