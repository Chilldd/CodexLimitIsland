# Codex Limit Island 代码质量整改执行方案（Codex 执行版 v2）

> 2026-10-15：P0-A、P0、P1、P2、P3 的代码与自动化验证已完成；真实 Tauri 窗口、托盘与 Hook 信任链路仍待交互式验收。详见 [P0-A](p0a-acceptance.md)、[P0](p0-acceptance.md)、[P1](p1-acceptance.md)、[P2](p2-acceptance.md)、[P3](p3-acceptance.md) 阶段报告。P3 共享 token 鉴权和刷新周期调整属于可选协议/行为变更，本次保留原协议与刷新周期。原清单保留作为完整验收要求。

> **执行对象**：`Chilldd/CodexLimitIsland`（Tauri 2 + Rust + React + TypeScript）  
> **原始审查基线**：`b7b051fe93b6d097d690336aa538107f231b0aea`，2026-10-15  
> **依据**：原《代码质量评估与整改方案》、仓库对应源码、`AGENTS.md`、`docs/state-machine.md` 及补充审查意见  
> **文件用途**：可以直接放在仓库 `docs/code-quality-refactor-plan.md`，交由 Codex 按阶段实施和验收  
> **重要说明**：本文件中“现状问题”基于上述提交的静态审查；Codex **必须重新检查当前 HEAD**。原审查文档记录的测试结果不等于本次已经运行的测试结果。若代码已变更，以当前代码核实是否仍存在问题，不重复修复。

---

## 0. 给 Codex 的执行指令（先读这里）

你是本仓库的执行工程师。目标是**在保持现有状态机、Hook 行为和灵动岛视觉体验的前提下，修复确定的可靠性问题，建立自动化质量保障，并逐步完成前后端模块化重构**。

**执行要求：**

1. 阅读仓库根目录 `AGENTS.md`、`README.md`、`docs/state-machine.md` 和本文档，检查 `git status --short`、`git rev-parse HEAD` 与当前分支。不要覆盖用户未提交的修改。检查当前版本与 `b7b051f` 是否一致；如不一致，先核实下列问题是否仍存在，再执行对应任务。
2. **默认每次只执行一个阶段**：`P0-A` → `P0` → `P1` → `P2` → `P3`。每阶段验收后停止并报告，等待用户下达“继续 P0/P1/P2/P3”。如果用户明确要求连续执行全部阶段，则每完成一个阶段都要运行该阶段验收，并把不同阶段变更分开记录。
3. 一个阶段内部按照文档编号执行。先补测试与可复现基线，再改生产代码，再做回归；高风险修改必须小步实施。若必须临时新增辅助抽象来测试现有代码，应确保对外行为不变。
4. **未经用户明确授权，不提交、推送、合并、发布、不修改本机用户级 `~/.codex/hooks.json`、不自动重置信任配置。** 可以修改仓库内测试、文档和代码；需要真实 Hook 配置操作时列出人工验证步骤。
5. 遵守隐私约束：禁止输出或写入提示词、工具参数、工具结果、登录令牌、真实 Session ID、用户工作目录和可识别个人信息。测试使用虚构 ID 与临时目录。原生错误消息可能携带路径，写日志前要审查、筛选或脱敏。
6. 每完成一个阶段，必须汇报：变更文件、为何修改、行为差异（若有）、执行过的验证命令及实际结果、未验证项与原因、残余风险、下一阶段建议。不允许把“编译通过”等同于“真实窗口/Hook 已验收”。
7. **不为满足文件长度指标而人为拆碎代码**，不引入不必要的全局状态库、CSS 框架、异步 HTTP 框架或全套架构重写。模块职责和可测试性优先。
8. 不确定的外部协议行为必须先查当前仓库与测试，不可用猜测修改事件、Token 语义或 Codex 信任机制。发生安全或正确性冲突时优先保持安全，明确报告与原行为的差异。

**推荐首条 Codex 指令：**

```text
请阅读 AGENTS.md、docs/state-machine.md 和 docs/code-quality-refactor-plan.md。
按照文档“0. 给 Codex 的执行指令”开始，仅执行 P0-A。
先确认当前 HEAD 与基线差异，补测试并修复确定的问题，运行可执行的验收。
不要提交、推送、发布、修改用户级 Hook 配置；完成后给我阶段验收报告和剩余风险，然后停止。
```

---

## 1. 任务目标、边界和验收标准

### 1.1 保留的核心架构

```text
Codex Hook JSON
   └─ codexlimit --hook（同一可执行文件，sender）
       └─ HTTP 127.0.0.1:17321/api/codex/hook
           └─ Rust normalize → reducer → registry → ActivitySnapshot
               └─ Tauri activity-updated / read_activity
                   └─ TypeScript deriveIslandPresentation()（纯函数）
                       └─ React Interaction reducer（compact/expanding/expanded/collapsing）
                           └─ DOM/CSS + 原生窗口尺寸 / HitRegion 编排

Codex app-server → UsageSnapshot → usage-updated / read_limits → Presentation
Completed Turn Result → read_token_usage(sessionId, turnId) → TokenUsageState → Presentation
```

以下是必须保持的设计约束：

- 领域状态分维度维护：`Lifecycle / Activity / Attention / Result / Token / Presentation / Interaction`；禁止增加万能状态枚举。
- Rust 会话变化仅由 `reduce_session()`（或提取后的同一逻辑入口）驱动；Registry 负责过期与索引。前端不得重复实现 Session stale 逻辑。
- `deriveIslandPresentation()` 保持**纯函数**，集中管理显示优先级、活动文案、Orb 映射；React 层仅负责订阅、交互、窗口管理与渲染。
- **Completed Turn 的 Token 查询只能由 Result 驱动**，按 Session ID + Turn ID 定位；不得改成由 Session Activity 驱动或把当前会话总 Token 当成本次任务 Token。
- 会话活动、权限审批与结果反馈独立；Result 在展开期间保留，Rust Registry 过期后也不能突然清空展开中的内容与 Token。
- Hook 仍使用**一个 exe 的 `--hook` / `--auto-start` 模式**；托盘明确退出后禁止 Hook 自动唤醒，直到用户手动启动恢复。
- 维持 `runNative` 对窗口尺寸和 HitRegion 的顺序控制，不能使旧异步操作覆盖新交互状态。
- 不改变页面既有视觉尺寸、颜色、文案和动画时序，除非某项任务明确标记为**行为修复**或**独立体验优化**且完成相应对比。
- 当前 Windows 是已验证的运行目标；macOS/Linux 只做不破坏兼容的代码组织，不声称已经运行验证。

### 1.2 变更类别必须明确标记

| 类别 | 含义 | 是否允许混入纯重构提交 |
| --- | --- | --- |
| `REFACTOR` | 移动代码、命名、注入依赖、格式化，不改变对外可观察行为 | 可以，但格式化应单独处理 |
| `TEST` | 新增行为约束、失败注入、测试辅助与 CI | 可以 |
| `BUGFIX` | 修复现有错误，可能有意改变异常情况下的行为 | **不允许**与大规模格式化/移动代码混在一起 |
| `BEHAVIOR` | 刷新周期、缓存策略、视觉动画、兼容协议变化 | **必须独立**，写明旧新行为并验收 |
| `HARDENING` | 安全限制、鉴权、资源限制、日志策略 | 尽量独立，验证兼容性 |

### 1.3 全局完成条件

- Windows 开发环境：前端构建、TS 检查、单元测试、Rust fmt、Clippy、Rust 单元测试均通过；新增的检查进入统一命令与 CI。
- `AGENTS.md`、`README.md`、`docs/state-machine.md` 与最终真实行为一致。
- 现有测试保持通过，并新增覆盖关键失败路径与窗口交互时序的测试；不能靠删除/跳过有价值的现有测试取得通过。
- 原有 `?debugIsland` 的 20 个场景可正常打开与交互，既有状态显示无意外差异；对有意修改项保留前后说明与截图/录屏。
- 使用真实 Windows 环境检查 Hook 的信任→重启→发送→HTTP 204→UI 更新链路，手动退出与自动启动链路；若当前环境无法运行，**明确标为“未执行真实验收”**。
- 对动画至少完成第 8 节时序用例；不得只用静态截图替代中间态验证。
- 无敏感内容进入持久化日志；日志大小有上限；错误可定位。

---

## 2. 经基线核对的问题清单（当前 HEAD 必须再次验证）

| ID | 严重性 | 现状及依据 | 去向 |
| --- | --- | --- | --- |
| `A1` | 高 | `app_paths.rs` 读取退出标记失败后返回 `false`，即允许自动启动；托盘写标记失败仍 `exit` | P0-A |
| `A2` | 高 | Hook 在 Registry 更新后才写 HTTP 204，响应丢失/超时可能使已处理事件被视为失败；缺少端到端幂等/失败测试 | P0-A |
| `A3` | 高 | `App.tsx` 的原生窗口异步队列没有可控 Promise 顺序测试；此前出现过宽紧凑→窄紧凑二次收缩 | P0-A / P1 |
| `A4` | 中 | 开发调试 `?debugIsland` 请求 HitRegion `384×550`，Rust `set_window_hit_region` 校验最高高度 `424`，存在确定的范围不一致 | P0-A |
| `A5` | 中 | 已有日志调用会输出所选 `codex.exe` 的绝对路径，错误文本也可能包含私人路径 | P0-A / P2 |
| `F1` | 高 | `src/App.tsx` 同时处理订阅、交互、尺寸、拖动、导航、渲染 | P1 |
| `F2` | 高 | App 中还有项目名、Meta、子代理计数、ARIA 文案等展示规则 | P1 |
| `F3` | 高 | `src/App.css` 压缩且结尾大量重复覆盖 | P0 / P1 |
| `F4` | 中 | 窗口宽度/高度/HitRegion 在 TS、CSS、Rust、配置中存在隐式耦合 | P1 / P2 |
| `F5` | 中 | `now` 每秒驱动整棵 `App` 更新；两次 Presentation 推导；未订阅 reduced-motion 变化 | P1 |
| `F6` | 低 | Token Hook 状态容器持续增长；`.mjs` 测试未被 TS 直接检查 | P1 / P3 |
| `R1` | 高 | `lib.rs` 混合启动、AppServer、额度、托盘、FFI、窗口等 | P2 |
| `R2` | 高 | `activity.rs` 混合 HTTP、协议、reducer、registry、命令 | P2 |
| `R3` | 高 | Hook 事件多处以裸字符串匹配，分支有 `unwrap()` | P2 |
| `R4` | 中 | `SERVER` / `USAGE_EVENTS` / `REGISTRY` 使用全局 `OnceLock`；存在反向跨模块调用 | P2 |
| `R5` | 中 | 协议常量、版本、会话 ID 验证重复且不一致 | P0 / P2 |
| `R6` | 中 | release 的 `eprintln!` 难以用于排障，日志位于 exe 附近且不轮转 | P2 |
| `R7` | 中 | README/AGENTS 写 5 分钟，但代码 `recv_timeout(30s)` 实际约每 30 秒刷新 | P0 |
| `R8` | 中 | Token 查询递归扫描 `~/.codex/sessions`，多次读取完整 JSONL | P2 |
| `R9` | 低 | 手写 Win32 FFI、多处手工 TS 类型、过宽权限、测试临时目录代码重复 | P0 / P2 / P3 |
| `H1` | 中 | 每个 Hook TCP 连接独立 `thread::spawn`，无并发数量上限；读请求头使用逐字节读取 | P3 |
| `H2` | 低 | `hook_sender.rs` 的响应读取一次最多 64 字节，若 TCP 只返回部分状态行存在误判风险 | P0-A |
| `M1` | 中 | 拖动每帧 `setPosition`，不等待前次完成，可能造成调用积压或位置回跳 | P3 |

原文中对 `App.tsx` 行数、CSS 行数、fmt 差异、原有测试数的描述，只是 `b7b051f` 的快照，不能直接当作新版本的事实。

---

## 3. P0-A：安全与行为基线（**第一个执行阶段**）

> 本阶段优先修复确定的可靠性缺口，给后续重构建立可以重复执行的保护测试。**本阶段包含明确标记的 `BUGFIX`，不要与格式化合并。**

### P0-A.1 仓库及现有验证基线

- [ ] 读取 `AGENTS.md`、README、状态机文档；记录当前 commit、工作区状态与操作系统；如果存在用户未提交修改，隔离自己的变更且不覆盖。
- [ ] 执行可用的现有测试，记录实际结果：

  ```powershell
  npm.cmd run build
  npm.cmd test
  cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
  cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
  cargo test --manifest-path src-tauri/Cargo.toml --lib
  ```

- [ ] 如果 `cargo fmt --check` 失败，**当前阶段记录即可，不要顺手格式化**，留在 P0 独立处理。
- [ ] 建立回归用例清单；不能用“测试绿了”代替完整行为验证。

### P0-A.2 修复退出标记失败时的行为 `A1`【BUGFIX】

**涉及文件**：`src-tauri/src/app_paths.rs`、`src-tauri/src/lib.rs`、关联测试。

- [ ] 不再将读取退出标记失败映射为“未禁止自动启动”。让内部读取接口表达 `Result<bool, Error>`；自动启动遇到读取错误时**保守拒绝启动**并记录可诊断的、不含私人路径的信息。
- [ ] 托盘执行“退出”时，如果持久化退出标记失败，**不得静默退出并假装能够阻止重新唤醒**。建议保留 GUI、显示明确的原生错误提示，允许用户在排除故障后重试；记录该异常路径是有意的行为修复。
- [ ] 手动启动清除标记失败时，不得宣称 Hook 自动唤醒已恢复；保留手动 GUI 可用性，并给出可操作的错误提示。
- [ ] 禁止因“Hook 到来”直接清除退出标记；保留启动来源 `Manual / AutoStart / Hook` 的语义与当前单 exe 方案。
- [ ] 加测试：标记不存在；读取失败；成功写入并退出；写入失败；自动启动被阻止；手动清除成功/失败；多次自动启动并发。使用临时路径，避免操作用户真实配置。

**通过标准**：明确退出后不可被 Hook 唤醒；标记读取失败时同样不自动启动；出错时可感知，而不是静默吞掉。

### P0-A.3 Hook HTTP 发送/确认/重试测试 `A2/H2`【TEST + 必要 BUGFIX】

**涉及文件**：`src-tauri/src/hook_sender.rs`、`src-tauri/src/activity.rs`（后续 P2 才拆分）。

- [ ] 为 HTTP 发送端构造本地假 TCP 服务，测试正常 `204`、`400`、连接拒绝、连接超时、响应中途断开、状态行分段到达、响应超时。
- [ ] 验证超时/拒绝的区别：只有监听不可用才尝试自动启动；明确的拒绝不得触发无意义的 GUI 自动启动。
- [ ] 覆盖“服务端已更新 Registry，但客户端未收到 204”情况，并测试重复发送 `SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop / SessionEnd` 的结果（包含旧版缺少 `tool_use_id` 的事件）。
- [ ] 明确哪些操作本身幂等，哪些需要基于事件身份/Turn 守卫做有限去重；**不要凭空添加短时间去重而误删合法事件**。若修复，保留子代理、迟到 Turn 的现有语义。
- [ ] 响应解析不能依赖单次 `read()` 恰好得到完整状态行；采用有上限、受超时控制的状态行解析，避免错误读取造成误判。
- [ ] HTTP 处理成功应仅表示服务端已经按定义接收/处理，不应让客户端把已确认失败当成成功；对于“Registry 已更新但通知失败”明确记录并测试允许的重试结果。
- [ ] 测试同一时间多个 Hook 尝试自动启动：最终只应有一个 GUI 实例处理事件；如果无法在单元测试中完整模拟，应列入 Windows 端到端回归。

**通过标准**：确认、重试、异常和重复事件都有可重复运行的测试；既不会重复产生错误 Result，也不会吞掉合法事件。

### P0-A.4 原生窗口/交互时序测试 `A3`【TEST】

**涉及文件**：`src/App.tsx`、`src/islandInteraction.ts`、测试目录；允许最小范围提取可测试函数，但不在此阶段大规模拆组件。

- [ ] 用可注入的假 `setSize`、`setHitRegion`、`setPosition`、时钟、计时器测试顺序；如当前结构难以测试，先抽出最小的原生操作队列，不改时序。
- [ ] 断言 `runNative` 串行：后续操作不会早于前次完成；前次失败不阻塞后续操作；错误仍可报告，不被错误处理链误吞掉。
- [ ] 覆盖快速展开/收起、收起期间再展开、`await setSize` 后用户改变交互状态、`await setHitRegion` 后状态变化、原生 API 抛错、组件卸载后的未完成操作。
- [ ] 为“**Completed 展开 → Result 过期 → 鼠标移开 → 只出现一次平滑收缩**”加入明确回归。校验 `liveView` / `retainedView` / `detailView` 与窗口目标尺寸的配合。
- [ ] 记录 `MORPH_MS=340`、`AUTO_COLLAPSE_DELAY_MS=260`、收起窗口恢复延迟（现代码为 `MORPH_MS+80` 或 reduced-motion 190ms）等当前行为。不要在这个阶段调动画参数。

**通过标准**：所有测试可通过控制 Promise 完成顺序稳定复现；保留旧操作不覆盖新状态的约束。

### P0-A.5 修复 Debug HitRegion 高度不一致 `A4`【BUGFIX】

**涉及文件**：`src/App.tsx`、`src-tauri/src/lib.rs`、Debug/窗口尺寸相关测试。

**已确认的基线矛盾**：开发调试代码设置窗口高度 `550`，`setHitRegion()` 在 Debug 下强制请求 `384×550`，Rust `set_window_hit_region` 却要求高度 `40..=424`。

- [ ] 核实当前 HEAD 是否仍存在该范围不一致。
- [ ] 若存在，修正 Debug 专用 HitRegion 校验/调用路径，使 `?debugIsland` 能正常交互。**不得直接把 Release 正常窗口的校验上限放宽到 550**；应限定开发配置或专用调试情形。
- [ ] 为正常 compact、expanded 最大 `420+4`、开发调试 `550`、非法尺寸加测试。
- [ ] Windows 手动验证 DebugSwitcher 所在区域确实可点击，并能切换全部 20 个场景。

### P0-A.6 日志隐私快速修复 `A5`【BUGFIX】

**涉及文件**：`src-tauri/src/lib.rs`、`src-tauri/src/diagnostics.rs` 与调用日志的文件。

- [ ] 处理 `choose_codex_path()` 成功保存后把 `path.display()` 写日志的问题。
- [ ] 检查所有日志调用的 `Some(&error.to_string())`，重点识别可能包含本机路径、会话标识、Token、提示词的内容。必要时用错误类别或受控上下文替代原文。
- [ ] 保留错误可诊断性；展示给用户的原生弹窗可依据实际场景显示其主动选择的路径，但不能把它写入持久化日志。
- [ ] 添加最小日志脱敏/不含隐私字段测试；完整日志迁移与轮转留待 P2。

### P0-A 阶段验收

- [ ] 当前环境可运行的原有测试均通过；新增失败路径测试全部通过。
- [ ] 逐项标记 `BUGFIX` 引入的有意行为差异。
- [ ] `docs/state-machine.md` 如果涉及交互时序改变，则同步更新；若保持行为不变无需重新设计图。
- [ ] 执行第 8 节中的高风险用例；无法进行原生 Windows 测试时如实记录。
- [ ] **完成后停止，不擅自开始 P0。**

---

## 4. P0：工程化规范与自动质量门禁

> 此阶段主要是 `REFACTOR / TEST`。格式化与代码逻辑更改分批完成，方便审阅。

### P0.1 文件与行尾

- [ ] 新增 `.editorconfig`（UTF-8、LF、末尾换行；Markdown 换行按需要处理）与 `.gitattributes`，建议以 `* text=auto eol=lf` 为基础，并考虑二进制文件和 Windows 脚本例外。
- [ ] 为 Git 明确规范化规则，避免无意义的整仓行尾变化；记录 Windows 开发环境可使用 `npm.cmd`。

### P0.2 Rust 格式化（单独变更集）

- [ ] 新增 `rustfmt.toml`，`max_width = 120`（以实际 stable rustfmt 支持为准），执行 `cargo fmt --manifest-path src-tauri/Cargo.toml`。
- [ ] 只格式化，不修改逻辑、测试断言或函数职责；审阅 diff 时额外检查格式化未意外覆盖用户修改。

### P0.3 前端 Prettier（单独变更集）

- [ ] 引入 Prettier、配置和 `format`/`format:check` 脚本，建议 `printWidth: 120`。
- [ ] 先只格式化 `src` 与已确认需要的配置/测试文件，不无差别重写第三方或生成内容。
- [ ] `App.css` 目前压缩且多层覆盖，**本阶段只格式化，不擅自删除可能影响视觉的覆盖声明**；真正的 CSS 等价合并放到 P1。

### P0.4 ESLint、类型检查和测试命令

- [ ] 使用 ESLint Flat Config + `typescript-eslint` + `eslint-plugin-react-hooks`，覆盖 `src` 与 TypeScript 测试。
- [ ] 初次引入允许记录现有 warning 清单，但不可永久以 `--quiet` 或禁用全部核心规则掩盖问题。之后逐项修复，并将关键规则逐步升级为 error。
- [ ] 建立 `typecheck`、`lint`、`test`、`format:check`、`check`。`check` 应执行前端 TS、构建与测试、格式化与 lint、Rust fmt、Clippy 和 Rust tests；无需每次运行打包安装器。
- [ ] 在 `README.md` 中记录跨平台命令与 Windows PowerShell 的 `npm.cmd` 用法。

**示例命令（按照真实 `package.json` 脚本落地，不应直接复制不适用的占位脚本）：**

```powershell
npm.cmd run check
npm.cmd run build
npm.cmd test
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

### P0.5 版本号与刷新间隔

- [ ] 将 `src-tauri/tauri.conf.json` 的 `version` 配置为读取 `../package.json`（若当前 Tauri 版本实际支持该用法，先检查构建）。
- [ ] `lib.rs` 的 app-server `clientInfo.version` 改用 `env!("CARGO_PKG_VERSION")`，确保和构建中 Cargo 版本一致。
- [ ] `Cargo.toml` 的 package 版本仍可能与 npm 版本漂移；新增**版本一致性校验脚本或测试**，用于校验 Cargo / npm / 实际 Tauri 构建版本，不要声称仅改 Tauri 配置就完成“单一来源”。
- [ ] **暂时保留源码现有约每 30 秒周期校准**；把 README 与 AGENTS 中“每 5 分钟”更正为当前真实行为，并注明有事件触发刷新和通知合并逻辑。改变为 5 分钟属于独立 `BEHAVIOR` 任务，**没有用户授权不要修改运行频率**。

### P0.6 Tauri 最小权限及 CI

- [ ] 审查 `src-tauri/capabilities/default.json`：确认没有前端实际使用 `allow-close`、`allow-start-dragging` 后再移除。
- [ ] 新增或完善 GitHub Actions Windows CI：至少包括 `npm ci`、前端测试/构建、Rust fmt/Clippy/test；可按项目构建工具环境选择合理缓存与步骤。
- [ ] Windows 原生隐藏窗口测试若受 CI 桌面会话限制，应单独说明/分组，不允许因为 CI 无 UI 就宣称 FFI 已验证。

### P0 阶段验收

- [ ] 全部适用的 `check` 命令通过；首次引入 lint 的残余 warning 必须记录具体位置与数量。
- [ ] 格式化变更和逻辑修复互不混淆；前后 UI 视觉对照无意外差异。
- [ ] 当前 README、AGENTS 与实际 30 秒刷新周期一致。
- [ ] 版本检查覆盖三处版本，而非只覆盖 Tauri/npm 两处。
- [ ] **完成后停止，等待 P1 指令。**

---

## 5. P1：前端模块化与动画时序保护

> 风险高于 P0。建议依次 **纯函数 → 数据 hooks → 交互/窗口 hooks → UI 组件 → CSS → 计时性能**；每一个子步骤后都运行 P0 的 `check`。状态机行为必须和 `docs/state-machine.md` 一致。

### P1.1 推荐目标结构（按需要调整，不以文件数为目标）

```text
src/
  App.tsx                    # 组合与数据装配，不直接堆积原生窗口编排
  domain/
    contracts.ts             # TS 领域契约，P3 可迁移到生成类型
    presentation.ts          # 原 islandState.ts 的纯展示选择
    interaction.ts           # 原 islandInteraction.ts 的纯 reducer
    metrics.ts               # JS/UI 尺寸与动画参数；CSS 通过变量消费
    format.ts                # 纯格式化函数
  hooks/
    useUsage.ts
    useActivity.ts
    useTurnTokenUsage.ts
    useHeldResults.ts
    useInteractionMachine.ts
    useIslandWindow.ts
    useHorizontalDrag.ts
    useReducedMotion.ts
  components/
    Island.tsx
    OrbStack.tsx
    MinimalContent.tsx
    CompactContent.tsx
    ExpandedContent.tsx
    SessionRow.tsx
    SessionList.tsx
    TokenSummary.tsx
    UsagePanel.tsx
    MetaBar.tsx
    Elapsed.tsx
  debug/
    scenarios.ts
    DebugSwitcher.tsx
  styles/
    tokens.css
    island.css
    compact.css
    expanded.css
    debug.css
```

可以保留业务上更合适的已有文件名，重要的是职责归属和依赖方向。不要仅为使 `App.tsx` 少于某个行数而创建过多空壳组件。

### P1.2 纯函数、订阅和 State hooks

- [ ] 先移出 `percent / tone / resetText / elapsed / exactTokens`、尺寸计算与常量，保留原有数值和格式行为。
- [ ] 抽取 `useUsage()`、`useActivity()`、`useHeldResults()`、`useReducedMotion()`。保留 `activity-updated` / `read_activity` 的新旧快照守卫，保留 `usage-updated` 与 `read_limits` 的竞态保护。
- [ ] `useReducedMotion()` 使用 `matchMedia` 变化订阅；卸载时清理监听。增加运行期间切换系统减少动态效果设置的测试。
- [ ] **特别保护 `heldResults`：** 展开/正在收起时既有 Result 和 Token 保留到既定释放时机，不能因为 Rust Snapshot 清理或定时器更新而闪退。

### P1.3 交互状态机与原生窗口编排

- [ ] 抽取 `useInteractionMachine()`，统一封装 reducer、同步 ref 和状态转移，确保异步操作读取的是最新状态；检查 React 严格模式和多次 effect 调用下是否重复调度。
- [ ] 抽取 `useIslandWindow()`，注入可替换的原生窗口接口（至少包含 `setSize`、`setHitRegion`）；保留现有 `runNative` 队列、`collapseOperation` 去重以及**每个 await 后检查最新交互状态**。
- [ ] 不改变“**展开时先放大原生窗口并设置 HitRegion，之后显示 expanded；收起时先播放 Morph、再缩小窗口**”的顺序。
- [ ] 与 CSS 的 `transitionend` 协作不能形成重复完成/两次收缩；保留定时器作为动画事件缺失时的保障。
- [ ] 复用 P0-A 的 Promise 时序测试；补测试：重复点击、浏览器事件丢失、组件卸载、异常恢复、快速多次收起、缩小时新数据到达。

### P1.4 拖动与导航

- [ ] 抽取 `useHorizontalDrag()`，保留 PointerCapture、拖动阈值、点击抑制、显示器边界、DPI 转换和 RAF 动画；不要本阶段顺便改变运动算法 `0.38`。
- [ ] 抽取会话导航流程，保留同一时刻只发起一次 `open_codex_session`、错误提示、禁用态和完成后收起行为。
- [ ] 若 CSS/命令回调需要将 UI 事件 `stopPropagation` 保留在组件，应确保点击按钮不会意外触发岛的展开/收起。

### P1.5 补齐 Presentation 的输出契约

- [ ] 把项目标题回退、子代理数量、Meta 文案、额度 tone、ARIA 主要语义文案集中到 `deriveIslandPresentation()` 或其纯格式化辅助函数。
- [ ] 构造类型化 `SessionRowView` / `headline` / `meta` 等可渲染模型。域展示文本与导航忙碌态分开：`openingSession`、`navigationError` 等交互过程信息仍由 React UI 层处理，不让 Presentation 依赖组件状态或 Tauri。
- [ ] 保持 `Permission > quota > active/result/idle` 的既有显示优先级、`minimal/single/multi` 布局语义、`Activity/Attention/Result` 互不覆盖的原则。
- [ ] 补充 Presentation 单元测试，覆盖项目名、空字段、模型、子代理数、Quota/Permission 冲突、活跃会话与最近结果并存等。

**建议类型方向（按代码细化，不必逐字复制）：**

```ts
type SessionRowView = {
  key: string;
  sessionId: string;
  title: string;
  tooltip: string;
  subtitle: string;
  dot: { attention?: Attention; feedback?: TurnResultKind };
  elapsed: { from: number | null; to: number | null };
};
```

### P1.6 UI 组件与 CSS

- [ ] 将重复的 Session/Result 行统一为一个可接收 ViewModel 的 `SessionRow`；正确区分运行中与结果行的 Dot、Elapsed、导航状态、禁用状态。
- [ ] `OrbStack` 与 `ThinkingOrb` 保持目前两个 Orb 的状态交接、尺寸和暂停策略。**64px 画布通过 `scale(.75)` 显示成 48px，与直接 48px 绘制不保证等价；移除该缩放属于独立体验优化，不能混在等价 CSS 清理中。**
- [ ] 先通过浏览器计算样式检查最终生效 CSS 声明，再合并 `.island`、`.compact-copy`、`.usage-row` 等层叠覆盖；统一颜色、尺寸、motion 变量。
- [ ] CSS 仍以 `layout-*`、`expanded`、`data-attention`、`data-feedback` 等现有语义作为输入，不引入 CSS 自创业务状态。
- [ ] 明确尺寸单一来源的可实现边界：TS `metrics.ts`/CSS 变量可直接同步，但 Rust 与 Tauri 配置不能直接 import TypeScript；使用生成文件、构建检查或跨文件测试约束关键数值，而非仅写注释。
- [ ] `100/204` HitRegion 与 `96/200` 可见岛宽度、`#root` 2px 内边距的关系应被命名并测试；展开最大高度 `420` 与 HitRegion `+4` 的关系同样处理。

### P1.7 限定刷新范围及测试迁移

- [ ] 消除为了 Elapsed 每秒驱动整个 App Presentation 重算的问题：将文本时间刷新移到 `<Elapsed>` 或更局部的 hook。
- [ ] `deriveIslandPresentation()` 的 `now` 仍控制 Result 的 3 秒可见期与 Token 就绪后的约 2.8 秒展示；应保留 `nextUpdateAt` 一次性计时器并确保到期后 UI 更新，不得因为删除全局 1s tick 而让结果永不过期。
- [ ] 验证 Token 状态变更、Result 到期与新 Hook 到达时 `liveView`/`retainedView` 的正确计算，必要时合并重复推导而非机械加 `useMemo`。
- [ ] `.test.mjs` 迁移为 `.test.ts` 时，必须同步修改测试执行方式和 TypeScript 包含范围（例如独立测试 tsconfig 或 Vitest）；不能只改后缀。

### P1 阶段验收

- [ ] `npm.cmd run check` 通过；Presentation / Interaction / Native Queue 新增测试通过。
- [ ] `App.tsx` 只负责组合，核心逻辑不再混在 JSX 中；重复 SessionRow JSX 消除。
- [ ] 展开/收起、Result 保留、Token 展示、拖动、导航、减少动态效果模式均按第 8 节回归。
- [ ] `?debugIsland` 20 场景与原显示一致；记录对比截图及动态片段，尤其是 Result 过期时收起效果。
- [ ] **完成后停止，等待 P2 指令。**

---

## 6. P2：Rust 模块化、可观测性与 Token IO 优化

> 原计划中 P3 的 Token 查询性能属于已存在的热点，建议提前到 P2。P2 内建议按 `P2.1 → P2.2 → P2.3 → P2.4` 小步骤验收，不要一次性重写整个 Rust 目录。

### P2.1 模块整理（先移动、不改行为）

推荐目标结构：

```text
src-tauri/src/
  main.rs
  lib.rs                   # mod 声明 + Builder/run() 组装
  launch.rs                # LaunchSource / should_run_gui / prepare_gui_launch
  constants.rs             # Hook 地址、路径、CREATE_NO_WINDOW 等
  session_id.rs            # Session ID 校验与内部表达
  hook/
    mod.rs
    protocol.rs            # normalize / HookEventKind / HookEvent
    sender.rs              # 原 hook_sender.rs
    server.rs              # HTTP 接入
  activity/
    mod.rs
    model.rs               # Session / Agent / TurnResult / Snapshot
    reducer.rs             # 纯状态变换
    registry.rs            # SessionRegistry / cleanup / snapshot
  usage/
    mod.rs
    app_server.rs          # JSON-RPC 客户端
    limits.rs              # parse_limits / parse_window
    refresher.rs           # 刷新调度
  tray.rs
  window/
    mod.rs
    frame.rs               # 原 window_frame.rs
    hit_region.rs
    placement.rs
  token_usage.rs
  codex_navigation.rs
  codex_runtime.rs
  settings.rs
  app_paths.rs
  diagnostics.rs
```

- [ ] `lib.rs` 先拆独立职责，`activity.rs` 再拆协议、服务、reducer、registry；每次移动后验证行为与测试。
- [ ] 保持公开 Tauri command 名称、事件名、JSON 字段和 `--hook`/`--auto-start` 参数不变；保持可执行文件只有一个。
- [ ] 将 Win32 `set_window_hit_region` FFI 搬到 `window` 领域；不能影响已有无标题栏 subclass 修复。Windows subclass 隐藏窗口测试必须保留。
- [ ] 测试迁移到对应模块；替代重复临时目录样板可用 `tempfile` dev-dependency，但需评估新增依赖。

### P2.2 Hook 强类型与 Managed State

- [ ] 将 Hook 事件名统一到 `HookEventKind`（`SessionStart`、`SessionEnd`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`PreCompact`、`PostCompact`、`SubagentStart`、`SubagentStop`、`PermissionRequest`、`Stop`、`Interrupt`），接收端做有界、明确的解析。
- [ ] reducer 以枚举穷尽匹配，去掉不必要的 `unwrap()`，提取具有业务名称的迟到事件守卫函数。不要改变旧 Turn、已结束 Session、子代理事件语义。
- [ ] **兼容性说明**：sender 当前转发原始 Hook JSON，不能因引入枚举就悄悄过滤未来新增的未知事件。可以仅将 sender 识别的事件类型用于 deadline/刷新判断，而让服务端按原规则决定是否返回 400；若要改变协议必须独立处理。
- [ ] `session_id.rs` 提供统一验证逻辑。**不要立即把所有内部 ID 变为严格 UUID 并导致模拟数据、旧 Hook 或测试失效**；导航 URI 输入继续严格验证，Token 文件名查询仍必须防路径注入。若统一为严格 UUID，明确列出边界迁移与对应测试修改，这是独立兼容性变更。
- [ ] 将 `SERVER`、`USAGE_EVENTS`、`REGISTRY` 从 `OnceLock` 分步迁移到 Tauri `app.manage()`/`tauri::State<T>` 或明确的共享 handle；先梳理初始化和持有关系，再迁移后台线程。
- [ ] 移除 `activity` 对 `crate::request_usage_refresh()` 的反向隐式调用，注入或显式传递 `UsageRefresher`；可测试无 GUI 时的 Registry 与刷新调度。
- [ ] `Mutex` 中毒需要记录并处理：如果恢复数据结构安全，使用 `into_inner()` 恢复并测试；不安全时明确停止相关工作而非静默永久失效。

### P2.3 日志、错误及长期运行

- [ ] 将日志从 exe 同目录迁移到用户级应用目录下：`~/.codex-limit-island/logs/codexlimit.log`。保留跨平台 Home 路径封装，不写 Windows 用户专有目录。
- [ ] 设定合理的大小上限（建议 1MiB）和有限轮转份数；**考虑同一可执行文件的 sender 与 GUI 多进程并发写日志、Windows 文件重命名/占用失败**，不能仅按文件大小直接 rename。
- [ ] 将 Release 上不可见的关键 `eprintln!` 替换为统一日志入口，覆盖 Hook 失败、活动通知、额度通知、窗口命令与退出标记错误；但不记录完整 Hook 请求或无法脱敏的错误原文。
- [ ] 对不可恢复错误提供可观察提示；区分调试日志与用户信息，不把内部堆栈/私密字段展示在 UI。
- [ ] 异常测试：日志目录不可写、轮转冲突、多进程同时追加、无法定位 Home、长时间重复失败。

### P2.4 Token 用量查询性能（从原 P3 提前）

**涉及文件**：`src-tauri/src/token_usage.rs`，配套 Rust 测试与必要的前端回归。

- [ ] 先为 `session_file()` 与 `parse_usage()` 建立基准/夹具：多日期目录、大 JSONL、指定较早 Turn、同一 Turn 多次更新、当前会话总 Token 与本次任务 Token 区分、文件尚未写完、部分损坏 JSON 行、`CODEX_HOME` 自定义目录。
- [ ] 借助日期目录缩小扫描范围，必要时缓存 `SessionId → PathBuf`；缓存项必须在文件被移动/删除、查询失败、Codex Home 变化时可以失效或重新查找。
- [ ] 允许从尾部读取或增量解析**仅当仍可准确定位 `requested_turn` 对应的记录**。如果指定 Turn 可能在文件较早位置，应回退按需扫描；不能用最后一条 Turn 的 Token 冒充被请求 Turn。
- [ ] 避免每次重试都对整个会话目录递归扫描并重复解析完整 JSONL；对并发同一 Session 查询适度合并，不让同步 IO 卡住 Tauri 主线程（保留 `spawn_blocking` 或等价机制）。
- [ ] 不变条件：`taskTokens` 对应请求的 Turn；`sessionTokens` 对应按协议定义的会话累计值；缺少本次任务数据时继续返回未知/等待，不伪造为 0 或总量。
- [ ] 前端完成态显示维持既有 3 秒、Token ready 约 2.8 秒、展开保持结果语义。

### P2 阶段验收

- [ ] `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、`cargo test --lib` 在 Windows 开发环境通过；原有测试不少于原基线有效覆盖，新增测试按实际统计报告。
- [ ] 模块依赖方向清晰；`lib.rs` 主要承担初始化和组装。行数目标只作为参考，不允许削弱领域语义或测试。
- [ ] HTTP `204` 与 ActivitySnapshot 结构、Tauri 命令与事件名未出现意外变化。
- [ ] Token 大文件/多会话场景有可量化的时间或 IO 对比，指定旧 Turn 结果正确。
- [ ] 日志轮转、脱敏、多进程写入均有测试或真实验证记录。
- [ ] Windows 真实 Hook、退出不复活、手动启动恢复、设置 Codex 程序路径和托盘行为完成回归。
- [ ] **完成后停止，等待 P3 指令。**

---

## 7. P3：契约、性能与可选加固（不得影响基础功能）

按实际测量优先级执行，不强求所有项同时交付。

### P3.1 前后端类型契约

- [ ] 评估 `ts-rs` 或 `tauri-specta`，把 Rust `Session`、`TurnResult`、`ActivitySnapshot`、`UsageSnapshot`、`TokenUsage` 等类型生成到 TypeScript；保持 camelCase / enum 序列化形式一致。
- [ ] 生成文件必须可复现并纳入校验；避免在生成后的文件手工改业务字段。新增依赖要核对当前 Tauri/Rust 版本兼容性。

### P3.2 Win32 FFI 整理

- [ ] 在 Windows 使用 `windows-sys` 或其他有稳定定义的官方绑定，逐步替代四散的手写 FFI 与魔法常量。
- [ ] 不得破坏窗口无标题栏、HitRegion、ShellExecute、标准流句柄继承管理；保留现有隐藏窗口测试并加实际 Windows 验证。

### P3.3 Hook 本机 HTTP 安全与资源保护

- [ ] 在不引入整套 HTTP 框架的前提下，为连接数/工作线程设定合理上限，避免异常客户端无限创建线程；请求长度、读取超时和错误响应需有测试。
- [ ] 若实施共享 token / 请求头认证，必须首先设计 sender 与 GUI 的 token 生命周期、原子写入、文件权限、升级和自动启动时序。**同一用户下其他进程通常也可能读取用户目录 token，因此此方案不能声称能抵御同权限恶意本地进程；主要用于降低误投递与未经配置进程的误用。**
- [ ] 鉴权属于协议变更：保留旧版本过渡处理和明确迁移步骤；优先保证已信任 Hook 命令不会因为升级永久失效。

### P3.4 长期运行与动画性能

- [ ] `useTurnTokenUsage()` 的缓存清理同时考虑当前 Snapshot、`heldResults`、正在查询的 Result；卸载时安全取消/忽略过期 Promise。不可让展开内容突然丢失。
- [ ] 对拖动期间每帧 `setPosition()` 做实测；如果存在原生调用积压，采用单个在途位置请求 + 最新目标值的策略或其他有证据的方案。保持 DPI/屏幕边界处理与 RAF 平滑性。
- [ ] 观察 Elapsed 更新、Orb 渲染、窗口 resize/region、Hook 高频事件时的 UI 卡顿和 React render 次数；性能优化必须附前后数据或录屏对比。
- [ ] 如希望把刷新周期 30 秒调整为 5 分钟，必须另建 `BEHAVIOR` 子任务，评估额度及时性、app-server 通知可靠性与电池/CPU/IO 开销；不能默改。

### P3 阶段验收

- [ ] 新增依赖有必要性说明与版本兼容验证。
- [ ] 契约生成和 FFI 验证可重复执行。
- [ ] 长运行测试不会无限增长内存/线程/日志，且展开结果和 Token 不丢失。
- [ ] 可量化性能指标优于原状态，动画未出现新闪烁、回跳、二次收缩。

---

## 8. 必须执行的回归测试矩阵

测试记录至少包含：**场景 / 自动化或手工 / 操作步骤 / 预期 / 实际 / 结果 / 证据位置**。原生窗口相关测试建议录屏或至少捕捉关键中间帧；静态截图无法证明动画时序。

| 编号 | 场景 | 预期结果 | 最低验证方式 |
| --- | --- | --- | --- |
| `WIN-01` | Idle/Thinking/Searching/Editing/Executing/Connecting/Compacting | 文案、Orb、紧凑尺寸不变 | 20 场景预览 + 人工 |
| `WIN-02` | Permission、Agent Permission、Quota、Quota+Permission | 展示优先级与 Attention Dot 正确 | Presentation 单测 + 预览 |
| `WIN-03` | Completed → Expanded → Result 到期 → MouseLeave | **仅一次连续收缩**，不经过多余宽紧凑形态 | Promise 测试 + 录屏 |
| `WIN-04` | 展开过程中鼠标移走 | 260ms 逻辑保持，之后正确收起 | 假时钟 + 录屏 |
| `WIN-05` | 收起过程中再次悬停/展开 | 新操作优先，旧异步操作不覆盖尺寸/点击区 | 可控 Promise 测试 |
| `WIN-06` | `setSize`、`setHitRegion` 失败、乱序完成 | 进入可恢复交互状态，错误可诊断 | 故障注入 |
| `WIN-07` | 展开后收到新的活动、权限、Result 或 Token | 展开高度合理，不突然裁切或闪烁 | 预览 + 动态测试 |
| `WIN-08` | 多 Session、多个 Result、子代理 | 排序、标题、Token 行、跳转按钮正确 | Presentation 单测 + 手工 |
| `WIN-09` | Token 查询晚于 Result 3 秒显示期 | ready 后保留约 2.8 秒，Expanded 继续显示 | 假时钟 + TS 测试 |
| `WIN-10` | 拖动到监视器左右边界，变更 DPI | 无越界、无明显回跳、HitRegion 对齐 | Windows 手工 |
| `WIN-11` | 系统 Reduce Motion 开启/关闭 | 动画符合设置，交互状态无卡住 | Windows 手工 + hook 测试 |
| `WIN-12` | `?debugIsland` 20 场景切换 | 切换器可点击；Debug 高度 550 的 HitRegion 有效 | Windows 手工 + 范围单测 |
| `WIN-13` | 焦点切换、托盘隐藏/显示、睡眠恢复 | 不偶现系统标题栏；点击区域正常 | Windows 手工 |
| `HOOK-01` | Hook 首次收到事件，GUI 未运行 | 单 exe `--auto-start` 启动 GUI，并重试当前事件 | Windows E2E |
| `HOOK-02` | Codex 已运行时手动启动 GUI | 后续新事件可以正常更新；旧事件是否可见依当前架构约束 | Windows E2E |
| `HOOK-03` | 托盘明确退出后 Codex 继续工作 | Hook 不自动唤醒；手动启动后恢复 | Windows E2E |
| `HOOK-04` | 退出标记读/写失败 | 自动启动保守拒绝，异常可见 | Rust 单测 + 故障注入 |
| `HOOK-05` | HTTP 204 丢失、重复 Stop、重复 Tool Hook | Result 不重复，合法事件不丢失 | TCP 假服务 + reducer 测试 |
| `HOOK-06` | Codex Hook 命令需要重新信任 | 不绕过信任；用户信任并重启后事件恢复 | Windows 手工 |
| `TOK-01` | 指定旧 Turn、多条 Usage Record、大 JSONL | 查到准确本次 Token、正确会话累计，不错配 | Rust 夹具/性能测试 |
| `TOK-02` | Result Rust 保留期 12 秒结束，但 UI 已展开 | 已展示的 Result 和 Token 仍在 | 假时钟 + 交互测试 |
| `LOG-01` | 安装目录只读、用户日志目录可写 | 日志可落在用户目录，不影响正常 UI | Windows 手工 |
| `LOG-02` | 错误反复发生、日志轮转、GUI/sender 并行写 | 日志有界、不损坏、不泄漏私人路径和会话内容 | 集成测试 |

**真实 Hook 验收步骤**（不可由模拟单测代替）：在用户自行确认/信任现有命令的环境中启动 Codex → 重启确保 Hook 生效 → 发送任务 → 检查本地 HTTP 204、`activity-updated` 与 UI → 完成后查看 Token → 托盘退出并触发 Hook（不应复活）→ 手动启动后再次触发 Hook（应恢复）。**不得自行编辑用户级 Hook 配置文件**。

---

## 9. 交付规范与每阶段报告模板

### 9.1 交付内容

- [ ] 更新的代码与单元测试、必要的假接口/测试夹具。
- [ ] 工程化配置：格式化、Lint、类型检查、一键检查、适用时 Windows CI。
- [ ] 维护文档：`AGENTS.md`、`README.md`、`docs/state-machine.md`、本整改清单的已完成标记或对应执行记录。
- [ ] 实际命令输出摘要、失败原因、未执行的手工项目，以及动态测试证据位置（如录屏/截图由用户环境产生）。
- [ ] 行为变更说明（仅列有意的 `BUGFIX`/`BEHAVIOR`）。

### 9.2 Codex 每次阶段完成后按此格式回复

```markdown
## 阶段验收：P0-A / P0 / P1 / P2 / P3

**工作分支与 HEAD**：...
**工作区原有变更保护**：...
**完成项目**：A1、A2……（列任务编号）
**文件变更**：路径 + 一句话目的
**对外行为改变**：无 / 列明每个修复的旧行为与新行为

### 验证记录
| 命令或场景 | 结果（通过/失败/未执行） | 证据或原因 |
| --- | --- | --- |
| npm.cmd run check | ... | ... |
| cargo test ... | ... | ... |
| WIN-03 / HOOK-03 等 | ... | ... |

**发现的新问题**：...
**未解决风险**：...
**建议进入下一阶段的条件**：...
**是否已经提交/推送**：否（除非用户明确授权）
```

### 9.3 红线

- 不修改用户 Hook 信任机制、不要复制本机绝对路径进入仓库或日志。
- 不把一个 exe 改成常驻服务 + 独立 sender 两个 exe。
- 不重新设计状态机，不合并 Activity/Attention/Result，不把 Token 统计绑定到 Activity。
- 不因为重构而删除快照新旧判断、迟到事件防护、展开 Result 保留和原生操作队列。
- 不靠 `setTimeout` 堆叠掩盖动画竞态，不靠静态截图宣称动画流畅。
- 不把 `cargo fmt` 与功能修复混在一个不可审阅的大变更中。
- 不为通过测试而改写测试期望来迁就错误实现；合理改变期望时必须注明行为变更。
- 不因本地构建或单元测试通过就宣称真实 Windows、Codex Hook 和 installer 已完成验收。

---

## 10. 建议的阶段启动口令

执行文档已包含详细步骤。后续用户可以每次向 Codex 发送一条简短命令：

```text
继续执行 docs/code-quality-refactor-plan.md 的 P0（或 P1/P2/P3）。
以当前代码和上一阶段验收报告为准；只完成本阶段，修复失败的测试并报告实际结果。
不要提交、推送、发布或修改用户级 Hook 配置。
```

**完成定义：** 模块职责清晰、关键行为有测试、真实异常可诊断、长期运行无明显资源增长、动画保持顺滑；代码行数下降仅为副产品，不是验收目标。
