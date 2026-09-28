import { resultKey, type Activity, type ActivitySnapshot, type Agent, type Session, type TokenUsageState, type TurnResult, type UsageSnapshot } from "./islandState";

export const DEBUG_SCENARIOS = [
  "Idle", "Thinking", "Searching", "Editing", "Executing", "Connecting", "Compacting",
  "Permission", "Agent Permission", "Completed Loading", "Completed Ready", "Interrupted",
  "2 Active Sessions", "1 Active + 1 Completed", "2 Active + 1 Completed", "2 Completed",
  "Multi Agent", "Quota Exhausted", "Quota + Permission",
] as const;
export type DebugScenarioName = typeof DEBUG_SCENARIOS[number];
export type DebugScenario = { snapshot: ActivitySnapshot; usage: UsageSnapshot; tokens: Record<string, TokenUsageState> };

export function createDebugScenario(name: DebugScenarioName, now: number): DebugScenario {
  const session = (id: string, activity: Activity = "thinking", agents: Agent[] = [], attention: Session["attention"] = "none"): Session => ({
    id, project: id, cwd: null, lifecycle: "active", activity, attention, currentCommand: null,
    startedAt: now - 94_000, lastActivityAt: now, model: "gpt-6-sol", currentTurnId: `${id}-turn`, agents,
  });
  const result = (id: string, kind: TurnResult["kind"] = "completed"): TurnResult => ({
    kind, sessionId: id, turnId: `${id}-turn`, finishedAt: now, project: id, model: "gpt-6-sol", startedAt: now - 94_000,
  });
  const agent = (id: string, attention: Agent["attention"] = "none"): Agent => ({ id, activity: "working", attention, lastActivityAt: now });
  const snapshot: ActivitySnapshot = { sessions: [], recentResults: [], updatedAt: now };
  const usage: UsageSnapshot = { fiveHour: { remainingPercent: 51, resetsAt: null }, weekly: { remainingPercent: 84, resetsAt: null }, updatedAt: now / 1000 };
  const tokens: Record<string, TokenUsageState> = {};
  const active = (activity: Activity) => { snapshot.sessions = [session("CodexLimitIsland", activity)]; };
  if (["Thinking", "Searching", "Editing", "Executing", "Connecting", "Compacting"].includes(name)) active(name.toLowerCase() as Activity);
  if (name === "Permission" || name === "Quota + Permission") snapshot.sessions = [session("CodexLimitIsland", "executing", [], "permission")];
  if (name === "Agent Permission") snapshot.sessions = [session("OtherProject"), session("CodexLimitIsland", "executing", [agent("worker", "permission")])];
  if (name === "Completed Loading" || name === "Completed Ready" || name === "Interrupted") snapshot.recentResults = [result("CodexLimitIsland", name === "Interrupted" ? "interrupted" : "completed")];
  if (name === "2 Active Sessions" || name === "2 Active + 1 Completed") snapshot.sessions = [session("CodexLimitIsland"), session("OtherProject", "editing")];
  if (name === "1 Active + 1 Completed") snapshot.sessions = [session("CodexLimitIsland")];
  if (name === "1 Active + 1 Completed" || name === "2 Active + 1 Completed") snapshot.recentResults = [result("FinishedProject")];
  if (name === "2 Completed") snapshot.recentResults = [result("FinishedProject"), result("OtherProject")];
  if (name === "Multi Agent") snapshot.sessions = [session("CodexLimitIsland", "working", [agent("a"), agent("b")])];
  if (name === "Quota Exhausted" || name === "Quota + Permission") usage.fiveHour = { remainingPercent: 0, resetsAt: null };
  for (const item of snapshot.recentResults) {
    if (item.kind !== "completed") continue;
    tokens[resultKey(item)] = name === "Completed Loading" ? { status: "loading" } : { status: "ready", taskTokens: item.sessionId === "OtherProject" ? 8_300 : 12_648, sessionTokens: 20_000, readyAt: now };
  }
  return { snapshot, usage, tokens };
}
