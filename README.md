# Codex 限额岛

Tauri + React 悬浮组件，显示 Codex 的五小时与每周剩余额度和重置时间。目前仅提供 Windows 安装包；macOS/Linux 的运行与打包尚未验证。

## 取数方式

Rust 后端优先使用用户在托盘菜单中设置的 Codex 程序路径（该文件不存在时回退自动查找）；否则在 Windows 优先查找 `%LOCALAPPDATA%\OpenAI\Codex\bin\<版本>\codex.exe`；在 macOS 优先查找常见的 `Codex.app/Contents/Resources/codex` 安装位置；其余情况从 `PATH` 查找 `codex`（Windows 为 `codex.exe`）。找到后启动 `app-server`，通过标准输入输出发送 `account/rateLimits/read`。使用 `windowDurationMins` 区分 300 分钟与 10080 分钟窗口，并计算 `100 - usedPercent`。程序不读取登录令牌；所选 Codex 程序需要已登录。

Codex Hook 运行 `codexlimit --hook`（Windows 为 `codexlimit.exe --hook`），从标准输入读取 JSON 并 POST 到灵动岛监听的 `127.0.0.1:17321/api/codex/hook`；灵动岛尚未运行时会以 `--auto-start` 模式启动同一个程序，并在有限时间内重试当前事件。Rust 后端仅在内存中保存状态所需字段，并通过 Tauri 事件实时通知 React。Hook 命令配置在用户级 `~/.codex/hooks.json`，修改后需在 Codex 中重新信任并重启。

用户通过托盘明确点击“退出”后，Hook 不会再次自动唤醒灵动岛；`--auto-start` 启动前会再次检查退出标记且不会清除它。再次手动启动 Codex Limit Island 后，会清除标记并恢复 Hook 自动唤醒能力。应用自己的少量持久化状态位于 `~/.codex-limit-island/`。

Codex 未安装在默认位置时，可在托盘图标右键菜单中选择“设置 Codex 程序路径…”指定 `codex.exe`；路径写入 `~/.codex-limit-island/config.json` 的 `codexPath`，选择“恢复默认路径”会删除该文件并回到自动查找。设置生效后会丢弃当前 Codex 连接并在下一次刷新时使用新路径。选定程序后先做一次自检：启动 `app-server` 并尝试读取额度，自检不通过则不保存并提示原因；程序能启动但额度读取失败（例如 Codex 未登录）时仍会保存并给出提示。

## 开发

状态系统的事件映射、展示优先级和展开交互见 [状态系统与事件流](docs/state-machine.md)。

需要 Node.js、Rust、Windows WebView2 和 Tauri 所需的 Windows 编译工具。

```powershell
npm.cmd install
npm.cmd run tauri dev
```

构建安装包：

```powershell
npm.cmd run tauri build
```

安装包输出在 `src-tauri\target\release\bundle\nsis`。窗口默认置顶；点击窗口查看详情。额度在启动、Root Stop、SessionEnd、app-server 通知时刷新，并每 5 分钟校准；Hook 状态实时更新。
