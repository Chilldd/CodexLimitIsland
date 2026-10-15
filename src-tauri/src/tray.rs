use crate::{
    app_paths, diagnostics,
    launch::exit_after_suppress,
    settings,
    usage::{AppServer, UsageService},
};
use std::{io, path::Path, sync::mpsc};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
/// 托盘右键菜单：已设置自定义路径时才启用“恢复默认路径”。
fn tray_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let set_path = MenuItem::with_id(app, "set-codex-path", "设置 Codex 程序路径…", true, None::<&str>)?;
    let reset_path = MenuItem::with_id(
        app,
        "reset-codex-path",
        "恢复默认路径",
        settings::configured_codex_path().is_some(),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[&set_path, &reset_path, &PredefinedMenuItem::separator(app)?, &quit],
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
        "set-codex-path" => choose_codex_path(app.clone()),
        "reset-codex-path" => reset_codex_path(app),
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
