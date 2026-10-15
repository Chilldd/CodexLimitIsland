import { useEffect, useMemo, useState } from "react";
import {
  deriveIslandPresentation,
  resultKey,
  type ActivitySnapshot,
  type TokenUsageState,
  type TurnResult,
  type UsageSnapshot,
} from "../islandState";
import { selectInteractionViews, type IslandInteractionState } from "../islandInteraction";

export function useIslandPresentation(
  snapshot: ActivitySnapshot,
  usage: UsageSnapshot | null,
  tokens: Record<string, TokenUsageState>,
  held: TurnResult[],
  phase: IslandInteractionState,
  observedAt: number,
  usageFailed: boolean,
) {
  const [deadlineTime, setDeadlineTime] = useState(() => Date.now());
  const tokenTime = [...snapshot.recentResults, ...held].reduce((latest, result) => {
    const token = tokens[resultKey(result)];
    return token?.status === "ready" ? Math.max(latest, token.readyAt) : latest;
  }, 0);
  const now = Math.max(deadlineTime, observedAt, tokenTime);
  const live = useMemo(
    () => deriveIslandPresentation(snapshot, usage, tokens, now, [], usageFailed),
    [snapshot, usage, tokens, now, usageFailed],
  );
  const retained = useMemo(
    () => (held.length ? deriveIslandPresentation(snapshot, usage, tokens, now, held, usageFailed) : live),
    [snapshot, usage, tokens, now, held, usageFailed, live],
  );
  useEffect(() => {
    if (live.nextUpdateAt == null) return;
    const timer = window.setTimeout(() => setDeadlineTime(Date.now()), Math.max(0, live.nextUpdateAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [live.nextUpdateAt]);
  return selectInteractionViews(phase, live, retained);
}
