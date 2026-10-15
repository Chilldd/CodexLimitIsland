use std::{
    fs::{self, OpenOptions, TryLockError},
    io::{self, Write},
    path::Path,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
const MAX_BYTES: u64 = 1024 * 1024;
const BACKUPS: usize = 2;
#[cfg(not(test))]
static FAILURES: AtomicUsize = AtomicUsize::new(0);
fn write_at(dir: &Path, stage: &str, error: Option<&str>, limit: u64) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    // 锁文件从不重命名；所有进程关闭日志句柄后才释放此 OS 锁，Windows 下也可轮转。
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(dir.join("writer.lock"))?;
    let until = Instant::now() + Duration::from_millis(100);
    loop {
        match lock.try_lock() {
            Ok(()) => break,
            Err(TryLockError::WouldBlock) if Instant::now() < until => std::thread::sleep(Duration::from_millis(2)),
            Err(error) => return Err(error.into()),
        }
    }
    let at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let line = format!(
        "{at} pid={} {stage}{}\n",
        std::process::id(),
        error.map(|e| format!(": {}", safe_detail(e))).unwrap_or_default()
    );
    let path = dir.join("codexlimit.log");
    if path.metadata().map(|m| m.len()).unwrap_or(0) + line.len() as u64 > limit {
        for index in (1..=BACKUPS).rev() {
            let to = dir.join(format!("codexlimit.log.{index}"));
            let from = if index == 1 {
                path.clone()
            } else {
                dir.join(format!("codexlimit.log.{}", index - 1))
            };
            match fs::remove_file(&to) {
                Ok(()) => (),
                Err(e) if e.kind() == io::ErrorKind::NotFound => (),
                Err(e) => return Err(e),
            }
            match fs::rename(from, to) {
                Ok(()) => (),
                Err(e) if e.kind() == io::ErrorKind::NotFound => (),
                Err(e) => return Err(e),
            }
        }
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(line.as_bytes())?;
    // file 先关闭，lock 后关闭；失败时不继续无锁写入。
    Ok(())
}
pub(crate) fn check() -> Result<(), String> {
    let dir = crate::app_paths::app_home_dir()?.join("logs");
    write_at(&dir, "日志就绪", None, MAX_BYTES).map_err(|_| "日志不可用，请检查用户应用目录权限".into())
}
#[cfg(not(test))]
use std::sync::atomic::{AtomicUsize, Ordering};
pub(crate) fn log(stage: &'static str, error: Option<&str>) {
    #[cfg(test)]
    {
        let _ = (stage, error);
    }
    #[cfg(not(test))]
    if let Err(error) = crate::app_paths::app_home_dir()
        .map_err(io::Error::other)
        .and_then(|dir| write_at(&dir.join("logs"), stage, error, MAX_BYTES))
    {
        let n = FAILURES.fetch_add(1, Ordering::Relaxed) + 1;
        if n.is_power_of_two() {
            eprintln!("写入应用日志失败：{:?}（累计 {n} 次）", error.kind());
        }
    }
}
// 外部错误和路径不可靠，持久化只允许受控类别；原始原因仍由相关 UI 返回。
fn safe_detail(detail: &str) -> &str {
    for (prefix, category) in [
        ("读取退出标记失败：", "读取退出标记失败"),
        ("读取 Hook 输入失败：", "读取 Hook 输入失败"),
        ("定位当前程序失败：", "定位当前程序失败"),
        ("启动灵动岛失败：", "启动灵动岛失败"),
        ("关闭 Hook 标准流继承失败：", "关闭 Hook 标准流继承失败"),
        ("写入配置文件失败：", "写入配置文件失败"),
        ("删除配置文件失败：", "删除配置文件失败"),
    ] {
        if detail.starts_with(prefix) {
            return category;
        }
    }
    match detail {
        "SessionStart"
        | "UserPromptSubmit"
        | "SessionEnd"
        | "Hook 输入长度无效"
        | "Hook 响应无效"
        | "Hook 监听启动超时"
        | "Hook 连接失败"
        | "Hook 已连接但未收到有效确认，事件可能已处理"
        | "无法确定用户 Home 目录"
        | "创建退出标记失败"
        | "清除退出标记失败" => detail,
        _ => "外部错误（隐私详情未记录）",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn untrusted_errors_never_reach_persistent_details() {
        for secret in [
            r"C:\Users\private\codex.exe",
            "/home/private/session.jsonl",
            "session_id=private-id",
            "token=secret",
            "prompt=private",
            "error\nforged log line",
        ] {
            assert_eq!(safe_detail(secret), "外部错误（隐私详情未记录）");
        }
        assert_eq!(safe_detail("Hook 响应无效"), "Hook 响应无效");
        assert_eq!(safe_detail("SessionStart"), "SessionStart");
        assert_eq!(
            safe_detail(r"启动灵动岛失败：C:\Users\private\app.exe"),
            "启动灵动岛失败"
        );
    }

    #[test]
    fn log_child() {
        let Some(dir) = std::env::var_os("CODEXLIMIT_TEST_LOG_DIR") else {
            return;
        };
        let limit = std::env::var("CODEXLIMIT_TEST_LOG_LIMIT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(MAX_BYTES);
        for i in 0..100 {
            write_at(
                Path::new(&dir),
                &format!("child-line-{i}"),
                Some("prompt=secret"),
                limit,
            )
            .unwrap();
        }
    }
    #[test]
    fn concurrent_processes_append_complete_private_records() {
        let dir = tempfile::tempdir().unwrap();
        let mut children = Vec::new();
        for _ in 0..4 {
            children.push(
                std::process::Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", "diagnostics::tests::log_child", "--quiet"])
                    .env("CODEXLIMIT_TEST_LOG_DIR", dir.path())
                    .stdout(std::process::Stdio::null())
                    .spawn()
                    .unwrap(),
            );
        }
        for mut child in children {
            assert!(child.wait().unwrap().success());
        }
        let text = fs::read_to_string(dir.path().join("codexlimit.log")).unwrap();
        assert_eq!(text.lines().count(), 400);
        assert!(!text.contains("secret"));
        assert!(text
            .lines()
            .all(|line| line.contains("child-line-") && line.ends_with("外部错误（隐私详情未记录）")));
    }
    #[test]
    fn rotation_is_bounded_and_conflict_is_observable() {
        let dir = tempfile::tempdir().unwrap();
        for _ in 0..1000 {
            write_at(dir.path(), "重复失败", Some("token=secret"), 512).unwrap();
        }
        for file in fs::read_dir(dir.path()).unwrap() {
            let file = file.unwrap();
            assert!(file.metadata().unwrap().len() <= 512);
        }
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 4);
        fs::remove_file(dir.path().join("codexlimit.log.2")).unwrap();
        fs::create_dir(dir.path().join("codexlimit.log.2")).unwrap();
        assert!(write_at(dir.path(), "再试", None, 1).is_err());
    }
    #[test]
    fn unavailable_directory_and_lock_do_not_block_forever() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("file");
        fs::write(&file, "x").unwrap();
        for _ in 0..1000 {
            assert!(write_at(&file, "test", None, MAX_BYTES).is_err());
        }
        let held = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(dir.path().join("writer.lock"))
            .unwrap();
        held.lock().unwrap();
        let at = Instant::now();
        assert!(write_at(dir.path(), "conflict", None, MAX_BYTES).is_err());
        assert!(at.elapsed() < Duration::from_secs(1));
        drop(held);
        write_at(dir.path(), "recovered", None, MAX_BYTES).unwrap();
    }

    #[test]
    fn multiple_processes_rotate_under_one_os_lock() {
        let dir = tempfile::tempdir().unwrap();
        let mut children = Vec::new();
        for _ in 0..4 {
            children.push(
                std::process::Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", "diagnostics::tests::log_child", "--quiet"])
                    .env("CODEXLIMIT_TEST_LOG_DIR", dir.path())
                    .env("CODEXLIMIT_TEST_LOG_LIMIT", "4096")
                    .stdout(std::process::Stdio::null())
                    .spawn()
                    .unwrap(),
            );
        }
        for mut child in children {
            assert!(child.wait().unwrap().success());
        }
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 4);
        for file in fs::read_dir(dir.path()).unwrap() {
            let file = file.unwrap();
            assert!(file.metadata().unwrap().len() <= 4096);
            if file.file_name() != "writer.lock" {
                let text = fs::read_to_string(file.path()).unwrap();
                assert!(text.ends_with('\n'));
                assert!(!text.contains("secret"));
                assert!(text
                    .lines()
                    .all(|line| line.contains("child-line-") && line.ends_with("外部错误（隐私详情未记录）")));
            }
        }
    }
}
