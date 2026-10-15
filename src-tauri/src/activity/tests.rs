use super::{model::*, reducer::*, registry::*};
use crate::hook::{protocol::*, server::receive_http};
use serde_json::json;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    time::Duration,
};
use std::{net::Ipv4Addr, sync::Mutex};
fn event(name: &str, at: u64) -> HookEvent {
    HookEvent {
        hook_event_name: name.parse().unwrap(),
        session_id: "s".into(),
        cwd: "D:/Demo".into(),
        observed_at: at,
        model: None,
        agent_id: None,
        turn_id: Some("turn-1".into()),
        tool_name: None,
        tool_use_id: None,
    }
}
fn tool(name: &str, id: &str, at: u64) -> HookEvent {
    let mut e = event("PreToolUse", at);
    e.tool_name = Some(name.into());
    e.tool_use_id = Some(id.into());
    e
}
#[test]
fn repeated_prompt_preserves_running_tools_and_completed_turn() {
    let mut r = SessionRegistry::default();
    apply_event(&mut r, event("UserPromptSubmit", 1));
    apply_event(&mut r, tool("Bash", "shell", 2));
    apply_event(&mut r, tool("Read", "read", 3));
    apply_event(&mut r, event("UserPromptSubmit", 4));
    apply_event(&mut r, tool("Bash", "shell", 5));
    assert_eq!(r.sessions["s"].started_at, Some(1));
    assert_eq!(r.sessions["s"].activity, Some(Activity::Searching));
    assert_eq!(r.active_tools["s"].len(), 2);
    apply_event(&mut r, event("Stop", 6));
    apply_event(&mut r, event("UserPromptSubmit", 7));
    apply_event(&mut r, event("Stop", 8));
    assert_eq!(r.recent_results.len(), 1);
    assert_eq!(r.sessions["s"].lifecycle, Lifecycle::Idle);
    let mut next = event("UserPromptSubmit", 9);
    next.turn_id = Some("turn-2".into());
    apply_event(&mut r, next);
    assert_eq!(r.sessions["s"].lifecycle, Lifecycle::Active);
}

#[test]
fn duplicate_hooks_after_lost_ack_keep_one_result_including_legacy_tools() {
    for (missing_turn, missing_tool_id) in [(false, false), (false, true), (true, false), (true, true)] {
        let mut r = SessionRegistry::default();
        for (at, name) in [
            "SessionStart",
            "UserPromptSubmit",
            "PreToolUse",
            "PostToolUse",
            "Stop",
            "SessionEnd",
        ]
        .into_iter()
        .enumerate()
        {
            for repeat in 0..2 {
                let mut e = event(name, (at * 2 + repeat + 1) as u64);
                if missing_turn {
                    e.turn_id = None;
                }
                if matches!(name, "PreToolUse" | "PostToolUse") {
                    e.tool_name = Some("Read".into());
                    if !missing_tool_id {
                        e.tool_use_id = Some("read-1".into());
                    }
                }
                apply_event(&mut r, e);
            }
        }
        assert_eq!(r.recent_results.len(), 1);
        assert_eq!(r.sessions["s"].lifecycle, Lifecycle::Idle);
        assert!(r.active_tools["s"].is_empty());
    }
}

#[test]
fn legacy_prompt_without_turn_identity_still_starts_a_legitimate_new_turn() {
    let mut r = SessionRegistry::default();
    for (at, name) in ["UserPromptSubmit", "Stop", "UserPromptSubmit", "Stop"]
        .into_iter()
        .enumerate()
    {
        let mut incoming = event(name, at as u64 + 1);
        incoming.turn_id = None;
        apply_event(&mut r, incoming);
    }
    assert_eq!(r.recent_results.len(), 2);
}

#[test]
fn http_processing_survives_lost_ack_and_notification_failure_without_false_success() {
    use std::{net::Shutdown, sync::Arc};
    let registry = Arc::new(Mutex::new(SessionRegistry::default()));
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let server_registry = registry.clone();
    let server = std::thread::spawn(move || {
        // 首次确认丢失；第二次通知失败；第三次成功重发。
        for attempt in 0..3 {
            let (stream, _) = listener.accept().unwrap();
            if attempt == 0 {
                stream.shutdown(Shutdown::Write).unwrap();
            }
            let result = receive_http(stream, |incoming| {
                let mut r = server_registry.lock().unwrap();
                if r.sessions.is_empty() {
                    apply_event(&mut r, event("UserPromptSubmit", 1));
                }
                apply_event(&mut r, incoming);
                if attempt == 1 {
                    Err("注入通知失败".into())
                } else {
                    Ok(())
                }
            });
            assert_eq!(result.is_ok(), attempt == 2);
        }
    });
    for attempt in 0..3 {
        let mut client = TcpStream::connect(address).unwrap();
        client.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let body = br#"{"hook_event_name":"Stop","session_id":"s","turn_id":"turn-1"}"#;
        write!(
            client,
            "POST /api/codex/hook HTTP/1.1\r\nContent-Length: {}\r\n\r\n",
            body.len()
        )
        .unwrap();
        client.write_all(body).unwrap();
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        assert_eq!(response.starts_with("HTTP/1.1 204"), attempt == 2);
    }
    server.join().unwrap();
    assert_eq!(registry.lock().unwrap().recent_results.len(), 1);
}

#[test]
fn normalizes_only_metadata() {
    let e = normalize_hook(&json!({"hook_event_name":"PreToolUse","session_id":"s","tool_input":{"command":"secret"}}))
        .unwrap();
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
    let mut post = event("PostToolUse", 3);
    post.tool_use_id = Some("edit".into());
    apply_event(&mut r, post);
    assert_eq!(r.sessions["s"].activity, Some(Activity::Thinking));
    apply_event(&mut r, tool("Bash", "shell", 4));
    apply_event(&mut r, event("PermissionRequest", 5));
    assert_eq!(r.sessions["s"].activity, Some(Activity::Executing));
    assert_eq!(r.sessions["s"].attention, Attention::Permission);
    let mut post = event("PostToolUse", 6);
    post.tool_use_id = Some("shell".into());
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
        assert_eq!(
            r.sessions["s"].attention,
            if agent_permission {
                Attention::None
            } else {
                Attention::Permission
            }
        );
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
    // 新提示词属于新 Turn；重复 turn-1 现在会被正确识别为重发。
    let mut prompt = event("UserPromptSubmit", 4);
    prompt.turn_id = Some("turn-2".into());
    apply_event(&mut r, prompt);
    let mut interrupt = event("Interrupt", 5);
    interrupt.turn_id = Some("turn-2".into());
    apply_event(&mut r, interrupt);
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
    let mut post = event("PostToolUse", 4);
    post.tool_use_id = Some("read".into());
    apply_event(&mut r, post);
    assert_eq!(r.sessions["s"].activity, Some(Activity::Executing));
    assert!(!cleanup_registry(&mut r, 3 + STALE_AFTER_MS));
    let mut next = event("UserPromptSubmit", 6);
    next.turn_id = Some("turn-2".into());
    apply_event(&mut r, next);
    apply_event(&mut r, tool("Bash", "late", 7));
    assert_eq!(r.sessions["s"].activity, Some(Activity::Thinking));
}
#[test]
fn subagent_does_not_cover_root() {
    let mut r = SessionRegistry::default();
    apply_event(&mut r, event("UserPromptSubmit", 1));
    apply_event(&mut r, tool("Bash", "root", 2));
    let mut agent = event("SubagentStart", 3);
    agent.agent_id = Some("a".into());
    apply_event(&mut r, agent);
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
    let mut agent = event("SubagentStart", 4);
    agent.agent_id = Some("a".into());
    apply_event(&mut r, agent);
    let mut stopped = event("SubagentStop", 5);
    stopped.agent_id = Some("a".into());
    apply_event(&mut r, stopped);
    assert_eq!(r.sessions["s"].lifecycle, Lifecycle::Active);
    assert!(r.recent_results.is_empty());
    apply_event(&mut r, event("SessionEnd", 6));
    assert!(r.recent_results.is_empty());
}
#[test]
fn old_session_end_cannot_close_new_turn() {
    let mut r = SessionRegistry::default();
    apply_event(&mut r, event("UserPromptSubmit", 1));
    let mut next = event("UserPromptSubmit", 2);
    next.turn_id = Some("turn-2".into());
    apply_event(&mut r, next);
    apply_event(&mut r, event("SessionEnd", 3));
    assert_eq!(r.sessions["s"].lifecycle, Lifecycle::Active);
}
#[test]
fn late_subagent_event_cannot_revive_finished_root() {
    let mut r = SessionRegistry::default();
    apply_event(&mut r, event("UserPromptSubmit", 1));
    apply_event(&mut r, event("Stop", 2));
    let mut agent = tool("Bash", "late", 3);
    agent.agent_id = Some("a".into());
    apply_event(&mut r, agent);
    assert_eq!(r.sessions["s"].lifecycle, Lifecycle::Idle);
    assert_eq!(r.recent_results.len(), 1);
    cleanup_registry(&mut r, 2 + RESULT_RETENTION_MS + 1);
    let mut later = tool("Bash", "later", 2 + RESULT_RETENTION_MS + 2);
    later.agent_id = Some("a".into());
    apply_event(&mut r, later);
    assert_eq!(r.sessions["s"].lifecycle, Lifecycle::Idle);
    assert!(r.recent_results.is_empty());
}
#[test]
fn agent_tool_can_restore_session_on_late_attach() {
    let mut r = SessionRegistry::default();
    let mut agent = tool("Bash", "agent-tool", 10);
    agent.agent_id = Some("worker".into());
    apply_event(&mut r, agent);
    assert_eq!(r.sessions["s"].lifecycle, Lifecycle::Active);
    assert_eq!(r.sessions["s"].activity, Some(Activity::Executing));
    assert_eq!(r.sessions["s"].agents[0].activity, Some(Activity::Working));
    let mut r = SessionRegistry::default();
    let mut started = event("SubagentStart", 10);
    started.agent_id = Some("worker".into());
    apply_event(&mut r, started);
    assert_eq!(r.sessions["s"].lifecycle, Lifecycle::Active);
    assert_eq!(r.sessions["s"].agents[0].activity, Some(Activity::Thinking));
}
#[test]
fn agent_permission_late_attach_does_not_replace_root_activity() {
    let mut r = SessionRegistry::default();
    let mut permission = event("PermissionRequest", 10);
    permission.agent_id = Some("worker".into());
    apply_event(&mut r, permission);
    assert_eq!(r.sessions["s"].lifecycle, Lifecycle::Active);
    assert_eq!(r.sessions["s"].activity, Some(Activity::Thinking));
    assert_eq!(r.sessions["s"].agents[0].attention, Attention::Permission);
    let mut bash = tool("Bash", "root", 11);
    bash.agent_id = None;
    apply_event(&mut r, bash);
    let mut permission = event("PermissionRequest", 12);
    permission.agent_id = Some("worker".into());
    apply_event(&mut r, permission);
    assert_eq!(r.sessions["s"].activity, Some(Activity::Executing));
}
#[test]
fn root_results_capture_context_without_session_end_duplication() {
    for ending in ["Stop", "Interrupt"] {
        let mut r = SessionRegistry::default();
        let mut prompt = event("UserPromptSubmit", 10);
        prompt.model = Some("sol".into());
        apply_event(&mut r, prompt);
        apply_event(&mut r, event("PermissionRequest", 11));
        assert_eq!(r.sessions["s"].activity, Some(Activity::Thinking));
        apply_event(&mut r, event(ending, 12));
        let result = &r.recent_results[0];
        assert_eq!(
            result.kind,
            if ending == "Stop" {
                TurnResultKind::Completed
            } else {
                TurnResultKind::Interrupted
            }
        );
        assert_eq!(result.project.as_deref(), Some("Demo"));
        assert_eq!(result.model.as_deref(), Some("sol"));
        assert_eq!(result.started_at, Some(10));
        apply_event(&mut r, event("SessionEnd", 13));
        assert_eq!(r.recent_results.len(), 1);
    }
}
