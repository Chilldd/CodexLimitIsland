# P3 契约与长期运行加固验收

2026-10-15。按用户“P2、P3 全部弄完”的要求，连续完成两阶段代码及可执行检查。P2 明细见 [P2 报告](p2-acceptance.md)；本阶段没有新增 Hook 鉴权或改变额度刷新周期。

## 修改

| 项目 | 文件与实现 |
| --- | --- |
| P3.1 类型契约 | Rust Activity model、UsageSnapshot/LimitWindow、TokenUsage 增加测试期 ts-rs 派生；`contracts.rs` 统一导出 11 个类型。`src/generated/contracts.ts` 直接被前端使用，原导出路径兼容；camelCase、枚举、null 和既有 JSON number 保持一致，内部 rootActivity 不导出 |
| 可复现生成 | `npm.cmd run contracts:generate` 更新；`contracts:check` 及统一检查中的 Rust 单测比较完整产物，漂移即失败。生成器格式固定，生成文件由 Prettier 忽略，不能手改 |
| P3.2 Win32 | windows-sys 提供窗口样式/结构/句柄、Region、ShellExecute、COM、标准流继承和进程标志定义；Common Controls subclass 保留系统导入库桥，参数使用官方 HWND/SUBCLASSPROC，兼容现有测试装载环境 |
| P3.3 HTTP | 固定 8 个 worker、16 个排队位置，超额 503；16KiB Header、1MiB Body，共享 1 秒整体读取期限，响应写入有界。重复 Content-Length、Transfer-Encoding、无效方法/路径、长度、JSON、事件均拒绝；400 后有限排空，避免 Windows 未读请求体使确认响应丢失 |
| P3.4 Token 缓存 | `useTurnTokenUsage(results, held)` 同时考虑 Snapshot、展开保留及在途查询；无引用且查询结束的键清理。卸载取消重试 timer 并唤醒等待，晚到 Promise 与 StrictMode 前一轮结果不能覆盖当前任务 |
| P3.4 拖动 | `positionWriter.ts` 仅允许一个原生移动请求在途；后续 RAF 覆盖最新目标，旧调用结束后发送最新值。失败可见，卸载清理尾随目标。运动算法 0.38、阈值、PointerCapture、点击抑制、DPI 和边界公式保持原规则 |

Shared token 鉴权在原方案中为条件性协议变更；本次保留既有可信 Hook 命令及接收协议，没有引入密钥生命周期、配置迁移或信任操作。30 秒等待校准与约 3 秒通知合并也保持原行为。

## 依赖与兼容

- ts-rs `12.0.1` 仅为 dev-dependency，最低 Rust 1.78；serde-compat 复用已有序列化注解。选择测试期导出是为了不将生成器带入 Release，也不额外耦合 Tauri 命令生成。
- tempfile `3.27.0` 为 dev-dependency，复用锁文件已有版本，测试数据只写独立临时目录。
- windows-sys `0.61.2` 复用锁文件已有版本，最低 Rust 1.71；仅 Windows 启用所需 API features。没有升级既有运行时包。
- 项目声明 Rust 至少 1.89，以使用标准库 OS 文件锁；实际最低版本仍受完整锁定依赖约束，本机验证为 Rust 1.96。
- 最初直接按官方绑定导入 subclass 导致测试程序装载失败（STATUS_ENTRYPOINT_NOT_FOUND）；仅将这组函数恢复为系统导入库桥后，原有隐藏窗口测试恢复通过。该兼容桥刻意保留，未用告警豁免或忽略测试掩盖。

## 自动化与量化记录

| 场景/操作 | 预期与实际结果 | 证据 |
| --- | --- | --- |
| 统一 `npm.cmd run check` | 版本一致、格式、零告警 lint、三个 TypeScript 范围、生产构建、Vitest、rustfmt、Clippy 与 Rust 单测全部通过 | 本次最终命令输出；下面列实际数量 |
| 前端回归 | 8 个测试文件、64 项通过；原 P1 的 58 项保留，新增缓存和位置写入测试 | `tests/tokenCache.test.tsx`、`positionWriter.test.ts`、既有 hooks/Presentation/Native Queue/Controller 测试 |
| Rust 回归 | 73 项通过、2 项原有忽略、0 失败；原 53 项有效测试全部保留 | 对应模块 `tests`，统一 Rust 命令 |
| 契约生成 | 运行 contracts:generate 成功，统一测试逐字校验生成结果、number 映射和内部字段排除 | `src-tauri/src/contracts.rs`、生成文件 |
| Token IO | 20000 行夹具首次读取 2,240,332 字节/102 个目录；5 次不变文件重试读取与目录遍历均为 0；原实现等价读取 11,201,660 字节 | `token_usage::tests::incremental_io_old_turns_partial_lines_and_relocation` |
| 旧 Turn 与损坏尾部 | 正确区分 taskTokens 与最新 sessionTokens；半行补齐后更新，移动/截断/删除与 Home 隔离通过；超大无关行有界跳过 | `token_usage.rs` 测试 |
| 同 Session 并发 | 8 个查询共享一次扫描；1000 个 Session 与 Turn 输入保持 64/128 项上限 | `token_usage.rs` 测试 |
| 前端长期缓存 | 1000 个完成 Turn 循环，Snapshot 移除但 held 存在时仍显示 Token，全部释放后缓存为 0；卸载后无重试 timer | `tests/tokenCache.test.tsx` |
| 拖动实际 hook 对照 | 同样 30 个 RAF 输入帧与未完成的原生替身：P1 在途 30 个、共发 30 次；P3 在途 1 个、释放后共发 2 次，最终位置均为 `[320,3]` | 本地 `p2-review.local/drag-benchmark.json`；对照运行原 P1 hook 与当前 hook |
| 窗口时序 | 原 App 展开保留、Result 到期后单次收起、尺寸/点击区请求计数与异常/反向时序均通过；Elapsed 仍只更新自身 | `tests/hooks.test.tsx`、`windowController.test.ts` |
| HTTP 资源 | 8 个阻塞 worker 与 16 个排队连接之外收到真实 TCP 503；释放后可处理完队列；非法 Header/Body 收到 400，空闲连接约 1 秒结束 | `hook/server.rs` 测试，随机本地端口 |
| Hook 兼容 | sender 原样转发未来未知事件 JSON；接收端明确拒绝；旧非 UUID 元数据仍可接收 | `hook/sender.rs`、`protocol.rs` 测试 |
| 日志并发/轮转 | 4 个测试进程 400 条追加完整；另 4 进程并发轮转保持 4096 字节测试上限和 2 份备份，日志无 secret/半行；轮转冲突与锁冲突可观察、可恢复 | `diagnostics.rs` 测试 |
| 原生 FFI | 原有无边框样式、激活消息、销毁顺序测试通过；新增隐藏窗口 Region 所有权与形状、测试文件句柄继承位清理通过 | `window/frame.rs`、`hook/sender.rs` Windows 测试 |

上述 RAF 测量使用真实 hook 与慢原生替身，证明请求合并和相同最终目标；不是用户桌面上的帧率、鼠标手感或原生移动耗时测量。CSS、Orb 和窗口 Morph 编排未作本阶段修改，沿用 P1 已保存的浏览器对照证据；本次没有重复运行整套浏览器场景。

## 审阅与未验证边界

P1 结束时、P2 结束时分别保存阶段快照；本地 `p2-review.local/05-p2.patch` 与 `06-p3.patch` 按顺序可重建最终文件，重放副本与当前工作区逐一比对。它们和性能证据由 `*.local` 忽略，不进入仓库；原 P0/P1 审阅补丁保留。未提交、暂存、推送、发布或修改真实用户 Hook 配置。

没有启动额外的真实 GUI，也未中断现有开发实例。真实 Codex Hook 信任/重启、托盘退出不复活、手动启动恢复、设置程序路径、真实 DPI/多屏/焦点、睡眠恢复、系统 Reduce Motion 与安装包仍需交互式验收；macOS/Linux 未运行。原有 2 项需要已登录 Codex 的测试继续忽略，远端 CI 与 NSIS 未运行。隐藏窗口和替身测试不能替代这些验证。
