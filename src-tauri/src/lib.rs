mod activity;
mod app_paths;
mod codex_runtime;
mod codex_navigation;
mod diagnostics;
mod hook_sender;
mod settings;
mod token_usage;
pub fn run_hook_sender() -> Result<(), String> {
    hook_sender::run()
}
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    ffi::OsStr,
    io::{self, BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::Manager;
use tauri::Emitter;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

static SERVER: OnceLock<Mutex<Option<AppServer>>> = OnceLock::new();
static USAGE_EVENTS: OnceLock<mpsc::Sender<()>> = OnceLock::new();
pub(crate) fn request_usage_refresh() { if let Some(sender) = USAGE_EVENTS.get() { let _ = sender.send(()); } }
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LaunchSource { Manual, AutoStart, Hook }

pub fn launch_source(arg: Option<&OsStr>) -> LaunchSource {
    match arg {
        Some(value) if value == OsStr::new("--hook") => LaunchSource::Hook,
        Some(value) if value == OsStr::new("--auto-start") => LaunchSource::AutoStart,
        _ => LaunchSource::Manual,
    }
}

pub fn prepare_gui_launch(source: LaunchSource) -> bool {
    let allowed = should_run_gui(source, app_paths::is_auto_start_suppressed, app_paths::clear_suppress_auto_start);
    if !allowed && source == LaunchSource::AutoStart { diagnostics::log("退出标记阻止自动启动", None); }
    allowed
}

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
    #[link_name = "GetWindowLongPtrW"]
    fn get_window_long_ptr(hwnd: *mut std::ffi::c_void, index: i32) -> isize;
    #[link_name = "SetWindowLongPtrW"]
    fn set_window_long_ptr(hwnd: *mut std::ffi::c_void, index: i32, value: isize) -> isize;
    #[link_name = "SetWindowPos"]
    fn set_window_pos(hwnd: *mut std::ffi::c_void, insert_after: *mut std::ffi::c_void, x: i32, y: i32, width: i32, height: i32, flags: u32) -> i32;
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
        Self::start_with(codex_runtime::find_codex_runtime()?)
    }

    fn start_with(executable: PathBuf) -> Result<Self, String> {
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
fn keep_window_borderless(window: &tauri::WebviewWindow) -> Result<(), String> {
    const GWL_STYLE: i32 = -16;
    const TITLE_BAR_STYLES: isize = 0x00c0_0000 | 0x0004_0000 | 0x0008_0000 | 0x0002_0000 | 0x0001_0000;
    const REFRESH_FRAME: u32 = 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let style = unsafe { get_window_long_ptr(hwnd.0, GWL_STYLE) };
    if style == 0 {
        return Err(format!("读取窗口样式失败：{}", io::Error::last_os_error()));
    }
    if style & TITLE_BAR_STYLES != 0 {
        // 透明窗口在焦点或尺寸变化后可能重新显示原生标题栏；保留其余窗口样式。
        if unsafe { set_window_long_ptr(hwnd.0, GWL_STYLE, style & !TITLE_BAR_STYLES) } == 0 {
            return Err(format!("移除窗口标题栏失败：{}", io::Error::last_os_error()));
        }
    }
    if unsafe { set_window_pos(hwnd.0, std::ptr::null_mut(), 0, 0, 0, 0, REFRESH_FRAME) } == 0 {
        return Err(format!("刷新窗口边框失败：{}", io::Error::last_os_error()));
    }
    Ok(())
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
    keep_window_borderless(&window)?;
    Ok(())
}

#[cfg(not(windows))]
fn apply_window_hit_region(_window: tauri::WebviewWindow, _width: f64, _height: f64) -> Result<(), String> {
    // 原生点击区域裁剪仅在 Windows 实现；其他平台先保持完整窗口可交互。
    Ok(())
}

/// 托盘右键菜单：已设置自定义路径时才启用“恢复默认路径”。
fn tray_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let set_path = MenuItem::with_id(app, "set-codex-path", "设置 Codex 程序路径…", true, None::<&str>)?;
    let reset_path = MenuItem::with_id(app, "reset-codex-path", "恢复默认路径", settings::configured_codex_path().is_some(), None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    Menu::with_items(app, &[&set_path, &reset_path, &PredefinedMenuItem::separator(app)?, &quit])
}

fn refresh_tray_menu(app: &tauri::AppHandle) {
    let Some(tray) = app.tray_by_id("main") else {
        diagnostics::log("找不到托盘图标", None);
        return;
    };
    if let Err(error) = tray_menu(app).and_then(|menu| tray.set_menu(Some(menu))) {
        diagnostics::log("刷新托盘菜单失败", Some(&error.to_string()));
    }
}

/// 切换 Codex 程序后丢弃现有连接，让下一次查询使用新路径。
fn restart_usage_connection() {
    if let Some(mutex) = SERVER.get() {
        if let Ok(mut server) = mutex.lock() { *server = None; }
    }
    request_usage_refresh();
}

/// 用户在托盘菜单中选定的 Codex 程序的检测结果。
enum RuntimeCheck {
    /// 成功启动 app-server 并读回额度。
    Usable,
    /// 程序能启动，但额度读取失败，通常是 Codex 未登录。
    LimitsFailed(String),
    /// 无法作为 Codex app-server 启动。
    Unusable(String),
}

/// 验证所选程序能否承担取数职责：完成 app-server 握手并读回额度才算可用。
fn check_codex_runtime(executable: &Path) -> RuntimeCheck {
    match AppServer::start_with(executable.to_path_buf()) {
        Err(error) => RuntimeCheck::Unusable(error),
        Ok(mut server) => match server.read_limits() {
            Ok(_) => RuntimeCheck::Usable,
            Err(error) => RuntimeCheck::LimitsFailed(error),
        },
    }
}

/// 结果提示使用原生对话框，只能在主线程弹出。
fn notify(app: &tauri::AppHandle, kind: MessageDialogKind, title: &str, message: String) {
    let handle = app.clone();
    let title = title.to_string();
    if let Err(error) = app.run_on_main_thread(move || {
        handle.dialog().message(message).title(title).kind(kind).show(|_| {});
    }) {
        diagnostics::log("显示结果提示失败", Some(&error.to_string()));
    }
}

/// 文件选择框只能在主线程创建，因此先注册回调，再由后台线程等待用户选择结果。
fn choose_codex_path(app: tauri::AppHandle) {
    let (sender, receiver) = mpsc::channel();
    let dialog = app.dialog().file().set_title("选择 Codex 可执行程序");
    #[cfg(windows)]
    let dialog = dialog.add_filter("可执行程序", &["exe"]);
    dialog.pick_file(move |path| { let _ = sender.send(path); });
    std::thread::spawn(move || {
        let selected = match receiver.recv() {
            Ok(Some(path)) => path,
            Ok(None) => { diagnostics::log("已取消设置 Codex 程序路径", None); return; }
            Err(_) => { diagnostics::log("接收 Codex 程序路径选择结果失败", None); return; }
        };
        let path = match selected.into_path() {
            Ok(path) if path.is_file() => path,
            Ok(_) => { diagnostics::log("所选 Codex 程序路径不是文件，已忽略", None); return; }
            Err(error) => { diagnostics::log("解析所选 Codex 程序路径失败", Some(&error.to_string())); return; }
        };
        let check = check_codex_runtime(&path);
        if let RuntimeCheck::Unusable(error) = &check {
            diagnostics::log("所选 Codex 程序不可用，未保存路径", Some(error));
            notify(&app, MessageDialogKind::Error, "Codex 程序不可用", format!(
                "所选程序无法启动 Codex app-server，路径未保存。\n\n{}\n\n{error}\n\n请选择 Codex CLI 或 Codex App 内置的 codex.exe。",
                path.display()
            ));
            return;
        }
        if let Err(error) = settings::save_codex_path(&path) {
            diagnostics::log("保存 Codex 程序路径失败", Some(&error));
            notify(&app, MessageDialogKind::Error, "保存失败", format!("{error}\n\n路径未保存。"));
            return;
        }
        diagnostics::log("已保存自定义 Codex 程序路径", Some(&path.display().to_string()));
        match check {
            RuntimeCheck::Usable => notify(&app, MessageDialogKind::Info, "Codex 程序已启用", format!(
                "程序自检通过，已使用：\n{}", path.display()
            )),
            RuntimeCheck::LimitsFailed(error) => notify(&app, MessageDialogKind::Warning, "已保存，但额度读取失败", format!(
                "程序可以启动，但未能读取额度：\n{error}\n\n已保存路径：\n{}", path.display()
            )),
            RuntimeCheck::Unusable(_) => (),
        }
        // 菜单与托盘属于主线程资源，回到主线程刷新。
        let handle = app.clone();
        if let Err(error) = app.run_on_main_thread(move || refresh_tray_menu(&handle)) {
            diagnostics::log("调度托盘菜单刷新失败", Some(&error.to_string()));
        }
        restart_usage_connection();
    });
}

fn reset_codex_path(app: &tauri::AppHandle) {
    if let Err(error) = settings::clear_codex_path() {
        diagnostics::log("清除自定义 Codex 程序路径失败", Some(&error));
        return;
    }
    diagnostics::log("已恢复自动查找 Codex 程序", None);
    refresh_tray_menu(app);
    restart_usage_connection();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    diagnostics::log("GUI 启动", None);
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_limits, activity::read_activity, token_usage::read_token_usage, codex_navigation::open_codex_session, set_window_hit_region])
        .on_window_event(|window, event| {
            #[cfg(windows)]
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Focused(_)) {
                if let Some(webview) = window.app_handle().get_webview_window("main") {
                    if let Err(error) = keep_window_borderless(&webview) {
                        eprintln!("窗口焦点变化后修复标题栏失败：{error}");
                    }
                }
            }
        })
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
                        Ok(false) => window.show().and_then(|_| window.set_focus()).and_then(|_| {
                            #[cfg(windows)]
                            keep_window_borderless(&window).map_err(io::Error::other)?;
                            Ok(())
                        }),
                        Err(error) => Err(error),
                    };
                    if let Err(error) = result {
                        eprintln!("切换灵动岛窗口可见性失败：{error}");
                    }
                }
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => {
                if app_paths::suppress_auto_start().is_err() {
                    diagnostics::log("创建退出标记失败", None);
                }
                app.exit(0);
            }
            "set-codex-path" => choose_codex_path(app.clone()),
            "reset-codex-path" => reset_codex_path(app),
            _ => (),
        })
        .setup(|app| {
            diagnostics::log("GUI setup 开始", None);
            let tray = app.tray_by_id("main").ok_or_else(|| io::Error::other("找不到托盘图标"))?;
            tray.set_menu(Some(tray_menu(app.handle())?))?;
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
                #[cfg(windows)]
                keep_window_borderless(&window).map_err(io::Error::other)?;
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

fn should_run_gui(source: LaunchSource, is_suppressed: impl FnOnce() -> bool, clear: impl FnOnce() -> Result<(), String>) -> bool {
    match source {
        LaunchSource::AutoStart => !is_suppressed(),
        LaunchSource::Manual => {
            if clear().is_err() { diagnostics::log("清除退出标记失败", None); }
            true
        }
        LaunchSource::Hook => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_launch_source() {
        assert_eq!(launch_source(None), LaunchSource::Manual);
        assert_eq!(launch_source(Some(OsStr::new("--auto-start"))), LaunchSource::AutoStart);
        assert_eq!(launch_source(Some(OsStr::new("--hook"))), LaunchSource::Hook);
    }

    #[test]
    fn auto_start_rechecks_marker_without_clearing_it() {
        use std::{fs, time::{SystemTime, UNIX_EPOCH}};
        let marker = std::env::temp_dir().join(format!("codexlimit-auto-start-test-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::File::create(&marker).unwrap();
        assert!(!should_run_gui(LaunchSource::AutoStart, || marker.exists(), || panic!("自动启动不得清除标记")));
        assert!(marker.exists());
        fs::remove_file(&marker).unwrap();
        assert!(should_run_gui(LaunchSource::AutoStart, || marker.exists(), || panic!("自动启动不得清除标记")));
    }

    #[test]
    fn manual_start_clears_marker() {
        use std::{fs, time::{SystemTime, UNIX_EPOCH}};
        let marker = std::env::temp_dir().join(format!("codexlimit-manual-start-test-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::File::create(&marker).unwrap();
        assert!(should_run_gui(LaunchSource::Manual, || panic!("手动启动不检查退出标记"), || fs::remove_file(&marker).map_err(|error| error.to_string())));
        assert!(!marker.exists());
    }

    #[test]
    fn hook_source_does_not_start_gui_or_touch_marker() {
        assert!(!should_run_gui(LaunchSource::Hook, || panic!("Hook 不检查 GUI 启动标记"), || panic!("Hook 不清除标记")));
    }

    #[test]
    fn rejects_unusable_codex_path() {
        assert!(matches!(check_codex_runtime(Path::new("codexlimit-missing-runtime")), RuntimeCheck::Unusable(_)));
    }

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
