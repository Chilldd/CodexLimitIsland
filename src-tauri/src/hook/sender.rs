#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    io::{self, Read, Write},
    net::TcpStream,
    path::PathBuf,
    process::{Command, Stdio},
    time::{Duration, Instant},
};
#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{SetHandleInformation, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE},
    System::Console::{GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE},
};

use crate::constants::HOOK_ADDRESS as ADDRESS;
const CONNECT_TIMEOUT: Duration = Duration::from_millis(200);
// SessionEnd 和 Interrupt 的 Codex Hook 总超时上限为 3 秒，预留进程启动与退出开销。
const END_START_TIMEOUT: Duration = Duration::from_millis(2_500);
const START_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, PartialEq, Eq)]
enum SendError {
    Unavailable,
    ConnectionFailed,
    Unconfirmed,
    Rejected(u16),
    InvalidResponse,
}

#[cfg(windows)]
fn prevent_hook_pipe_inheritance() -> Result<(), String> {
    let handles = [
        unsafe { GetStdHandle(STD_INPUT_HANDLE) },
        unsafe { GetStdHandle(STD_OUTPUT_HANDLE) },
        unsafe { GetStdHandle(STD_ERROR_HANDLE) },
    ];
    prevent_handle_inheritance(&handles)
}
#[cfg(windows)]
fn prevent_handle_inheritance(handles: &[windows_sys::Win32::Foundation::HANDLE]) -> Result<(), String> {
    for &handle in handles {
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            continue;
        }
        if unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0) } == 0 {
            return Err(format!("关闭 Hook 标准流继承失败：{}", io::Error::last_os_error()));
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn prevent_hook_pipe_inheritance() -> Result<(), String> {
    Ok(())
}

fn auto_start_command(executable: PathBuf) -> Command {
    let mut command = Command::new(executable);
    command
        .arg("--auto-start")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(crate::constants::CREATE_NO_WINDOW);
    command
}

fn post(input: &[u8]) -> Result<(), SendError> {
    post_to(input, ADDRESS.into(), CONNECT_TIMEOUT)
}

fn connect_error(error: io::Error) -> SendError {
    // Windows 回环端口未监听时，短连接期限也可能先表现为超时。
    if matches!(error.kind(), io::ErrorKind::ConnectionRefused | io::ErrorKind::TimedOut) {
        SendError::Unavailable
    } else {
        SendError::ConnectionFailed
    }
}

fn post_to(input: &[u8], address: std::net::SocketAddr, timeout: Duration) -> Result<(), SendError> {
    let mut stream = TcpStream::connect_timeout(&address, timeout).map_err(connect_error)?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|_| SendError::Unconfirmed)?;
    write!(stream, "POST /api/codex/hook HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", input.len()).map_err(|_| SendError::Unconfirmed)?;
    stream.write_all(input).map_err(|_| SendError::Unconfirmed)?;
    // 限制总读取时间与状态行长度，分段到达不能被误当成完整确认。
    let until = Instant::now() + timeout;
    let mut response = Vec::new();
    while !response.ends_with(b"\r\n") {
        if response.len() >= 1024 {
            return Err(SendError::InvalidResponse);
        }
        let remaining = until
            .checked_duration_since(Instant::now())
            .filter(|value| !value.is_zero())
            .ok_or(SendError::Unconfirmed)?;
        stream
            .set_read_timeout(Some(remaining))
            .map_err(|_| SendError::Unconfirmed)?;
        let mut byte = [0];
        stream.read_exact(&mut byte).map_err(|_| SendError::Unconfirmed)?;
        response.push(byte[0]);
    }
    let line = std::str::from_utf8(&response).map_err(|_| SendError::InvalidResponse)?;
    let mut fields = line.split_whitespace();
    if !matches!(fields.next(), Some("HTTP/1.1" | "HTTP/1.0")) {
        return Err(SendError::InvalidResponse);
    }
    let code = fields
        .next()
        .filter(|code| code.len() == 3 && code.bytes().all(|byte| byte.is_ascii_digit()))
        .ok_or(SendError::InvalidResponse)?;
    let status = code.parse::<u16>().map_err(|_| SendError::InvalidResponse)?;
    if status == 204 {
        Ok(())
    } else {
        Err(SendError::Rejected(status))
    }
}

fn send_with_start(
    input: &[u8],
    mut suppressed: impl FnMut() -> Result<bool, String>,
    mut start: impl FnMut() -> Result<(), String>,
    mut send: impl FnMut(&[u8]) -> Result<(), SendError>,
    deadline: Duration,
) -> Result<(), String> {
    match send(input) {
        Ok(()) => return Ok(()),
        Err(SendError::Rejected(code)) => return Err(format!("Hook 请求被拒绝，HTTP {code}")),
        Err(SendError::InvalidResponse) => return Err("Hook 响应无效".into()),
        Err(SendError::ConnectionFailed) => return Err("Hook 连接失败".into()),
        Err(SendError::Unconfirmed) => return Err("Hook 已连接但未收到有效确认，事件可能已处理".into()),
        Err(SendError::Unavailable) => {}
    }
    if suppressed()? {
        return Ok(());
    }
    start()?;
    let until = Instant::now() + deadline;
    while Instant::now() < until {
        std::thread::sleep(Duration::from_millis(75));
        match send(input) {
            Ok(()) => return Ok(()),
            Err(SendError::Rejected(code)) => return Err(format!("Hook 请求被拒绝，HTTP {code}")),
            Err(SendError::InvalidResponse) => return Err("Hook 响应无效".into()),
            Err(SendError::ConnectionFailed) => return Err("Hook 连接失败".into()),
            Err(SendError::Unconfirmed) => return Err("Hook 已连接但未收到有效确认，事件可能已处理".into()),
            Err(SendError::Unavailable) => {}
        }
    }
    Err("Hook 监听启动超时".into())
}

pub fn run() -> Result<(), String> {
    run_inner().inspect_err(|error| crate::diagnostics::log("Hook 发送失败", Some(error)))
}

fn run_inner() -> Result<(), String> {
    let mut input = Vec::new();
    io::stdin()
        .take(crate::constants::MAX_HOOK_BYTES + 1)
        .read_to_end(&mut input)
        .map_err(|error| format!("读取 Hook 输入失败：{error}"))?;
    validate_input(&input)?;
    let event_name = serde_json::from_slice::<serde_json::Value>(&input)
        .ok()
        .and_then(|value| value.get("hook_event_name")?.as_str().map(str::to_owned));
    let kind = event_name
        .as_deref()
        .and_then(|name| name.parse::<super::protocol::HookEventKind>().ok());
    use super::protocol::HookEventKind;
    if matches!(
        kind,
        Some(HookEventKind::SessionStart | HookEventKind::UserPromptSubmit | HookEventKind::SessionEnd)
    ) {
        crate::diagnostics::log("Codex 已调用 Hook", event_name.as_deref());
    }
    let deadline = match kind {
        Some(HookEventKind::SessionEnd | HookEventKind::Interrupt) => END_START_TIMEOUT,
        _ => START_TIMEOUT,
    };
    send_with_start(
        &input,
        crate::app_paths::is_auto_start_suppressed,
        || {
            crate::diagnostics::log("Hook 未发现监听，尝试启动 GUI", None);
            let exe = std::env::current_exe().map_err(|error| format!("定位当前程序失败：{error}"))?;
            prevent_hook_pipe_inheritance()?;
            auto_start_command(exe)
                .spawn()
                .map_err(|error| format!("启动灵动岛失败：{error}"))?;
            Ok(())
        },
        post,
        deadline,
    )
}

fn validate_input(input: &[u8]) -> Result<(), String> {
    if input.is_empty() || input.len() as u64 > crate::constants::MAX_HOOK_BYTES {
        Err("Hook 输入长度无效".into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::net::Ipv4Addr;

    fn fake_http(chunks: Vec<Vec<u8>>, pause: Duration, timeout: Duration) -> Result<(), SendError> {
        use std::{
            io::{BufRead, BufReader},
            net::TcpListener,
        };
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
            let mut reader = BufReader::new(&mut stream);
            let mut length = 0;
            loop {
                let mut line = String::new();
                assert!(reader.read_line(&mut line).unwrap() > 0, "测试请求头提前结束");
                if let Some(value) = line.strip_prefix("Content-Length: ") {
                    length = value.trim().parse::<usize>().unwrap();
                }
                if line == "\r\n" {
                    break;
                }
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            assert_eq!(body, b"{}");
            for chunk in chunks {
                std::thread::sleep(pause);
                if stream.write_all(&chunk).is_err() {
                    break;
                }
            }
        });
        let result = post_to(b"{}", address, timeout);
        server.join().unwrap();
        result
    }

    #[test]
    fn http_confirmation_handles_fragmentation_rejection_and_invalid_lines() {
        let timeout = Duration::from_secs(1);
        assert_eq!(
            fake_http(
                vec![b"HTTP/1.1 2".to_vec(), b"04 No Content\r".to_vec(), b"\n".to_vec()],
                Duration::from_millis(5),
                timeout
            ),
            Ok(())
        );
        assert_eq!(
            fake_http(vec![b"HTTP/1.1 400 Bad Request\r\n".to_vec()], Duration::ZERO, timeout),
            Err(SendError::Rejected(400))
        );
        for line in [b"garbage 204 OK\r\n".as_slice(), b"HTTP/1.1 20 OK\r\n", &[b'x'; 1024]] {
            assert_eq!(
                fake_http(vec![line.to_vec()], Duration::ZERO, timeout),
                Err(SendError::InvalidResponse)
            );
        }
    }

    #[test]
    fn lost_or_timed_out_acknowledgement_is_not_listener_unavailability() {
        assert_eq!(
            fake_http(vec![b"HTTP/1.1 20".to_vec()], Duration::ZERO, Duration::from_secs(1)),
            Err(SendError::Unconfirmed)
        );
        assert_eq!(
            fake_http(
                vec![b"HTTP/1.1 204 No Content\r\n".to_vec()],
                Duration::from_millis(150),
                Duration::from_millis(30)
            ),
            Err(SendError::Unconfirmed)
        );
        for error in [
            SendError::Unconfirmed,
            SendError::ConnectionFailed,
            SendError::InvalidResponse,
            SendError::Rejected(400),
        ] {
            let mut error = Some(error);
            assert!(send_with_start(
                b"{}",
                || panic!("不检查标记"),
                || panic!("不得启动"),
                |_| Err(error.take().unwrap()),
                Duration::ZERO
            )
            .is_err());
        }
    }

    #[test]
    fn unavailable_connections_and_other_connect_errors_have_distinct_policies() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        // Windows 防火墙可能将未监听端口表现为超时；两种情况都必须有界失败。
        assert_eq!(post_to(b"{}", address, CONNECT_TIMEOUT), Err(SendError::Unavailable));
        assert_eq!(
            connect_error(io::ErrorKind::ConnectionRefused.into()),
            SendError::Unavailable
        );
        assert_eq!(connect_error(io::ErrorKind::TimedOut.into()), SendError::Unavailable);
        assert_eq!(
            connect_error(io::ErrorKind::PermissionDenied.into()),
            SendError::ConnectionFailed
        );
        assert!(send_with_start(
            b"{}",
            || Err("读取退出标记失败".into()),
            || panic!("读取失败不得启动"),
            |_| Err(SendError::Unavailable),
            Duration::ZERO
        )
        .is_err());
    }

    #[test]
    fn running_listener_sends_without_start() {
        let starts = Cell::new(0);
        let result = send_with_start(
            b"{}",
            || Ok(true),
            || {
                starts.set(starts.get() + 1);
                Ok(())
            },
            |_| Ok(()),
            Duration::from_millis(1),
        );
        assert!(result.is_ok());
        assert_eq!(starts.get(), 0);
    }
    #[test]
    fn starts_and_retries_current_event() {
        let attempts = Cell::new(0);
        let starts = Cell::new(0);
        let result = send_with_start(
            b"{}",
            || Ok(false),
            || {
                starts.set(starts.get() + 1);
                Ok(())
            },
            |_| {
                attempts.set(attempts.get() + 1);
                if attempts.get() == 1 {
                    Err(SendError::Unavailable)
                } else {
                    Ok(())
                }
            },
            Duration::from_millis(300),
        );
        assert!(result.is_ok());
        assert_eq!(starts.get(), 1);
        assert_eq!(attempts.get(), 2);
    }
    #[test]
    fn suppressed_without_listener_does_not_start() {
        let starts = Cell::new(0);
        let result = send_with_start(
            b"{}",
            || Ok(true),
            || {
                starts.set(starts.get() + 1);
                Ok(())
            },
            |_| Err(SendError::Unavailable),
            Duration::from_millis(1),
        );
        assert!(result.is_ok());
        assert_eq!(starts.get(), 0);
    }
    #[test]
    fn timeout_and_rejection_are_bounded() {
        let timeout = send_with_start(
            b"{}",
            || Ok(false),
            || Ok(()),
            |_| Err(SendError::Unavailable),
            Duration::from_millis(1),
        );
        assert!(timeout.unwrap_err().contains("超时"));
        let rejected = send_with_start(
            b"{}",
            || Ok(false),
            || panic!("不应启动"),
            |_| Err(SendError::Rejected(400)),
            Duration::from_millis(1),
        );
        assert!(rejected.unwrap_err().contains("400"));
    }
    #[test]
    fn oversized_input_is_rejected() {
        assert!(validate_input(&vec![0; crate::constants::MAX_HOOK_BYTES as usize + 1]).is_err());
    }

    #[test]
    fn hook_spawns_gui_in_auto_start_mode() {
        let command = auto_start_command(PathBuf::from("codexlimit.exe"));
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            [std::ffi::OsStr::new("--auto-start")]
        );
    }

    #[cfg(windows)]
    #[test]
    fn official_handle_binding_clears_inheritance_on_a_test_file() {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Foundation::GetHandleInformation;
        let file = tempfile::tempfile().unwrap();
        let handle = file.as_raw_handle();
        assert_ne!(
            unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) },
            0
        );
        prevent_handle_inheritance(&[std::ptr::null_mut(), INVALID_HANDLE_VALUE, handle]).unwrap();
        let mut flags = 0;
        assert_ne!(unsafe { GetHandleInformation(handle, &mut flags) }, 0);
        assert_eq!(flags & HANDLE_FLAG_INHERIT, 0);
    }
    #[test]
    fn unknown_future_event_json_is_forwarded_unchanged() {
        let input = br#"{"hook_event_name":"FutureHook","session_id":"legacy"}"#;
        let mut sent = false;
        send_with_start(
            input,
            || panic!("not needed"),
            || panic!("not needed"),
            |bytes| {
                assert_eq!(bytes, input);
                sent = true;
                Ok(())
            },
            START_TIMEOUT,
        )
        .unwrap();
        assert!(sent);
    }
}
