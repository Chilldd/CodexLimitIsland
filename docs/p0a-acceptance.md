# P0-A 安全与行为基线验收记录

日期：2026-10-15。依据：[整改方案 v2](code-quality-refactor-plan.md)。本次只实施 P0-A，P0/P1/P2/P3 尚未开始。

## 基线与结果

- 分支：`main`；HEAD：`b7b051fe93b6d097d690336aa538107f231b0aea`，与方案审查基线一致。
- 开始时 `git status --short` 为空，没有覆盖原有未提交修改。
- 环境：Windows `10.0.22631`、PowerShell `7.6.3`。
- P0-A.1–P0-A.6 的代码和自动化保护已实现；真实窗口与真实 Codex Hook 验收尚未执行，不能认定完整端到端验收通过。
- 未提交、推送、合并、发布或构建安装包；未修改用户级 Hook 配置和信任设置。

## 文件与行为变化

| 文件 | 类别与目的 |
| --- | --- |
| `src-tauri/src/app_paths.rs` | BUGFIX：退出标记读取返回 Result，保留失败，不再转为“允许自动启动” |
| `src-tauri/src/lib.rs` | BUGFIX/TEST：自动启动读取失败拒绝运行；退出写标记失败保留 GUI 并弹窗；手动清除失败保留 GUI 并告知自动唤醒未恢复；开发专用 HitRegion 范围及测试 |
| `src-tauri/src/hook_sender.rs` | BUGFIX/TEST：有界状态行解析、总读取期限、连接失败与确认丢失分类、本地 TCP 假服务测试 |
| `src-tauri/src/activity.rs` | BUGFIX/TEST：最小 HTTP 接收测试入口、确认丢失和通知失败测试；已知 Turn Prompt 重发不重启任务；活动 Tool 重发保留前台顺序 |
| `src-tauri/src/diagnostics.rs` | BUGFIX/TEST：持久化详情只接受受控类别，外部错误和隐私路径不原样记录；防日志注入测试 |
| `src-tauri/src/codex_runtime.rs` | BUGFIX：自定义路径失效回退时不记录绝对路径 |
| `src/nativeOperations.ts` | REFACTOR/BUGFIX/TEST：提取原生队列、尺寸操作及交互计时器；交互版本和卸载守卫阻止旧操作继续提交 |
| `src/islandInteraction.ts`、`src/App.tsx` | REFACTOR/BUGFIX：接入可测试执行函数，集中选择 Live/Retained/Detail 视图；切换阶段释放旧收起操作引用 |
| `tests/nativeOperations.test.mjs` | TEST：16 项可控 Promise、假时钟、错误、卸载、Result 过期收起回归 |
| `AGENTS.md`、`README.md`、`docs/state-machine.md` | 同步失败处理、Hook 确认契约与交互守卫 |
| `docs/code-quality-refactor-plan.md`、本文件 | 保存原始方案与本次实际证据、剩余验收要求 |

有意修复的异常行为：

1. 退出标记读取失败不再启动 GUI；退出写入失败不再直接退出；手动清除失败不再静默声称自动唤醒已恢复。
2. HTTP 明确拒绝、无效响应、写入失败或确认超时不再触发 GUI 启动和盲目重发；尚未建连时的拒绝/超时仍允许检查退出标记后启动。Windows 未监听回环端口在短期限内也可能表现为建连超时。
3. 同一非空 Turn ID 的 Root Prompt 重发不再清空工具或重新生成结果；同一活动 Tool ID 重发不再覆盖其原始开始顺序。
4. 旧原生操作在状态绕回同名阶段后也会失效，等待 HitRegion 完成后不再错误结束新一轮交互；卸载后不再执行后续队列任务或完成交互状态更新。
5. Debug 构建额外允许 `384×550`；Release 上限仍为 `390×424`。既有颜色、CSS、文案与动画时间未调整。
6. 选定路径、外部错误原文不再写入持久化日志，日志保留阶段与受控错误类别；相关原生结果弹窗继续返回原始原因。

原有 `results_and_session_end_are_distinct` 测试的第二个合法任务原先重复使用 `turn-1`；现改为 `turn-2` 并保留原有完成/中断断言，与新增“同一 Turn 重发不复活”的行为一致。

## 命令验证

| 命令 | 原始基线 | 修改后实际结果 |
| --- | --- | --- |
| `npm.cmd run build` | 通过 | 通过，含 TypeScript 检查和 Vite 生产构建 |
| `npm.cmd test` | 13 通过 | 29 通过，0 失败、0 跳过 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib --quiet` | 41 通过、2 忽略 | 52 通过、2 忽略、0 失败 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 通过 | 通过 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 失败，存在已有格式差异 | 仍失败；本阶段未执行整仓格式化，留待 P0 独立处理 |
| `git diff --check` | — | 通过 |

前端命令在受限进程环境首次因 `spawn EPERM` 失败，随后在允许创建子进程的环境使用相同命令通过。Rust 既有两个忽略项分别需要已登录 Codex 和真实协议处理器；没有新增忽略测试。

## 回归矩阵与证据

表中测试函数名是可重复运行的证据位置；不包含真实会话或用户目录。

| 场景 | 方式与操作 | 预期与实际 | 结果与证据 |
| --- | --- | --- | --- |
| HOOK-04 | 临时标记读写/清除；注入读取、写入、清除失败；8 个并发启动判定 | 错误不变成成功；自动启动不清除标记；退出写失败不调用 exit | 自动化通过：`app_paths.rs`、`lib.rs::tests`；真实弹窗待验 |
| HOOK-05 | 假 TCP 服务分段返回 204、400、超长/非法状态行、断开、确认超时、未监听端口 | 分段 204 成功，其他情况有界失败；已建连错误不调用 start | 通过：`hook_sender.rs::tests` |
| HOOK-05 | Registry 已接收 Stop 后关闭写端；再次通知失败；第三次重发成功 | 前两次无 204，第三次 204，只有一个 Result | 通过：`http_processing_survives_lost_ack_and_notification_failure_without_false_success` |
| HOOK-05 | 顺序重复 SessionStart/Prompt/PreTool/PostTool/Stop/SessionEnd；组合缺 Turn/Tool ID | 同一链路最终保留一个结果；无工具残留；缺 Turn ID 的合法下一任务不被删 | 通过：`duplicate_hooks_after_lost_ack_keep_one_result_including_legacy_tools` 等 |
| WIN-03、TOK-02 | Result 已过期且 Rust 快照为空，仍保留展开视图；收起后解除尺寸等待 | Detail 保留 Result；Live 直接为 minimal；一次 `100×40` 点击区收缩 | 自动化通过：`nativeOperations.test.mjs`；真实动画录屏待验 |
| WIN-04 | 展开期间鼠标离开，假时钟推进 259/260ms，再进入取消计时 | 259ms 不收起；260ms 收起；重新进入取消旧任务 | 通过：`leaving during expansion waits 260ms...` |
| WIN-05 | 在尺寸或点击区 Promise 未完成时收起/再展开，含阶段绕回 | 新交互最终占优，旧操作不发 NATIVE_READY/ANIMATION_END | 通过：`collapse during expansion...`、`reexpand while collapse...`、`ABA interaction...` |
| WIN-06 | 原生尺寸/点击区失败；前次拒绝后再执行；等待期间卸载 | rejection 可观察；队列继续运行；卸载后不提交新状态 | 通过：`native queue serializes...`、`native ... rejection...`、`unmount...`、StrictMode 测试 |
| WIN-11 | 假时钟推进恢复时间；取消旧恢复、卸载后清理 | 普通 420ms，减少动态效果 190ms；取消后无回调 | 自动化通过；系统设置切换待验 |
| WIN-12 | 校验 compact、expanded 424、Debug 550、NaN/Infinity/越界 | Release 不放宽，只有 Debug 精确例外允许 550 | 范围测试通过；20 场景点击待验 |
| WIN-02/08/09、TOK-02 | 保留并运行原 Presentation 与 Interaction 测试 | 审批、排序、Token 到期与展开保留行为不回归 | 通过：原有 `tests/islandState.test.mjs` 13 项 |
| 日志隐私 | 输入虚构 Windows/Unix 路径、Session/Token/提示词和换行内容 | 持久化详情只返回受控类别 | 通过：`diagnostics.rs::tests::untrusted_errors_never_reach_persistent_details` |

## 尚未执行的真实验收与剩余风险

当前未通过原生 GUI 自动化控制应用，也未改变用户现有 Hook/信任环境。以下需要已信任命令的真实 Windows 运行验收，不能由单元测试替代：

- WIN-01/02/07/08/12：打开 `?debugIsland`，点击全部 20 个场景，检查文案、Orb、详情、导航与 DebugSwitcher 点击区域。
- WIN-03/04/05/06：录制 Result 到期后收起、展开中离开、收起中再展开；确认无额外宽紧凑形态、裁切或跳动。自动化只证明调用和模型顺序，不证明画面平滑。
- WIN-10/11/13：跨屏拖动与 DPI、系统减少动态效果开关、焦点、托盘显示/隐藏、睡眠恢复。
- HOOK-01/02/03/06：已信任 Hook → 重启 Codex → 发送任务 → HTTP 204 与 UI → Token → 托盘退出后事件不唤醒 → 手动启动恢复；并发 Hook 自动启动最终只有一个 GUI 实例。退出标记真实权限失败时也需检查提示窗口。
- TOK-01、LOG-01/02：Token 大文件性能和日志目录迁移/轮转属于 P2，尚未实施或验收；本阶段日志仍位于原位置，没有大小上限。

缺少 Turn ID 的 Prompt 无法可靠区分“新任务”和“历史重发”；缺少 Tool ID 的旧 Hook 也不能承诺跨事件乱序幂等。同一已结束 Tool 的 Pre 重放未引入历史事件缓存。为避免误删合法事件，本阶段不添加时间窗口去重；sender 建连后确认丢失即报告错误，不自动重发。Registry 清理后也不承诺永久去重。

下一阶段建议：先补真实窗口和 Hook 验收；P0 再独立引入格式化、静态检查与统一质量门禁，避免与本次 BUGFIX 混杂。本次到此停止。
