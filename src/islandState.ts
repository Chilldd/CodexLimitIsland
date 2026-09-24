export type Activity = "idle" | "thinking" | "working" | "searching" | "editing" | "running-command" | "connecting" | "composing" | "waiting" | "completed";
export type OrbState = "working" | "searching" | "solving" | "listening" | "connecting" | "weaving" | "composing" | "breathing" | "shaping";
export type LimitWindow = { remainingPercent: number; resetsAt: number | null };
export type UsageSnapshot = { fiveHour: LimitWindow | null; weekly: LimitWindow | null; updatedAt: number };
export type Agent = { id: string; state: Activity; lastActivityAt: number };
export type Session = { id: string; project: string | null; cwd: string | null; state: Activity; currentCommand: string | null; startedAt: number | null; lastActivityAt: number; completedAt: number | null; model: string | null; agents: Agent[] };
export type ActivitySnapshot = { sessions: Session[]; updatedAt: number };
export function newerActivity(current: ActivitySnapshot, next: ActivitySnapshot): ActivitySnapshot { return next.updatedAt >= current.updatedAt ? next : current; }
export type IslandView = { mode: "minimal" | "single-session" | "multi-session" | "attention"; label: string; expandedLabel: string; orb: { state: OrbState; speed: number }; primary?: Session; sessions: Session[]; activeCount: number; waitingCount: number };

const activityCopy: Record<Activity, { compact: string; expanded: string }> = {
  idle: { compact: "Codex", expanded: "暂无运行任务" },
  thinking: { compact: "Thinking...", expanded: "Thinking..." },
  working: { compact: "Working...", expanded: "Working..." },
  searching: { compact: "Searching...", expanded: "Searching..." },
  editing: { compact: "Editing...", expanded: "Editing files..." },
  "running-command": { compact: "Running...", expanded: "Running command..." },
  connecting: { compact: "Connecting...", expanded: "Connecting..." },
  composing: { compact: "Compacting...", expanded: "Compacting context..." },
  waiting: { compact: "等待审批", expanded: "等待审批" },
  completed: { compact: "已完成", expanded: "任务已完成" },
};
export function getActivityLabel(state: Activity, mode: "compact" | "expanded"): string { return activityCopy[state][mode]; }

const ORB_CONFIG: Record<Activity, { state: OrbState; speed: number }> = {
  idle: { state: "breathing", speed: .65 }, thinking: { state: "solving", speed: 1 }, working: { state: "working", speed: 1 }, searching: { state: "searching", speed: 1.1 },
  editing: { state: "shaping", speed: 1 }, "running-command": { state: "working", speed: 1.15 }, connecting: { state: "connecting", speed: 1 },
  composing: { state: "composing", speed: 1 }, waiting: { state: "listening", speed: .75 }, completed: { state: "breathing", speed: .65 },
};
const rank: Record<Activity, number> = { waiting: 2, thinking: 3, working: 3, searching: 3, editing: 3, "running-command": 3, connecting: 3, composing: 3, completed: 4, idle: 5 };
export function sessionLabel(session: Session): string {
  return getActivityLabel(session.state, "expanded");
}
export function selectIsland(sessions: Session[], usage: UsageSnapshot | null, now: number): IslandView {
  const top = sessions.filter(s => s.state === "completed" ? now - (s.completedAt ?? s.lastActivityAt) <= 3000 : s.state === "waiting" || now - s.lastActivityAt <= 600_000).sort((a, b) => rank[a.state] - rank[b.state] || b.lastActivityAt - a.lastActivityAt);
  const working = top.filter(s => rank[s.state] === 3);
  const waitingCount = top.filter(s => s.state === "waiting").length;
  const primary = top[0];
  const base = { primary, sessions: top, activeCount: working.length, waitingCount };
  if (usage?.fiveHour?.remainingPercent === 0 || usage?.weekly?.remainingPercent === 0) return { ...base, mode: "attention", label: "额度已用尽", expandedLabel: usage?.fiveHour?.remainingPercent === 0 ? "5 小时额度已用尽" : "每周额度已用尽", orb: { state: "breathing", speed: .5 } };
  if (waitingCount) return { ...base, mode: "attention", label: "等待审批", expandedLabel: "等待审批", orb: ORB_CONFIG.waiting };
  if (working.length > 1) return { ...base, mode: "multi-session", label: `${working.length} 个会话`, expandedLabel: `${working.length} 个会话运行中`, orb: { state: "weaving", speed: 1 } };
  if (working.length === 1) {
    const activeAgents = working[0].agents.filter(a => a.state !== "completed" && a.state !== "idle").length;
    return { ...base, mode: "single-session", label: activeAgents > 1 ? "Agents..." : getActivityLabel(working[0].state, "compact"), expandedLabel: activeAgents > 1 ? "Working with agents..." : sessionLabel(working[0]), orb: activeAgents > 1 ? { state: "weaving", speed: 1 } : ORB_CONFIG[working[0].state] };
  }
  const completed = top.filter(s => s.state === "completed");
  if (completed.length) return { ...base, mode: "single-session", label: "已完成", expandedLabel: completed.length === 1 ? "任务已完成" : `${completed.length} 个会话已完成`, orb: ORB_CONFIG.completed };
  return { ...base, mode: "minimal", label: "Codex", expandedLabel: "暂无运行任务", orb: ORB_CONFIG.idle };
}
