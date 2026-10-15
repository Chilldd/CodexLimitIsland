# Codex Limit Island (限额灵动岛)

<p align="center">
  <img src="docs/images/compact-pill.png" alt="Codex Limit Island Pill" height="38" />
</p>

<p align="center">
  <strong>专为 OpenAI Codex 打造的轻量级桌面悬浮灵动岛</strong><br>
  实时监控 5 小时与每周额度配额、重置倒计时，无缝联动 Codex 会话活动状态与 Token 统计。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white" alt="Platform" />
  <img src="https://img.shields.io/badge/Framework-Tauri%202-FFC131?logo=tauri&logoColor=black" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/Frontend-React%2019%20%7C%20TS-61DAFB?logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

---

## 📸 界面预览

| 悬浮胶囊状态 (Compact) | 任务完成与 Token 统计 (Expanded) |
| :---: | :---: |
| <img src="docs/images/compact-pill.png" width="180" alt="悬浮胶囊状态" /> | <img src="docs/images/expanded-completed.png" width="380" alt="任务完成卡片" /> |
| **实时思考与动作状态** | **多会话与子 Agent 协同** |
| <img src="docs/images/expanded-thinking.png" width="380" alt="思考中" /> | <img src="docs/images/expanded-multi.png" width="380" alt="多会话运行" /> |

---

## ✨ 核心特性

- 📊 **额度实时掌控**：双环/双进度条清晰展示 Codex **5 小时窗口**与**每周窗口**的剩余额度百分比，精确计算额度重置倒计时。
- 🏝️ **灵动岛轻盈交互**：默认以小巧的“药丸胶囊”悬浮置顶，轻触即可平滑展开详细卡片；支持全局自由拖拽与智能屏幕边缘贴边。
- ⚡ **深度 Hook 联动**：深度接入 Codex 命令型 Hook，实时感知 Codex 会话的生命周期与具体行为（思考中、搜索代码、执行命令、等待审批、上下文压缩等），动态呈现呼吸 Orb 动效。
- 🔢 **Token 消耗透视**：任务完成时自动统计本次任务（Turn）消耗的 Tokens 及当前会话累计 Tokens，使用情况一目了然。
- 🛡️ **纯本地与零隐私泄露**：
  - **不抓取、不存储**任何用户 API Key、登录令牌（Token）或对话提示词与代码输出；
  - 仅在本地环回接口（`127.0.0.1`）通信，所有会话状态仅保留在本地内存，随用随析。
- 🔌 **智能唤醒与退出尊重**：
  - 在 Codex 触发任务时可自动按需拉起灵动岛；
  - 当用户在系统托盘明确选择“退出”后，会记录退出意愿，后续不再随意唤醒打扰。

---

## 🚀 快速上手

### 1. 下载与安装

进入 [Releases](https://github.com/) 页面，下载最新的安装包：
- **`Codex.Limit.Island-Setup.exe`**：双击即可完成安装并自动运行。

> **环境说明**：目前灵动岛的原生窗口贴边、阴影与点击穿透针对 Windows 进行了深度适配与打包。macOS/Linux 架构预留了支持，待后续环境验证后开放打包。

---

### 2. 配置 Codex Hook（推荐）

通过配置 Codex 命令型 Hook，灵动岛可以在后台实时感知 Codex 的运行状态、进度及 Token 消耗。

1. 打开或创建当前用户的 Hook 配置文件：
   - 路径：`%USERPROFILE%\.codex\hooks.json`（也可直接参考仓库根目录的 [hooks.example.json](hooks.example.json)）
2. 填入如下真实 Hook 规则配置：

```json
{
  "description": "Send Codex lifecycle events to Codex Limit Island over localhost.",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "codexlimit.exe --hook",
            "timeout": 12
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "codexlimit.exe --hook",
            "timeout": 3
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "codexlimit.exe --hook",
            "timeout": 12
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "codexlimit.exe --hook",
            "timeout": 12
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "codexlimit.exe --hook",
            "timeout": 12
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "codexlimit.exe --hook",
            "timeout": 12
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "codexlimit.exe --hook",
            "timeout": 12
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "codexlimit.exe --hook",
            "timeout": 12
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "codexlimit.exe --hook",
            "timeout": 12
          }
        ]
      }
    ]
  }
}
```

> 💡 **路径提示**：
> - 若 `codexlimit.exe` 在环境变量 `PATH` 中，直接写 `"command": "codexlimit.exe --hook"` 即可；
> - 若未加入环境变量，可配置为安装后的绝对路径（例如：`"C:\\Users\\<你的用户名>\\AppData\\Local\\Programs\\Codex Limit Island\\codexlimit.exe --hook"` 或源码编译产物路径，注意 Windows 路径中的反斜杠必须写为双反斜杠 `\\\\`）。

3. **信任命令**：保存后**重启 Codex App**。在 Codex 首次触发 Hook 时，界面会弹出命令确认提示，点击 **Trust**（信任）即可。

---

### 3. 日常使用

- **展开/折叠**：鼠标左键点击灵动岛即可在紧凑态与展开态之间平滑切换。
- **拖拽定位**：按住悬浮岛即可在屏幕顶部自由拖动位置，松开后自动贴紧顶边。
- **托盘菜单**：
  - 找不到 Codex 时可点击托盘右键菜单中的 **“设置 Codex 程序路径…”** 手动指定 `codex.exe`（内置连接自检）；
  - 随时选择 **“恢复默认路径”**；
  - 点击 **“退出”** 彻底关闭悬浮岛。

---

## 🏗️ 架构与数据流

灵动岛采用双通道设计，将额度读取与会话动态严格解耦：

```mermaid
flowchart TD
    subgraph Data Sources
      CodexServer[Codex App Server] -- "account/rateLimits/read (stdio)" --> UsageModule[额度服务 (UsageService)]
      CodexHook[Codex CLI Hook] -- "JSON POST 127.0.0.1:17321" --> HookModule[Hook 接收端 (Hook Server)]
    end

    subgraph Rust Core
      UsageModule --> UsageSnapshot[额度快照]
      HookModule --> Reducer[会话状态归约器]
      Reducer --> Registry[会话注册表]
      Registry --> ActivitySnapshot[活动快照]
    end

    subgraph UI Layer
      UsageSnapshot --> Deriver[deriveIslandPresentation]
      ActivitySnapshot --> Deriver
      Deriver --> ReactUI[React 灵动岛组件]
    end
```

- **额度服务**：启动 `codex.exe app-server`，通过标准输入输出调用 `account/rateLimits/read`，按 `windowDurationMins` 识别 5 小时与每周额度。
- **Hook 状态流**：Hook 命令将事件发送给本地轻量 HTTP 端口，在内存中完成轻量状态推导，详见 [状态系统与事件流说明文档](docs/state-machine.md)。

---

## 🛠️ 参与开发

欢迎提交 PR 或 Issue 一起完善项目！

### 环境准备

- **Node.js**：24.15+（推荐 Node.js 24 系列或 26+）
- **Rust**：Stable 1.89+（需安装 `rustfmt` 和 `clippy`）
- **Windows**：系统需安装 WebView2 Runtime（Windows 10/11 通常已自带）与 C++ 生成工具

### 常用命令

```powershell
# 1. 安装锁定依赖
npm.cmd ci

# 2. 启动前端 + Tauri 本地开发
npm.cmd run tauri dev

# 3. 运行完整质量检查（包含 ESLint 0 warning、类型检查、Vitest、Rust Clippy/Test）
npm.cmd run check

# 4. 单独代码格式化
npm.cmd run format
cargo fmt --manifest-path src-tauri/Cargo.toml

# 5. 生成/检查 Rust 与 TypeScript 跨层契约
npm.cmd run contracts:generate
npm.cmd run contracts:check

# 6. 构建 Windows NSIS 安装包
npm.cmd run tauri build
```

打包完成后，安装包将输出至：`src-tauri/target/release/bundle/nsis/`。

更多规范请参阅 [贡献指南 (CONTRIBUTING.md)](CONTRIBUTING.md)。

---

## 🔒 隐私与安全性保障

- **凭证安全**：灵动岛绝不读取、不转发、不记录用户的任何登录 Token 或 Session Cookie。
- **内容安全**：Hook 接收端仅在内存提取操作类型（如当前命令名、工具类型），不持久化存储提示词（Prompt）、文件内容或工具执行输出。
- **本地边界**：HTTP Hook 接收服务严格绑定在 `127.0.0.1:17321`，不暴露任何公网接口；设置了 1MiB 请求上限与严格超时。

---

## 📄 开源许可证

本项目基于 [MIT 许可证](LICENSE) 开源。欢迎自由使用、修改与分发。
