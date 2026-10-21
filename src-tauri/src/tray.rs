use crate::{
    app_paths, diagnostics,
    launch::exit_after_suppress,
    settings,
    usage::{AppServer, UsageService},
};
use std::{io, path::Path, sync::mpsc};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
/// 托盘右键菜单：已设置自定义路径时才启用“恢复默认路径”，并支持自由选择展示 5h 还是 week 限额。
fn tray_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let current_window = settings::limit_display_window();
    let refresh_limits = MenuItem::with_id(app, "refresh-limits", "立即刷新额度", true, None::<&str>)?;
    let reset_pos = MenuItem::with_id(app, "reset-window-position", "重置窗口位置", true, None::<&str>)?;
    let config_hook = MenuItem::with_id(app, "configure-codex-hook", "配置 Codex Hook…", true, None::<&str>)?;

    let set_path = MenuItem::with_id(app, "set-codex-path", "设置 Codex 程序路径…", true, None::<&str>)?;
    let reset_path = MenuItem::with_id(
        app,
        "reset-codex-path",
        "恢复默认路径",
        settings::configured_codex_path().is_some(),
        None::<&str>,
    )?;
    let item_5h = CheckMenuItem::with_id(
        app,
        "limit-window-5h",
        "5 小时限额 (5h)",
        true,
        current_window == settings::LimitDisplayWindow::FiveHour,
        None::<&str>,
    )?;
    let item_week = CheckMenuItem::with_id(
        app,
        "limit-window-week",
        "每周限额 (7d)",
        true,
        current_window == settings::LimitDisplayWindow::Week,
        None::<&str>,
    )?;
    let display_menu = Submenu::with_items(app, "展示额度", true, &[&item_5h, &item_week])?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[
            &refresh_limits,
            &PredefinedMenuItem::separator(app)?,
            &display_menu,
            &reset_pos,
            &PredefinedMenuItem::separator(app)?,
            &config_hook,
            &set_path,
            &reset_path,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )
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

/// 用户在托盘菜单中选定的 Codex 程序的检测结果。
pub(crate) enum RuntimeCheck {
    /// 成功启动 app-server 并读回额度。
    Usable,
    /// 程序能启动，但额度读取失败，通常是 Codex 未登录。
    LimitsFailed(String),
    /// 无法作为 Codex app-server 启动。
    Unusable(String),
}

/// 验证所选程序能否承担取数职责：完成 app-server 握手并读回额度才算可用。
pub(crate) fn check_codex_runtime(executable: &Path) -> RuntimeCheck {
    match AppServer::start_with(executable.to_path_buf()) {
        Err(error) => RuntimeCheck::Unusable(error),
        Ok(mut server) => match server.read_limits() {
            Ok(_) => RuntimeCheck::Usable,
            Err(error) => RuntimeCheck::LimitsFailed(error),
        },
    }
}

/// 结果提示使用原生对话框，只能在主线程弹出。
pub(crate) fn notify(app: &tauri::AppHandle, kind: MessageDialogKind, title: &str, message: String) {
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
    dialog.pick_file(move |path| {
        let _ = sender.send(path);
    });
    std::thread::spawn(move || {
        let selected = match receiver.recv() {
            Ok(Some(path)) => path,
            Ok(None) => {
                diagnostics::log("已取消设置 Codex 程序路径", None);
                return;
            }
            Err(_) => {
                diagnostics::log("接收 Codex 程序路径选择结果失败", None);
                return;
            }
        };
        let path = match selected.into_path() {
            Ok(path) if path.is_file() => path,
            Ok(_) => {
                diagnostics::log("所选 Codex 程序路径不是文件，已忽略", None);
                return;
            }
            Err(error) => {
                diagnostics::log("解析所选 Codex 程序路径失败", Some(&error.to_string()));
                return;
            }
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
            notify(
                &app,
                MessageDialogKind::Error,
                "保存失败",
                format!("{error}\n\n路径未保存。"),
            );
            return;
        }
        diagnostics::log("已保存自定义 Codex 程序路径", None);
        match check {
            RuntimeCheck::Usable => notify(
                &app,
                MessageDialogKind::Info,
                "Codex 程序已启用",
                format!("程序自检通过，已使用：\n{}", path.display()),
            ),
            RuntimeCheck::LimitsFailed(error) => notify(
                &app,
                MessageDialogKind::Warning,
                "已保存，但额度读取失败",
                format!(
                    "程序可以启动，但未能读取额度：\n{error}\n\n已保存路径：\n{}",
                    path.display()
                ),
            ),
            RuntimeCheck::Unusable(_) => (),
        }
        // 菜单与托盘属于主线程资源，回到主线程刷新。
        let handle = app.clone();
        if let Err(error) = app.run_on_main_thread(move || refresh_tray_menu(&handle)) {
            diagnostics::log("调度托盘菜单刷新失败", Some(&error.to_string()));
        }
        app.state::<UsageService>().reset();
        app.state::<UsageService>().refresher.request();
    });
}

fn reset_codex_path(app: &tauri::AppHandle) {
    if let Err(error) = settings::clear_codex_path() {
        diagnostics::log("清除自定义 Codex 程序路径失败", Some(&error));
        return;
    }
    diagnostics::log("已恢复自动查找 Codex 程序", None);
    refresh_tray_menu(app);
    app.state::<UsageService>().reset();
    app.state::<UsageService>().refresher.request();
}

pub(crate) fn apply_limit_window(app: &tauri::AppHandle, window: settings::LimitDisplayWindow) -> Result<(), String> {
    if settings::limit_display_window() == window {
        return Ok(());
    }
    settings::save_limit_display_window(window)?;
    diagnostics::log("已更新展示限额设置", None);
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || refresh_tray_menu(&handle)) {
        diagnostics::log("调度托盘菜单刷新失败", Some(&error.to_string()));
    }
    app.emit("limit-window-changed", window).map_err(|error| {
        diagnostics::log("发送展示限额变更事件失败", Some(&error.to_string()));
        error.to_string()
    })?;
    Ok(())
}

#[tauri::command]
pub fn set_limit_display_window(app: tauri::AppHandle, window: settings::LimitDisplayWindow) -> Result<(), String> {
    apply_limit_window(&app, window)
}

fn select_limit_window(app: &tauri::AppHandle, window: settings::LimitDisplayWindow) {
    if let Err(error) = apply_limit_window(app, window) {
        diagnostics::log("保存展示限额设置失败", Some(&error));
        notify(
            app,
            MessageDialogKind::Error,
            "保存设置失败",
            format!("{error}\n\n设置未保存。"),
        );
    }
}

pub(crate) fn on_menu(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "quit" => {
            if let Err(error) = exit_after_suppress(app_paths::suppress_auto_start, || app.exit(0)) {
                diagnostics::log("创建退出标记失败", None);
                notify(
                    app,
                    MessageDialogKind::Error,
                    "无法安全退出",
                    format!("{error}。应用仍在运行。请检查应用状态目录的写入权限后重试退出。"),
                );
            }
        }
        "refresh-limits" => {
            app.state::<UsageService>().refresh_now(app);
        }
        "reset-window-position" => {
            if let Err(error) = settings::clear_window_x() {
                diagnostics::log("清除保存的窗口横坐标失败", Some(&error));
            }
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                if let Err(error) = app.run_on_main_thread(move || {
                    if let Err(error) = crate::window::place_center(&window_clone) {
                        diagnostics::log("重置窗口位置失败", Some(&error.to_string()));
                    }
                }) {
                    diagnostics::log("调度重置窗口位置失败", Some(&error.to_string()));
                }
            }
        }
        "configure-codex-hook" => match crate::hook::config::configure_codex_hooks() {
            Ok(path) => {
                diagnostics::log("已更新 Codex Hook 配置", None);
                notify(
                    app,
                    MessageDialogKind::Info,
                    "Codex Hook 配置成功",
                    format!(
                        "已成功将 Hook 规则写入：\n{}\n\n请完全退出并重启 Codex App，并在首次触发时点击确认信任该 Hook 命令。",
                        path.display()
                    ),
                );
            }
            Err(error) => {
                diagnostics::log("配置 Codex Hook 失败", None);
                notify(
                    app,
                    MessageDialogKind::Error,
                    "配置 Codex Hook 失败",
                    format!("未能写入 Hook 配置：\n{error}"),
                );
            }
        },
        "set-codex-path" => choose_codex_path(app.clone()),
        "reset-codex-path" => reset_codex_path(app),
        "limit-window-5h" => select_limit_window(app, settings::LimitDisplayWindow::FiveHour),
        "limit-window-week" => select_limit_window(app, settings::LimitDisplayWindow::Week),
        _ => (),
    }
}
pub(crate) fn setup(app: &tauri::AppHandle) -> tauri::Result<()> {
    let tray = app
        .tray_by_id("main")
        .ok_or_else(|| io::Error::other("找不到托盘图标"))?;
    tray.set_menu(Some(tray_menu(app)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unusable_codex_path() {
        assert!(matches!(
            check_codex_runtime(Path::new("codexlimit-missing-runtime")),
            RuntimeCheck::Unusable(_)
        ));
    }
}
