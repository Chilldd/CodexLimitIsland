use serde::Serialize;
use serde_json::Value;
use std::{collections::HashMap, io::{Read, Write}, net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream}, path::Path, sync::{Mutex, OnceLock}, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::Emitter;

static REGISTRY: OnceLock<Mutex<SessionRegistry>> = OnceLock::new();
const STALE_AFTER_MS: u64 = 10 * 60 * 1000;
const ACTIVE_AFTER_MS: u64 = 2 * 60 * 60 * 1000;
const RESULT_RETENTION_MS: u64 = 12_000;
pub const MAX_HOOK_BYTES: u64 = 1024 * 1024;
const HOOK_PORT: u16 = 17321;
const MAX_HEADER_BYTES: usize = 16 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub project: Option<String>,
    pub cwd: Option<String>,
    pub lifecycle: Lifecycle,
    pub activity: Option<Activity>,
    pub attention: Attention,
    pub current_command: Option<String>,
    pub started_at: Option<u64>,
    pub last_activity_at: u64,
    pub model: Option<String>,
    #[serde(rename = "currentTurnId")]
    pub current_turn_id: Option<String>,
    #[serde(skip_serializing)]
    pub root_activity: Activity,
    pub agents: Vec<Agent>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent { pub id: String, pub activity: Option<Activity>, pub attention: Attention, pub last_activity_at: u64 }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Activity { Thinking, Working, Searching, Editing, Executing, Connecting, Compacting }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Attention { None, Permission }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Lifecycle { Idle, Active }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TurnResultKind { Completed, Interrupted }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnResult {
    pub kind: TurnResultKind,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub finished_at: u64,
    pub project: Option<String>,
    pub model: Option<String>,
    pub started_at: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySnapshot { pub sessions: Vec<Session>, pub recent_results: Vec<TurnResult>, pub updated_at: u64 }

#[derive(Clone, Serialize)]
struct HookEvent {
    hook_event_name: String,
    session_id: String,
    cwd: String,
    observed_at: u64,
    model: Option<String>,
    agent_id: Option<String>,
    turn_id: Option<String>,
    tool_name: Option<String>,
    tool_use_id: Option<String>,
}

#[derive(Default)]
struct SessionRegistry { sessions: HashMap<String, Session>, active_tools: HashMap<String, Vec<ActiveTool>>, recent_results: Vec<TurnResult>, updated_at: u64 }

struct ActiveTool { id: String, name: String, activity: Activity, started_at: u64, agent_id: Option<String> }

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn field<'a>(value: &'a Value, name: &str) -> Option<&'a str> { value.get(name).and_then(Value::as_str) }
fn project_of(cwd: &str) -> Option<String> { Path::new(cwd).file_name().map(|v| v.to_string_lossy().into_owned()) }
fn hook_address() -> SocketAddrV4 { SocketAddrV4::new(Ipv4Addr::LOCALHOST, HOOK_PORT) }
fn normalize_hook(value: &Value) -> Result<HookEvent, String> {
    let hook_event_name = field(value, "hook_event_name").ok_or("Hook 缺少事件名")?;
    if !matches!(hook_event_name, "SessionStart" | "SessionEnd" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "PreCompact" | "PostCompact" | "SubagentStart" | "SubagentStop" | "PermissionRequest" | "Stop" | "Interrupt") { return Err("未知 Hook 事件".into()); }
    Ok(HookEvent {
        hook_event_name: hook_event_name.into(),
        session_id: field(value, "session_id").ok_or("Hook 缺少会话 ID")?.into(),
        cwd: field(value, "cwd").unwrap_or("").into(),
        observed_at: now_ms(),
        model: field(value, "model").map(str::to_string),
        agent_id: field(value, "agent_id").map(str::to_string),
        turn_id: field(value, "turn_id").map(str::to_string),
        tool_name: field(value, "tool_name").map(str::to_string),
        tool_use_id: field(value, "tool_use_id").map(str::to_string),
    })
}

fn read_http_event(stream: &mut TcpStream) -> Result<HookEvent, String> {
    let mut headers = Vec::new();
    while !headers.ends_with(b"\r\n\r\n") {
        if headers.len() >= MAX_HEADER_BYTES { return Err("HTTP 请求头过大".into()); }
        let mut byte = [0];
        stream.read_exact(&mut byte).map_err(|error| format!("读取 HTTP 请求头失败：{error}"))?;
        headers.push(byte[0]);
    }
    let header = std::str::from_utf8(&headers).map_err(|_| "HTTP 请求头编码无效")?;
    let mut lines = header.split("\r\n");
    if !lines.next().is_some_and(|line| line == "POST /api/codex/hook HTTP/1.1" || line == "POST /api/codex/hook HTTP/1.0") {
        return Err("HTTP 方法或路径无效".into());
    }
    let length = lines.filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.trim().parse::<u64>().ok())
        .ok_or("缺少有效的 Content-Length")?;
    if length == 0 || length > MAX_HOOK_BYTES { return Err("Hook 请求体长度无效".into()); }
    let mut input = vec![0; length as usize];
    stream.read_exact(&mut input).map_err(|error| format!("读取 Hook 请求体失败：{error}"))?;
    let value: Value = serde_json::from_slice(&input).map_err(|error| format!("Hook JSON 无效：{error}"))?;
    normalize_hook(&value)
}

fn receive_connection(mut stream: TcpStream, app: &tauri::AppHandle) -> Result<(), String> {
    stream.set_read_timeout(Some(Duration::from_secs(1))).map_err(|error| format!("设置 Hook 接收超时失败：{error}"))?;
    let event = match read_http_event(&mut stream) {
        Ok(event) => event,
        Err(error) => {
            let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            return Err(error);
        }
    };
    let refresh_usage = event.hook_event_name == "SessionEnd" || (event.hook_event_name == "Stop" && event.agent_id.is_none());
    let snapshot = {
        let mutex = REGISTRY.get_or_init(|| Mutex::new(SessionRegistry::default()));
        let mut registry = mutex.lock().map_err(|_| "会话状态不可用".to_string())?;
        apply_event(&mut registry, event);
        cleanup_registry(&mut registry, now_ms());
        snapshot(&mut registry)
    };
    app.emit("activity-updated", snapshot).map_err(|error| format!("通知界面失败：{error}"))?;
    if refresh_usage { crate::request_usage_refresh(); }
    stream.write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").map_err(|error| format!("返回 Hook 响应失败：{error}"))
}

pub fn start_listener(app: tauri::AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind(hook_address()).map_err(|error| format!("启动 Hook 监听失败（可能已有灵动岛实例）：{error}"))?;
    let cleanup_app = app.clone();
    std::thread::spawn(move || {
        for connection in listener.incoming() {
            match connection {
                Ok(stream) => {
                    let app = app.clone();
                    std::thread::spawn(move || {
                        if let Err(error) = receive_connection(stream, &app) { eprintln!("Codex Limit Island: {error}"); }
                    });
                }
                Err(error) => eprintln!("Codex Limit Island: 接收 Hook 连接失败：{error}"),
            }
        }
    });
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let Some(mutex) = REGISTRY.get() else { continue };
        let Ok(mut registry) = mutex.lock() else { continue };
        if cleanup_registry(&mut registry, now_ms()) {
            let next = snapshot(&mut registry);
            drop(registry);
            if let Err(error) = cleanup_app.emit("activity-updated", next) { eprintln!("通知界面失败：{error}"); }
        }
    });
    Ok(())
}

fn tool_activity(name: &str) -> Activity {
    let operation = name.rsplit("__").next().unwrap_or(name).to_ascii_lowercase();
    if matches!(operation.as_str(), "bash" | "exec_command" | "shell_command") { Activity::Executing }
    else if matches!(operation.as_str(), "apply_patch" | "edit" | "write") || operation.starts_with("write_") || operation.starts_with("edit_") { Activity::Editing }
    else if ["search", "find", "read", "list", "query", "get"].iter().any(|verb| operation == *verb || operation.starts_with(&format!("{verb}_"))) { Activity::Searching }
    else if name.starts_with("mcp__") { Activity::Connecting }
    else { Activity::Working }
}
fn foreground_activity(session: &mut Session, tools: &[ActiveTool]) {
    if session.lifecycle == Lifecycle::Idle { session.activity = None; session.current_command = None; return; }
    let root = tools.iter().filter(|tool| tool.agent_id.is_none()).max_by_key(|tool| tool.started_at);
    let other = tools.iter().filter(|tool| tool.agent_id.is_some()).max_by_key(|tool| tool.started_at);
    // 最近启动的 Root Tool 是前台动作；Read 可以暂时盖过仍在运行的 Bash。
    session.current_command = root.filter(|tool| tool.activity == Activity::Executing).map(|tool| tool.name.clone());
    session.activity = Some(root.or(other).map_or(session.root_activity, |tool| tool.activity));
}
fn update_agent(session: &mut Session, id: &str, activity: Option<Activity>, attention: Attention, at: u64) {
    if let Some(agent) = session.agents.iter_mut().find(|agent| agent.id == id) {
        agent.activity = activity; agent.attention = attention; agent.last_activity_at = at;
    } else {
        session.agents.push(Agent { id: id.into(), activity, attention, last_activity_at: at });
    }
}
fn apply_event(registry: &mut SessionRegistry, event: HookEvent) {
    if !matches!(event.hook_event_name.as_str(), "SessionStart" | "SessionEnd" | "UserPromptSubmit")
        && registry.sessions.get(&event.session_id).is_some_and(|session| session.lifecycle == Lifecycle::Idle
            && ((session.started_at.is_some() && session.current_turn_id == event.turn_id)
                || registry.recent_results.iter().rev().find(|result| result.session_id == event.session_id)
                    .is_some_and(|result| result.turn_id == event.turn_id))) { return; }
    let tools = registry.active_tools.entry(event.session_id.clone()).or_default();
    let session = registry.sessions.entry(event.session_id.clone()).or_insert_with(|| Session {
        id: event.session_id.clone(), project: project_of(&event.cwd), cwd: Some(event.cwd.clone()), lifecycle: Lifecycle::Idle,
        activity: None, attention: Attention::None, current_command: None, started_at: None, last_activity_at: event.observed_at,
        model: None, current_turn_id: None, root_activity: Activity::Thinking, agents: Vec::new(),
    });
    // 旧 Turn 的迟到事件不得改变当前 Turn；缺失 turn_id 的旧版 Hook 维持兼容。
    if event.hook_event_name != "SessionStart" && !(event.hook_event_name == "UserPromptSubmit" && event.agent_id.is_none()) {
        if let (Some(current), Some(incoming)) = (&session.current_turn_id, &event.turn_id) {
            if current != incoming { return; }
        }
    }
    let result = reduce_session(session, tools, event);
    if let Some(result) = result { registry.recent_results.push(result); }
}

// 所有领域状态写入都集中在这个事件入口；Registry 只负责索引和保留时间。
fn reduce_session(session: &mut Session, tools: &mut Vec<ActiveTool>, event: HookEvent) -> Option<TurnResult> {
    if !event.cwd.is_empty() { session.cwd = Some(event.cwd.clone()); session.project = project_of(&event.cwd); }
    if event.model.is_some() { session.model = event.model; }
    session.last_activity_at = event.observed_at;
    let agent_id = event.agent_id.as_deref();
    let mut result = None;
    match event.hook_event_name.as_str() {
        "SessionStart" => {},
        "SessionEnd" => { tools.clear(); session.lifecycle = Lifecycle::Idle; session.attention = Attention::None; session.agents.clear(); },
        "UserPromptSubmit" if agent_id.is_none() => {
            tools.clear(); session.agents.retain(|agent| agent.activity.is_some());
            session.current_turn_id = event.turn_id;
            session.root_activity = Activity::Thinking; session.attention = Attention::None;
            session.started_at = Some(event.observed_at); session.lifecycle = Lifecycle::Active;
        },
        "UserPromptSubmit" => { update_agent(session, agent_id.unwrap(), Some(Activity::Thinking), Attention::None, event.observed_at); },
        "PreToolUse" | "PostToolUse" | "PermissionRequest" | "PreCompact" | "PostCompact" | "SubagentStart" => {
            if session.lifecycle == Lifecycle::Idle {
                session.started_at = Some(event.observed_at); session.lifecycle = Lifecycle::Active;
                session.current_turn_id = event.turn_id.clone(); session.root_activity = Activity::Thinking;
            }
            match event.hook_event_name.as_str() {
                "PreToolUse" => {
                    let name = event.tool_name.unwrap_or_default();
                    let id = event.tool_use_id.unwrap_or_else(|| format!("legacy:{name}"));
                    tools.retain(|tool| tool.id != id || tool.agent_id.as_deref() != agent_id);
                    tools.push(ActiveTool { id, activity: tool_activity(&name), name, started_at: event.observed_at, agent_id: event.agent_id.clone() });
                    if let Some(id) = agent_id { update_agent(session, id, Some(Activity::Working), Attention::None, event.observed_at); }
                    else { session.attention = Attention::None; }
                },
                "PostToolUse" => {
                    if let Some(id) = event.tool_use_id {
                        tools.retain(|tool| tool.id != id || tool.agent_id.as_deref() != agent_id);
                    } else if let Some(position) = tools.iter().rposition(|tool| tool.agent_id.as_deref() == agent_id && event.tool_name.as_deref().is_none_or(|name| tool.name == name)) { tools.remove(position); }
                    if let Some(id) = agent_id { update_agent(session, id, Some(Activity::Thinking), Attention::None, event.observed_at); }
                    else { session.attention = Attention::None; }
                },
                "PermissionRequest" => { if let Some(id) = agent_id {
                    if let Some(agent) = session.agents.iter_mut().find(|agent| agent.id == id) { agent.attention = Attention::Permission; }
                    else { update_agent(session, id, Some(Activity::Thinking), Attention::Permission, event.observed_at); }
                } else { session.attention = Attention::Permission; } },
                "PreCompact" => { if let Some(id) = agent_id { update_agent(session, id, Some(Activity::Compacting), Attention::None, event.observed_at); } else { session.root_activity = Activity::Compacting; session.attention = Attention::None; } },
                "PostCompact" => { if let Some(id) = agent_id { update_agent(session, id, Some(Activity::Thinking), Attention::None, event.observed_at); } else { session.root_activity = Activity::Thinking; session.attention = Attention::None; } },
                "SubagentStart" => { if let Some(id) = agent_id { update_agent(session, id, Some(Activity::Thinking), Attention::None, event.observed_at); } },
                _ => {},
            }
        },
        "SubagentStop" | "Stop" | "Interrupt" if agent_id.is_some() => {
            let id = agent_id.unwrap(); update_agent(session, id, None, Attention::None, event.observed_at);
            tools.retain(|tool| tool.agent_id.as_deref() != Some(id));
        },
        "Stop" | "Interrupt" if session.lifecycle == Lifecycle::Active => {
            result = Some(TurnResult {
                kind: if event.hook_event_name == "Stop" { TurnResultKind::Completed } else { TurnResultKind::Interrupted },
                session_id: session.id.clone(), turn_id: session.current_turn_id.clone().or(event.turn_id), finished_at: event.observed_at,
                project: session.project.clone(), model: session.model.clone(), started_at: session.started_at,
            });
            tools.clear(); session.lifecycle = Lifecycle::Idle; session.attention = Attention::None;
        },
        _ => {},
    }
    foreground_activity(session, tools);
    result
}

fn has_permission(session: &Session) -> bool {
    session.attention == Attention::Permission
        || session.agents.iter().any(|agent| agent.attention == Attention::Permission)
}

fn cleanup_registry(registry: &mut SessionRegistry, now: u64) -> bool {
    let before = registry.sessions.len();
    let result_count = registry.recent_results.len();
    registry.recent_results.retain(|result| now.saturating_sub(result.finished_at) <= RESULT_RETENTION_MS);
    registry.sessions.retain(|id, session| {
        if has_permission(session) || registry.active_tools.get(id).is_some_and(|tools| !tools.is_empty()) {
            now.saturating_sub(session.last_activity_at) <= ACTIVE_AFTER_MS
        } else {
            now.saturating_sub(session.last_activity_at) <= STALE_AFTER_MS
        }
    });
    registry.active_tools.retain(|id, tools| registry.sessions.contains_key(id) && !tools.is_empty());
    before != registry.sessions.len() || result_count != registry.recent_results.len()
}

fn snapshot(registry: &mut SessionRegistry) -> ActivitySnapshot {
    registry.updated_at = now_ms().max(registry.updated_at.saturating_add(1));
    let sessions = registry.sessions.values().filter(|session| session.lifecycle == Lifecycle::Active).cloned().collect();
    ActivitySnapshot { sessions, recent_results: registry.recent_results.clone(), updated_at: registry.updated_at }
}

fn read_activity_snapshot() -> Result<ActivitySnapshot, String> {
    let mutex = REGISTRY.get_or_init(|| Mutex::new(SessionRegistry::default()));
    let mut registry = mutex.lock().map_err(|_| "会话状态不可用".to_string())?;
    cleanup_registry(&mut registry, now_ms());
    Ok(snapshot(&mut registry))
}

#[tauri::command]
pub async fn read_activity() -> Result<ActivitySnapshot, String> {
    read_activity_snapshot()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn event(name: &str, at: u64) -> HookEvent {
        HookEvent { hook_event_name: name.into(), session_id: "s".into(), cwd: "D:/Demo".into(), observed_at: at,
            model: None, agent_id: None, turn_id: Some("turn-1".into()), tool_name: None, tool_use_id: None }
    }
    fn tool(name: &str, id: &str, at: u64) -> HookEvent {
        let mut e = event("PreToolUse", at); e.tool_name = Some(name.into()); e.tool_use_id = Some(id.into()); e
    }
    #[test]
    fn normalizes_only_metadata() {
        let e = normalize_hook(&json!({"hook_event_name":"PreToolUse","session_id":"s","tool_input":{"command":"secret"}})).unwrap();
        assert!(!serde_json::to_string(&e).unwrap().contains("secret"));
    }
    #[test]
    fn tool_classification() {
        assert_eq!(tool_activity("Bash"), Activity::Executing);
        assert_eq!(tool_activity("apply_patch"), Activity::Editing);
        assert_eq!(tool_activity("mcp__filesystem__read_file"), Activity::Searching);
        assert_eq!(tool_activity("mcp__service__create_item"), Activity::Connecting);
    }
    #[test]
    fn reducer_keeps_activity_and_attention_independent() {
        let mut r = SessionRegistry::default();
        apply_event(&mut r, event("UserPromptSubmit", 1));
        assert_eq!(r.sessions["s"].activity, Some(Activity::Thinking));
        apply_event(&mut r, tool("apply_patch", "edit", 2));
        assert_eq!(r.sessions["s"].activity, Some(Activity::Editing));
        let mut post = event("PostToolUse", 3); post.tool_use_id = Some("edit".into());
        apply_event(&mut r, post);
        assert_eq!(r.sessions["s"].activity, Some(Activity::Thinking));
        apply_event(&mut r, tool("Bash", "shell", 4));
        apply_event(&mut r, event("PermissionRequest", 5));
        assert_eq!(r.sessions["s"].activity, Some(Activity::Executing));
        assert_eq!(r.sessions["s"].attention, Attention::Permission);
        let mut post = event("PostToolUse", 6); post.tool_use_id = Some("shell".into());
        apply_event(&mut r, post);
        assert_eq!(r.sessions["s"].attention, Attention::None);
    }
    #[test]
    fn permission_retention_covers_root_and_agent_without_active_tools() {
        for agent_permission in [false, true] {
            let mut r = SessionRegistry::default();
            apply_event(&mut r, event("UserPromptSubmit", 1));
            let mut permission = event("PermissionRequest", 2);
            if agent_permission {
                permission.agent_id = Some("worker".into());
            }
            apply_event(&mut r, permission);
            assert!(r.active_tools.get("s").is_none_or(Vec::is_empty));
            assert_eq!(r.sessions["s"].attention, if agent_permission { Attention::None } else { Attention::Permission });
            assert!(has_permission(&r.sessions["s"]));
            assert!(!cleanup_registry(&mut r, 2 + STALE_AFTER_MS + 1));
            assert!(r.sessions.contains_key("s"));
            assert!(cleanup_registry(&mut r, 2 + ACTIVE_AFTER_MS + 1));
            assert!(!r.sessions.contains_key("s"));
        }
    }
    #[test]
    fn session_without_permission_or_active_tools_uses_stale_retention() {
        let mut r = SessionRegistry::default();
        apply_event(&mut r, event("UserPromptSubmit", 1));
        assert!(!has_permission(&r.sessions["s"]));
        assert!(r.active_tools.get("s").is_none_or(Vec::is_empty));
        assert!(!cleanup_registry(&mut r, 1 + STALE_AFTER_MS));
        assert!(r.sessions.contains_key("s"));
        assert!(cleanup_registry(&mut r, 1 + STALE_AFTER_MS + 1));
        assert!(!r.sessions.contains_key("s"));
    }
    #[test]
    fn results_and_session_end_are_distinct() {
        let mut r = SessionRegistry::default();
        apply_event(&mut r, event("UserPromptSubmit", 1));
        apply_event(&mut r, event("Stop", 2));
        assert_eq!(r.recent_results[0].kind, TurnResultKind::Completed);
        assert_eq!(r.recent_results[0].turn_id.as_deref(), Some("turn-1"));
        apply_event(&mut r, event("SessionEnd", 3));
        assert_eq!(r.recent_results.len(), 1);
        apply_event(&mut r, event("UserPromptSubmit", 4));
        apply_event(&mut r, event("Interrupt", 5));
        assert_eq!(r.recent_results[1].kind, TurnResultKind::Interrupted);
        assert!(cleanup_registry(&mut r, 5 + RESULT_RETENTION_MS + 1));
        assert!(r.recent_results.is_empty());
    }
    #[test]
    fn concurrent_tools_keep_recent_foreground_and_old_turn_is_ignored() {
        let mut r = SessionRegistry::default();
        apply_event(&mut r, event("UserPromptSubmit", 1));
        apply_event(&mut r, tool("Bash", "shell", 2));
        apply_event(&mut r, tool("mcp__filesystem__read_file", "read", 3));
        assert_eq!(r.sessions["s"].activity, Some(Activity::Searching));
        let mut post = event("PostToolUse", 4); post.tool_use_id = Some("read".into());
        apply_event(&mut r, post);
        assert_eq!(r.sessions["s"].activity, Some(Activity::Executing));
        assert!(!cleanup_registry(&mut r, 3 + STALE_AFTER_MS));
        let mut next = event("UserPromptSubmit", 6); next.turn_id = Some("turn-2".into()); apply_event(&mut r, next);
        apply_event(&mut r, tool("Bash", "late", 7));
        assert_eq!(r.sessions["s"].activity, Some(Activity::Thinking));
    }
    #[test]
    fn subagent_does_not_cover_root() {
        let mut r = SessionRegistry::default();
        apply_event(&mut r, event("UserPromptSubmit", 1));
        apply_event(&mut r, tool("Bash", "root", 2));
        let mut agent = event("SubagentStart", 3); agent.agent_id = Some("a".into()); apply_event(&mut r, agent);
        assert_eq!(r.sessions["s"].activity, Some(Activity::Executing));
    }
    #[test]
    fn compact_and_agent_lifecycle_do_not_replace_root_result() {
        let mut r = SessionRegistry::default();
        apply_event(&mut r, event("UserPromptSubmit", 1));
        apply_event(&mut r, event("PreCompact", 2));
        assert_eq!(r.sessions["s"].activity, Some(Activity::Compacting));
        apply_event(&mut r, event("PostCompact", 3));
        assert_eq!(r.sessions["s"].activity, Some(Activity::Thinking));
        let mut agent = event("SubagentStart", 4); agent.agent_id = Some("a".into()); apply_event(&mut r, agent);
        let mut stopped = event("SubagentStop", 5); stopped.agent_id = Some("a".into()); apply_event(&mut r, stopped);
        assert_eq!(r.sessions["s"].lifecycle, Lifecycle::Active);
        assert!(r.recent_results.is_empty());
        apply_event(&mut r, event("SessionEnd", 6));
        assert!(r.recent_results.is_empty());
    }
    #[test]
    fn old_session_end_cannot_close_new_turn() {
        let mut r = SessionRegistry::default();
        apply_event(&mut r, event("UserPromptSubmit", 1));
        let mut next = event("UserPromptSubmit", 2); next.turn_id = Some("turn-2".into()); apply_event(&mut r, next);
        apply_event(&mut r, event("SessionEnd", 3));
        assert_eq!(r.sessions["s"].lifecycle, Lifecycle::Active);
    }
    #[test]
    fn late_subagent_event_cannot_revive_finished_root() {
        let mut r = SessionRegistry::default();
        apply_event(&mut r, event("UserPromptSubmit", 1));
        apply_event(&mut r, event("Stop", 2));
        let mut agent = tool("Bash", "late", 3); agent.agent_id = Some("a".into());
        apply_event(&mut r, agent);
        assert_eq!(r.sessions["s"].lifecycle, Lifecycle::Idle);
        assert_eq!(r.recent_results.len(), 1);
        cleanup_registry(&mut r, 2 + RESULT_RETENTION_MS + 1);
        let mut later = tool("Bash", "later", 2 + RESULT_RETENTION_MS + 2); later.agent_id = Some("a".into());
        apply_event(&mut r, later);
        assert_eq!(r.sessions["s"].lifecycle, Lifecycle::Idle);
        assert!(r.recent_results.is_empty());
    }
    #[test]
    fn agent_tool_can_restore_session_on_late_attach() {
        let mut r = SessionRegistry::default();
        let mut agent = tool("Bash", "agent-tool", 10); agent.agent_id = Some("worker".into());
        apply_event(&mut r, agent);
        assert_eq!(r.sessions["s"].lifecycle, Lifecycle::Active);
        assert_eq!(r.sessions["s"].activity, Some(Activity::Executing));
        assert_eq!(r.sessions["s"].agents[0].activity, Some(Activity::Working));
        let mut r = SessionRegistry::default();
        let mut started = event("SubagentStart", 10); started.agent_id = Some("worker".into());
        apply_event(&mut r, started);
        assert_eq!(r.sessions["s"].lifecycle, Lifecycle::Active);
        assert_eq!(r.sessions["s"].agents[0].activity, Some(Activity::Thinking));
    }
    #[test]
    fn agent_permission_late_attach_does_not_replace_root_activity() {
        let mut r = SessionRegistry::default();
        let mut permission = event("PermissionRequest", 10); permission.agent_id = Some("worker".into());
        apply_event(&mut r, permission);
        assert_eq!(r.sessions["s"].lifecycle, Lifecycle::Active);
        assert_eq!(r.sessions["s"].activity, Some(Activity::Thinking));
        assert_eq!(r.sessions["s"].agents[0].attention, Attention::Permission);
        let mut bash = tool("Bash", "root", 11); bash.agent_id = None;
        apply_event(&mut r, bash);
        let mut permission = event("PermissionRequest", 12); permission.agent_id = Some("worker".into());
        apply_event(&mut r, permission);
        assert_eq!(r.sessions["s"].activity, Some(Activity::Executing));
    }
    #[test]
    fn root_results_capture_context_without_session_end_duplication() {
        for ending in ["Stop", "Interrupt"] {
            let mut r = SessionRegistry::default();
            let mut prompt = event("UserPromptSubmit", 10); prompt.model = Some("sol".into());
            apply_event(&mut r, prompt);
            apply_event(&mut r, event("PermissionRequest", 11));
            assert_eq!(r.sessions["s"].activity, Some(Activity::Thinking));
            apply_event(&mut r, event(ending, 12));
            let result = &r.recent_results[0];
            assert_eq!(result.kind, if ending == "Stop" { TurnResultKind::Completed } else { TurnResultKind::Interrupted });
            assert_eq!(result.project.as_deref(), Some("Demo"));
            assert_eq!(result.model.as_deref(), Some("sol"));
            assert_eq!(result.started_at, Some(10));
            apply_event(&mut r, event("SessionEnd", 13));
            assert_eq!(r.recent_results.len(), 1);
        }
    }
}
