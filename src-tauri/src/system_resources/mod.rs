mod collector;
#[cfg(not(any(windows, target_os = "macos")))]
mod fallback;
pub(crate) mod macos;
mod sampler;
#[cfg(windows)]
pub(crate) mod windows;

use collector::create_collector;
use serde::{Deserialize, Serialize};
use std::{
    sync::{atomic::AtomicU32, Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};

pub(crate) static APP_SERVER_PID: AtomicU32 = AtomicU32::new(0);

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
pub struct ProcessMetrics {
    pub cpu_percent: f32,
    pub memory_bytes: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
pub struct SystemResourceSnapshot {
    pub total: ProcessMetrics,
    pub app: ProcessMetrics,
    pub tasks: ProcessMetrics,
    pub sample_time_ms: u64,
}

pub struct ResourceMonitor {
    app_handle: AppHandle,
    sampler: Mutex<sampler::Sampler>,
    state: Arc<Mutex<SamplerState>>,
}

#[derive(Default)]
struct SamplerState {
    last_snapshot: Option<SystemResourceSnapshot>,
}

impl ResourceMonitor {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            sampler: Mutex::new(sampler::Sampler::default()),
            state: Arc::new(Mutex::new(SamplerState::default())),
        }
    }

    pub fn start(&self) -> Result<(), String> {
        let app_handle = self.app_handle.clone();
        let state = self.state.clone();
        let mut collector = create_collector();
        self.sampler
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .start(move || {
                let snapshot = collector.sample();
                state
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .last_snapshot = Some(snapshot);
                if app_handle.emit("resource-snapshot", snapshot).is_err() {
                    crate::diagnostics::log("资源采样通知失败", None);
                }
            })
    }

    pub fn stop(&self) -> Result<(), String> {
        self.sampler
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .stop()
    }

    pub fn current_snapshot(&self) -> SystemResourceSnapshot {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .last_snapshot
            .unwrap_or_default()
    }
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[tauri::command]
pub fn start_resource_sampling(monitor: tauri::State<ResourceMonitor>) -> Result<(), String> {
    monitor.start()
}

#[tauri::command]
pub fn stop_resource_sampling(monitor: tauri::State<ResourceMonitor>) -> Result<(), String> {
    monitor.stop()
}

#[tauri::command]
pub fn read_resource_snapshot(monitor: tauri::State<ResourceMonitor>) -> SystemResourceSnapshot {
    monitor.current_snapshot()
}

#[cfg(test)]
mod tests;
