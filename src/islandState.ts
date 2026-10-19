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
  thinking: { compact: "思考中", expanded: "正在思考…" },
  working: { compact: "处理中", expanded: "正在处理…" },
  searching: { compact: "搜索中", expanded: "正在搜索…" },
  editing: { compact: "编辑中", expanded: "正在编辑文件…" },
  executing: { compact: "运行中", expanded: "正在运行命令…" },
  connecting: { compact: "连接中", expanded: "正在连接…" },
  compacting: { compact: "压缩中", expanded: "正在压缩上下文…" },
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
const compactTokens = (value: number) => {
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
// 其余按文案字数分档（≤3 字 run，≤5 字 result，更长 multi），“ · ” 分隔符不计入。
export function compactTierFor(label: string, completed: boolean): CompactTier {
  if (completed) return "result";
  const length = [...label.replace(" · ", "")].length;
  return length <= 3 ? "run" : length <= 5 ? "result" : "multi";
}
export function sessionLabel(session: Session): string {
  return effectiveAttention(session) === "permission" ? "等待审批" : copy[session.activity ?? "thinking"].expanded;
}
export type ResultPresentation = { result: TurnResult; token?: TokenUsageState; label: string };
export type ElapsedView = { from: number | null; to: number | null };
export type SessionRowView = {
  key: string;
  sessionId: string;
  title: string;
  tooltip: string;
  subtitle: string;
  attention?: Attention;
  feedback?: TurnResultKind;
  elapsed: ElapsedView;
};
export type UsageRowView = {
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
  rows: SessionRowView[];
  meta: MetaView | null;
  usageRows: UsageRowView[];
  compactUsage: { tone: ReturnType<typeof tone>; percent: string; label: string };
  ariaLabel: string;
  isIdle: boolean;
};
function resultLabel(result: TurnResult, token?: TokenUsageState): string {
  if (result.kind === "interrupted") return "任务已中断";
  return token?.status === "ready" && token.taskTokens != null
    ? `任务完成 · ${token.taskTokens.toLocaleString("zh-CN")} tokens`
    : "任务已完成";
}
function idleTurnSubtitle(turn: LastTurnSummary): string {
  if (turn.result.kind === "interrupted") return "上次任务已中断";
  return turn.token?.status === "ready" && turn.token.taskTokens != null
    ? `上次完成 · ${compactTokens(turn.token.taskTokens)} tokens`
    : "上次任务已完成";
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
  let expandedTitle = "暂无运行任务";
  let expandedSubtitle = idleTurn
    ? idleTurnSubtitle(idleTurn)
    : usageFailed
      ? "暂时无法获取额度"
      : !usage
        ? "正在同步账户额度"
        : getIdlePrompt(now);
  let selectedOrb: { state: OrbState; speed: number } = idleOrb;
  if (primarySession) {
    const activity = primarySession.activity ?? "thinking";
    compactLabel = activeAgents > 1 ? "多代理" : copy[activity].compact;
    expandedTitle = activeAgents > 1 ? "多个子代理运行中" : copy[activity].expanded;
    expandedSubtitle = activeAgents > 1 ? `${activeAgents} 个子代理` : "当前会话";
    selectedOrb = activeAgents > 1 || sessions.length > 1 ? { state: "weaving", speed: 1 } : orb[activity];
    if (sessions.length > 1) {
      compactLabel = `${sessions.length} 个会话`;
      expandedTitle = `${sessions.length} 个会话运行中`;
      expandedSubtitle = `${sessions.length} 个会话`;
    }
    if (visibleResults.length) {
      const completed = visibleResults.filter((item) => item.result.kind === "completed").length;
      const interrupted = visibleResults.length - completed;
      const suffix = interrupted ? `${visibleResults.length} 结果` : `${completed} 完成`;
      compactLabel = `${sessions.length} 运行 · ${suffix}`;
      expandedTitle = `${sessions.length} 运行 · ${visibleResults.length} 个结果`;
    }
  } else if (primaryResult) {
    feedback = primaryResult.result.kind;
    compactLabel = primaryResult.result.kind === "completed" ? "完成" : "已中断";
    expandedTitle = primaryResult.result.kind === "completed" ? "任务已完成" : "任务已中断";
    expandedSubtitle = "本次任务已结束";
    if (primaryResult.result.kind === "completed" && token?.status === "ready" && token.taskTokens != null)
      compactLabel = `完成 · ${compactTokens(token.taskTokens)}`;
    if (visibleResults.length > 1) {
      compactLabel = `${visibleResults.length} 个结果`;
      expandedTitle = `${visibleResults.length} 个最近结果`;
    }
  }
  if (quota) {
    const quotaWeek =
      limitWindow === "week"
        ? usage?.weekly?.remainingPercent === 0
        : usage?.fiveHour?.remainingPercent !== 0 && usage?.weekly?.remainingPercent === 0;
    feedback = "none";
    compactLabel = "额度已用尽";
    expandedTitle = quotaWeek ? "每周额度已用尽" : "5 小时额度已用尽";
    if (!primarySession && !primaryResult) {
      expandedSubtitle = resetSummary(
        quotaWeek ? (usage?.weekly ?? null) : (usage?.fiveHour ?? null),
        quotaWeek ? "周额度" : "5h 额度",
        now,
      );
    }
  }
  if (permission) {
    feedback = "none";
    compactLabel = "等待审批";
    expandedTitle = "等待审批";
    expandedSubtitle = "需要你的确认";
  }
  const targetLimit = limitWindow === "week" ? (usage?.weekly ?? null) : (usage?.fiveHour ?? null);
  const limitLabel = limitWindow === "week" ? "7d" : "5h";
  const idleMetaLabel = usageFailed ? "额度读取失败" : !usage ? "正在连接 Codex" : quota ? "已用 100%" : "";
  const isIdle = !primarySession && !primaryResult && !quota && !permission && !idleTurn;
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
      title: primarySession?.project || primaryResult?.result.project || idleTurn?.result.project || "Codex 会话",
      subtitle: expandedSubtitle,
    },
    rows: [
      ...sessions.map((session): SessionRowView => {
        const agents = session.agents.filter((agent) => agent.activity !== null).length;
        return {
          key: `session:${session.id}`,
          sessionId: session.id,
          title: session.project || session.cwd?.split(/[\\/]/).pop() || "Codex 会话",
          tooltip: session.project ?? session.cwd ?? "",
          subtitle: sessionLabel(session) + (agents > 1 ? ` · ${agents} 个子代理` : ""),
          attention: effectiveAttention(session),
          elapsed: { from: session.startedAt, to: null },
        };
      }),
      ...visibleResults.map(({ result, label }): SessionRowView => ({
        key: `result:${resultKey(result)}`,
        sessionId: result.sessionId,
        title: result.project || "Codex 会话",
        tooltip: result.project ?? "",
        subtitle: label,
        feedback: result.kind,
        elapsed: { from: result.startedAt, to: result.finishedAt },
      })),
    ],
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
                      ? new Date(usage.updatedAt * 1000).toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "",
                  }),
          },
    usageRows: (
      [
        ["5 小时剩余", usage?.fiveHour ?? null],
        ["每周剩余", usage?.weekly ?? null],
      ] as const
    ).map(([label, value]) => ({
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
        ? `Codex ${limitWindow === "week" ? "每周" : "五小时"}剩余额度 ${percent(targetLimit)}`
        : compactLabel,
  };
}
