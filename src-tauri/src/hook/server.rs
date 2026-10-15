use super::protocol::*;
use crate::{
    activity::{model::*, registry::*},
    constants::{HOOK_ADDRESS, MAX_HOOK_BYTES},
};
use serde_json::Value;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::Emitter;
const MAX_HEADER_BYTES: usize = 16 * 1024;
#[derive(Clone, Default)]
pub(crate) struct ActivityState(Arc<Mutex<SessionRegistry>>);
fn read_exact_until(stream: &mut TcpStream, mut bytes: &mut [u8], until: Instant) -> Result<(), String> {
    while !bytes.is_empty() {
        let remaining = until
            .checked_duration_since(Instant::now())
            .filter(|t| !t.is_zero())
            .ok_or("Hook 请求超时")?;
        stream
            .set_read_timeout(Some(remaining))
            .map_err(|_| "设置 Hook 接收超时失败")?;
        let n = stream.read(bytes).map_err(|_| "读取 Hook 请求失败")?;
        if n == 0 {
            return Err("Hook 请求提前结束".into());
        }
        bytes = &mut bytes[n..];
    }
    Ok(())
}
fn read_http_event(stream: &mut TcpStream) -> Result<HookEvent, String> {
    let until = Instant::now() + Duration::from_secs(1);
    let mut headers = Vec::new();
    while !headers.ends_with(b"\r\n\r\n") {
        if headers.len() >= MAX_HEADER_BYTES {
            return Err("HTTP 请求头过大".into());
        }
        let mut byte = [0];
        read_exact_until(stream, &mut byte, until)?;
        headers.push(byte[0]);
    }
    let header = std::str::from_utf8(&headers).map_err(|_| "HTTP 请求头编码无效")?;
    let mut lines = header.split("\r\n");
    if !lines
        .next()
        .is_some_and(|line| line == "POST /api/codex/hook HTTP/1.1" || line == "POST /api/codex/hook HTTP/1.0")
    {
        return Err("HTTP 方法或路径无效".into());
    }
    let mut length = None;
    for line in lines.filter(|line| !line.is_empty()) {
        let (name, value) = line.split_once(':').ok_or("HTTP 请求头无效")?;
        if name.eq_ignore_ascii_case("transfer-encoding") {
            return Err("不支持分块 Hook 请求".into());
        }
        if name.eq_ignore_ascii_case("content-length") {
            if length.is_some() {
                return Err("重复 Content-Length".into());
            }
            length = Some(value.trim().parse::<u64>().map_err(|_| "Content-Length 无效")?);
        }
    }
    let length = length.ok_or("缺少有效的 Content-Length")?;
    if length == 0 || length > MAX_HOOK_BYTES {
        return Err("Hook 请求体长度无效".into());
    }
    let mut input = vec![0; length as usize];
    read_exact_until(stream, &mut input, until)?;
    let value: Value = serde_json::from_slice(&input).map_err(|error| format!("Hook JSON 无效：{error}"))?;
    normalize_hook(&value)
}

// 先发送关闭方向的 FIN，再有限排空已到达的请求体，避免 Windows 丢弃 400 响应而只返回 RST。
fn reject_http(stream: &mut TcpStream) {
    let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    let _ = stream.shutdown(std::net::Shutdown::Write);
    let until = Instant::now() + Duration::from_millis(10);
    let mut buffer = [0u8; 8192];
    let mut drained = 0;
    while drained < MAX_HOOK_BYTES {
        let Some(left) = until
            .checked_duration_since(Instant::now())
            .filter(|left| !left.is_zero())
        else {
            break;
        };
        if stream.set_read_timeout(Some(left)).is_err() {
            break;
        }
        match stream.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => drained += count as u64,
        }
    }
}
pub(crate) fn receive_http(
    mut stream: TcpStream,
    process: impl FnOnce(HookEvent) -> Result<(), String>,
) -> Result<(), String> {
    stream
        .set_write_timeout(Some(Duration::from_millis(250)))
        .map_err(|_| "设置 Hook 响应超时失败")?;
    stream
        .set_read_timeout(Some(Duration::from_secs(1)))
        .map_err(|error| format!("设置 Hook 接收超时失败：{error}"))?;
    let event = match read_http_event(&mut stream) {
        Ok(event) => event,
        Err(error) => {
            reject_http(&mut stream);
            return Err(error);
        }
    };
    process(event)?;
    stream
        .write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        .map_err(|error| format!("返回 Hook 响应失败：{error}"))
}

fn receive_connection(
    stream: TcpStream,
    app: &tauri::AppHandle,
    state: &ActivityState,
    refresher: &crate::usage::UsageRefresher,
) -> Result<(), String> {
    receive_http(stream, |event| {
        let refresh_usage = event.hook_event_name == HookEventKind::SessionEnd
            || (event.hook_event_name == HookEventKind::Stop && event.agent_id.is_none());
        let snapshot = {
            let mut registry = crate::sync_state::lock(&state.0);
            apply_event(&mut registry, event);
            cleanup_registry(&mut registry, now_ms());
            snapshot(&mut registry)
        };
        app.emit("activity-updated", snapshot)
            .map_err(|error| format!("通知界面失败：{error}"))?;
        if refresh_usage {
            refresher.request();
        }
        Ok(())
    })
}

pub(crate) fn start_listener(
    app: tauri::AppHandle,
    state: ActivityState,
    refresher: crate::usage::UsageRefresher,
) -> Result<(), String> {
    let listener = TcpListener::bind(HOOK_ADDRESS)
        .map_err(|error| format!("启动 Hook 监听失败（可能已有灵动岛实例）：{error}"))?;
    let cleanup_app = app.clone();
    let workers_state = state.clone();
    let (sender, _workers) = worker_pool(move |stream| {
        if let Err(error) = receive_connection(stream, &app, &workers_state, &refresher) {
            crate::diagnostics::log("处理 Hook 失败", Some(&error));
        }
    });
    std::thread::spawn(move || {
        for connection in listener.incoming() {
            match connection {
                Ok(stream) => {
                    admit(&sender, stream);
                }
                Err(error) => crate::diagnostics::log("接收 Hook 连接失败", Some(&error.to_string())),
            }
        }
    });
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let mut registry = crate::sync_state::lock(&state.0);
        if cleanup_registry(&mut registry, now_ms()) {
            let next = snapshot(&mut registry);
            drop(registry);
            if let Err(error) = cleanup_app.emit("activity-updated", next) {
                crate::diagnostics::log("通知活动更新失败", Some(&error.to_string()));
            }
        }
    });
    Ok(())
}

fn read_activity_snapshot(state: &ActivityState) -> Result<ActivitySnapshot, String> {
    let mut registry = crate::sync_state::lock(&state.0);
    cleanup_registry(&mut registry, now_ms());
    Ok(snapshot(&mut registry))
}

#[tauri::command]
pub(crate) async fn read_activity(state: tauri::State<'_, ActivityState>) -> Result<ActivitySnapshot, String> {
    read_activity_snapshot(&state)
}

const WORKERS: usize = 8;
const QUEUED: usize = 16;
fn worker_pool(
    process: impl Fn(TcpStream) + Send + Sync + 'static,
) -> (std::sync::mpsc::SyncSender<TcpStream>, Vec<std::thread::JoinHandle<()>>) {
    let (sender, receiver) = std::sync::mpsc::sync_channel::<TcpStream>(QUEUED);
    let receiver = Arc::new(Mutex::new(receiver));
    let process = Arc::new(process);
    let workers = (0..WORKERS)
        .map(|_| {
            let receiver = receiver.clone();
            let process = process.clone();
            std::thread::spawn(move || loop {
                let connection = match receiver.lock() {
                    Ok(receiver) => receiver.recv(),
                    Err(_) => {
                        crate::diagnostics::log("Hook 工作队列中毒，已停止", None);
                        return;
                    }
                };
                let Ok(stream) = connection else { return };
                process(stream);
            })
        })
        .collect();
    (sender, workers)
}
fn admit(sender: &std::sync::mpsc::SyncSender<TcpStream>, stream: TcpStream) {
    if let Err(error) = sender.try_send(stream) {
        let mut rejected = match error {
            std::sync::mpsc::TrySendError::Full(stream) | std::sync::mpsc::TrySendError::Disconnected(stream) => stream,
        };
        let _ = rejected.set_write_timeout(Some(Duration::from_millis(25)));
        let _ =
            rejected.write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn pair() -> (TcpStream, TcpStream) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let client = TcpStream::connect(l.local_addr().unwrap()).unwrap();
        (client, l.accept().unwrap().0)
    }
    #[test]
    fn rejects_ambiguous_headers_oversized_body_and_timeout() {
        for headers in [
            "Content-Length: 1\r\nContent-Length: 1",
            "Content-Length: 1\r\nTransfer-Encoding: chunked",
            "Content-Length: 1048577",
            "Missing: length",
        ] {
            let (mut client, server) = pair();
            client
                .write_all(format!("POST /api/codex/hook HTTP/1.1\r\n{headers}\r\n\r\nx").as_bytes())
                .unwrap();
            assert!(receive_http(server, |_| panic!("invalid request")).is_err());
            let mut reply = String::new();
            client.read_to_string(&mut reply).ok();
            assert!(reply.starts_with("HTTP/1.1 400"));
        }
        let (_client, server) = pair();
        let at = Instant::now();
        assert!(receive_http(server, |_| panic!("idle request")).is_err());
        assert!(at.elapsed() < Duration::from_secs(2));
    }
    #[test]
    fn pool_has_bounded_workers_and_queue_and_returns_503() {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Condvar,
        };
        let active = Arc::new(AtomicUsize::new(0));
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let inside = active.clone();
        let wait = gate.clone();
        let (sender, workers) = worker_pool(move |_stream| {
            inside.fetch_add(1, Ordering::SeqCst);
            let (lock, cv) = &*wait;
            let mut ready = lock.lock().unwrap();
            while !*ready {
                ready = cv.wait(ready).unwrap();
            }
        });
        let mut clients = Vec::new();
        for _ in 0..WORKERS {
            let (client, server) = pair();
            clients.push(client);
            sender.send(server).unwrap();
        }
        let until = Instant::now() + Duration::from_secs(2);
        while active.load(Ordering::SeqCst) != WORKERS {
            assert!(Instant::now() < until);
            std::thread::yield_now();
        }
        for _ in 0..QUEUED {
            let (client, server) = pair();
            clients.push(client);
            sender.try_send(server).unwrap();
        }
        let (mut client, server) = pair();
        admit(&sender, server);
        let mut reply = String::new();
        client.read_to_string(&mut reply).unwrap();
        assert!(reply.starts_with("HTTP/1.1 503"));
        assert_eq!(active.load(Ordering::SeqCst), WORKERS);
        *gate.0.lock().unwrap() = true;
        gate.1.notify_all();
        drop(sender);
        for worker in workers {
            worker.join().unwrap();
        }
        assert_eq!(active.load(Ordering::SeqCst), WORKERS + QUEUED);
    }
}
