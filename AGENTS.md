# Codex Limit Island 项目约定

## 项目范围

- 这是 Windows 上的 Tauri 2 + React + TypeScript 悬浮组件，显示 Codex App 的五小时、每周额度，以及 Hook 提供的会话活动状态。
- 保持改动集中在当前需求。不要顺手重构取数、状态选择和窗口行为；需要调整这些行为时，先核对调用链与现有测试。
- 不提交、推送或发布，除非用户明确要求。

## 关键链路

- `src-tauri/src/codex_runtime.rs` 在 Windows 和 macOS 优先查找常见的 Codex App 内置程序位置，再按平台从 `PATH` 查找 `codex`，通过 `app-server` 调用 `account/rateLimits/read`。按 `windowDurationMins` 识别五小时和每周窗口。不要读取或记录登录令牌。
- Codex 命令型 Hook 运行 `codexlimit --hook`（Windows 为 `codexlimit.exe --hook`），将标准输入 JSON POST 到 `127.0.0.1:17321/api/codex/hook`；GUI 未运行时以 `--auto-start` 模式启动同一程序并重试。`src-tauri/src/activity/` 只在内存中保留状态所需字段，不持久化提示词、工具参数或工具输出。
- 用户通过托盘明确“退出”后，Hook 不会再次自动唤醒灵动岛；自动启动需再次检查退出标记且不能清除它，只有手动启动才清除标记并恢复自动唤醒。应用自己的少量持久化状态位于 `~/.codex-limit-island/`。
- 退出标记读取失败时拒绝自动启动；托盘写标记失败时保留 GUI 并提示错误；手动启动清除失败时保留窗口并提示自动唤醒尚未恢复。
- `src/hooks/useUsage.ts` 启动时调用 `read_limits`，Rust 在 Root Stop、SessionEnd、app-server 通知时刷新额度，等待通知约 30 秒超时后校准；事件刷新先等待约 3 秒并合并期间的通知，实际间隔还包含查询耗时。`useActivity.ts` 通过 `activity-updated` 实时接收会话状态，`read_activity` 只用于首次加载。`src/islandState.ts` 集中生成展示模型。调整状态规则时，同时检查 Hook 事件映射和 UI 选择逻辑。
- 用户级 Hook 配置在 `%USERPROFILE%\.codex\hooks.json`，不属于项目文件。修改 Hook 命令会触发 Codex 重新信任；不要绕过信任机制，也不要把本机绝对路径写进仓库配置。

## 构建与验证

- Windows PowerShell 使用 `npm.cmd`。前端验证：`npm.cmd run build`；Rust 验证：`cargo test --lib --quiet --manifest-path src-tauri/Cargo.toml`。
- Node.js 24.15 以上的 24 系列或 Node.js 26 以上环境使用 `npm.cmd ci` 安装锁定依赖，统一质量检查执行 `npm.cmd run check`。格式化使用 `npm.cmd run format` 与 `cargo fmt --manifest-path src-tauri/Cargo.toml`；不要将格式化与业务逻辑修改混为同一步骤。
- 版本需保持 npm、Cargo 与 Tauri 编译上下文一致；运行 `npm.cmd run version:check` 和 Rust 单测验证。ESLint 要求 0 warning，不新增告警豁免；Vitest 运行 TypeScript 测试，测试类型由 `tsconfig.test.json` 检查。
- UI 预览与视觉验收统一复用 `src/debugPresentation.ts` 的 20 个标准场景与 `src/components/PreviewGallery.tsx`（仅 DEV 加载：单实例交互用 `?debugIsland`，全形态平铺用 `?preview=matrix`，README 靶向渲染用 `?preview=readme`），始终渲染真实 `<Island />` 组件而非另建静态 HTML 页面。修改样式或布局后运行 `npm.cmd run preview:matrix` 生成 `artifacts.local/island-matrix.png` 核对全部 20 个场景的胶囊态与展开态；改动影响文档外观时运行 `npm.cmd run preview:readme`（或 `npm.cmd run preview:capture` 一次生成两者）同步更新 `docs/images/*.png`。
- 安装包构建：`npm.cmd run tauri build`；安装包输出在 `src-tauri/target/release/bundle/nsis`。构建成功只能证明产物生成；真实 Hook 流程还需要 Codex 已信任命令、重启后发送消息，并检查本地 HTTP 响应与界面状态。
- 运行中的 `src-tauri/target/release/codexlimit.exe` 可能占用构建产物。重建前只停止路径精确匹配的本项目进程，完成后避免同时运行多个实例。

## 编码要求

- 遵循现有目录、命名和代码风格；业务文案与错误消息优先使用中文。
- 保留错误信息，不用空 `catch`、伪造成功状态或吞掉 Hook 失败。
- 排障时只读取必要字段，展示日志时不要泄露会话 ID、目录或其他私人内容。

## Rust 模块与资源边界

- `lib.rs` 只组装；启动、托盘、Hook 协议/收发、Activity model/reducer/registry、Usage app-server/解析/调度、Window frame/点击区/定位各在对应模块。
- Registry、UsageService 和 TokenUsageReader 由 Tauri manage/State 持有；Hook 通过显式 UsageRefresher 请求刷新。不要恢复可变全局 OnceLock 或反向调用入口函数。
- 日志只写 `~/.codex-limit-island/logs/`，保留受控阶段和错误类别；单文件 1MiB、2 份备份，轮转与追加共用固定 OS 锁文件。不得绕过锁写入或持久化外部错误原文。
- Hook 保持 8 个工作线程、16 个排队连接、1MiB 请求体、16KiB 请求头和 1 秒整体读取期限；改变协议需单独评估兼容。sender 转发未知事件原始 JSON，接收端明确拒绝未知事件。
- Token 查询保持 spawn_blocking、Session 文件索引 64 项和每文件 Turn 缓存 128 项；新 Turn 可完整回扫，重试优先增量读取。指定旧 Turn 不得返回最新 Turn 的 taskTokens。
- 跨层类型来自 `src/generated/contracts.ts`，运行 `npm.cmd run contracts:generate` 更新，`contracts:check` 及 Rust 单测验证漂移；不要手改生成文件。JSON 新字段需同步 Rust Serialize/TS 派生。
- Win32 优先复用 windows-sys；Common Controls subclass 使用官方类型及系统导入库兼容桥。保留真实隐藏窗口、HitRegion 所有权与句柄继承测试。

## 状态系统约束

- 新增状态先确定其所属维度：Lifecycle、Activity、Attention、Result、Token、Presentation 或 Interaction；不得扩充万能状态枚举。
- Activity 只表示 Codex 正在做什么；Attention 只表示用户是否需要操作；Result 只表示一个 Turn 的最终结果。Token Usage 属于 Turn Result，按 Session ID 和 Turn ID 查询，不得由 Session Activity 触发。
- Rust 领域状态只经 Hook 事件 reducer 改变；Session 失效和清理规则只放在 Rust Registry。前端不重复判断 Session stale。
- UI 展示优先级、状态文案、Activity 到 Orb 的映射集中在 `deriveIslandPresentation()`；App 只处理订阅、交互、窗口、拖动和渲染。
- `useInteractionMachine()` 封装 reducer 和同步状态读取；`windowController.ts` 保留原生队列、交互版本守卫与收起去重。`useHeldResults()` 在展开、展开准备和收起期间保留 Result，仅到 compact 才释放。Elapsed 的秒级刷新不得回传到 App。Token 缓存需保留 Snapshot、heldResults 和在途查询，完成后清理不再引用的键；拖动始终至多一个原生移动请求在途，并保留最新目标。
- CSS 只消费领域与展示模型已有的状态维度，不创造新业务状态。布局与展开状态应同时保留。
- 新增状态时同时补充 Rust 状态机测试与 TypeScript Presentation 测试。
