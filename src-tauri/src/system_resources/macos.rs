use super::{collector::ResourceCollector, now_ms, ProcessMetrics, SystemResourceSnapshot};

/// macOS 资源采集器预留实现。
///
/// 后续支持 macOS 时，可通过 `libproc` (`proc_pidinfo` / `proc_listpids`)
/// 或 `sysctl` 采集 `Codex.app` 及 CLI `codex` 进程树的 CPU 与 RSS 物理内存。
#[allow(dead_code)]
pub(crate) struct MacosResourceCollector;

#[allow(dead_code)]
impl MacosResourceCollector {
    pub(crate) fn new() -> Self {
        Self
    }
}

impl ResourceCollector for MacosResourceCollector {
    fn sample(&mut self) -> SystemResourceSnapshot {
        // macOS 骨架实现：返回基础空快照，待 macOS 适配接入实际系统调用
        SystemResourceSnapshot {
            total: ProcessMetrics::default(),
            app: ProcessMetrics::default(),
            tasks: ProcessMetrics::default(),
            sample_time_ms: now_ms(),
        }
    }
}

/// 判定是否属于 macOS 上的 Codex App 路径（而非命令行 CLI）
#[allow(dead_code)]
pub(crate) fn is_codex_app_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    (lower.contains("codex.app") || lower.contains("/applications/codex")) && !lower.contains("/resources/codex")
}
