use super::*;

#[test]
fn stop_waits_for_in_flight_sample_before_restart() {
    use std::{sync::mpsc, thread, time::Duration};

    let mut sampler = sampler::Sampler::default();
    let (entered, started) = mpsc::channel();
    let (release, proceed) = mpsc::channel();
    sampler
        .start(move || {
            entered.send(()).unwrap();
            proceed.recv().unwrap();
        })
        .unwrap();
    started.recv_timeout(Duration::from_secs(2)).unwrap();

    let (finished, stopped) = mpsc::channel();
    let stopping = thread::spawn(move || {
        sampler.stop().unwrap();
        finished.send(()).unwrap();
        sampler
    });
    let returned_before_sample_finished = stopped.recv_timeout(Duration::from_millis(50)).is_ok();
    release.send(()).unwrap();
    let mut sampler = stopping.join().unwrap();

    let (sampled, restarted) = mpsc::channel();
    sampler
        .start(move || {
            sampled.send(()).unwrap();
        })
        .unwrap();
    restarted.recv_timeout(Duration::from_secs(2)).unwrap();
    sampler.stop().unwrap();
    assert!(!returned_before_sample_finished, "停止返回时，旧采样线程必须已退出");
}

#[test]
fn repeated_starts_and_rapid_restarts_keep_one_sampler() {
    use std::{
        sync::{
            atomic::{AtomicUsize, Ordering},
            mpsc, Arc,
        },
        time::Duration,
    };

    let mut sampler = sampler::Sampler::default();
    let samples = Arc::new(AtomicUsize::new(0));
    for expected in 1..=20 {
        let count = samples.clone();
        let (sampled, started) = mpsc::channel();
        sampler
            .start(move || {
                count.fetch_add(1, Ordering::SeqCst);
                sampled.send(()).unwrap();
            })
            .unwrap();
        started.recv_timeout(Duration::from_secs(2)).unwrap();
        sampler.start(|| panic!("重复启动不应创建第二个采样线程")).unwrap();
        sampler.stop().unwrap();
        assert_eq!(samples.load(Ordering::SeqCst), expected);
        sampler.stop().unwrap();
    }
}

#[test]
fn dropping_sampler_releases_worker_before_returning() {
    use std::{sync::mpsc, time::Duration};

    struct DropSignal(mpsc::Sender<()>);
    impl Drop for DropSignal {
        fn drop(&mut self) {
            self.0.send(()).unwrap();
        }
    }

    let (released, dropped) = mpsc::channel();
    let signal = DropSignal(released);
    let (sampled, started) = mpsc::channel();
    let mut sampler = sampler::Sampler::default();
    sampler
        .start(move || {
            let _keep_alive = &signal;
            sampled.send(()).unwrap();
        })
        .unwrap();
    started.recv_timeout(Duration::from_secs(2)).unwrap();
    drop(sampler);
    assert!(dropped.try_recv().is_ok(), "销毁监控器时必须释放采样线程");
}

#[cfg(windows)]
#[test]
fn includes_primary_runtime_nodes_without_counting_unrelated_nodes() {
    use super::windows::{classify_process, ProcessGroup};

    for name in ["node.exe", "node_repl.exe"] {
        assert_eq!(
            classify_process(
                name,
                &format!(r"C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\{name}")
            ),
            Some(ProcessGroup::Task)
        );
    }
    for path in [
        r"C:\nvm4w\nodejs\node.exe",
        r"D:\Projects\node_modules\node\bin\node.exe",
        r"C:\Users\User\.cache\codex-runtimes-unrelated\node.exe",
        r"C:\Users\User\AppData\Local\OpenAI\Codex\runtimes-unrelated\node.exe",
    ] {
        assert_eq!(classify_process("node.exe", path), None, "{path}");
    }
}

#[test]
fn default_snapshot_has_zero_metrics() {
    let snapshot = SystemResourceSnapshot::default();
    assert_eq!(snapshot.total.cpu_percent, 0.0);
    assert_eq!(snapshot.total.memory_bytes, 0);
    assert_eq!(snapshot.app.cpu_percent, 0.0);
    assert_eq!(snapshot.tasks.cpu_percent, 0.0);
}

#[cfg(windows)]
#[test]
fn correctly_identifies_windows_app_vs_cli_paths() {
    use super::windows::{classify_process, ProcessGroup};

    // WindowsApps / MSIX 安装的桌面客户端
    assert_eq!(
        classify_process(
            "ChatGPT.exe",
            r"C:\Program Files\WindowsApps\OpenAI.Codex_26.1016.6573.0_x64__2p2nqsd0c76g0\app\ChatGPT.exe"
        ),
        Some(ProcessGroup::App)
    );

    // 传统安装目录
    assert_eq!(
        classify_process("Codex.exe", r"C:\Users\User\AppData\Local\Programs\Codex\Codex.exe"),
        Some(ProcessGroup::App)
    );

    // CLI 进程
    assert_eq!(
        classify_process("codex.exe", r"C:\Users\User\AppData\Local\OpenAI\Codex\bin\codex.exe"),
        Some(ProcessGroup::Task)
    );

    // 运行时辅助进程
    assert_eq!(
        classify_process(
            "node.exe",
            r"C:\Users\User\AppData\Local\OpenAI\Codex\runtimes\cua_node\bin\node.exe"
        ),
        Some(ProcessGroup::Task)
    );

    // 自身排除
    assert_eq!(
        classify_process(
            "codexlimit.exe",
            r"D:\WorkSpace\YuG\app\codexlimit\target\debug\codexlimit.exe"
        ),
        None
    );
}

#[test]
fn correctly_identifies_macos_app_vs_cli_paths() {
    use super::macos::is_codex_app_path;
    assert!(is_codex_app_path("/Applications/Codex.app/Contents/MacOS/Codex"));
    assert!(is_codex_app_path("/Users/user/Applications/Codex.app"));
    assert!(!is_codex_app_path("/Applications/Codex.app/Contents/Resources/codex"));
    assert!(!is_codex_app_path("/usr/local/bin/codex"));
}
