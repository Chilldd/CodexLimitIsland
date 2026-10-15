use super::{model::*, registry::ActiveTool};
use crate::hook::protocol::{project_of, HookEvent, HookEventKind};
pub(super) fn tool_activity(name: &str) -> Activity {
    let operation = name.rsplit("__").next().unwrap_or(name).to_ascii_lowercase();
    if matches!(operation.as_str(), "bash" | "exec_command" | "shell_command") {
        Activity::Executing
    } else if matches!(operation.as_str(), "apply_patch" | "edit" | "write")
        || operation.starts_with("write_")
        || operation.starts_with("edit_")
    {
        Activity::Editing
    } else if ["search", "find", "read", "list", "query", "get"]
        .iter()
        .any(|verb| operation == *verb || operation.starts_with(&format!("{verb}_")))
    {
        Activity::Searching
    } else if name.starts_with("mcp__") {
        Activity::Connecting
    } else {
        Activity::Working
    }
}
fn foreground_activity(session: &mut Session, tools: &[ActiveTool]) {
    if session.lifecycle == Lifecycle::Idle {
        session.activity = None;
        session.current_command = None;
        return;
    }
    let root = tools
        .iter()
        .filter(|tool| tool.agent_id.is_none())
        .max_by_key(|tool| tool.started_at);
    let other = tools
        .iter()
        .filter(|tool| tool.agent_id.is_some())
        .max_by_key(|tool| tool.started_at);
    // 最近启动的 Root Tool 是前台动作；Read 可以暂时盖过仍在运行的 Bash。
    session.current_command = root
        .filter(|tool| tool.activity == Activity::Executing)
        .map(|tool| tool.name.clone());
    session.activity = Some(root.or(other).map_or(session.root_activity, |tool| tool.activity));
}
fn update_agent(session: &mut Session, id: &str, activity: Option<Activity>, attention: Attention, at: u64) {
    if let Some(agent) = session.agents.iter_mut().find(|agent| agent.id == id) {
        agent.activity = activity;
        agent.attention = attention;
        agent.last_activity_at = at;
    } else {
        session.agents.push(Agent {
            id: id.into(),
            activity,
            attention,
            last_activity_at: at,
        });
    }
}
// 所有领域状态写入都集中在这个事件入口；Registry 只负责索引和保留时间。
pub(super) fn reduce_session(
    session: &mut Session,
    tools: &mut Vec<ActiveTool>,
    event: HookEvent,
) -> Option<TurnResult> {
    if !event.cwd.is_empty() {
        session.cwd = Some(event.cwd.clone());
        session.project = project_of(&event.cwd);
    }
    if event.model.is_some() {
        session.model = event.model;
    }
    session.last_activity_at = event.observed_at;
    let agent_id = event.agent_id.as_deref();
    let mut result = None;
    match event.hook_event_name {
        HookEventKind::SessionStart => {}
        HookEventKind::SessionEnd => {
            tools.clear();
            session.lifecycle = Lifecycle::Idle;
            session.attention = Attention::None;
            session.agents.clear();
        }
        HookEventKind::UserPromptSubmit if agent_id.is_none() => {
            tools.clear();
            session.agents.retain(|agent| agent.activity.is_some());
            session.current_turn_id = event.turn_id;
            session.root_activity = Activity::Thinking;
            session.attention = Attention::None;
            session.started_at = Some(event.observed_at);
            session.lifecycle = Lifecycle::Active;
        }
        HookEventKind::UserPromptSubmit => {
            if let Some(id) = agent_id {
                update_agent(
                    session,
                    id,
                    Some(Activity::Thinking),
                    Attention::None,
                    event.observed_at,
                );
            }
        }
        HookEventKind::PreToolUse
        | HookEventKind::PostToolUse
        | HookEventKind::PermissionRequest
        | HookEventKind::PreCompact
        | HookEventKind::PostCompact
        | HookEventKind::SubagentStart => {
            if session.lifecycle == Lifecycle::Idle {
                session.started_at = Some(event.observed_at);
                session.lifecycle = Lifecycle::Active;
                session.current_turn_id = event.turn_id.clone();
                session.root_activity = Activity::Thinking;
            }
            match event.hook_event_name {
                HookEventKind::PreToolUse => {
                    let name = event.tool_name.unwrap_or_default();
                    let identified = event.tool_use_id.is_some();
                    let id = event.tool_use_id.unwrap_or_else(|| format!("legacy:{name}"));
                    if !identified {
                        tools.retain(|tool| tool.id != id || tool.agent_id.as_deref() != agent_id);
                    }
                    if !tools
                        .iter()
                        .any(|tool| tool.id == id && tool.agent_id.as_deref() == agent_id)
                    {
                        tools.push(ActiveTool {
                            id,
                            activity: tool_activity(&name),
                            name,
                            started_at: event.observed_at,
                            agent_id: event.agent_id.clone(),
                        });
                    }
                    if let Some(id) = agent_id {
                        update_agent(session, id, Some(Activity::Working), Attention::None, event.observed_at);
                    } else {
                        session.attention = Attention::None;
                    }
                }
                HookEventKind::PostToolUse => {
                    if let Some(id) = event.tool_use_id {
                        tools.retain(|tool| tool.id != id || tool.agent_id.as_deref() != agent_id);
                    } else if let Some(position) = tools.iter().rposition(|tool| {
                        tool.agent_id.as_deref() == agent_id
                            && event.tool_name.as_deref().is_none_or(|name| tool.name == name)
                    }) {
                        tools.remove(position);
                    }
                    if let Some(id) = agent_id {
                        update_agent(
                            session,
                            id,
                            Some(Activity::Thinking),
                            Attention::None,
                            event.observed_at,
                        );
                    } else {
                        session.attention = Attention::None;
                    }
                }
                HookEventKind::PermissionRequest => {
                    if let Some(id) = agent_id {
                        if let Some(agent) = session.agents.iter_mut().find(|agent| agent.id == id) {
                            agent.attention = Attention::Permission;
                        } else {
                            update_agent(
                                session,
                                id,
                                Some(Activity::Thinking),
                                Attention::Permission,
                                event.observed_at,
                            );
                        }
                    } else {
                        session.attention = Attention::Permission;
                    }
                }
                HookEventKind::PreCompact => {
                    if let Some(id) = agent_id {
                        update_agent(
                            session,
                            id,
                            Some(Activity::Compacting),
                            Attention::None,
                            event.observed_at,
                        );
                    } else {
                        session.root_activity = Activity::Compacting;
                        session.attention = Attention::None;
                    }
                }
                HookEventKind::PostCompact => {
                    if let Some(id) = agent_id {
                        update_agent(
                            session,
                            id,
                            Some(Activity::Thinking),
                            Attention::None,
                            event.observed_at,
                        );
                    } else {
                        session.root_activity = Activity::Thinking;
                        session.attention = Attention::None;
                    }
                }
                HookEventKind::SubagentStart => {
                    if let Some(id) = agent_id {
                        update_agent(
                            session,
                            id,
                            Some(Activity::Thinking),
                            Attention::None,
                            event.observed_at,
                        );
                    }
                }
                HookEventKind::SessionStart
                | HookEventKind::SessionEnd
                | HookEventKind::UserPromptSubmit
                | HookEventKind::SubagentStop
                | HookEventKind::Stop
                | HookEventKind::Interrupt => {}
            }
        }
        HookEventKind::SubagentStop | HookEventKind::Stop | HookEventKind::Interrupt if agent_id.is_some() => {
            if let Some(id) = agent_id {
                update_agent(session, id, None, Attention::None, event.observed_at);
                tools.retain(|tool| tool.agent_id.as_deref() != Some(id));
            }
        }
        HookEventKind::Stop | HookEventKind::Interrupt if session.lifecycle == Lifecycle::Active => {
            result = Some(TurnResult {
                kind: if event.hook_event_name == HookEventKind::Stop {
                    TurnResultKind::Completed
                } else {
                    TurnResultKind::Interrupted
                },
                session_id: session.id.clone(),
                turn_id: session.current_turn_id.clone().or(event.turn_id),
                finished_at: event.observed_at,
                project: session.project.clone(),
                model: session.model.clone(),
                started_at: session.started_at,
            });
            tools.clear();
            session.lifecycle = Lifecycle::Idle;
            session.attention = Attention::None;
        }
        HookEventKind::SubagentStop | HookEventKind::Stop | HookEventKind::Interrupt => {}
    }
    foreground_activity(session, tools);
    result
}
