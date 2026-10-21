mod activity;
mod app_paths;
mod codex_navigation;
mod codex_runtime;
mod constants;
mod diagnostics;
mod hook;
mod launch;
mod session_id;
mod settings;
mod sync_state;
pub(crate) mod system_resources;
mod token_usage;
mod tray;
mod usage;
mod window;
pub use launch::{launch_source, prepare_gui_launch, LaunchSource};
pub fn run_hook_sender() -> Result<(), String> {
    hook::sender::run()
}
use launch::LAUNCH_WARNING;
use std::io;
use tauri::Manager;
use tauri_plugin_dialog::MessageDialogKind;
use tray::notify;
use usage::start_usage_listener;
#[cfg(windows)]
use window::keep_window_borderless;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    diagnostics::log("GUI 启动", None);
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            usage::read_limits,
            usage::refresh_limits,
            settings::read_limit_display_window,
            settings::save_window_position,
            tray::set_limit_display_window,
            hook::server::read_activity,
            token_usage::read_token_usage,
            codex_navigation::open_codex_session,
            window::set_window_hit_region,
            system_resources::start_resource_sampling,
            system_resources::stop_resource_sampling,
            system_resources::read_resource_snapshot
        ])
        .on_window_event(|window, event| {
            #[cfg(windows)]
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Focused(_)) {
                if let Some(webview) = window.app_handle().get_webview_window("main") {
                    if let Err(error) = keep_window_borderless(&webview) {
                        diagnostics::log("窗口焦点变化后修复标题栏失败", Some(&error.to_string()));
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
            } = event
            {
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
                        diagnostics::log("切换灵动岛窗口可见性失败", Some(&error.to_string()));
                    }
                }
            }
        })
        .on_menu_event(tray::on_menu)
        .setup(|app| {
            diagnostics::log("GUI setup 开始", None);
            if let Err(error) = diagnostics::check() {
                notify(app.handle(), MessageDialogKind::Warning, "日志不可用", error);
            }
            if let Some(error) = LAUNCH_WARNING.get() {
                notify(
                    app.handle(),
                    MessageDialogKind::Warning,
                    "自动唤醒尚未恢复",
                    format!("{error}。窗口仍可使用；请检查应用状态目录的写入权限，然后手动重启。"),
                );
            }
            tray::setup(app.handle())?;
            let (usage, notifications) = usage::UsageService::new();
            app.manage(usage.clone());
            app.manage(token_usage::TokenUsageReader::default());
            app.manage(system_resources::ResourceMonitor::new(app.handle().clone()));
            let activity = hook::server::ActivityState::default();
            app.manage(activity.clone());
            hook::server::start_listener(app.handle().clone(), activity, usage.refresher.clone())
                .map_err(std::io::Error::other)?;
            diagnostics::log("Hook 监听已启动", None);
            start_usage_listener(app.handle().clone(), usage, notifications);
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(windows)]
                window::frame::install(&window).map_err(io::Error::other)?;
                window::place_initial(&window)?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .unwrap_or_else(|error| {
            diagnostics::log("GUI 构建失败", Some(&error.to_string()));
            panic!("无法启动 Codex 限额岛：{error}");
        });
    app.run(|app, event| {
        if let tauri::RunEvent::Exit = event {
            app.state::<usage::UsageService>().reset();
            if app.state::<system_resources::ResourceMonitor>().stop().is_err() {
                diagnostics::log("资源采样停止失败", None);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use serde_json::Value;
    #[test]
    fn compiled_tauri_version_matches_cargo_and_npm() {
        let npm: Value = serde_json::from_str(include_str!("../../package.json")).unwrap();
        let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
        assert_eq!(npm["version"].as_str().unwrap(), env!("CARGO_PKG_VERSION"));
        assert_eq!(context.package_info().version.to_string(), env!("CARGO_PKG_VERSION"));
    }
}

#[cfg(test)]
mod contracts;
