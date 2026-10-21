# Codex Limit Island

<p align="center">
  <img src="docs/images/compact-pill.png" alt="Codex Limit Island Pill" height="38" />
</p>

<p align="center">
  <strong>A lightweight desktop floating Dynamic Island tailored for OpenAI Codex</strong><br>
  Real-time monitoring of 5-hour and weekly rate limits with reset countdowns, seamlessly integrated with Codex session activities and token metrics.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white" alt="Platform" />
  <img src="https://img.shields.io/badge/Framework-Tauri%202-FFC131?logo=tauri&logoColor=black" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/Frontend-React%2019%20%7C%20TS-61DAFB?logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

<p align="center">
  <a href="README.md">简体中文</a> | <a href="README_en.md"><b>English</b></a>
</p>

---

## 📸 Preview

|                          Floating Capsule (Compact)                           |                       Task Completed & Token Summary (Expanded)                        |
| :---------------------------------------------------------------------------: | :------------------------------------------------------------------------------------: |
| <img src="docs/images/compact-pill.png" width="180" alt="Floating Capsule" /> | <img src="docs/images/expanded-completed.png" width="380" alt="Completed Task Card" /> |
|                       **Real-Time Thinking & Actions**                        |                         **Multi-Session & Sub-Agent Tracking**                         |
|  <img src="docs/images/expanded-thinking.png" width="380" alt="Thinking" />   |  <img src="docs/images/expanded-multi.png" width="380" alt="Multi-session Running" />  |

---

## ✨ Key Features

- 📊 **Multi-Dimensional Quota Monitoring**: The expanded panel displays progress bars and reset countdowns for both the **5-hour** and **weekly (7-day)** quota windows. The compact capsule displays your preferred quota window, which can be toggled via the system tray menu.
- 🏝️ **Smart Adaptive Dynamic Island**:
  - **Compact Capsule**: Dynamic text measurement and adaptive sizing ensure activity status and quota percentage fit naturally without awkward truncation; enhanced with a subtle divider and animated breathing Orb.
  - **Interactive Expanded Panel**: Left-click to smoothly toggle between compact and expanded views. Supports horizontal drag-and-drop along the top edge of your screen with position persistence.
- ⚡ **Deep Codex Hook Integration**: Integrates directly with Codex command-style Hooks to track session lifecycles and fine-grained behaviors (thinking/reasoning, code search, command execution, approval requests, context compression, etc.) with real-time breathing Orb effects.
- 🚀 **One-Click Session Navigation**: Click the main session headline or any item in the multi-task list to immediately bring up and focus the corresponding session in the Codex App.
- 💡 **Idle Inspiration Ticker**: When Codex is idle with no active tasks, the expanded panel rotates creative prompts and ideas to inspire your next prompt.
- 🗂️ **Multi-Task & Model Visibility**: Displays concurrent sessions and background sub-agent tasks, complete with active model tags (e.g., `gpt-4o`, `o3-mini`) and dynamic elapsed timers.
- 🔢 **Token Consumption Transparency**: Automatically captures and presents Turn Token usage upon task completion as well as cumulative Session Tokens.
- 🛡️ **100% Local Processing & Privacy**:
  - Never accesses credentials, login tokens, prompt contents, or tool execution outputs;
  - Hook JSON payloads are transmitted via local loopback (`127.0.0.1`), preserving only essential state metadata in memory; Token metrics are read from local session logs;
  - Session activity and token caches exist solely in memory and are released upon exit.
- 🔌 **Intelligent Auto-Start & Tray Exit Respect**:
  - Can automatically launch the island on demand when Codex initiates tasks;
  - If you explicitly choose "Exit" from the system tray, your choice is respected and auto-wakeups are suppressed until you manually start the application again.

---

## 🚀 Quick Start

### 1. Download & Installation

Visit the [Releases](https://github.com/Chilldd/CodexLimitIsland/releases/latest) page to download the latest Windows x64 installer.

- [Download v0.1.1 Installer (Windows x64)](https://github.com/Chilldd/CodexLimitIsland/releases/download/v0.1.1/CodexLimitIsland_0.1.1_x64-setup.exe)
- [View All Releases](https://github.com/Chilldd/CodexLimitIsland/releases)

Run the installer and follow the setup wizard.

> **Prerequisite**: An active and logged-in Codex CLI or Codex App installation. The island queries rate limits through the Codex executable and does not provide standalone login functionality.
>
> **Platform Support**: Currently optimized and packaged for Windows x64 (NSIS). macOS/Linux packaging is not yet configured.
>
> **Code Signature**: The v0.1.1 installer is not digitally signed. You can verify binary integrity using `SHA256SUMS.txt` provided in the release.

---

### 2. Configure Codex Hooks (Recommended)

Configuring Codex command-style Hooks enables real-time activity status, lifecycle tracking, and Token metrics in the island.

1. Open or create `%USERPROFILE%\.codex\hooks.json` (or under your custom `CODEX_HOME` directory).
2. Refer to [hooks.example.json](hooks.example.json) and merge the hook definitions into your existing `hooks` object.
3. Replace the `command` field in each handler with the correct executable path. The example covers 12 event types, including session lifecycle, tool execution, sub-agents, approvals, and compression.

If `codexlimit.exe` is added to your `PATH`:

```json
{
  "command": "codexlimit.exe --hook"
}
```

If not in `PATH`, use the absolute path enclosed in quotes. For example, if installed in `C:\Program Files\Codex Limit Island\codexlimit.exe`:

```json
{
  "command": "\"C:\\Program Files\\Codex Limit Island\\codexlimit.exe\" --hook"
}
```

4. Save the file and restart Codex App. Review and trust the configuration in the Hook Review interface (or execute `/hooks` in Codex CLI). Modified hooks require re-approval before execution. See [Codex Official Hook Documentation](https://learn.chatgpt.com/docs/hooks).
5. Send a prompt in Codex to verify that the island transitions to active state and displays turn results upon completion.

---

### 3. Daily Usage

- **Expand / Collapse**: Click the island to smoothly switch between compact capsule and expanded card views.
- **Drag Positioning**: Click and drag horizontally along the top edge of the display; the position is automatically persisted.
- **Direct Session Jump**: Click the session title or any item in the session list within the expanded card to immediately activate and focus the conversation in the Codex App.
- **Idle Prompt Ticker**: Displays prompt ideas and questions when no active tasks are running.
- **Tray Menu**:
  - Switch displayed limit in compact mode via **"Display Limit"** (`5h Rate Limit` or `Weekly Rate Limit`);
  - Manually configure `codex.exe` path via **"Set Codex Path..."** (includes built-in connectivity diagnostics);
  - Select **"Restore Default Path"** at any time;
  - Choose **"Exit"** to completely shut down the application.

Exiting via the system tray stops the island from automatically waking up on subsequent Hook events until the program is manually restarted.

---

## 🏗️ Architecture & Data Flow

Codex Limit Island utilizes a dual-channel architecture that strictly decouples rate limit querying from session event tracking:

```mermaid
flowchart TD
    subgraph Sources["Data Sources"]
      CodexServer["Codex App Server"] -- "account/rateLimits/read (stdio)" --> UsageModule["Usage Service"]
      CodexHook["Codex Command Hook"] -- "JSON POST 127.0.0.1:17321" --> HookModule["Hook Server"]
    end

    subgraph Core["Rust Core"]
      UsageModule --> UsageSnapshot[Usage Snapshot]
      HookModule --> Reducer[Activity Reducer]
      Reducer --> Registry[Session Registry]
      Registry --> ActivitySnapshot[Activity Snapshot]
    end

    subgraph UI["Presentation Layer"]
      UsageSnapshot --> Deriver[deriveIslandPresentation]
      ActivitySnapshot --> Deriver
      Deriver --> ReactUI[React Dynamic Island]
    end
```

- **Usage Service**: Spawns `codex.exe app-server` and queries `account/rateLimits/read` via standard I/O, determining 5-hour and weekly quotas via `windowDurationMins`.
- **Hook State Flow**: The hook command forwards event JSON to the local lightweight HTTP server, updating memory state reducers. See [State Machine & Event Flow Documentation](docs/state-machine.md) for details.

---

## 🛠️ Development & Contributing

Contributions and feedback are warmly welcomed!

### Prerequisites

- **Node.js**: `^24.15.0` or `>=26` (as specified in `package.json`).
- **Rust**: Stable (with `rustfmt` and `clippy` installed). Minimum declared version is 1.89, verified on 1.96.
- **Windows**: WebView2 Runtime (preinstalled on Windows 10/11) and C++ Build Tools.

### Common Commands

```powershell
# 1. Install dependencies
npm.cmd ci

# 2. Start frontend + Tauri in development mode
npm.cmd run tauri dev

# 3. Run comprehensive quality checks (ESLint 0 warning, typecheck, Vitest, Clippy, Rust tests)
npm.cmd run check

# 4. Code formatting
npm.cmd run format
cargo fmt --manifest-path src-tauri/Cargo.toml

# 5. Generate / verify Rust <-> TypeScript contracts
npm.cmd run contracts:generate
npm.cmd run contracts:check

# 6. Build Windows NSIS installer
npm.cmd run tauri build
```

The compiled installer will be generated at: `src-tauri/target/release/bundle/nsis/`.

For more details, please review our [Contributing Guide (CONTRIBUTING.md)](CONTRIBUTING.md).

---

## 🔒 Privacy & Security Guarantees

- **Rate Limit Extraction**: Communicates with the local Codex app-server via standard I/O; never reads stored authentication tokens or sensitive credentials directly.
- **Hook Data Handling**: Standard input payloads are forwarded to loopback `127.0.0.1`. The server retains only session IDs, tool names, event types, and model metadata in memory, dropping raw prompts, parameters, and outputs.
- **Token Metrics**: Extracted from local turn records in `CODEX_HOME/sessions/` (`%USERPROFILE%\.codex\sessions\`); does not modify or upload session data.
- **Local Storage**: User preferences, exit flags, and diagnostic logs are stored under `%USERPROFILE%\.codex-limit-island\`. Logs are limited to 1 MiB with a 2-file retention cap.
- **Loopback Boundaries**: Hook HTTP server listens strictly on `127.0.0.1:17321` with a 1 MiB body ceiling and strict read timeouts.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
