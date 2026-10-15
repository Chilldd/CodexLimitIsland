# Codex 限额岛

Tauri + React 悬浮组件，显示 Codex 的五小时与每周剩余额度和重置时间。目前仅提供 Windows 安装包；macOS/Linux 的运行与打包尚未验证。

## 取数方式

Rust 后端优先使用用户在托盘菜单中设置的 Codex 程序路径（该文件不存在时回退自动查找）；否则在 Windows 优先查找 `%LOCALAPPDATA%\OpenAI\Codex\bin\<版本>\codex.exe`；在 macOS 优先查找常见的 `Codex.app/Contents/Resources/codex` 安装位置；其余情况从 `PATH` 查找 `codex`（Windows 为 `codex.exe`）。找到后启动 `app-server`，通过标准输入输出发送 `account/rateLimits/read`。使用 `windowDurationMins` 区分 300 分钟与 10080 分钟窗口，并计算 `100 - usedPercent`。程序不读取登录令牌；所选 Codex 程序需要已登录。

Codex Hook 运行 `codexlimit --hook`（Windows 为 `codexlimit.exe --hook`），从标准输入读取 JSON 并 POST 到灵动岛监听的 `127.0.0.1:17321/api/codex/hook`；灵动岛尚未运行时会以 `--auto-start` 模式启动同一个程序，并在有限时间内重试当前事件。Rust 后端仅在内存中保存状态所需字段，并通过 Tauri 事件实时通知 React。Hook 命令配置在用户级 `~/.codex/hooks.json`，修改后需在 Codex 中重新信任并重启。

用户通过托盘明确点击“退出”后，Hook 不会再次自动唤醒灵动岛；`--auto-start` 启动前会再次检查退出标记且不会清除它。再次手动启动 Codex Limit Island 后，会清除标记并恢复 Hook 自动唤醒能力。应用自己的少量持久化状态位于 `~/.codex-limit-island/`。

退出标记无法读取时会拒绝自动启动；托盘退出时若无法保存标记，窗口会继续运行并提示修复权限后重试。手动启动时若无法清除标记，窗口仍可使用，但会提示自动唤醒尚未恢复。

Hook 仅在连接被拒绝或建连超时时尝试自动启动。HTTP 明确拒绝、无效响应或建连后的确认超时会返回错误；确认丢失时会说明事件可能已处理，避免盲目重发。

Codex 未安装在默认位置时，可在托盘图标右键菜单中选择“设置 Codex 程序路径…”指定 `codex.exe`；路径写入 `~/.codex-limit-island/config.json` 的 `codexPath`，选择“恢复默认路径”会删除该文件并回到自动查找。设置生效后会丢弃当前 Codex 连接并在下一次刷新时使用新路径。选定程序后先做一次自检：启动 `app-server` 并尝试读取额度，自检不通过则不保存并提示原因；程序能启动但额度读取失败（例如 Codex 未登录）时仍会保存并给出提示。

## 开发

状态系统的事件映射、展示优先级和展开交互见 [状态系统与事件流](docs/state-machine.md)。

安全基线整改及实际验收记录见 [P0-A 阶段报告](docs/p0a-acceptance.md)。

需要 Node.js、Rust、Windows WebView2 和 Tauri 所需的 Windows 编译工具。

```powershell
npm.cmd install
npm.cmd run tauri dev
```

构建安装包：

```powershell
npm.cmd run tauri build
```

安装包输出在 `src-tauri\target\release\bundle\nsis`。窗口默认置顶；点击窗口查看详情。额度在启动、Root Stop、SessionEnd、app-server 通知时刷新，并在等待刷新通知约 30 秒超时后校准；事件刷新先等待约 3 秒并合并期间的通知，实际间隔还包含查询耗时。Hook 状态实时更新。

## 质量检查

使用 Node.js 24.15 以上的 24 系列或 Node.js 26 以上版本，以及包含 `rustfmt`、`clippy` 的 stable Rust（至少 1.89，实际最低版本还受锁定依赖约束）。本项目当前实测 Node.js 24.18。Windows PowerShell 使用 `npm.cmd`；其他平台可将命令中的 `npm.cmd` 换成 `npm`，但原生功能目前只在 Windows 开发环境验证。

```powershell
npm.cmd ci
npm.cmd run check
```

`check` 依次验证 npm/Cargo/Tauri 版本、Prettier、ESLint、应用/配置/测试类型、前端构建、Vitest、Rust 格式、Clippy 和 Rust 单测，不构建安装包。单独运行可使用 `typecheck`、`lint`、`format:check`、`version:check`、`build`、`test`、`check:rust`；`npm.cmd run format` 和 `cargo fmt --manifest-path src-tauri/Cargo.toml` 分别修复前端与 Rust 格式。

ESLint 启用推荐的 TypeScript 与 React Hooks 规则，要求 0 error、0 warning。测试已迁移为 TypeScript，由 Vitest 运行，`tsconfig.test.json` 直接检查测试类型；React hooks 与组件使用 jsdom 和 Testing Library，窗口时序使用可控 Promise 与假时钟。版本校验脚本也接受 Node 配置的类型检查。

`App.tsx` 负责组合；展示模型集中在 `islandState.ts`，订阅、结果保留、窗口、拖动和导航位于 `src/hooks/`，原生窗口队列由 `windowController.ts` 编排。Elapsed 的每秒刷新局限在文本组件，Result 到期使用一次性定时器。尺寸常量、CSS tokens、Rust 点击区和 Tauri 配置之间有契约测试。P1 的验证和浏览器对照见 [P1 阶段报告](docs/p1-acceptance.md)。

Tauri 版本读取根目录 `package.json`，Cargo package 版本仍需同步维护。`version:check` 检查三处配置，Rust 单测另行检查 Tauri 编译上下文中实际解析的版本。

`.github/workflows/check.yml` 在 Windows runner 上安装锁定依赖并执行相同的 `check`。隐藏 Win32 窗口测试会照常执行并使失败反馈到 CI；它们不替代真实窗口、动画与 Hook 信任链路验收。

## 后端与跨层契约

Rust 入口 `src-tauri/src/lib.rs` 负责初始化和组装；`hook/` 接收与转发事件，`activity/` 管理领域状态，`usage/` 管理额度连接与调度，`window/` 管理原生窗口，`tray.rs` 和 `launch.rs` 分别管理托盘与启动。Registry、额度连接和 Token 文件索引通过 Tauri Managed State 共享。

跨层类型由 Rust 的 Serialize/ts-rs 定义生成到 `src/generated/contracts.ts`：

```powershell
npm.cmd run contracts:generate
npm.cmd run contracts:check
```

生成文件直接用于前端，不能手工修改；`check` 中的 Rust 单测也检查契约漂移。生成器只属于开发依赖，64 位数字保持既有 JSON number 形式。

应用日志位于 `~/.codex-limit-island/logs/codexlimit.log`，最大 1MiB，最多 2 份轮转备份。GUI 和 Hook sender 共用 OS 文件锁，隐私详情只保留受控错误类别；日志不可写时启动界面会提示。旧 exe 同目录日志不会自动迁移或删除。

本机 Hook HTTP 保持原协议，使用 8 个工作线程、16 个排队连接；超额连接返回 503，非法请求返回 400。请求体最大 1MiB、请求头最大 16KiB，读取使用 1 秒整体期限。没有新增鉴权或修改已信任命令，资源限制不等同于同用户进程隔离。

Token 文件按 Session 缓存并增量读取，旧 Turn 首次查询仍可回扫；路径/文件变化会失效重查。前端 Token 缓存保留展开结果和在途查询，引用释放且查询完成后清理；拖动只保留一个在途原生请求与最新目标，DPI、边界和运动算法保持原规则。

两阶段的验证、性能量化及未执行的真实联调见 [P2 报告](docs/p2-acceptance.md) 和 [P3 报告](docs/p3-acceptance.md)。
