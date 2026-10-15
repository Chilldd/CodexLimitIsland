use serde::Serialize;
#[derive(Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
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
    #[cfg_attr(test, ts(skip))]
    pub root_activity: Activity,
    pub agents: Vec<Agent>,
}

#[derive(Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    pub activity: Option<Activity>,
    pub attention: Attention,
    pub last_activity_at: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "kebab-case")]
pub enum Activity {
    Thinking,
    Working,
    Searching,
    Editing,
    Executing,
    Connecting,
    Compacting,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum Attention {
    None,
    Permission,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum Lifecycle {
    Idle,
    Active,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "lowercase")]
pub enum TurnResultKind {
    Completed,
    Interrupted,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
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
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ActivitySnapshot {
    pub sessions: Vec<Session>,
    pub recent_results: Vec<TurnResult>,
    pub updated_at: u64,
}
