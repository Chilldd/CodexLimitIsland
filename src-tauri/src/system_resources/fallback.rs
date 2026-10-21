use super::{collector::ResourceCollector, now_ms, ProcessMetrics, SystemResourceSnapshot};

pub(crate) struct FallbackResourceCollector;

impl FallbackResourceCollector {
    pub(crate) fn new() -> Self {
        Self
    }
}

impl ResourceCollector for FallbackResourceCollector {
    fn sample(&mut self) -> SystemResourceSnapshot {
        SystemResourceSnapshot {
            total: ProcessMetrics::default(),
            app: ProcessMetrics::default(),
            tasks: ProcessMetrics::default(),
            sample_time_ms: now_ms(),
        }
    }
}
