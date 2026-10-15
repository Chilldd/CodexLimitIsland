import { useState } from "react";
import { resultKey, type TurnResult } from "../islandState";
import type { IslandInteractionState } from "../islandInteraction";

export function useHeldResults(incoming: TurnResult[], phase: IslandInteractionState): TurnResult[] {
  const retaining = phase !== "compact";
  const [previous, setPrevious] = useState(() => ({ incoming, retaining, held: retaining ? incoming : [] }));
  if (previous.incoming !== incoming || previous.retaining !== retaining) {
    // 根据输入调整本组件的保留快照，收起完成前不受 Registry 清理影响。
    const byKey = new Map(previous.held.map((result) => [resultKey(result), result]));
    if (retaining) incoming.forEach((result) => byKey.set(resultKey(result), result));
    const held = retaining ? [...byKey.values()] : [];
    setPrevious({ incoming, retaining, held });
    return held;
  }
  return previous.held;
}
