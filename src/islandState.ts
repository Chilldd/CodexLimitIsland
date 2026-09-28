export type Activity = "thinking" | "working" | "searching" | "editing" | "executing" | "connecting" | "compacting";
export type Attention = "none" | "permission";
export type Lifecycle = "idle" | "active";
export type TurnResultKind = "completed" | "interrupted";
export type TurnResult = { kind: TurnResultKind; sessionId: string; turnId: string | null; finishedAt: number; project: string | null; model: string | null; startedAt: number | null };
export type TokenUsageState = { status: "loading" } | { status: "ready"; taskTokens: number | null; sessionTokens: number | null; readyAt: number } | { status: "unavailable" };
export type OrbState = "working" | "searching" | "solving" | "connecting" | "weaving" | "composing" | "breathing" | "shaping";
export type LimitWindow = { remainingPercent: number; resetsAt: number | null };
export type UsageSnapshot = { fiveHour: LimitWindow | null; weekly: LimitWindow | null; updatedAt: number };
export type Agent = { id: string; activity: Activity | null; attention: Attention; lastActivityAt: number };
export type Session = { id: string; project: string | null; cwd: string | null; lifecycle: Lifecycle; activity: Activity | null; attention: Attention; currentCommand: string | null; startedAt: number | null; lastActivityAt: number; model: string | null; currentTurnId: string | null; agents: Agent[] };
export type ActivitySnapshot = { sessions: Session[]; recentResults: TurnResult[]; updatedAt: number };
export function newerActivity(current: ActivitySnapshot, next: ActivitySnapshot): ActivitySnapshot { return next.updatedAt >= current.updatedAt ? next : current; }
export function resultKey(result: TurnResult): string { return `${result.sessionId}:${result.turnId ?? `legacy-${result.finishedAt}`}`; }
export function effectiveAttention(session: Session): Attention { return session.attention === "permission" || session.agents.some(agent => agent.attention === "permission") ? "permission" : "none"; }
const RESULT_DISPLAY_MS = 3_000;
const TOKEN_READY_DISPLAY_MS = 2_800;
const copy: Record<Activity, { compact: string; expanded: string }> = {
  thinking: { compact: "Thinking...", expanded: "Thinking..." },
  working: { compact: "Working...", expanded: "Working..." },
  searching: { compact: "Searching...", expanded: "Searching..." },
  editing: { compact: "Editing...", expanded: "Editing files..." },
  executing: { compact: "Running...", expanded: "Running command..." },
  connecting: { compact: "Connecting...", expanded: "Connecting..." },
  compacting: { compact: "Compacting...", expanded: "Compacting context..." },
};
const orb: Record<Activity, { state: OrbState; speed: number }> = {
  thinking: { state: "solving", speed: 1 }, working: { state: "working", speed: 1 }, searching: { state: "searching", speed: 1.1 },
  editing: { state: "shaping", speed: 1 }, executing: { state: "working", speed: 1.15 }, connecting: { state: "connecting", speed: 1 }, compacting: { state: "composing", speed: 1 },
};
const idleOrb = { state: "breathing" as const, speed: .65 };
const compactTokens = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(value);
export function sessionLabel(session: Session): string { return effectiveAttention(session) === "permission" ? "等待审批" : copy[session.activity ?? "thinking"].expanded; }
export type ResultPresentation = { result: TurnResult; token?: TokenUsageState; label: string };
export type IslandPresentation = {
  layout: "minimal" | "single" | "multi";
  attention: "none" | "permission" | "quota";
  feedback: "none" | TurnResultKind;
  compactLabel: string;
  expandedTitle: string;
  expandedSubtitle: string;
  orb: { state: OrbState; speed: number };
  primarySession?: Session;
  primaryResult?: ResultPresentation;
  sessions: Session[];
  visibleResults: ResultPresentation[];
  rowCount: number;
  token?: TokenUsageState;
  showTokenSummary: boolean;
  nextUpdateAt: number | null;
};
function resultLabel(result: TurnResult, token?: TokenUsageState): string {
  if (result.kind === "interrupted") return "任务已中断";
  return token?.status === "ready" && token.taskTokens != null ? `任务完成 · ${token.taskTokens.toLocaleString("zh-CN")} tokens` : "任务已完成";
}
export function deriveIslandPresentation(snapshot: ActivitySnapshot, usage: UsageSnapshot | null, tokens: Record<string, TokenUsageState>, now: number, heldResults: TurnResult[] = []): IslandPresentation {
  const sessions = snapshot.sessions.filter(session => session.lifecycle === "active").sort((a, b) =>
    Number(effectiveAttention(b) === "permission") - Number(effectiveAttention(a) === "permission") || b.lastActivityAt - a.lastActivityAt || a.id.localeCompare(b.id));
  const primarySession = sessions[0];
  const permission = sessions.some(session => effectiveAttention(session) === "permission");
  const quota = usage?.fiveHour?.remainingPercent === 0 || usage?.weekly?.remainingPercent === 0;
  const heldKeys = new Set(heldResults.map(resultKey));
  const byKey = new Map(snapshot.recentResults.map(result => [resultKey(result), result]));
  heldResults.forEach(result => byKey.set(resultKey(result), result));
  let nextUpdateAt: number | null = null;
  const visibleResults = [...byKey.values()].filter(result => {
    const token = tokens[resultKey(result)];
    const expiresAt = Math.max(result.finishedAt + RESULT_DISPLAY_MS, token?.status === "ready" ? token.readyAt + TOKEN_READY_DISPLAY_MS : 0);
    if (heldKeys.has(resultKey(result))) return true;
    if (now >= expiresAt) return false;
    nextUpdateAt = nextUpdateAt == null ? expiresAt : Math.min(nextUpdateAt, expiresAt);
    return true;
  }).sort((a, b) => b.finishedAt - a.finishedAt || a.sessionId.localeCompare(b.sessionId) || (a.turnId ?? "").localeCompare(b.turnId ?? ""))
    .map(result => ({ result, token: tokens[resultKey(result)], label: resultLabel(result, tokens[resultKey(result)]) }));
  const primaryResult = visibleResults[0];
  const token = primaryResult?.token;
  const rowCount = sessions.length + visibleResults.length;
  const activeAgents = primarySession?.agents.filter(agent => agent.activity !== null).length ?? 0;
  const layout = rowCount > 1 ? "multi" : rowCount === 1 || quota ? "single" : "minimal";
  const attention = permission ? "permission" : quota ? "quota" : "none";
  let feedback: IslandPresentation["feedback"] = "none";
  let compactLabel = "Codex";
  let expandedTitle = "暂无运行任务";
  let expandedSubtitle = "额度状态";
  let selectedOrb: { state: OrbState; speed: number } = idleOrb;
  if (primarySession) {
    const activity = primarySession.activity ?? "thinking";
    compactLabel = activeAgents > 1 ? "Agents..." : copy[activity].compact;
    expandedTitle = activeAgents > 1 ? "Working with agents..." : copy[activity].expanded;
    expandedSubtitle = activeAgents > 1 ? `${activeAgents} 个子代理` : "正在处理当前会话";
    selectedOrb = activeAgents > 1 || sessions.length > 1 ? { state: "weaving", speed: 1 } : orb[activity];
    if (sessions.length > 1) { compactLabel = `${sessions.length} 个会话`; expandedTitle = `${sessions.length} 个会话运行中`; expandedSubtitle = `${sessions.length} 个会话`; }
    if (visibleResults.length) {
      const completed = visibleResults.filter(item => item.result.kind === "completed").length;
      const interrupted = visibleResults.length - completed;
      const suffix = interrupted ? `${visibleResults.length} 个结果` : `${completed} 完成`;
      compactLabel = `${sessions.length} 运行 · ${suffix}`;
      expandedTitle = `${sessions.length} 运行 · ${visibleResults.length} 个结果`;
    }
  } else if (primaryResult) {
    feedback = primaryResult.result.kind;
    compactLabel = primaryResult.result.kind === "completed" ? "已完成" : "已中断";
    expandedTitle = primaryResult.result.kind === "completed" ? "任务已完成" : "任务已中断";
    expandedSubtitle = "本次任务已结束";
    if (primaryResult.result.kind === "completed" && token?.status === "ready" && token.taskTokens != null) compactLabel = `完成 · ${compactTokens(token.taskTokens)}`;
    if (visibleResults.length > 1) { compactLabel = `${visibleResults.length} 个结果`; expandedTitle = `${visibleResults.length} 个最近结果`; }
  }
  if (quota) { feedback = "none"; compactLabel = "额度已用尽"; expandedTitle = usage?.fiveHour?.remainingPercent === 0 ? "5 小时额度已用尽" : "每周额度已用尽"; }
  if (permission) { feedback = "none"; compactLabel = "等待审批"; expandedTitle = "等待审批"; expandedSubtitle = "需要你的确认"; }
  return { layout, attention, feedback, compactLabel, expandedTitle, expandedSubtitle, orb: selectedOrb, primarySession, primaryResult, sessions, visibleResults, rowCount, token,
    showTokenSummary: rowCount === 1 && !quota && !permission && primaryResult?.result.kind === "completed" && token?.status === "ready", nextUpdateAt };
}
