use std::{io::{self, Read, Write}, net::{Ipv4Addr, SocketAddrV4, TcpStream}, process::{Command, Stdio}, time::{Duration, Instant}};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetStdHandle(n_std_handle: u32) -> *mut std::ffi::c_void;
    fn SetHandleInformation(handle: *mut std::ffi::c_void, mask: u32, flags: u32) -> i32;
}

const ADDRESS: SocketAddrV4 = SocketAddrV4::new(Ipv4Addr::LOCALHOST, 17321);
const CONNECT_TIMEOUT: Duration = Duration::from_millis(200);
// SessionEnd 和 Interrupt 的 Codex Hook 总超时上限为 3 秒，预留进程启动与退出开销。
const END_START_TIMEOUT: Duration = Duration::from_millis(2_500);
const START_TIMEOUT: Duration = Duration::from_secs(10);

enum SendError { Unavailable, Rejected(u16), InvalidResponse }

#[cfg(windows)]
fn prevent_hook_pipe_inheritance() -> Result<(), String> {
    const HANDLE_FLAG_INHERIT: u32 = 1;
    // GUI 长驻进程不能继承 Codex 用来等待 Hook 结束的标准流管道。
    for kind in [-10i32, -11, -12] {
        let handle = unsafe { GetStdHandle(kind as u32) };
        if handle.is_null() || handle == (-1isize as *mut std::ffi::c_void) { continue; }
        if unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0) } == 0 {
            return Err(format!("关闭 Hook 标准流继承失败：{}", io::Error::last_os_error()));
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn prevent_hook_pipe_inheritance() -> Result<(), String> { Ok(()) }

fn post(input: &[u8]) -> Result<(), SendError> {
    let mut stream = TcpStream::connect_timeout(&ADDRESS.into(), CONNECT_TIMEOUT).map_err(|_| SendError::Unavailable)?;
    stream.set_read_timeout(Some(CONNECT_TIMEOUT)).map_err(|_| SendError::Unavailable)?;
    stream.set_write_timeout(Some(CONNECT_TIMEOUT)).map_err(|_| SendError::Unavailable)?;
    write!(stream, "POST /api/codex/hook HTTP/1.1\r\nHost: 127.0.0.1:17321\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", input.len()).map_err(|_| SendError::Unavailable)?;
    stream.write_all(input).map_err(|_| SendError::Unavailable)?;
    let mut response = [0u8; 64];
    let count = stream.read(&mut response).map_err(|_| SendError::Unavailable)?;
    let line = String::from_utf8_lossy(&response[..count]);
    let status = line.split_whitespace().nth(1).and_then(|value| value.parse::<u16>().ok()).ok_or(SendError::InvalidResponse)?;
    if status == 204 { Ok(()) } else { Err(SendError::Rejected(status)) }
}

fn send_with_start(input: &[u8], mut suppressed: impl FnMut() -> bool, mut start: impl FnMut() -> Result<(), String>, mut send: impl FnMut(&[u8]) -> Result<(), SendError>, deadline: Duration) -> Result<(), String> {
    match send(input) {
        Ok(()) => return Ok(()),
        Err(SendError::Rejected(code)) => return Err(format!("Hook 请求被拒绝，HTTP {code}")),
        Err(SendError::InvalidResponse) => return Err("Hook 响应无效".into()),
        Err(SendError::Unavailable) => {},
    }
    if suppressed() { return Ok(()); }
    start()?;
    let until = Instant::now() + deadline;
    while Instant::now() < until {
        std::thread::sleep(Duration::from_millis(75));
        match send(input) {
            Ok(()) => return Ok(()),
            Err(SendError::Rejected(code)) => return Err(format!("Hook 请求被拒绝，HTTP {code}")),
            Err(SendError::InvalidResponse) => return Err("Hook 响应无效".into()),
            Err(SendError::Unavailable) => {},
        }
    }
    Err("Hook 监听启动超时".into())
}

pub fn run() -> Result<(), String> {
    run_inner().inspect_err(|error| super::diagnostics::log("Hook 发送失败", Some(error)))
}

fn run_inner() -> Result<(), String> {
    let mut input = Vec::new();
    io::stdin().take(super::activity::MAX_HOOK_BYTES + 1).read_to_end(&mut input)
        .map_err(|error| format!("读取 Hook 输入失败：{error}"))?;
    validate_input(&input)?;
    let event_name = serde_json::from_slice::<serde_json::Value>(&input)
        .ok().and_then(|value| value.get("hook_event_name")?.as_str().map(str::to_owned));
    if matches!(event_name.as_deref(), Some("SessionStart" | "UserPromptSubmit" | "SessionEnd")) {
        super::diagnostics::log("Codex 已调用 Hook", event_name.as_deref());
    }
    let deadline = match event_name.as_deref() {
        Some("SessionEnd" | "Interrupt") => END_START_TIMEOUT,
        _ => START_TIMEOUT,
    };
    send_with_start(&input, super::app_paths::is_auto_start_suppressed, || {
        super::diagnostics::log("Hook 未发现监听，尝试启动 GUI", None);
        let exe = std::env::current_exe().map_err(|error| format!("定位当前程序失败：{error}"))?;
        prevent_hook_pipe_inheritance()?;
        let mut command = Command::new(exe);
        command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        command.spawn().map_err(|error| format!("启动灵动岛失败：{error}"))?;
        Ok(())
    }, post, deadline)
}

fn validate_input(input: &[u8]) -> Result<(), String> {
    if input.is_empty() || input.len() as u64 > super::activity::MAX_HOOK_BYTES { Err("Hook 输入长度无效".into()) } else { Ok(()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn running_listener_sends_without_start() {
        let starts = Cell::new(0);
        let result = send_with_start(b"{}", || true, || { starts.set(starts.get() + 1); Ok(()) }, |_| Ok(()), Duration::from_millis(1));
        assert!(result.is_ok()); assert_eq!(starts.get(), 0);
    }
    #[test]
    fn starts_and_retries_current_event() {
        let attempts = Cell::new(0);
        let starts = Cell::new(0);
        let result = send_with_start(b"{}", || false, || { starts.set(starts.get() + 1); Ok(()) }, |_| {
            attempts.set(attempts.get() + 1);
            if attempts.get() == 1 { Err(SendError::Unavailable) } else { Ok(()) }
        }, Duration::from_millis(300));
        assert!(result.is_ok()); assert_eq!(starts.get(), 1); assert_eq!(attempts.get(), 2);
    }
    #[test]
    fn suppressed_without_listener_does_not_start() {
        let starts = Cell::new(0);
        let result = send_with_start(b"{}", || true, || { starts.set(starts.get() + 1); Ok(()) }, |_| Err(SendError::Unavailable), Duration::from_millis(1));
        assert!(result.is_ok());
        assert_eq!(starts.get(), 0);
    }
    #[test]
    fn timeout_and_rejection_are_bounded() {
        let timeout = send_with_start(b"{}", || false, || Ok(()), |_| Err(SendError::Unavailable), Duration::from_millis(1));
        assert!(timeout.unwrap_err().contains("超时"));
        let rejected = send_with_start(b"{}", || false, || panic!("不应启动"), |_| Err(SendError::Rejected(400)), Duration::from_millis(1));
        assert!(rejected.unwrap_err().contains("400"));
    }
    #[test]
    fn oversized_input_is_rejected() {
        assert!(validate_input(&vec![0; super::super::activity::MAX_HOOK_BYTES as usize + 1]).is_err());
    }

}
