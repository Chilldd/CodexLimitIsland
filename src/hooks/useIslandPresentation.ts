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
  if (!all.length) return previous;
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
  const tokenTime = [...snapshot.recentResults, ...held].reduce((latest, result) => {
    const token = tokens[resultKey(result)];
    return token?.status === "ready" ? Math.max(latest, token.readyAt) : latest;
  }, 0);
  const now = Math.max(deadlineTime, observedAt, tokenTime);
  const live = useMemo(
    () => deriveIslandPresentation(snapshot, usage, tokens, now, [], usageFailed, limitWindow, nextTurn),
    [snapshot, usage, tokens, now, usageFailed, limitWindow, nextTurn],
  );
  const retained = useMemo(
    () =>
      held.length
        ? deriveIslandPresentation(snapshot, usage, tokens, now, held, usageFailed, limitWindow, nextTurn)
        : live,
    [snapshot, usage, tokens, now, held, usageFailed, limitWindow, nextTurn, live],
  );
  useEffect(() => {
    if (live.nextUpdateAt == null) return;
    const timer = window.setTimeout(() => setDeadlineTime(Date.now()), Math.max(0, live.nextUpdateAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [live.nextUpdateAt]);
  return selectInteractionViews(phase, live, retained);
}
