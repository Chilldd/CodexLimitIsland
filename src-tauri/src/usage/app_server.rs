use super::{parse_limits, UsageRefresher, UsageSnapshot};
#[cfg(test)]
use crate::codex_runtime;
use serde_json::{json, Value};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    io::{self, BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc,
    time::Duration,
};
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(20);
pub(crate) struct AppServer {
    child: Child,
    stdin: ChildStdin,
    responses: mpsc::Receiver<String>,
    next_id: u64,
}

impl Drop for AppServer {
    fn drop(&mut self) {
        crate::system_resources::APP_SERVER_PID.store(0, std::sync::atomic::Ordering::Relaxed);
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl AppServer {
    #[cfg(test)]
    pub(crate) fn start() -> Result<Self, String> {
        Self::start_with(codex_runtime::find_codex_runtime()?)
    }

    pub(crate) fn start_with(executable: PathBuf) -> Result<Self, String> {
        Self::start_notified(executable, None)
    }
    pub(crate) fn start_notified(executable: PathBuf, refresher: Option<UsageRefresher>) -> Result<Self, String> {
        let mut command = Command::new(executable);
        command
            .arg("app-server")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        command.creation_flags(crate::constants::CREATE_NO_WINDOW); // CREATE_NO_WINDOW
        let mut child = command
            .spawn()
            .map_err(|error| format!("无法启动 Codex App Server：{error}"))?;
        crate::system_resources::APP_SERVER_PID.store(child.id(), std::sync::atomic::Ordering::Relaxed);
        let stdin = child.stdin.take().ok_or("Codex 标准输入不可用")?;
        let stdout = child.stdout.take().ok_or("Codex 标准输出不可用")?;
        let mut stderr = child.stderr.take().ok_or("Codex 错误输出不可用")?;
        let (sender, responses) = mpsc::sync_channel(32);
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(line) => {
                        if let Ok(value) = serde_json::from_str::<Value>(&line) {
                            if value.get("method").and_then(Value::as_str) == Some("account/rateLimits/updated") {
                                if let Some(events) = &refresher {
                                    events.request();
                                }
                            } else if value.get("id").is_some() && sender.send(line).is_err() {
                                break;
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        });
        std::thread::spawn(move || {
            let _ = io::copy(&mut stderr, &mut io::sink());
        });

        let mut server = Self {
            child,
            stdin,
            responses,
            next_id: 1,
        };
        server.send(&json!({
            "method": "initialize", "id": 1,
            "params": { "clientInfo": {
                "name": "codex_limit_island", "title": "Codex Limit Island", "version": env!("CARGO_PKG_VERSION")
            }}
        }))?;
        server.wait_for(1)?;
        server.send(&json!({"method": "initialized", "params": {}}))?;
        Ok(server)
    }

    pub(crate) fn read_limits(&mut self) -> Result<UsageSnapshot, String> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(&json!({"method": "account/rateLimits/read", "id": id, "params": {}}))?;
        let response = self.wait_for(id)?;
        parse_limits(&response)
    }

    fn send(&mut self, message: &Value) -> Result<(), String> {
        writeln!(self.stdin, "{message}")
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("向 Codex 发送请求失败：{error}"))
    }

    fn wait_for(&mut self, id: u64) -> Result<Value, String> {
        loop {
            let line = self
                .responses
                .recv_timeout(RESPONSE_TIMEOUT)
                .map_err(|_| "等待 Codex 响应超时或连接已关闭".to_string())?;
            let value: Value = serde_json::from_str(&line).map_err(|_| "Codex 返回了无法解析的数据".to_string())?;
            if value.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }
            if let Some(error) = value.get("error") {
                return Err(error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Codex 查询失败")
                    .to_string());
            }
            return Ok(value);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires a signed-in Codex App on Windows"]
    fn reads_live_limits_twice() {
        let mut server = AppServer::start().unwrap();
        let first = server.read_limits().unwrap();
        let second = server.read_limits().unwrap();
        assert!(first.five_hour.is_some() || first.weekly.is_some());
        assert!(second.five_hour.is_some() || second.weekly.is_some());
    }
}
