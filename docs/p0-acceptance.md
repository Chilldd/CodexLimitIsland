# P0 工程规范与质量门禁验收记录

日期：2026-10-15。依据：[整改方案 v2](code-quality-refactor-plan.md)。本阶段完成 P0.1–P0.6，P1/P2/P3 尚未开始。

## 基线与变更保护

- 分支为 `main`，HEAD 仍为 `b7b051fe93b6d097d690336aa538107f231b0aea`。
- 开始时有 P0-A 的 15 个未提交文件变更；本阶段先保存完整阶段快照，保留其代码与测试，再执行格式化和工程配置调整。
- 环境：Windows `10.0.22631`、PowerShell `7.6.3`、Node `24.18.0`、npm `11.16.0`、Rust `1.96.0`、rustfmt `1.9.0-stable`。
- 本地审阅补丁按顺序保存为 `p0-review.local/01-rust-format.patch`、`02-frontend-format.patch`、`03-tooling.patch`。前两份仅含对应格式化，第三份包含工程配置和必要的小幅源码调整；从 P0-A 快照顺序应用可重建本阶段结果。此目录由已有 `*.local` 规则忽略，补丁不进入仓库。
- 未提交、暂存、推送或发布；未修改真实 Hook 配置、信任设置或启动运行中的 GUI。

## 完成项目与文件

| 项目 | 文件 | 实现与边界 |
| --- | --- | --- |
| P0.1 | `.editorconfig`、`.gitattributes` | UTF-8、LF、末尾换行；Rust 缩进 4 空格；Markdown 保留有意义的行末空格；CMD/BAT 使用 CRLF，图像标记为二进制。未执行整仓 `git add --renormalize` |
| P0.2 | `rustfmt.toml`、`src-tauri/src/*.rs` | stable rustfmt，`max_width=120`；先独立完成 Rust 格式化，再调整版本字段和增加版本测试 |
| P0.3 | `.prettierrc.json`、`.prettierignore`、`src`、`tests`、既有前端配置 | Prettier 120 列；CSS 只展开格式，保留全部声明、选择器及覆盖顺序；不整理业务样式 |
| P0.4 | `eslint.config.mjs`、`package.json`、`package-lock.json` | ESLint Flat Config、TypeScript 与 React Hooks 推荐规则；建立类型、lint、格式、构建、测试和统一 `check` |
| P0.4 | `tsconfig.json`、`tsconfig.node.json`、`vite.config.ts` | 独立检查应用与 Vite 配置，均不生成中间 JS；添加 Node 类型后删除过时 `@ts-expect-error`；未来 TS 测试纳入类型检查和 lint，现有 MJS 测试执行方式保留 |
| P0.4 | `src/App.tsx` | effect 清理捕获已创建队列，避免读取可能变化的 ref 告警；将点击回调的三元语句改为等价 if/else；不调整订阅、结果保留或窗口时序 |
| P0.5 | `src-tauri/tauri.conf.json`、`scripts/check-versions.mjs`、`tests/versions.test.mjs` | Tauri 读取 `../package.json`；脚本通过 Cargo metadata 检查 npm/Cargo/Tauri 三处版本，测试逐一注入不一致和缺失 |
| P0.5 | `src-tauri/src/lib.rs` | app-server 使用 `env!("CARGO_PKG_VERSION")`；Rust 测试通过 `generate_context!()` 的 package info 验证实际 Tauri 编译版本，无需启动 GUI |
| P0.5 | `README.md`、`AGENTS.md` | 更正为等待通知约 30 秒超时后校准，说明事件先等待约 3 秒并合并通知，实际间隔包含查询耗时；未改刷新频率 |
| P0.6 | `src-tauri/capabilities/default.json` | 检索前端确认未调用 close/startDragging，移除两项对应权限；保留当前自定义拖动使用的定位与监视器权限 |
| P0.6 | `.github/workflows/check.yml` | Windows、Node 24、stable Rust、npm ci、同一 check 命令，配置 npm/Rust 缓存；隐藏窗口测试照常执行，失败不豁免 |

新增开发工具锁定为 Prettier `3.9.10`、ESLint `10.12.0`、`@eslint/js` `10.0.1`、typescript-eslint `8.71.2`、React Hooks ESLint 插件 `7.1.1`、globals `17.13.0`、Node 类型 `24.19.2`。安装时发现 ESLint 9 已停止支持，最终使用声明兼容 TypeScript 6 和当前 Node 环境的 ESLint 10 工具链。现有运行时依赖的锁定版本与完整性均未改变。

## 实际验证

统一入口为 `npm.cmd run check`，以下各检查均已在本机执行。最终从 `npm.cmd ci` 重新安装后，完整入口退出码为 0。

| 命令或场景 | 实际结果 |
| --- | --- |
| `npm.cmd ci` | 通过，锁文件可重新安装 |
| `npm.cmd run version:check` | 通过，npm/Cargo/Tauri 均为 `0.1.0` |
| `npm.cmd run format:check` | 通过 |
| `npm.cmd run lint` | 0 error、2 个登记 warning，数量上限为 2 |
| `npm.cmd run typecheck` | 通过，检查应用、未来 TS 测试范围与 Vite 配置 |
| `npm.cmd run build` | 通过，TypeScript 与 Vite 生产构建成功 |
| `npm.cmd test` | 30 通过，0 失败、0 跳过；保留 P0-A 的 29 项并新增版本门禁测试 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 通过，P0-A 已记录的格式差异已处理 |
| `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 通过 |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib --quiet` | 53 通过、2 个既有忽略、0 失败；新增实际 Tauri 编译版本测试 |
| 格式化等价核验 | P0-A 快照与纯格式化快照的 10 个 TS/TSX/MJS 文件转译 AST 一致；CSS 在忽略等价空白与小数写法后，选择器、声明值和覆盖顺序一致 |
| 既有运行时依赖核验 | 逐项比较阶段前后 package-lock 中原有运行时包的 version/integrity，未改变 |
| 审阅补丁回放 | 3 份补丁按阶段顺序重建当前文件，验证未丢失 P0-A 修改 |
| `git diff --check` | 通过 |

两项 Rust 忽略测试仍分别要求已登录 Codex 与真实 Codex 协议处理器；本次没有新增忽略项。隐藏 Win32 窗口测试包含在本地 Rust 测试中并通过，不能由此推断焦点、桌面动画或 CI 桌面会话已验收。

## 已登记 lint warning

规则均为 `react-hooks/set-state-in-effect`，仅在 `src/App.tsx` 中降为 warning；其他推荐规则保持原有检查等级，`rules-of-hooks` 等关键规则为 error。`--max-warnings 2` 阻止告警数量增长，没有使用 `--quiet` 或全局关闭 Hooks 规则。

| 位置 | 原因 | 后续处理 |
| --- | --- | --- |
| `src/App.tsx:279` | 展开期间 effect 合并保留 Result 的 setHeldResults | P1 的 useHeldResults 拆分时处理，保护 Rust 清理后展开 Result/Token 仍保留的语义 |
| `src/App.tsx:296` | Token 状态变化后 effect 同步更新时间 | P1 的局部计时与 Presentation 推导整理时处理，保护结果 3 秒及 Token ready 约 2.8 秒期限 |

## 行为差异与未验证项

- 本阶段没有改变状态机、Hook 协议、刷新周期、窗口尺寸、动画参数、颜色或显示文案。源码调整仅为版本元数据与等价 lint 整理。
- 前端不再拥有未使用的 close/startDragging 权限；当前自定义拖动使用 setPosition，后端托盘退出不依赖这两项前端权限。
- 本地已验证 Tauri 解析 package.json 版本的编译路径；没有构建或安装 NSIS，不声称安装包版本资源已实际验收。
- 新 Windows CI 已加入仓库配置，本次没有推送或触发线上 workflow；缓存命中、runner 工具环境及其隐藏窗口测试结果需在后续真实运行确认。若隐藏窗口测试因桌面会话失败，应明确排查，不能直接跳过或改为 continue-on-error。
- 未进行真实 Windows UI 截图/录屏对照或 Codex Hook 全链路验收；CSS/脚本结构等价和自动化测试不能证明画面流畅。P0-A 报告中的真实场景继续待验。
- `.test.mjs` 暂未迁移为 TypeScript；Node 仍执行现有测试集合，迁移执行器与类型范围属于 P1。

本阶段工程检查已通过。建议补充真实窗口和 Hook 验收后，按 P1 先提取纯函数与订阅 hooks，再逐步整理窗口编排和组件。本次按方案停在 P0。
