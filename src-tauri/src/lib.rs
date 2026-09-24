mod activity;
mod app_paths;
mod codex_runtime;
mod diagnostics;
mod hook_sender;
pub fn run_hook_sender() -> Result<(), String> {
    hook_sender::run()
}
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    io::{self, BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::Manager;
use tauri::Emitter;
use tauri::menu::{Menu, MenuItem};

static SERVER: OnceLock<Mutex<Option<AppServer>>> = OnceLock::new();
static USAGE_EVENTS: OnceLock<mpsc::Sender<()>> = OnceLock::new();
pub(crate) fn request_usage_refresh() { if let Some(sender) = USAGE_EVENTS.get() { let _ = sender.send(()); } }
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(20);

#[cfg(windows)]
#[link(name = "gdi32")]
unsafe extern "system" {
    #[link_name = "CreateRectRgn"]
    fn create_rect_rgn(left: i32, top: i32, right: i32, bottom: i32) -> *mut std::ffi::c_void;
    #[link_name = "DeleteObject"]
    fn delete_object(handle: *mut std::ffi::c_void) -> i32;
}

#[cfg(windows)]
#[link(name = "user32")]
unsafe extern "system" {
    #[link_name = "SetWindowRgn"]
    fn set_window_rgn(hwnd: *mut std::ffi::c_void, region: *mut std::ffi::c_void, redraw: i32) -> i32;
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LimitWindow {
    remaining_percent: f64,
    resets_at: Option<i64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageSnapshot {
    five_hour: Option<LimitWindow>,
    weekly: Option<LimitWindow>,
    updated_at: u64,
}

struct AppServer {
    child: Child,
    stdin: ChildStdin,
    responses: mpsc::Receiver<String>,
    next_id: u64,
}

impl Drop for AppServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl AppServer {
    fn start() -> Result<Self, String> {
        let executable = codex_runtime::find_codex_runtime()?;
        let mut command = Command::new(executable);
        command.arg("app-server")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        let mut child = command
            .spawn()
            .map_err(|error| format!("无法启动 Codex App Server：{error}"))?;
        let stdin = child.stdin.take().ok_or("Codex 标准输入不可用")?;
        let stdout = child.stdout.take().ok_or("Codex 标准输出不可用")?;
        let mut stderr = child.stderr.take().ok_or("Codex 错误输出不可用")?;
        let (sender, responses) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(line) => {
                        if let Ok(value) = serde_json::from_str::<Value>(&line) {
                            if value.get("method").and_then(Value::as_str) == Some("account/rateLimits/updated") {
                                if let Some(events) = USAGE_EVENTS.get() { let _ = events.send(()); }
                            } else if value.get("id").is_some() && sender.send(line).is_err() { break; }
                        }
                    }
                    Err(_) => break,
                }
            }
        });
        std::thread::spawn(move || { let _ = io::copy(&mut stderr, &mut io::sink()); });

        let mut server = Self { child, stdin, responses, next_id: 1 };
        server.send(&json!({
            "method": "initialize", "id": 1,
            "params": { "clientInfo": {
                "name": "codex_limit_island", "title": "Codex Limit Island", "version": "0.1.0"
            }}
        }))?;
        server.wait_for(1)?;
        server.send(&json!({"method": "initialized", "params": {}}))?;
        Ok(server)
    }

    fn read_limits(&mut self) -> Result<UsageSnapshot, String> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(&json!({"method": "account/rateLimits/read", "id": id, "params": {}}))?;
        let response = self.wait_for(id)?;
        parse_limits(&response)
    }

    fn send(&mut self, message: &Value) -> Result<(), String> {
        writeln!(self.stdin, "{message}")
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("向 Codex 发送请求失败：{error}"))
    }

    fn wait_for(&mut self, id: u64) -> Result<Value, String> {
        loop {
            let line = self.responses.recv_timeout(RESPONSE_TIMEOUT)
                .map_err(|_| "等待 Codex 响应超时或连接已关闭".to_string())?;
            let value: Value = serde_json::from_str(&line)
                .map_err(|_| "Codex 返回了无法解析的数据".to_string())?;
            if value.get("id").and_then(Value::as_u64) != Some(id) { continue; }
            if let Some(error) = value.get("error") {
                return Err(error.get("message").and_then(Value::as_str)
                    .unwrap_or("Codex 查询失败").to_string());
            }
            return Ok(value);
        }
    }
}

fn parse_window(value: &Value) -> Option<(u64, LimitWindow)> {
    let duration = value.get("windowDurationMins")?.as_u64()?;
    let used = value.get("usedPercent")?.as_f64()?;
    let remaining_percent = (100.0 - used).clamp(0.0, 100.0);
    let resets_at = value.get("resetsAt").and_then(Value::as_i64);
    Some((duration, LimitWindow { remaining_percent, resets_at }))
}

fn parse_limits(response: &Value) -> Result<UsageSnapshot, String> {
    let result = response.get("result").ok_or("Codex 响应缺少结果")?;
    let bucket = result.pointer("/rateLimitsByLimitId/codex")
        .or_else(|| result.get("rateLimits"))
        .ok_or("Codex 未返回通用限额")?;
    let mut snapshot = UsageSnapshot {
        five_hour: None, weekly: None,
        updated_at: SystemTime::now().duration_since(UNIX_EPOCH)
            .unwrap_or_default().as_secs(),
    };
    for field in ["primary", "secondary"] {
        if let Some((minutes, window)) = bucket.get(field).and_then(parse_window) {
            match minutes {
                300 => snapshot.five_hour = Some(window),
                10080 => snapshot.weekly = Some(window),
                _ => (),
            }
        }
    }
    Ok(snapshot)
}

fn read_limits_blocking() -> Result<UsageSnapshot, String> {
    let mutex = SERVER.get_or_init(|| Mutex::new(None));
    let mut server = mutex.lock().map_err(|_| "Codex 连接状态不可用")?;
    if server.is_none() { *server = Some(AppServer::start()?); }
    let result = server.as_mut().expect("server initialized").read_limits();
    if result.is_err() { *server = None; }
    result
}

fn start_usage_listener(app: tauri::AppHandle) {
    let (sender, notifications) = mpsc::channel();
    if USAGE_EVENTS.set(sender).is_err() { return; }
    std::thread::spawn(move || loop {
        let notified = match notifications.recv_timeout(Duration::from_secs(30)) {
            Ok(()) => true,
            Err(mpsc::RecvTimeoutError::Timeout) => false,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };
        if notified {
            std::thread::sleep(Duration::from_secs(3));
            while notifications.try_recv().is_ok() {}
        }
        match read_limits_blocking() {
            Ok(snapshot) => {
                if let Err(error) = app.emit("usage-updated", snapshot) { eprintln!("通知额度更新失败：{error}"); }
            }
            Err(error) => {
                if let Err(emit_error) = app.emit("usage-error", error) { eprintln!("通知额度错误失败：{emit_error}"); }
            }
        }
    });
}

#[tauri::command]
async fn read_limits() -> Result<UsageSnapshot, String> {
    tauri::async_runtime::spawn_blocking(read_limits_blocking)
        .await.map_err(|error| format!("后台查询失败：{error}"))?
}

#[tauri::command]
fn set_window_hit_region(window: tauri::WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    if !width.is_finite() || !height.is_finite() || !(100.0..=390.0).contains(&width) || !(40.0..=424.0).contains(&height) {
        return Err("窗口点击区域超出允许范围".into());
    }
    apply_window_hit_region(window, width, height)
}

#[cfg(windows)]
fn apply_window_hit_region(window: tauri::WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let region_width = (width * scale).round() as i32;
    let region_height = (height * scale).round() as i32;
    let left = (size.width as i32 - region_width) / 2;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let region = unsafe { create_rect_rgn(left, 0, left + region_width, region_height) };
    if region.is_null() { return Err(format!("点击区域创建失败：{}", io::Error::last_os_error())); }
    // 可见窗口更新裁剪区域时立即重绘，避免收缩后残留原生窗口画面。
    if unsafe { set_window_rgn(hwnd.0, region, 1) } == 0 {
        let error = io::Error::last_os_error();
        unsafe { delete_object(region); }
        return Err(format!("窗口点击区域调整失败：{error}"));
    }
    Ok(())
}

#[cfg(not(windows))]
fn apply_window_hit_region(_window: tauri::WebviewWindow, _width: f64, _height: f64) -> Result<(), String> {
    // 原生点击区域裁剪仅在 Windows 实现；其他平台先保持完整窗口可交互。
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    diagnostics::log("GUI 启动", None);
    if app_paths::clear_suppress_auto_start().is_err() {
        diagnostics::log("清除退出标记失败", None);
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
        .invoke_handler(tauri::generate_handler![read_limits, activity::read_activity, set_window_hit_region])
        // 左键切换浮窗，右键由托盘菜单提供退出入口。
        .on_tray_icon_event(|app, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event {
                if let Some(window) = app.get_webview_window("main") {
                    let result = match window.is_visible() {
                        Ok(true) => window.hide(),
                        Ok(false) => window.show().and_then(|_| window.set_focus()),
                        Err(error) => Err(error),
                    };
                    if let Err(error) = result {
                        eprintln!("切换灵动岛窗口可见性失败：{error}");
                    }
                }
            }
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "quit" {
                if app_paths::suppress_auto_start().is_err() {
                    diagnostics::log("创建退出标记失败", None);
                }
                app.exit(0);
            }
        })
        .setup(|app| {
            diagnostics::log("GUI setup 开始", None);
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;
            let tray = app.tray_by_id("main").ok_or_else(|| io::Error::other("找不到托盘图标"))?;
            tray.set_menu(Some(menu))?;
            activity::start_listener(app.handle().clone()).map_err(std::io::Error::other)?;
            diagnostics::log("Hook 监听已启动", None);
            start_usage_listener(app.handle().clone());
            if let Some(window) = app.get_webview_window("main") {
                if let Some(monitor) = window.primary_monitor()? {
                    let screen = monitor.size();
                    let origin = monitor.position();
                    let width = (390.0 * monitor.scale_factor()) as i32;
                    let top = (3.0 * monitor.scale_factor()) as i32;
                    window.set_position(tauri::PhysicalPosition::new(
                        origin.x + (screen.width as i32 - width) / 2,
                        origin.y + top,
                    ))?;
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .unwrap_or_else(|error| {
            diagnostics::log("GUI 构建失败", Some(&error.to_string()));
            panic!("无法启动 Codex 限额岛：{error}");
        });
    app.run(|_, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(mutex) = SERVER.get() {
                if let Ok(mut server) = mutex.lock() { *server = None; }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_windows_by_duration() {
        let response = json!({"result": {"rateLimitsByLimitId": {"codex": {
            "primary": {"usedPercent": 20, "windowDurationMins": 10080, "resetsAt": 1790000000},
            "secondary": {"usedPercent": 35, "windowDurationMins": 300, "resetsAt": 1789900000}
        }}}});
        let snapshot = parse_limits(&response).unwrap();
        assert_eq!(snapshot.five_hour.unwrap().remaining_percent, 65.0);
        assert_eq!(snapshot.weekly.unwrap().remaining_percent, 80.0);
    }

    #[test]
    #[ignore = "requires a signed-in Codex App on Windows"]
    fn reads_live_limits_twice() {
        let mut server = AppServer::start().unwrap();
        let first = server.read_limits().unwrap();
        let second = server.read_limits().unwrap();
        assert!(first.five_hour.is_some() || first.weekly.is_some());
        assert!(second.five_hour.is_some() || second.weekly.is_some());
    }
}

