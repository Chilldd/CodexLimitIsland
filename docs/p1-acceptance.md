# P1 前端模块化与动画时序验收记录

日期：2026-10-15。依据：[整改方案 v2](code-quality-refactor-plan.md)。P1.1–P1.7 的代码、自动化检查和浏览器模拟回归已完成；真实 Tauri 窗口与 Hook 联调尚未验收。P2/P3 尚未开始。

## 基线与范围

- 在 P0 完成后的 67 文件快照上实施，保留此前所有未提交修改。分支为 `main`，HEAD 仍为 `b7b051fe93b6d097d690336aa538107f231b0aea`。
- 本阶段未改变运行时依赖的 5 个锁定包版本及完整性；33 个 Rust 工程文件与 P1 开始时逐字节一致。新增依赖只用于测试。
- P1 独立审阅补丁保存为 `p1-review.local/04-p1.patch`，以 P0 结束时快照为基线；此前 P0 的三份审阅补丁保持不变。补丁与浏览器证据目录由已有 `*.local` 规则忽略，不进入仓库。
- 未提交、暂存、推送或发布，未修改用户级 Hook 配置或信任设置，未启动额外的真实 GUI 实例。

## 实现

| 范围 | 主要文件 | 结果 |
| --- | --- | --- |
| 纯函数与尺寸 | `src/domain/format.ts`、`metrics.ts` | 移出格式化、尺寸计算和时序常量，保留原数值与格式规则 |
| 数据订阅 | `src/hooks/useUsage.ts`、`useActivity.ts` | 保留首次读取与事件竞态守卫，清理晚到的监听注册，阻止卸载后的回调写入 |
| 展示与结果保留 | `src/islandState.ts`、`useHeldResults.ts`、`useIslandPresentation.ts` | 集中输出类型化 headline、rows、meta、额度与 ARIA 文案；在 expanding/expanded/collapsing 期间保留 Result，compact 后释放 |
| 交互与原生窗口 | `useInteractionMachine.ts`、`useIslandWindow.ts`、`src/windowController.ts`、`nativeWindow.ts`、`nativeOperations.ts` | reducer 配合同步 ref，注入原生接口；保留串行队列、版本失效、await 后守卫、收起去重与异常恢复 |
| 拖动与导航 | `useHorizontalDrag.ts`、`useSessionNavigation.ts` | 保留 0.38 运动算法、PointerCapture、阈值、DPI 与边界转换、RAF、点击抑制；导航防重入并保留忙碌、错误和成功收起行为 |
| UI | `src/components/*`、`src/App.tsx` | App 负责装配；Session 与 Result 共用 SessionRow；Orb、详情、额度、Elapsed 和 Debug 控件各自负责渲染 |
| CSS | `src/styles/tokens.css`、`src/App.css` | 合并重复根选择器声明，集中颜色、尺寸和 motion 变量；保留 layout/expanded/attention/feedback 维度和 Orb 64px 画布的 scale(.75) |
| 局部计时 | `Elapsed.tsx`、`useIslandPresentation.ts`、`useReducedMotion.ts` | Elapsed 秒级刷新只更新文本组件；Result 使用下一到期时间的一次性计时器；减少动态效果设置支持运行中变化及卸载清理 |
| Token 与调试 | `useTurnTokenUsage.ts`、`useDebugPresentation.ts` | 移动原 Token hook，保留查询键、重试间隔和缓存语义；生产构建移除 Debug 场景代码 |
| 测试与工程配置 | `tests/*.test.ts(x)`、`vitest.config.ts`、`tsconfig*.json`、`eslint.config.mjs`、`scripts/check-versions.ts`、`package*.json` | 原 MJS 测试和版本脚本迁移为 TypeScript；应用、配置脚本与测试均做类型检查；移除 App 的 effect 告警例外，lint 要求零告警 |
| 文档 | `README.md`、`AGENTS.md`、`docs/state-machine.md`、阶段方案与本报告 | 同步当前入口、职责、命令、测试和验收边界 |

保留展开顺序：先放大原生窗口、设置点击区，再显示 expanded。收起先播放 Morph，之后缩小原生窗口。参数仍为 Morph 340ms、离开延迟 260ms、普通兜底 420ms、减少动态效果兜底 190ms。原生 await 未完成、快速反向操作和组件卸载仍受队列版本及生命周期守卫保护。

收起恢复已设置相同点击区时，不再因 React 随后的 compact 提交重复调用。Result 保留从 expanding 开始，避免原生放大尚未完成时 Registry 清理造成详情丢失。上述边界均有实际 hook/控制器测试。

## 自动化验证

最终 `npm.cmd run check` 返回 0：

| 检查 | 实际结果 |
| --- | --- |
| 版本一致性 | npm / Cargo / Tauri 均为 0.1.0 |
| Prettier、rustfmt | 通过 |
| ESLint | 通过，零告警 |
| TypeScript | 应用、配置与脚本、测试三个范围通过 |
| Vite 生产构建 | 通过；单个主 JS 产物，无 Debug 场景分块 |
| Vitest | 6 个文件、58 项测试通过 |
| Clippy | `--locked --all-targets -- -D warnings` 通过 |
| Rust 单元测试 | 53 项通过，2 项原有忽略，0 失败 |

测试覆盖原有 Presentation/Interaction/Native Queue 断言，并增加实际窗口编排、订阅竞态、StrictMode、晚到清理、结果保留、Token 查询身份、到期计时、Elapsed 局部更新、减少动态效果、拖动、导航及 App 集成。尺寸契约测试读取 CSS、Tauri 配置和 Rust 边界，检查 96/200 可见宽度、100/204 点击区、2px 内边距、380/384 展开宽度及 420/424 高度关系。

开发测试工具固定为 Vitest 5.0.4、jsdom 30.1.2、Testing Library React 16.3.3 / DOM 10.4.2；Node 要求 24.15+ 的 24 系列或 26+，本机为 24.18.0。

工作区原地 `npm.cmd ci` 因现有开发进程占用 Rolldown 模块而中断；随后 `npm.cmd install --ignore-scripts` 恢复依赖，最终统一检查通过。保留原开发进程，在独立目录从零执行 `npm.cmd ci` 成功，并再次完成三个 TypeScript 范围的检查、生产构建和 58 项测试。Windows 仍占用的旧模块清理目录留待原开发进程退出后由包管理器清理。

## 浏览器模拟回归

使用虚构数据和本地原生接口替身，未连接真实 Hook、额度或会话。以下证据保存在本地忽略目录 `p1-review.local/`：

- 基线与当前版本各检查 20 个 Debug 场景的 compact/expanded，共 40 组状态；比较布局、字体、颜色、尺寸、transition 和 Orb 缩放等计算样式，差异为 0。证据为 `baseline-styles.json`、`current-styles.json`、`style-differences.json`，并保存 thinking/completed/multi 对比截图。
- 在实际 390×550 浏览器视口逐项点击 20 个场景，全部可渲染；记录为 `native-size-scenarios.json`。最终预览为 [final-preview.jpg](../p1-review.local/final-preview.jpg)。
- 展开 completed Result，等待紧凑态到期，再模拟 Registry 清理并离开岛区域。保留的 Result/Token 持续显示至收起；记录 1 次高度 transition、66 次 DOM 尺寸采样，尺寸从 380×204 单调收至 96×36，没有额外中间目标。原生替身仅记录 1 次窗口恢复，最终点击区为 100×40。证据为 `collapse-frames.json`、`collapse-native-calls.json`、`collapse-verification.json`。
- 另录制浏览器实际画面的 48 张 screencast 帧，去掉操作前等待帧后，按时间戳编码成 45 帧的 [collapse-recording.mp4](../p1-review.local/collapse-recording.mp4)。`screencast-012.jpg` 可查看收起中间画面；`screencast-frames.json` 保存时间戳。`collapse-middle.jpg` 捕获时已完成收起，不作为中间帧证据。

本阶段创建的浏览器页面已关闭，临时视口已恢复，专用 Vite 验证服务已停止。独立安装验证目录和阶段快照在补丁重放检查后清理；本地审阅补丁、基线模拟页面及截图/视频作为回归证据保留。

## 剩余验收与下一阶段

浏览器替身与自动化测试不能证明 Windows 原生点击穿透、透明裁切、多显示器真实 DPI/边界、焦点行为或系统减少动态效果设置的实际联动。真实 Hook 还需在 Codex 已信任命令并重启后发送消息，检查本地 HTTP 响应、状态/Token 和界面变化；用户配置及信任操作仍由用户明确授权后进行。

本阶段未构建 NSIS 安装包，也未运行远端 CI。P2 的 Rust 模块化、日志及 Token IO 优化，P3 的契约和缓存治理均未开始。下一步按阶段方案实施 P2；本次停在 P1。
