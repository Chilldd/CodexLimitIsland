use serde::Serialize;
use serde_json::Value;
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub(crate) enum HookEventKind {
    SessionStart,
    SessionEnd,
    UserPromptSubmit,
    PreToolUse,
    PostToolUse,
    PreCompact,
    PostCompact,
    SubagentStart,
    SubagentStop,
    PermissionRequest,
    Stop,
    Interrupt,
}
impl std::str::FromStr for HookEventKind {
    type Err = String;
    fn from_str(value: &str) -> Result<Self, String> {
        match value {
            "SessionStart" => Ok(Self::SessionStart),
            "SessionEnd" => Ok(Self::SessionEnd),
            "UserPromptSubmit" => Ok(Self::UserPromptSubmit),
            "PreToolUse" => Ok(Self::PreToolUse),
            "PostToolUse" => Ok(Self::PostToolUse),
            "PreCompact" => Ok(Self::PreCompact),
            "PostCompact" => Ok(Self::PostCompact),
            "SubagentStart" => Ok(Self::SubagentStart),
            "SubagentStop" => Ok(Self::SubagentStop),
            "PermissionRequest" => Ok(Self::PermissionRequest),
            "Stop" => Ok(Self::Stop),
            "Interrupt" => Ok(Self::Interrupt),
            _ => Err("未知 Hook 事件".into()),
        }
    }
}
#[derive(Clone, Serialize)]
pub(crate) struct HookEvent {
    pub(crate) hook_event_name: HookEventKind,
    pub(crate) session_id: String,
    pub(crate) cwd: String,
    pub(crate) observed_at: u64,
    pub(crate) model: Option<String>,
    pub(crate) agent_id: Option<String>,
    pub(crate) turn_id: Option<String>,
    pub(crate) tool_name: Option<String>,
    pub(crate) tool_use_id: Option<String>,
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn field<'a>(value: &'a Value, name: &str) -> Option<&'a str> {
    value.get(name).and_then(Value::as_str)
}
pub(crate) fn project_of(cwd: &str) -> Option<String> {
    Path::new(cwd).file_name().map(|v| v.to_string_lossy().into_owned())
}
pub(crate) fn normalize_hook(value: &Value) -> Result<HookEvent, String> {
    let hook_event_name = field(value, "hook_event_name").ok_or("Hook 缺少事件名")?;
    let kind = hook_event_name.parse()?;
    for (name, max) in [
        ("session_id", 256),
        ("turn_id", 256),
        ("agent_id", 256),
        ("tool_use_id", 256),
        ("tool_name", 1024),
        ("model", 1024),
        ("cwd", 16 * 1024),
    ] {
        if field(value, name).is_some_and(|v| v.len() > max) {
            return Err("Hook 元数据字段过长".into());
        }
    }

    Ok(HookEvent {
        hook_event_name: kind,
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn metadata_bounds_and_legacy_ids_do_not_change_known_protocol() {
        assert!(
            normalize_hook(&serde_json::json!({"hook_event_name":"SessionStart","session_id":"legacy-non-uuid"}))
                .is_ok()
        );
        assert!(normalize_hook(&serde_json::json!({"hook_event_name":"FutureHook","session_id":"s"})).is_err());
        assert!(normalize_hook(&serde_json::json!({"hook_event_name":"Stop","session_id":"x".repeat(257)})).is_err());
    }
}
