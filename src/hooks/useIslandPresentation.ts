import { useEffect, useMemo, useState } from "react";
import {
  deriveIslandPresentation,
  resultKey,
  type ActivitySnapshot,
  type LastTurnSummary,
  type LimitDisplayWindow,
  type TokenUsageState,
  type TurnResult,
  type UsageSnapshot,
} from "../islandState";
import { selectInteractionViews, type IslandInteractionState } from "../islandInteraction";

function pickLatestTurn(
  results: TurnResult[],
  held: TurnResult[],
  tokens: Record<string, TokenUsageState>,
  previous: LastTurnSummary | null,
): LastTurnSummary | null {
  const all = [...results, ...held];
  let candidate: TurnResult | null = previous ? previous.result : null;
  for (const result of all) {
    if (!candidate || result.finishedAt > candidate.finishedAt) {
      candidate = result;
    }
  }
  if (!candidate) return previous;
  const token =
    tokens[resultKey(candidate)] ??
    (previous && resultKey(previous.result) === resultKey(candidate) ? previous.token : undefined);
  if (previous && previous.result === candidate && previous.token === token) {
    return previous;
  }
  return { result: candidate, token };
}

function retainSessionTurns(
  snapshot: ActivitySnapshot,
  held: TurnResult[],
  tokens: Record<string, TokenUsageState>,
  previous: Record<string, LastTurnSummary>,
  latest: LastTurnSummary | null,
): Record<string, LastTurnSummary> {
  const results = [...snapshot.recentResults, ...held, ...(latest ? [latest.result] : [])];
  const relevant = new Set([
    ...snapshot.sessions.map((session) => session.id),
    ...results.map((result) => result.sessionId),
  ]);
  const next = new Map(Object.entries(previous).filter(([id]) => relevant.has(id)));
  if (latest && !next.has(latest.result.sessionId)) next.set(latest.result.sessionId, latest);
  for (const result of results) {
    const current = next.get(result.sessionId);
    if (!current || result.finishedAt > current.result.finishedAt) next.set(result.sessionId, { result });
  }
  for (const [id, summary] of next) {
    const token = tokens[resultKey(summary.result)] ?? summary.token;
    if (token !== summary.token) next.set(id, { ...summary, token });
  }
  if (next.size === Object.keys(previous).length && [...next].every(([id, summary]) => previous[id] === summary))
    return previous;
  return Object.fromEntries(next);
}

export function useIslandPresentation(
  snapshot: ActivitySnapshot,
  usage: UsageSnapshot | null,
  tokens: Record<string, TokenUsageState>,
  held: TurnResult[],
  phase: IslandInteractionState,
  observedAt: number,
  usageFailed: boolean,
  limitWindow: LimitDisplayWindow = "fiveHour",
) {
  const [deadlineTime, setDeadlineTime] = useState(() => Date.now());
  const [lastTurn, setLastTurn] = useState<LastTurnSummary | null>(() =>
    pickLatestTurn(snapshot.recentResults, held, tokens, null),
  );
  const nextTurn = pickLatestTurn(snapshot.recentResults, held, tokens, lastTurn);
  if (nextTurn !== lastTurn) setLastTurn(nextTurn);
  const [sessionTurns, setSessionTurns] = useState<Record<string, LastTurnSummary>>({});
  const nextSessionTurns = retainSessionTurns(snapshot, held, tokens, sessionTurns, nextTurn);
  if (nextSessionTurns !== sessionTurns) setSessionTurns(nextSessionTurns);
  const tokenTime = [...snapshot.recentResults, ...held].reduce((latest, result) => {
    const token = tokens[resultKey(result)];
    return token?.status === "ready" ? Math.max(latest, token.readyAt) : latest;
  }, 0);
  const now = Math.max(deadlineTime, observedAt, tokenTime);
  const live = useMemo(
    () =>
      deriveIslandPresentation(snapshot, usage, tokens, now, [], usageFailed, limitWindow, nextTurn, nextSessionTurns),
    [snapshot, usage, tokens, now, usageFailed, limitWindow, nextTurn, nextSessionTurns],
  );
  const retained = useMemo(
    () =>
      held.length
        ? deriveIslandPresentation(
            snapshot,
            usage,
            tokens,
            now,
            held,
            usageFailed,
            limitWindow,
            nextTurn,
            nextSessionTurns,
          )
        : live,
    [snapshot, usage, tokens, now, held, usageFailed, limitWindow, nextTurn, nextSessionTurns, live],
  );
  useEffect(() => {
    if (live.nextUpdateAt == null) return;
    const timer = window.setTimeout(() => setDeadlineTime(Date.now()), Math.max(0, live.nextUpdateAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [live.nextUpdateAt]);
  return selectInteractionViews(phase, live, retained);
}
