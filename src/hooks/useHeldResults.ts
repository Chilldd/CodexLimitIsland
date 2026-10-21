import { useState } from "react";
import { resultKey, type TurnResult } from "../islandState";
import type { IslandInteractionState } from "../islandInteraction";

function sameResults(a: TurnResult[], b: TurnResult[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((item, index) => resultKey(item) === resultKey(b[index]));
}

export function useHeldResults(incoming: TurnResult[], phase: IslandInteractionState): TurnResult[] {
  const retaining = phase !== "compact";
  const [previous, setPrevious] = useState(() => ({ incoming, retaining, held: retaining ? incoming : [] }));
  if (!sameResults(previous.incoming, incoming) || previous.retaining !== retaining) {
    // 根据输入调整本组件的保留快照，收起完成前不受 Registry 清理影响。
    const byKey = new Map(previous.held.map((result) => [resultKey(result), result]));
    if (retaining) incoming.forEach((result) => byKey.set(resultKey(result), result));
    const held = retaining ? [...byKey.values()] : [];
    setPrevious({ incoming, retaining, held });
    return held;
  }
  return previous.held;
}
