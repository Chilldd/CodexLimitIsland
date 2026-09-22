export type Activity = "idle" | "thinking" | "working" | "searching" | "editing" | "running-command" | "connecting" | "composing" | "waiting" | "completed" | "error" | "rate-limited";
export type OrbState = "working" | "searching" | "solving" | "listening" | "connecting" | "weaving" | "composing" | "breathing" | "shaping";
export type LimitWindow = { remainingPercent: number; resetsAt: number | null };
export type UsageSnapshot = { fiveHour: LimitWindow | null; weekly: LimitWindow | null; updatedAt: number };
export type Agent = { id: string; state: Activity; lastActivityAt: number };
export type Session = { id: string; parentSessionId: string | null; project: string | null; cwd: string | null; state: Activity; label: string | null; currentFile: string | null; currentCommand: string | null; startedAt: number | null; lastActivityAt: number; completedAt: number | null; model: string | null; reasoningLevel: string | null; agents: Agent[] };
export type ActivitySnapshot = { sessions: Session[]; updatedAt: number };
export type IslandView = { mode: "minimal" | "single-session" | "multi-session" | "attention"; label: string; orb: { state: OrbState; speed: number }; primary?: Session; sessions: Session[]; activeCount: number; waitingCount: number; errorCount: number; rateLimitedCount: number };

const ORB_CONFIG: Record<Activity, { state: OrbState; speed: number }> = {
  idle: { state: "breathing", speed: .65 }, thinking: { state: "solving", speed: 1 }, working: { state: "working", speed: 1 }, searching: { state: "searching", speed: 1.1 },
  editing: { state: "shaping", speed: 1 }, "running-command": { state: "working", speed: 1.15 }, connecting: { state: "connecting", speed: 1 },
  composing: { state: "composing", speed: 1 }, waiting: { state: "listening", speed: .75 }, completed: { state: "breathing", speed: .65 },
  error: { state: "breathing", speed: .5 }, "rate-limited": { state: "breathing", speed: .5 },
};
const rank: Record<Activity, number> = { "rate-limited": 0, error: 1, waiting: 2, thinking: 3, working: 3, searching: 3, editing: 3, "running-command": 3, connecting: 3, composing: 3, completed: 4, idle: 5 };
export function sessionLabel(session: Session): string {
  if (session.label) return session.label;
  switch (session.state) {
    case "thinking": return "Thinking…"; case "working": return "Working…"; case "searching": return "Searching codebase…";
    case "editing": return session.currentFile ? `Editing ${session.currentFile.split(/[\\/]/).pop()}` : "Editing files…";
    case "running-command": return session.currentCommand ? `Running ${session.currentCommand.trim().split(/\s+/).slice(0, 2).join(" ")}` : "Running command…";
    case "connecting": return "Connecting…"; case "composing": return "Writing…"; case "waiting": return "Needs approval";
    case "completed": return "Completed"; case "error": return "Failed"; case "rate-limited": return "Limit reached"; default: return "";
  }
}
export function selectIsland(sessions: Session[], usage: UsageSnapshot | null, now: number): IslandView {
  const top = sessions.filter(s => !s.parentSessionId && (s.state === "completed" ? now - (s.completedAt ?? s.lastActivityAt) <= 3000 : s.state === "waiting" || now - s.lastActivityAt <= 600_000)).sort((a, b) => rank[a.state] - rank[b.state] || b.lastActivityAt - a.lastActivityAt);
  const working = top.filter(s => rank[s.state] === 3);
  const waitingCount = top.filter(s => s.state === "waiting").length;
  const errorCount = top.filter(s => s.state === "error").length;
  const rateLimitedCount = top.filter(s => s.state === "rate-limited").length;
  const primary = top[0];
  const base = { primary, sessions: top, activeCount: working.length, waitingCount, errorCount, rateLimitedCount };
  if (rateLimitedCount || usage?.fiveHour?.remainingPercent === 0 || usage?.weekly?.remainingPercent === 0) return { ...base, mode: "attention", label: usage?.fiveHour?.remainingPercent === 0 ? "5H limit reached" : usage?.weekly?.remainingPercent === 0 ? "WEEK limit reached" : `${rateLimitedCount} session${rateLimitedCount === 1 ? "" : "s"} hit a limit`, orb: ORB_CONFIG["rate-limited"] };
  if (errorCount) return { ...base, mode: "attention", label: `${errorCount} session${errorCount === 1 ? "" : "s"} failed`, orb: ORB_CONFIG.error };
  if (waitingCount) return { ...base, mode: "attention", label: `${waitingCount} session${waitingCount === 1 ? " needs" : "s need"} you`, orb: ORB_CONFIG.waiting };
  if (working.length > 1) return { ...base, mode: "multi-session", label: `${working.length} sessions working`, orb: { state: "weaving", speed: 1 } };
  if (working.length === 1) {
    const activeAgents = working[0].agents.filter(a => a.state !== "completed" && a.state !== "idle").length;
    return { ...base, mode: "single-session", label: activeAgents > 1 ? `Working · ${activeAgents} agents` : sessionLabel(working[0]), orb: activeAgents > 1 ? { state: "weaving", speed: 1 } : ORB_CONFIG[working[0].state] };
  }
  const completed = top.filter(s => s.state === "completed");
  if (completed.length) return { ...base, mode: "single-session", label: completed.length === 1 ? "Completed" : `${completed.length} sessions completed`, orb: ORB_CONFIG.completed };
  return { ...base, mode: "minimal", label: "", orb: ORB_CONFIG.idle };
}
