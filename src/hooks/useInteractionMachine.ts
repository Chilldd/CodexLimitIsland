import { useCallback, useReducer, useRef } from "react";
import { reduceInteraction, type InteractionEvent, type IslandInteractionState } from "../islandInteraction";

export function useInteractionMachine() {
  const [phase, dispatch] = useReducer(reduceInteraction, "compact" as IslandInteractionState);
  const latest = useRef<IslandInteractionState>("compact");
  const current = useCallback(() => latest.current, []);
  const transition = useCallback((event: InteractionEvent) => {
    latest.current = reduceInteraction(latest.current, event);
    dispatch(event);
  }, []);
  return { phase, current, transition };
}
