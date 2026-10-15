use super::{model::*, reducer::reduce_session};
use crate::hook::protocol::{now_ms, project_of, HookEvent, HookEventKind};
use std::collections::HashMap;
pub(super) const STALE_AFTER_MS: u64 = 10 * 60 * 1000;
pub(super) const ACTIVE_AFTER_MS: u64 = 2 * 60 * 60 * 1000;
pub(super) const RESULT_RETENTION_MS: u64 = 12_000;
#[derive(Default)]
pub(crate) struct SessionRegistry {
    pub(crate) sessions: HashMap<String, Session>,
    pub(crate) active_tools: HashMap<String, Vec<ActiveTool>>,
    pub(crate) recent_results: Vec<TurnResult>,
    pub(crate) updated_at: u64,
}

pub(crate) struct ActiveTool {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) activity: Activity,
    pub(crate) started_at: u64,
    pub(crate) agent_id: Option<String>,
}

pub(crate) fn apply_event(registry: &mut SessionRegistry, event: HookEvent) {
    if is_duplicate_prompt(registry, &event) || is_finished_turn_event(registry, &event) {
        return;
    }
    let tools = registry.active_tools.entry(event.session_id.clone()).or_default();
    let session = registry
        .sessions
        .entry(event.session_id.clone())
        .or_insert_with(|| Session {
            id: event.session_id.clone(),
            project: project_of(&event.cwd),
            cwd: Some(event.cwd.clone()),
            lifecycle: Lifecycle::Idle,
            activity: None,
            attention: Attention::None,
            current_command: None,
            started_at: None,
            last_activity_at: event.observed_at,
            model: None,
            current_turn_id: None,
            root_activity: Activity::Thinking,
            agents: Vec::new(),
        });
    // 旧 Turn 的迟到事件不得改变当前 Turn；缺失 turn_id 的旧版 Hook 维持兼容。
    if event.hook_event_name != HookEventKind::SessionStart
        && !(event.hook_event_name == HookEventKind::UserPromptSubmit && event.agent_id.is_none())
    {
        if let (Some(current), Some(incoming)) = (&session.current_turn_id, &event.turn_id) {
            if current != incoming {
                return;
            }
        }
    }
    let result = reduce_session(session, tools, event);
    if let Some(result) = result {
        registry.recent_results.push(result);
    }
}

pub(super) fn has_permission(session: &Session) -> bool {
    session.attention == Attention::Permission
        || session
            .agents
            .iter()
            .any(|agent| agent.attention == Attention::Permission)
}

pub(crate) fn cleanup_registry(registry: &mut SessionRegistry, now: u64) -> bool {
    let before = registry.sessions.len();
    let result_count = registry.recent_results.len();
    registry
        .recent_results
        .retain(|result| now.saturating_sub(result.finished_at) <= RESULT_RETENTION_MS);
    registry.sessions.retain(|id, session| {
        if has_permission(session) || registry.active_tools.get(id).is_some_and(|tools| !tools.is_empty()) {
            now.saturating_sub(session.last_activity_at) <= ACTIVE_AFTER_MS
        } else {
            now.saturating_sub(session.last_activity_at) <= STALE_AFTER_MS
        }
    });
    registry
        .active_tools
        .retain(|id, tools| registry.sessions.contains_key(id) && !tools.is_empty());
    before != registry.sessions.len() || result_count != registry.recent_results.len()
}

pub(crate) fn snapshot(registry: &mut SessionRegistry) -> ActivitySnapshot {
    registry.updated_at = now_ms().max(registry.updated_at.saturating_add(1));
    let sessions = registry
        .sessions
        .values()
        .filter(|session| session.lifecycle == Lifecycle::Active)
        .cloned()
        .collect();
    ActivitySnapshot {
        sessions,
        recent_results: registry.recent_results.clone(),
        updated_at: registry.updated_at,
    }
}

fn is_duplicate_prompt(registry: &SessionRegistry, event: &HookEvent) -> bool {
    event.hook_event_name == HookEventKind::UserPromptSubmit
        && event.agent_id.is_none()
        && event.turn_id.is_some()
        && registry
            .sessions
            .get(&event.session_id)
            .is_some_and(|session| session.current_turn_id == event.turn_id)
}

fn is_finished_turn_event(registry: &SessionRegistry, event: &HookEvent) -> bool {
    !matches!(
        event.hook_event_name,
        HookEventKind::SessionStart | HookEventKind::SessionEnd | HookEventKind::UserPromptSubmit
    ) && registry.sessions.get(&event.session_id).is_some_and(|session| {
        session.lifecycle == Lifecycle::Idle
            && ((session.started_at.is_some() && session.current_turn_id == event.turn_id)
                || registry
                    .recent_results
                    .iter()
                    .rev()
                    .find(|result| result.session_id == event.session_id)
                    .is_some_and(|result| result.turn_id == event.turn_id))
    })
}
