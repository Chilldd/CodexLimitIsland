use serde::Serialize;
use serde_json::Value;
use std::{collections::HashMap, io::{Read, Write}, net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream}, path::Path, sync::{Mutex, OnceLock}, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::Emitter;

static REGISTRY: OnceLock<Mutex<SessionRegistry>> = OnceLock::new();
const STALE_AFTER_MS: u64 = 10 * 60 * 1000;
const ACTIVE_AFTER_MS: u64 = 2 * 60 * 60 * 1000;
const COMPLETED_AFTER_MS: u64 = 8_000;
pub const MAX_HOOK_BYTES: u64 = 1024 * 1024;
const HOOK_PORT: u16 = 17321;
const MAX_HEADER_BYTES: usize = 16 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub project: Option<String>,
    pub cwd: Option<String>,
    pub state: String,
    pub current_command: Option<String>,
    pub started_at: Option<u64>,
    pub last_activity_at: u64,
    pub completed_at: Option<u64>,
    pub model: Option<String>,
    #[serde(skip_serializing)]
    pub current_turn_id: Option<String>,
    #[serde(skip_serializing)]
    pub root_state: String,
    pub agents: Vec<Agent>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent { pub id: String, pub state: String, pub last_activity_at: u64 }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySnapshot { pub sessions: Vec<Session>, pub updated_at: u64 }

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
struct SessionRegistry { sessions: HashMap<String, Session>, active_tools: HashMap<String, Vec<ActiveTool>>, updated_at: u64 }

struct ActiveTool { id: String, name: String, state: &'static str, started_at: u64, agent_id: Option<String> }

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

fn tool_state(name: &str) -> &'static str {
    let operation = name.rsplit("__").next().unwrap_or(name).to_ascii_lowercase();
    if matches!(operation.as_str(), "bash" | "exec_command" | "shell_command") { "running-command" }
    else if matches!(operation.as_str(), "apply_patch" | "edit" | "write") || operation.starts_with("write_") || operation.starts_with("edit_") { "editing" }
    else if ["search", "find", "read", "list", "query", "get"].iter().any(|verb| operation == *verb || operation.starts_with(&format!("{verb}_"))) { "searching" }
    else if name.starts_with("mcp__") { "connecting" }
    else { "working" }
}
fn recompute_session_state(session: &mut Session, tools: &[ActiveTool]) {
    if session.completed_at.is_some() { session.state = "completed".into(); session.current_command = None; return; }
    let root = tools.iter().filter(|tool| tool.agent_id.is_none()).max_by_key(|tool| tool.started_at);
    let other = tools.iter().filter(|tool| tool.agent_id.is_some()).max_by_key(|tool| tool.started_at);
    session.current_command = root.filter(|tool| tool.state == "running-command").map(|tool| tool.name.clone());
    session.state = if session.root_state == "waiting" { "waiting" }
        else if let Some(tool) = root { tool.state }
        else if let Some(tool) = other { tool.state }
        else if session.root_state == "composing" { "composing" }
        else if session.agents.iter().any(|agent| agent.state == "waiting") { "waiting" }
        else if session.started_at.is_some() { "thinking" }
        else { "idle" }.into();
}
fn update_agent(session: &mut Session, id: &str, state: &str, at: u64) {
    if let Some(agent) = session.agents.iter_mut().find(|agent| agent.id == id) {
        agent.state = state.into(); agent.last_activity_at = at;
    } else {
        session.agents.push(Agent { id: id.into(), state: state.into(), last_activity_at: at });
    }
}
fn apply_event(registry: &mut SessionRegistry, event: HookEvent) {
    let tools = registry.active_tools.entry(event.session_id.clone()).or_default();
    let session = registry.sessions.entry(event.session_id.clone()).or_insert_with(|| Session {
        id: event.session_id.clone(), project: project_of(&event.cwd), cwd: Some(event.cwd.clone()), state: "idle".into(),
        current_command: None, started_at: None, last_activity_at: event.observed_at, completed_at: None,
        model: None, current_turn_id: None, root_state: "thinking".into(), agents: Vec::new(),
    });
    // 旧 Turn 的迟到事件不得改变当前 Turn；缺失 turn_id 的旧版 Hook 维持兼容。
    if event.agent_id.is_none() && event.hook_event_name != "UserPromptSubmit" && event.hook_event_name != "SessionStart" && event.hook_event_name != "SessionEnd" {
        if let (Some(current), Some(incoming)) = (&session.current_turn_id, &event.turn_id) {
            if current != incoming { return; }
        }
    }
    if !event.cwd.is_empty() { session.cwd = Some(event.cwd.clone()); session.project = project_of(&event.cwd); }
    if event.model.is_some() { session.model = event.model; }
    session.last_activity_at = event.observed_at;
    let agent_id = event.agent_id.as_deref();
    match event.hook_event_name.as_str() {
        "SessionStart" => {},
        "SessionEnd" => { tools.clear(); session.completed_at = Some(event.observed_at); },
        "UserPromptSubmit" if agent_id.is_none() => {
            tools.clear(); session.agents.retain(|agent| agent.state != "completed");
            session.current_turn_id = event.turn_id;
            session.root_state = "thinking".into(); session.started_at = Some(event.observed_at); session.completed_at = None;
        },
        "UserPromptSubmit" => { update_agent(session, agent_id.unwrap(), "thinking", event.observed_at); },
        "PreToolUse" | "PostToolUse" | "PermissionRequest" | "PreCompact" | "PostCompact" | "SubagentStart" => {
            if session.started_at.is_none() || session.completed_at.is_some() {
                session.started_at = Some(event.observed_at); session.completed_at = None;
                session.current_turn_id = event.turn_id.clone(); session.root_state = "thinking".into();
            }
            match event.hook_event_name.as_str() {
                "PreToolUse" => {
                    let name = event.tool_name.unwrap_or_default();
                    let id = event.tool_use_id.unwrap_or_else(|| format!("legacy:{name}"));
                    tools.retain(|tool| tool.id != id || tool.agent_id.as_deref() != agent_id);
                    tools.push(ActiveTool { id, state: tool_state(&name), name, started_at: event.observed_at, agent_id: event.agent_id.clone() });
                    if let Some(id) = agent_id { update_agent(session, id, "working", event.observed_at); }
                },
                "PostToolUse" => {
                    if let Some(id) = event.tool_use_id {
                        tools.retain(|tool| tool.id != id || tool.agent_id.as_deref() != agent_id);
                    } else if let Some(position) = tools.iter().rposition(|tool| tool.agent_id.as_deref() == agent_id && event.tool_name.as_deref().is_none_or(|name| tool.name == name)) { tools.remove(position); }
                    if let Some(id) = agent_id { update_agent(session, id, "thinking", event.observed_at); }
                    else if session.root_state == "waiting" { session.root_state = "thinking".into(); }
                },
                "PermissionRequest" => { if let Some(id) = agent_id { update_agent(session, id, "waiting", event.observed_at); } else { session.root_state = "waiting".into(); } },
                "PreCompact" => { if let Some(id) = agent_id { update_agent(session, id, "composing", event.observed_at); } else { session.root_state = "composing".into(); } },
                "PostCompact" => { if let Some(id) = agent_id { update_agent(session, id, "thinking", event.observed_at); } else { session.root_state = "thinking".into(); } },
                "SubagentStart" => { if let Some(id) = agent_id { update_agent(session, id, "thinking", event.observed_at); } },
                _ => {},
            }
        },
        "SubagentStop" => { if let Some(id) = agent_id { update_agent(session, id, "completed", event.observed_at); tools.retain(|tool| tool.agent_id.as_deref() != Some(id)); } },
        "Stop" | "Interrupt" if agent_id.is_some() => { let id = agent_id.unwrap(); update_agent(session, id, "completed", event.observed_at); tools.retain(|tool| tool.agent_id.as_deref() != Some(id)); },
        "Stop" | "Interrupt" => { tools.clear(); session.completed_at = Some(event.observed_at); },
        _ => {},
    }
    recompute_session_state(session, tools);
}

fn cleanup_registry(registry: &mut SessionRegistry, now: u64) -> bool {
    let before = registry.sessions.len();
    registry.sessions.retain(|id, session| {
        if session.state == "completed" {
            now.saturating_sub(session.completed_at.unwrap_or(session.last_activity_at)) <= COMPLETED_AFTER_MS
        } else if session.state == "waiting" || registry.active_tools.get(id).is_some_and(|tools| !tools.is_empty()) {
            now.saturating_sub(session.last_activity_at) <= ACTIVE_AFTER_MS
        } else {
            now.saturating_sub(session.last_activity_at) <= STALE_AFTER_MS
        }
    });
    registry.active_tools.retain(|id, tools| registry.sessions.contains_key(id) && !tools.is_empty());
    before != registry.sessions.len()
}

fn snapshot(registry: &mut SessionRegistry) -> ActivitySnapshot {
    registry.updated_at = now_ms().max(registry.updated_at.saturating_add(1));
    let sessions = registry.sessions.values().filter(|session| session.state != "idle").cloned().collect();
    ActivitySnapshot { sessions, updated_at: registry.updated_at }
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
    #[test]
    fn tracks_independent_sessions_and_agents() {
        let mut registry = SessionRegistry::default();
        let event = |name: &str, id: &str, agent: Option<&str>, at| HookEvent { hook_event_name: name.into(), session_id: id.into(), cwd: "D:/Demo".into(), observed_at: at, model: None, agent_id: agent.map(str::to_string), turn_id: None, tool_name: None, tool_use_id: None };
        apply_event(&mut registry, event("UserPromptSubmit", "a", None, 1));
        apply_event(&mut registry, event("UserPromptSubmit", "b", None, 2));
        apply_event(&mut registry, event("SubagentStart", "a", Some("worker"), 3));
        apply_event(&mut registry, event("Stop", "a", None, 4));
        assert_eq!(registry.sessions.len(), 2);
        assert_eq!(registry.sessions["a"].agents.len(), 1);
        assert_eq!(registry.sessions["b"].state, "thinking");
    }
    #[test]
    fn normalizes_only_metadata() {
        let event = normalize_hook(&json!({"hook_event_name":"PreToolUse","session_id":"s1","cwd":"D:/Demo","tool_name":"Bash","tool_use_id":"call-1","tool_input":{"command":"secret"}})).unwrap();
        let saved = serde_json::to_string(&event).unwrap();
        assert!(!saved.contains("secret"));
        assert_eq!(event.tool_use_id.as_deref(), Some("call-1"));
    }
    #[test]
    fn classifies_tools_by_operation() {
        assert_eq!(tool_state("Bash"), "running-command");
        assert_eq!(tool_state("apply_patch"), "editing");
        assert_eq!(tool_state("mcp__filesystem__read_file"), "searching");
        assert_eq!(tool_state("mcp__service__create_item"), "connecting");
        assert_eq!(tool_state("functions.exec"), "working");
    }
    #[test]
    fn post_tool_use_only_finishes_its_own_call() {
        let mut registry = SessionRegistry::default();
        let event = |hook: &str, tool: Option<&str>, call: Option<&str>, at| HookEvent {
            hook_event_name: hook.into(), session_id: "s1".into(), cwd: "D:/Demo".into(), observed_at: at,
            model: None, agent_id: None, turn_id: None,
            tool_name: tool.map(str::to_string), tool_use_id: call.map(str::to_string),
        };
        apply_event(&mut registry, event("UserPromptSubmit", None, None, 1));
        apply_event(&mut registry, event("PreToolUse", Some("Bash"), Some("shell"), 2));
        apply_event(&mut registry, event("PreToolUse", Some("mcp__filesystem__read_file"), Some("read"), 3));
        apply_event(&mut registry, event("PostToolUse", Some("mcp__filesystem__read_file"), Some("read"), 4));
        assert_eq!(registry.sessions["s1"].state, "running-command");
        apply_event(&mut registry, event("PostToolUse", Some("Bash"), Some("shell"), 5));
        assert_eq!(registry.sessions["s1"].state, "thinking");
    }
    fn event(name: &str, id: &str, at: u64) -> HookEvent {
        HookEvent { hook_event_name: name.into(), session_id: id.into(), cwd: "D:/Demo".into(), observed_at: at,
            model: None, agent_id: None, turn_id: None, tool_name: None, tool_use_id: None }
    }
    #[test]
    fn session_end_is_removed_after_display_period() {
        let mut registry = SessionRegistry::default();
        apply_event(&mut registry, event("UserPromptSubmit", "a", 1));
        apply_event(&mut registry, event("SessionEnd", "a", 2));
        assert!(!cleanup_registry(&mut registry, 2 + COMPLETED_AFTER_MS));
        assert_eq!(registry.sessions["a"].state, "completed");
        assert!(cleanup_registry(&mut registry, 3 + COMPLETED_AFTER_MS));
        assert!(registry.sessions.is_empty());
    }
    #[test]
    fn stale_session_and_its_tools_are_removed() {
        let mut registry = SessionRegistry::default();
        apply_event(&mut registry, event("UserPromptSubmit", "a", 1));
        let mut tool = event("PreToolUse", "a", 2);
        tool.tool_name = Some("Bash".into());
        tool.tool_use_id = Some("call".into());
        apply_event(&mut registry, tool);
        assert_eq!(registry.active_tools["a"].len(), 1);
        assert!(!cleanup_registry(&mut registry, 3 + STALE_AFTER_MS));
        assert_eq!(registry.active_tools["a"].len(), 1);
        assert!(cleanup_registry(&mut registry, 3 + ACTIVE_AFTER_MS));
        assert!(registry.sessions.is_empty());
    }
    #[test]
    fn waiting_session_survives_stale_cleanup() {
        let mut registry = SessionRegistry::default();
        apply_event(&mut registry, event("UserPromptSubmit", "a", 1));
        apply_event(&mut registry, event("PermissionRequest", "a", 2));
        assert!(!cleanup_registry(&mut registry, 3 + STALE_AFTER_MS));
        assert_eq!(registry.sessions["a"].state, "waiting");
    }
    #[test]
    fn new_turn_drops_completed_agents_but_keeps_active_agents() {
        let mut registry = SessionRegistry::default();
        apply_event(&mut registry, event("UserPromptSubmit", "a", 1));
        for id in ["finished", "active"] {
            let mut started = event("SubagentStart", "a", 2);
            started.agent_id = Some(id.into());
            apply_event(&mut registry, started);
        }
        let mut stopped = event("SubagentStop", "a", 3);
        stopped.agent_id = Some("finished".into());
        apply_event(&mut registry, stopped);
        apply_event(&mut registry, event("UserPromptSubmit", "a", 4));
        assert_eq!(registry.sessions["a"].agents.len(), 1);
        assert_eq!(registry.sessions["a"].agents[0].id, "active");
    }
    #[test]
    fn compact_events_keep_session_active() {
        let mut registry = SessionRegistry::default();
        apply_event(&mut registry, event("UserPromptSubmit", "a", 1));
        apply_event(&mut registry, event("PreCompact", "a", 2));
        assert_eq!(registry.sessions["a"].state, "composing");
        apply_event(&mut registry, event("PostCompact", "a", 3));
        assert_eq!(registry.sessions["a"].state, "thinking");
        for name in ["PreCompact", "PostCompact"] {
            assert!(normalize_hook(&json!({"hook_event_name": name, "session_id": "a"})).is_ok());
        }
    }
    #[test]
    fn late_attach_recovers_tool_and_permission() {
        let mut registry = SessionRegistry::default();
        let mut bash = event("PreToolUse", "tool", 10);
        bash.tool_name = Some("Bash".into());
        apply_event(&mut registry, bash);
        assert_eq!(registry.sessions["tool"].started_at, Some(10));
        assert_eq!(registry.sessions["tool"].state, "running-command");
        assert_eq!(registry.active_tools["tool"].len(), 1);
        apply_event(&mut registry, event("PermissionRequest", "permission", 11));
        assert_eq!(registry.sessions["permission"].state, "waiting");
    }
    #[test]
    fn subagent_events_preserve_root_tool() {
        let mut registry = SessionRegistry::default();
        apply_event(&mut registry, event("UserPromptSubmit", "a", 1));
        let mut bash = event("PreToolUse", "a", 2);
        bash.tool_name = Some("Bash".into());
        apply_event(&mut registry, bash);
        for name in ["SubagentStart", "UserPromptSubmit", "PreCompact", "PostCompact"] {
            let mut sub = event(name, "a", 3);
            sub.agent_id = Some("agent-1".into());
            apply_event(&mut registry, sub);
            assert_eq!(registry.sessions["a"].state, "running-command");
            assert_eq!(registry.sessions["a"].started_at, Some(1));
            assert_eq!(registry.sessions["a"].current_command.as_deref(), Some("Bash"));
        }
    }
    #[test]
    fn previous_turn_event_does_not_change_new_turn() {
        let mut registry = SessionRegistry::default();
        let mut first = event("UserPromptSubmit", "a", 1);
        first.turn_id = Some("old".into());
        apply_event(&mut registry, first);
        let mut second = event("UserPromptSubmit", "a", 2);
        second.turn_id = Some("new".into());
        apply_event(&mut registry, second);
        let mut late = event("PreToolUse", "a", 3);
        late.turn_id = Some("old".into()); late.tool_name = Some("Bash".into());
        apply_event(&mut registry, late);
        assert_eq!(registry.sessions["a"].state, "thinking");
        assert_eq!(registry.sessions["a"].current_turn_id.as_deref(), Some("new"));
    }
}
