# 贡献指南 (Contributing Guide)

感谢你对 **Codex Limit Island** 的关注与贡献！在提交 Issue 或 Pull Request 之前，请先阅读本指南。

---

## 🛠️ 本地开发环境

- **操作系统**：Windows 10/11（macOS / Linux 环境欢迎试验与适配）
- **Node.js**：`^24.15.0` 或 `>=26`（建议使用 LTS）
- **Rust**：Stable 1.89+（通过 `rustup component add clippy rustfmt` 安装工具链）
- **包管理器**：Windows PowerShell 环境请使用 `npm.cmd`

---

## 📋 开发工作流

1. **克隆并安装依赖**：
   ```powershell
   git clone https://github.com/<your-username>/codexlimit.git
   cd codexlimit
   npm.cmd ci
   ```

2. **本地调试**：
   ```powershell
   npm.cmd run tauri dev
   ```

3. **跨层类型契约（Rust 与 TypeScript）**：
   若修改了 Rust 暴露给前端的数据模型（`src-tauri/src/`），请使用生成脚本更新契约定义，**请勿手工修改 `src/generated/contracts.ts`**：
   ```powershell
   npm.cmd run contracts:generate
   ```

4. **代码格式化**：
   - 前端：`npm.cmd run format`
   - Rust 后端：`cargo fmt --manifest-path src-tauri/Cargo.toml`

---

## 🧪 质量门禁与测试

本项目要求所有代码在合并前通过完整的质量检查，**零 Error、零 Warning**：

```powershell
npm.cmd run check
```

`npm.cmd run check` 会依次执行以下检查：
1. **版本一致性**：校验 `package.json`、`Cargo.toml` 与 Tauri 上下文版本；
2. **代码格式**：Prettier 检查；
3. **代码规范（Lint）**：ESLint 严格模式（0 error, 0 warning）；
4. **前端构建与类型**：TypeScript 编译（包含应用、Node 配置与测试类型）；
5. **单元测试**：Vitest 运行前端与 Hook 测试；
6. **Rust 门禁**：`cargo fmt --check`、`cargo clippy -D warnings` 与 `cargo test`。

在提交 PR 之前，请务必在本地确认 `npm.cmd run check` 顺利通过。

---

## 📐 设计与架构约定

- **状态分层边界**：
  - Activity 仅代表 Codex 正在执行的行为；
  - Attention 仅代表是否等待用户审批；
  - Result 代表一个 Turn 的结束快照；
  - Token Usage 附属于已完成的 Result。
  - 详细状态转换图与设计规则请参阅 [状态系统与事件流说明](docs/state-machine.md)。
- **安全性与隐私约束**：
  - 不得引入任何读取、持久化用户 Token、密码、提示词全文或命令原始输出的改动；
  - Hook 接收端仅保留状态模型所需的关键元数据。
