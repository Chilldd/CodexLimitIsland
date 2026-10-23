import { percent, tone, resetText, resetSummary } from "./domain/format";
import { getIdlePrompt } from "./domain/idlePrompts";
import type { CompactTier } from "./domain/metrics";

import type {
  Activity,
  Attention,
  TurnResultKind,
  TurnResult,
  UsageSnapshot,
  Session,
  ActivitySnapshot,
  LimitDisplayWindow,
} from "./generated/contracts";
export type {
  Activity,
  Attention,
  Lifecycle,
  TurnResultKind,
  TurnResult,
  LimitWindow,
  UsageSnapshot,
  Agent,
  Session,
  ActivitySnapshot,
  LimitDisplayWindow,
} from "./generated/contracts";
export type TokenUsageState =
  | { status: "loading" }
  | { status: "ready"; taskTokens: number | null; sessionTokens: number | null; readyAt: number }
  | { status: "unavailable" };
export type LastTurnSummary = { result: TurnResult; token?: TokenUsageState };
export type OrbState =
  "working" | "searching" | "solving" | "connecting" | "weaving" | "composing" | "breathing" | "shaping";
export function newerActivity(current: ActivitySnapshot, next: ActivitySnapshot): ActivitySnapshot {
  return next.updatedAt >= current.updatedAt ? next : current;
}
export function resultKey(result: TurnResult): string {
  return `${result.sessionId}:${result.turnId ?? `legacy-${result.finishedAt}`}`;
}
export function effectiveAttention(session: Session): Attention {
  return session.attention === "permission" || session.agents.some((agent) => agent.attention === "permission")
    ? "permission"
    : "none";
}
const RESULT_DISPLAY_MS = 3_000;
const TOKEN_READY_DISPLAY_MS = 2_800;
const copy: Record<Activity, { compact: string; expanded: string }> = {
  thinking: { compact: "Thinking...", expanded: "Thinking..." },
  working: { compact: "Working...", expanded: "Working..." },
  searching: { compact: "Searching...", expanded: "Searching..." },
  editing: { compact: "Editing...", expanded: "Applying changes..." },
  executing: { compact: "Running...", expanded: "Running command..." },
  connecting: { compact: "Connecting...", expanded: "Connecting..." },
  compacting: { compact: "Compacting...", expanded: "Compacting context..." },
};
const orb: Record<Activity, { state: OrbState; speed: number }> = {
  thinking: { state: "solving", speed: 1 },
  working: { state: "working", speed: 1 },
  searching: { state: "searching", speed: 1.1 },
  editing: { state: "shaping", speed: 1 },
  executing: { state: "working", speed: 1.15 },
  connecting: { state: "connecting", speed: 1 },
  compacting: { state: "composing", speed: 1 },
};
const idleOrb = { state: "breathing" as const, speed: 0.65 };
export const compactTokens = (value: number) => {
  if (value >= 999_500) {
    const millions = value / 1_000_000;
    return `${millions.toFixed(millions >= 100 ? 0 : 1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${thousands.toFixed(thousands >= 100 ? 0 : 1).replace(/\.0$/, "")}k`;
  }
  return String(value);
};
// 紧凑态宽度档位：完成结果始终按「完成 + token」预留，避免 token 加载、失败时二次变宽或收窄；
// 英文状态按字符数分档（≤13 run，≤18 result，更长 multi），“ · ” 分隔符不计入。
export function compactTierFor(label: string, completed: boolean): CompactTier {
  if (completed) return "result";
  const length = [...label.replace(" · ", "")].length;
  return length <= 13 ? "run" : length <= 18 ? "result" : "multi";
}
export function sessionLabel(session: Session): string {
  return effectiveAttention(session) === "permission"
    ? "Approval needed"
    : copy[session.activity ?? "thinking"].expanded;
}
export type ResultPresentation = { result: TurnResult; token?: TokenUsageState; label: string };
export type ElapsedView = { from: number | null; to: number | null };
export type SessionRowView = {
  key: string;
  sessionId: string;
  title: string;
  tooltip: string;
  subtitle: string;
  model: string | null;
  token?: TokenUsageState;
  tokenLabel?: string;
  attention?: Attention;
  feedback?: TurnResultKind;
  elapsed: ElapsedView;
};
export type UsageRowView = {
  window: LimitDisplayWindow;
  selected: boolean;
  label: string;
  tone: ReturnType<typeof tone>;
  percent: string;
  width: string;
  reset: string;
};
export type MetaView = { label: string; elapsed?: ElapsedView; time?: string };
export type IslandPresentation = {
  layout: "minimal" | "single" | "multi";
  attention: "none" | "permission" | "quota";
  feedback: "none" | TurnResultKind;
  compactLabel: string;
  compactTier: CompactTier;
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
  headline: { sessionId?: string; title: string; subtitle: string };
  activityHeading: { title: string; summary: string };
  rows: SessionRowView[];
  meta: MetaView | null;
  usageRows: UsageRowView[];
  compactUsage: { tone: ReturnType<typeof tone>; percent: string; label: string };
  ariaLabel: string;
  isIdle: boolean;
};
function resultLabel(result: TurnResult, token?: TokenUsageState): string {
  if (result.kind === "interrupted") return "Task interrupted";
  return token?.status === "ready" && token.taskTokens != null
    ? `Completed · ${token.taskTokens.toLocaleString("en-US")} tokens`
    : "Task completed";
}
function idleTurnSubtitle(turn: LastTurnSummary): string {
  if (turn.result.kind === "interrupted") return "Previous task interrupted";
  return turn.token?.status === "ready" && turn.token.taskTokens != null
    ? `Last completed · ${compactTokens(turn.token.taskTokens)} tokens`
    : "Previous task completed";
}
export function deriveIslandPresentation(
  snapshot: ActivitySnapshot,
  usage: UsageSnapshot | null,
  tokens: Record<string, TokenUsageState>,
  now: number,
  heldResults: TurnResult[] = [],
  usageFailed = false,
  limitWindow: LimitDisplayWindow = "fiveHour",
  lastTurn: LastTurnSummary | null = null,
  sessionTurns: Record<string, LastTurnSummary> = {},
): IslandPresentation {
  const sessions = snapshot.sessions
    .filter((session) => session.lifecycle === "active")
    .sort(
      (a, b) =>
        Number(effectiveAttention(b) === "permission") - Number(effectiveAttention(a) === "permission") ||
        b.lastActivityAt - a.lastActivityAt ||
        a.id.localeCompare(b.id),
    );
  const primarySession = sessions[0];
  const permission = sessions.some((session) => effectiveAttention(session) === "permission");
  const quota = usage?.fiveHour?.remainingPercent === 0 || usage?.weekly?.remainingPercent === 0;
  const heldKeys = new Set(heldResults.map(resultKey));
  const byKey = new Map(snapshot.recentResults.map((result) => [resultKey(result), result]));
  heldResults.forEach((result) => byKey.set(resultKey(result), result));
  const sortedResults = [...byKey.values()].sort(
    (a, b) =>
      b.finishedAt - a.finishedAt ||
      a.sessionId.localeCompare(b.sessionId) ||
      (a.turnId ?? "").localeCompare(b.turnId ?? ""),
  );
  let nextUpdateAt: number | null = null;
  const visibleResults = sortedResults
    .filter((result) => {
      const token = tokens[resultKey(result)];
      const expiresAt = Math.max(
        result.finishedAt + RESULT_DISPLAY_MS,
        token?.status === "ready" ? token.readyAt + TOKEN_READY_DISPLAY_MS : 0,
      );
      if (heldKeys.has(resultKey(result))) return true;
      if (now >= expiresAt) return false;
      nextUpdateAt = nextUpdateAt == null ? expiresAt : Math.min(nextUpdateAt, expiresAt);
      return true;
    })
    .map((result) => ({
      result,
      token: tokens[resultKey(result)],
      label: resultLabel(result, tokens[resultKey(result)]),
    }));
  const primaryResult = visibleResults[0];
  const token = primaryResult?.token;
  const rowCount = sessions.length + visibleResults.length;
  const activeAgents = primarySession?.agents.filter((agent) => agent.activity !== null).length ?? 0;
  const layout = rowCount > 1 ? "multi" : rowCount === 1 || quota ? "single" : "minimal";
  const attention = permission ? "permission" : quota ? "quota" : "none";
  const latestExpired = sortedResults[0];
  const candidateResult =
    latestExpired && (!lastTurn || latestExpired.finishedAt >= lastTurn.result.finishedAt)
      ? latestExpired
      : lastTurn?.result;
  const idleTurn: LastTurnSummary | null =
    !primarySession && !primaryResult && candidateResult
      ? {
          result: candidateResult,
          token:
            tokens[resultKey(candidateResult)] ??
            (lastTurn && resultKey(lastTurn.result) === resultKey(candidateResult) ? lastTurn.token : undefined),
        }
      : null;
  let feedback: IslandPresentation["feedback"] = "none";
  let compactLabel = "Codex";
  let expandedTitle = "No active tasks";
  let expandedSubtitle = idleTurn
    ? idleTurnSubtitle(idleTurn)
    : usageFailed
      ? "Limits temporarily unavailable"
      : !usage
        ? "Syncing account limits"
        : getIdlePrompt(now);
  let selectedOrb: { state: OrbState; speed: number } = idleOrb;
  if (primarySession) {
    const activity = primarySession.activity ?? "thinking";
    compactLabel = activeAgents > 1 ? "Multi-agent" : copy[activity].compact;
    expandedTitle = activeAgents > 1 ? "Multiple agents working" : copy[activity].expanded;
    expandedSubtitle = activeAgents > 1 ? `${activeAgents} agents` : "Current session";
    selectedOrb = activeAgents > 1 || sessions.length > 1 ? { state: "weaving", speed: 1 } : orb[activity];
    if (sessions.length > 1) {
      compactLabel = `${sessions.length} active sessions`;
      expandedTitle = `${sessions.length} sessions active`;
      expandedSubtitle = `${sessions.length} active sessions`;
    }
    const otherResults = visibleResults.filter(
      (item) => !sessions.some((session) => session.id === item.result.sessionId),
    );
    if (otherResults.length) {
      const completed = otherResults.filter((item) => item.result.kind === "completed").length;
      const interrupted = otherResults.length - completed;
      const suffix = interrupted ? `${otherResults.length} results` : `${completed} completed`;
      compactLabel = `${sessions.length} running · ${suffix}`;
      expandedTitle = `${sessions.length} running · ${otherResults.length} results`;
    }
  } else if (primaryResult) {
    feedback = primaryResult.result.kind;
    compactLabel = primaryResult.result.kind === "completed" ? "Completed" : "Interrupted";
    expandedTitle = primaryResult.result.kind === "completed" ? "Task completed" : "Task interrupted";
    expandedSubtitle = "Session completed";
    if (primaryResult.result.kind === "completed" && token?.status === "ready" && token.taskTokens != null)
      compactLabel = `Completed · ${compactTokens(token.taskTokens)}`;
    if (visibleResults.length > 1) {
      compactLabel = `${visibleResults.length} results`;
      expandedTitle = `${visibleResults.length} recent results`;
    }
  }
  if (quota) {
    const quotaWeek =
      limitWindow === "week"
        ? usage?.weekly?.remainingPercent === 0
        : usage?.fiveHour?.remainingPercent !== 0 && usage?.weekly?.remainingPercent === 0;
    feedback = "none";
    compactLabel = "Rate limit reached";
    expandedTitle = quotaWeek ? "Weekly limit reached" : "5-hour limit reached";
    if (!primarySession && !primaryResult) {
      expandedSubtitle = resetSummary(
        quotaWeek ? (usage?.weekly ?? null) : (usage?.fiveHour ?? null),
        quotaWeek ? "Weekly limit" : "5-hour limit",
        now,
      );
    }
  }
  if (permission) {
    feedback = "none";
    compactLabel = "Approval needed";
    expandedTitle = "Approval needed";
    expandedSubtitle = "Waiting for your approval";
  }
  const targetLimit = limitWindow === "week" ? (usage?.weekly ?? null) : (usage?.fiveHour ?? null);
  const limitLabel = limitWindow === "week" ? "7d" : "5h";
  const idleMetaLabel = usageFailed
    ? "Unable to read limits"
    : !usage
      ? "Connecting to Codex"
      : quota
        ? "100% used"
        : "";
  const isIdle = !primarySession && !primaryResult && !quota && !permission && !idleTurn;
  // 项目行以 Session 为身份；同一会话的新任务与上次结果共用一行，Token 仍按原 Turn 查询。
  const latestTurns = new Map(Object.entries(sessionTurns));
  if (lastTurn && !latestTurns.has(lastTurn.result.sessionId)) latestTurns.set(lastTurn.result.sessionId, lastTurn);
  for (const result of [...sortedResults, ...(lastTurn ? [lastTurn.result] : [])]) {
    const previous = latestTurns.get(result.sessionId);
    if (previous && previous.result.finishedAt > result.finishedAt) continue;
    latestTurns.set(result.sessionId, {
      result,
      token:
        tokens[resultKey(result)] ??
        (previous && resultKey(previous.result) === resultKey(result) ? previous.token : undefined),
    });
  }
  const rows: SessionRowView[] = sessions.map((session) => {
    const agents = session.agents.filter((agent) => agent.activity !== null).length;
    return {
      key: `session:${session.id}`,
      sessionId: session.id,
      title: session.project || session.cwd?.split(/[\\/]/).pop() || "Codex session",
      tooltip: session.project ?? session.cwd ?? "",
      subtitle: sessionLabel(session) + (agents > 1 ? ` · ${agents} agents` : ""),
      model: session.model,
      token: latestTurns.get(session.id)?.token,
      tokenLabel: "Previous",
      attention: effectiveAttention(session),
      elapsed: { from: session.startedAt, to: null },
    };
  });
  const listedSessions = new Set(sessions.map((session) => session.id));
  const rowResults = visibleResults.length
    ? visibleResults.map(({ result }) => result)
    : idleTurn
      ? [idleTurn.result]
      : [];
  for (const result of rowResults) {
    if (listedSessions.has(result.sessionId)) continue;
    listedSessions.add(result.sessionId);
    const summary = latestTurns.get(result.sessionId);
    const rowToken =
      tokens[resultKey(result)] ??
      (summary && resultKey(summary.result) === resultKey(result) ? summary.token : undefined);
    rows.push({
      key: `session:${result.sessionId}`,
      sessionId: result.sessionId,
      title: result.project || "Codex session",
      tooltip: result.project ?? "",
      subtitle: idleTurn
        ? result.kind === "completed"
          ? "Last task completed"
          : "Last task interrupted"
        : result.kind === "completed"
          ? "Task completed"
          : "Task interrupted",
      model: result.model,
      token: result.kind === "completed" ? rowToken : undefined,
      tokenLabel: "Task",
      feedback: result.kind,
      elapsed: { from: result.startedAt, to: result.finishedAt },
    });
  }
  const resultRows = rows.length - sessions.length;
  const activityHeading = {
    title: idleTurn
      ? "Last result"
      : resultRows
        ? sessions.length
          ? "Activity & results"
          : "Recent results"
        : "Current activity",
    summary:
      `${sessions.length} active` +
      (resultRows && !idleTurn ? ` · ${resultRows} ${resultRows === 1 ? "result" : "results"}` : ""),
  };
  return {
    layout,
    attention,
    feedback,
    compactLabel,
    compactTier: compactTierFor(compactLabel, feedback === "completed"),
    expandedTitle,
    expandedSubtitle,
    isIdle,
    orb: selectedOrb,
    primarySession,
    primaryResult,
    sessions,
    visibleResults,
    rowCount,
    token,
    showTokenSummary:
      rowCount === 1 &&
      !quota &&
      !permission &&
      primaryResult?.result.kind === "completed" &&
      token?.status === "ready",
    nextUpdateAt,
    headline: {
      sessionId: primarySession?.id ?? primaryResult?.result.sessionId ?? idleTurn?.result.sessionId,
      title: primarySession?.project || primaryResult?.result.project || idleTurn?.result.project || "Codex session",
      subtitle: expandedSubtitle,
    },
    activityHeading,
    rows,
    meta:
      layout === "multi"
        ? null
        : {
            label: primarySession?.model || primaryResult?.result.model || idleTurn?.result.model || idleMetaLabel,
            ...(primarySession
              ? { elapsed: { from: primarySession.startedAt, to: null } }
              : primaryResult
                ? { elapsed: { from: primaryResult.result.startedAt, to: primaryResult.result.finishedAt } }
                : {
                    time: usage
                      ? new Date(usage.updatedAt * 1000).toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "",
                  }),
          },
    usageRows: (
      [
        ["5h", usage?.fiveHour ?? null, "fiveHour" as const],
        ["7d", usage?.weekly ?? null, "week" as const],
      ] as const
    ).map(([label, value, windowKey]) => ({
      window: windowKey,
      selected: limitWindow === windowKey,
      label,
      tone: tone(value),
      percent: percent(value),
      width: `${value?.remainingPercent ?? 0}%`,
      reset: resetText(value),
    })),
    compactUsage: {
      tone: tone(targetLimit),
      percent: percent(targetLimit),
      label: limitLabel,
    },
    ariaLabel:
      layout === "minimal"
        ? `Codex ${limitWindow === "week" ? "weekly" : "5-hour"} remaining ${percent(targetLimit)}`
        : compactLabel,
  };
}
