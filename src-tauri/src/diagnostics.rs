use std::{env, fs::OpenOptions, io::{self, Write}, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};

fn log_path() -> io::Result<PathBuf> {
    Ok(env::current_exe()?.with_file_name("codexlimit-startup.log"))
}

// 只记录启动阶段与错误，不写入 Hook 输入、会话 ID、工作目录或工具数据。
pub(crate) fn log(stage: &str, error: Option<&str>) {
    let result = (|| -> io::Result<()> {
        let path = log_path()?;
        let mut file = OpenOptions::new().create(true).append(true).open(path)?;
        let at = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
        match error {
            Some(error) => writeln!(file, "{at} pid={} {stage}: {error}", std::process::id()),
            None => writeln!(file, "{at} pid={} {stage}", std::process::id()),
        }
    })();
    if let Err(error) = result { eprintln!("写入启动日志失败：{error}"); }
}
