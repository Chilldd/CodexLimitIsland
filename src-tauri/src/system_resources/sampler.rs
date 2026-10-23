use std::{
    sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, TryRecvError},
    thread::{self, JoinHandle},
    time::Duration,
};

#[derive(Default)]
pub(super) struct Sampler {
    worker: Option<Worker>,
}

struct Worker {
    stop: Sender<()>,
    thread: JoinHandle<()>,
}

impl Sampler {
    pub(super) fn start(&mut self, sample: impl FnMut() + Send + 'static) -> Result<(), String> {
        if self.worker.is_some() {
            return Ok(());
        }
        let (stop, receiver) = mpsc::channel();
        let thread = thread::Builder::new()
            .name("resource-monitor".into())
            .spawn(move || run_sampler_loop(receiver, sample))
            .map_err(|error| format!("无法启动资源采样线程：{error}"))?;
        self.worker = Some(Worker { stop, thread });
        Ok(())
    }

    pub(super) fn stop(&mut self) -> Result<(), String> {
        if let Some(worker) = self.worker.take() {
            // 每轮启动拥有独立的停止通道；唤醒并等待退出后才能开始下一轮。
            // 接收端已关闭时，仍通过 join 检查线程是否正常结束。
            let _ = worker.stop.send(());
            worker.thread.join().map_err(|_| "资源采样线程异常退出".to_string())?;
        }
        Ok(())
    }
}

impl Drop for Sampler {
    fn drop(&mut self) {
        if self.stop().is_err() {
            crate::diagnostics::log("资源采样停止失败", None);
        }
    }
}

fn run_sampler_loop(stop: Receiver<()>, mut sample: impl FnMut()) {
    if stop.try_recv() != Err(TryRecvError::Empty) {
        return;
    }
    // 首次立即建立 CPU 基线并提供内存数据，随后每秒采样；停止时无须等满一秒。
    sample();
    while stop.recv_timeout(Duration::from_secs(1)) == Err(RecvTimeoutError::Timeout) {
        sample();
    }
}
