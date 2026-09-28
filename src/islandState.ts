export type Activity = "thinking" | "working" | "searching" | "editing" | "executing" | "connecting" | "compacting";
export type Attention = "none" | "permission";
export type Lifecycle = "idle" | "active";
export type TurnResultKind = "completed" | "interrupted";
export type TurnResult = { kind: TurnResultKind; sessionId: string; turnId: string | null; finishedAt: number };
export type TokenUsageState = { status: "loading" } | { status: "ready"; taskTokens: number | null; sessionTokens: number | null; readyAt: number } | { status: "unavailable" };
export type OrbState = "working" | "searching" | "solving" | "listening" | "connecting" | "weaving" | "composing" | "breathing" | "shaping";
export type LimitWindow = { remainingPercent: number; resetsAt: number | null };
export type UsageSnapshot = { fiveHour: LimitWindow | null; weekly: LimitWindow | null; updatedAt: number };
export type Agent = { id: string; activity: Activity | null; attention: Attention; lastActivityAt: number };
export type Session = { id: string; project: string | null; cwd: string | null; lifecycle: Lifecycle; activity: Activity | null; attention: Attention; currentCommand: string | null; startedAt: number | null; lastActivityAt: number; model: string | null; currentTurnId: string | null; agents: Agent[] };
export type ActivitySnapshot = { sessions: Session[]; recentResults: TurnResult[]; updatedAt: number };
export function newerActivity(current: ActivitySnapshot, next: ActivitySnapshot): ActivitySnapshot { return next.updatedAt >= current.updatedAt ? next : current; }
export function resultKey(result: TurnResult): string { return `${result.sessionId}:${result.turnId ?? `legacy-${result.finishedAt}`}`; }
const RESULT_DISPLAY_MS = 3000;
const TOKEN_READY_DISPLAY_MS = 2800;
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
export function sessionLabel(session: Session): string { return session.attention === "permission" ? "等待审批" : copy[session.activity ?? "thinking"].expanded; }
export type IslandPresentation = {
  layout: "minimal" | "single" | "multi";
  attention: "none" | "permission" | "quota";
  feedback: "none" | TurnResultKind;
  compactLabel: string;
  expandedTitle: string;
  expandedSubtitle: string;
  orb: { state: OrbState; speed: number };
  primarySession?: Session;
  sessions: Session[];
  result?: TurnResult;
  token?: TokenUsageState;
  showTokenSummary: boolean;
};
export function deriveIslandPresentation(snapshot: ActivitySnapshot, usage: UsageSnapshot | null, tokens: Record<string, TokenUsageState>, now: number, heldResult: TurnResult | null = null): IslandPresentation {
  const sessions = snapshot.sessions.filter(session => session.lifecycle === "active").sort((a, b) => Number(b.attention === "permission") - Number(a.attention === "permission") || b.lastActivityAt - a.lastActivityAt);
  const primarySession = sessions[0];
  const permission = sessions.some(session => session.attention === "permission" || session.agents.some(agent => agent.attention === "permission"));
  const quota = usage?.fiveHour?.remainingPercent === 0 || usage?.weekly?.remainingPercent === 0;
  const result = heldResult ?? [...snapshot.recentResults].reverse().find(item => { const token = tokens[resultKey(item)]; return now - item.finishedAt <= RESULT_DISPLAY_MS || (token?.status === "ready" && now - token.readyAt <= TOKEN_READY_DISPLAY_MS); });
  const token = result ? tokens[resultKey(result)] : undefined;
  const activeAgents = primarySession?.agents.filter(agent => agent.activity !== null).length ?? 0;
  const layout = sessions.length > 1 ? "multi" : sessions.length === 1 || result || quota ? "single" : "minimal";
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
  } else if (result) {
    feedback = result.kind;
    compactLabel = result.kind === "completed" ? "已完成" : "已中断";
    expandedTitle = result.kind === "completed" ? "任务已完成" : "任务已中断";
    expandedSubtitle = "本次任务已结束";
    if (result.kind === "completed" && token?.status === "ready" && token.taskTokens != null) compactLabel = `完成 · ${compactTokens(token.taskTokens)}`;
  }
  if (quota) { feedback = "none"; compactLabel = "额度已用尽"; expandedTitle = usage?.fiveHour?.remainingPercent === 0 ? "5 小时额度已用尽" : "每周额度已用尽"; }
  if (permission) { feedback = "none"; compactLabel = "等待审批"; expandedTitle = "等待审批"; expandedSubtitle = "需要你的确认"; }
  return { layout, attention, feedback, compactLabel, expandedTitle, expandedSubtitle, orb: selectedOrb, primarySession, sessions, result, token, showTokenSummary: !primarySession && !quota && !permission && result?.kind === "completed" && token?.status === "ready" };
}
