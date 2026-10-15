use super::{AppServer, UsageSnapshot};
use std::{
    sync::{mpsc, Arc, Mutex},
    time::Duration,
};
use tauri::Emitter;
#[derive(Clone)]
pub(crate) struct UsageRefresher(mpsc::SyncSender<()>);
impl UsageRefresher {
    pub(crate) fn request(&self) {
        if let Err(mpsc::TrySendError::Disconnected(())) = self.0.try_send(()) {
            crate::diagnostics::log("额度刷新通道已关闭", None);
        }
    }
}
#[derive(Clone)]
pub(crate) struct UsageService {
    server: Arc<Mutex<Option<AppServer>>>,
    pub(crate) refresher: UsageRefresher,
}
impl UsageService {
    pub(crate) fn new() -> (Self, mpsc::Receiver<()>) {
        let (sender, rx) = mpsc::sync_channel(1);
        (
            Self {
                server: Arc::default(),
                refresher: UsageRefresher(sender),
            },
            rx,
        )
    }
    pub(crate) fn reset(&self) {
        *crate::sync_state::lock(&self.server) = None;
    }
    fn read(&self) -> Result<UsageSnapshot, String> {
        let mut server = crate::sync_state::lock(&self.server);
        if server.is_none() {
            *server = Some(AppServer::start_notified(
                crate::codex_runtime::find_codex_runtime()?,
                Some(self.refresher.clone()),
            )?);
        }
        let result = match server.as_mut() {
            Some(server) => server.read_limits(),
            None => Err("Codex 连接尚未初始化".into()),
        };
        if result.is_err() {
            *server = None;
        }
        result
    }
}
pub(crate) fn start_usage_listener(app: tauri::AppHandle, service: UsageService, notifications: mpsc::Receiver<()>) {
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
        match service.read() {
            Ok(snapshot) => {
                if let Err(error) = app.emit("usage-updated", snapshot) {
                    crate::diagnostics::log("通知额度更新失败", Some(&error.to_string()));
                }
            }
            Err(error) => {
                crate::diagnostics::log("额度读取失败", Some(&error));
                if let Err(error) = app.emit("usage-error", error) {
                    crate::diagnostics::log("通知额度错误失败", Some(&error.to_string()));
                }
            }
        }
    });
}
#[tauri::command]
pub(crate) async fn read_limits(state: tauri::State<'_, UsageService>) -> Result<UsageSnapshot, String> {
    let service = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.read())
        .await
        .map_err(|_| "后台额度查询失败".to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn notifications_are_coalesced_without_gui() {
        let (service, rx) = UsageService::new();
        for _ in 0..10_000 {
            service.refresher.request();
        }
        assert_eq!(rx.try_iter().count(), 1);
        service.refresher.request();
        assert!(rx.try_recv().is_ok());
        service.reset();
    }
}
