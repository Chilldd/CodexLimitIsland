use super::SystemResourceSnapshot;

/// 跨平台系统资源采集特征。各操作系统实现各自的进程识别、CPU 和内存统计。
pub(crate) trait ResourceCollector: Send {
    /// 执行一次采样周期，返回当前的系统资源快照。
    fn sample(&mut self) -> SystemResourceSnapshot;
}

/// 工厂方法：根据目标操作系统构建对应的资源采集器。
pub(crate) fn create_collector() -> Box<dyn ResourceCollector> {
    #[cfg(windows)]
    {
        Box::new(super::windows::WindowsResourceCollector::new())
    }

    #[cfg(target_os = "macos")]
    {
        Box::new(super::macos::MacosResourceCollector::new())
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Box::new(super::fallback::FallbackResourceCollector::new())
    }
}
