use crate::{app_paths, diagnostics};
use std::{ffi::OsStr, sync::OnceLock};
pub(crate) static LAUNCH_WARNING: OnceLock<String> = OnceLock::new();
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LaunchSource {
    Manual,
    AutoStart,
    Hook,
}

pub fn launch_source(arg: Option<&OsStr>) -> LaunchSource {
    match arg {
        Some(value) if value == OsStr::new("--hook") => LaunchSource::Hook,
        Some(value) if value == OsStr::new("--auto-start") => LaunchSource::AutoStart,
        _ => LaunchSource::Manual,
    }
}

pub fn prepare_gui_launch(source: LaunchSource) -> bool {
    match should_run_gui(
        source,
        app_paths::is_auto_start_suppressed,
        app_paths::clear_suppress_auto_start,
    ) {
        Ok(allowed) => {
            if !allowed && source == LaunchSource::AutoStart {
                diagnostics::log("退出标记阻止自动启动", None);
            }
            allowed
        }
        Err(error) => {
            diagnostics::log("启动标记操作失败", Some(&error));
            if source == LaunchSource::Manual {
                let _ = LAUNCH_WARNING.set(error);
                true
            } else {
                false
            }
        }
    }
}

pub(crate) fn exit_after_suppress(
    suppress: impl FnOnce() -> Result<(), String>,
    exit: impl FnOnce(),
) -> Result<(), String> {
    suppress()?;
    exit();
    Ok(())
}

pub(crate) fn should_run_gui(
    source: LaunchSource,
    is_suppressed: impl FnOnce() -> Result<bool, String>,
    clear: impl FnOnce() -> Result<(), String>,
) -> Result<bool, String> {
    match source {
        LaunchSource::AutoStart => is_suppressed().map(|suppressed| !suppressed),
        LaunchSource::Manual => clear().map(|_| true),
        LaunchSource::Hook => Ok(false),
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
        use std::{
            fs,
            time::{SystemTime, UNIX_EPOCH},
        };
        let marker = std::env::temp_dir().join(format!(
            "codexlimit-auto-start-test-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::File::create(&marker).unwrap();
        assert!(!should_run_gui(
            LaunchSource::AutoStart,
            || Ok(marker.exists()),
            || panic!("自动启动不得清除标记")
        )
        .unwrap());
        assert!(marker.exists());
        fs::remove_file(&marker).unwrap();
        assert!(should_run_gui(
            LaunchSource::AutoStart,
            || Ok(marker.exists()),
            || panic!("自动启动不得清除标记")
        )
        .unwrap());
    }

    #[test]
    fn manual_start_clears_marker() {
        use std::{
            fs,
            time::{SystemTime, UNIX_EPOCH},
        };
        let marker = std::env::temp_dir().join(format!(
            "codexlimit-manual-start-test-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::File::create(&marker).unwrap();
        assert!(should_run_gui(
            LaunchSource::Manual,
            || panic!("手动启动不检查退出标记"),
            || fs::remove_file(&marker).map_err(|error| error.to_string())
        )
        .unwrap());
        assert!(!marker.exists());
    }

    #[test]
    fn hook_source_does_not_start_gui_or_touch_marker() {
        assert!(!should_run_gui(
            LaunchSource::Hook,
            || panic!("Hook 不检查 GUI 启动标记"),
            || panic!("Hook 不清除标记")
        )
        .unwrap());
    }

    #[test]
    fn marker_failures_never_claim_success() {
        assert!(should_run_gui(
            LaunchSource::AutoStart,
            || Err("读取失败".into()),
            || panic!("不得清除")
        )
        .is_err());
        assert!(should_run_gui(LaunchSource::Manual, || panic!("不读取"), || Err("清除失败".into())).is_err());
        let exited = std::cell::Cell::new(false);
        assert!(exit_after_suppress(|| Err("写入失败".into()), || exited.set(true)).is_err());
        assert!(!exited.get());
        exit_after_suppress(|| Ok(()), || exited.set(true)).unwrap();
        assert!(exited.get());
    }

    #[test]
    fn simultaneous_auto_starts_all_respect_suppression() {
        let workers: Vec<_> = (0..8)
            .map(|_| {
                std::thread::spawn(|| {
                    should_run_gui(LaunchSource::AutoStart, || Ok(true), || panic!("不得清除")).unwrap()
                })
            })
            .collect();
        for worker in workers {
            assert!(!worker.join().unwrap());
        }
    }
}
