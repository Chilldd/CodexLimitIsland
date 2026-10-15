export type IslandInteractionState = "compact" | "expanding" | "expanded" | "collapsing";
export type InteractionEvent =
  "EXPAND" | "NATIVE_READY" | "COLLAPSE" | "ANIMATION_END" | "EXPAND_FAILED" | "COLLAPSE_FAILED";
export function shouldUseHeldResults(state: IslandInteractionState): boolean {
  return state === "expanding" || state === "expanded";
}
export function selectInteractionViews<T>(
  state: IslandInteractionState,
  live: T,
  retained: T,
): { view: T; detailView: T } {
  const view = shouldUseHeldResults(state) ? retained : live;
  return { view, detailView: state === "collapsing" ? retained : view };
}
export function reduceInteraction(state: IslandInteractionState, event: InteractionEvent): IslandInteractionState {
  switch (event) {
    case "EXPAND":
      return state === "compact" || state === "collapsing" ? "expanding" : state;
    case "NATIVE_READY":
      return state === "expanding" ? "expanded" : state;
    case "COLLAPSE":
      return state === "expanded" || state === "expanding" ? "collapsing" : state;
    case "ANIMATION_END":
      return state === "collapsing" ? "compact" : state;
    case "EXPAND_FAILED":
      return state === "expanding" ? "compact" : state;
    case "COLLAPSE_FAILED":
      return state === "collapsing" ? "expanded" : state;
  }
}
