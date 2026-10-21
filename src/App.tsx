import { useCallback, useEffect, useState } from "react";
import { useTurnTokenUsage } from "./hooks/useTurnTokenUsage";
import { useUsage } from "./hooks/useUsage";
import { useActivity } from "./hooks/useActivity";
import { useReducedMotion } from "./hooks/useReducedMotion";
import { useHeldResults } from "./hooks/useHeldResults";
import { useLimitWindow } from "./hooks/useLimitWindow";
import { useIslandPresentation } from "./hooks/useIslandPresentation";
import { useInteractionMachine } from "./hooks/useInteractionMachine";
import { useIslandWindow } from "./hooks/useIslandWindow";
import { useHorizontalDrag } from "./hooks/useHorizontalDrag";
import { useSessionNavigation } from "./hooks/useSessionNavigation";
import { debugEnabled, useDebugPresentation } from "./hooks/useDebugPresentation";
import { ROOT_PADDING, compactSize, expandedHeight } from "./domain/metrics";
import { nativeWindow, type IslandNativeWindow } from "./nativeWindow";
import { Island } from "./components/Island";
import { DebugSwitcher } from "./components/DebugSwitcher";
import "./App.css";
import "./styles/states.css";

import { type TurnResult } from "./islandState";

const NO_HELD: TurnResult[] = [];

function App({ native = nativeWindow }: { native?: IslandNativeWindow }) {
  const usage = useUsage();
  const activity = useActivity();
  const machine = useInteractionMachine();
  const debug = useDebugPresentation();
  const reducedMotion = useReducedMotion();
  const limitWindow = useLimitWindow();
  const snapshot = debug.scenario?.snapshot ?? activity.snapshot;
  const held = useHeldResults(snapshot.recentResults, machine.phase);
  const tokens = useTurnTokenUsage(activity.snapshot.recentResults, debug.scenario ? NO_HELD : held);
  const { view, detailView } = useIslandPresentation(
    snapshot,
    debug.scenario?.usage ?? usage.usage,
    debug.scenario?.tokens ?? tokens,
    held,
    machine.phase,
    Math.max(activity.observedAt, usage.observedAt, debug.observedAt),
    usage.error !== null,
    limitWindow,
  );
  const fallbackCompact = compactSize(view.layout, view.compactTier);
  const [adaptiveWidth, setAdaptiveWidth] = useState<number | null>(null);
  const onMeasureCompactWidth = useCallback((target: number) => {
    setAdaptiveWidth((prev) => {
      if (prev === target || (prev != null && Math.abs(prev - target) <= 1)) {
        return prev;
      }
      return target;
    });
  }, []);

  const compactIslandWidth =
    view.layout === "minimal"
      ? fallbackCompact.width - ROOT_PADDING * 2
      : (adaptiveWidth ?? fallbackCompact.width - ROOT_PADDING * 2);

  const height = expandedHeight(view.rowCount, view.showTokenSummary);
  const { controller, orbTransitioning } = useIslandWindow(native, machine, {
    compact: {
      width: compactIslandWidth + ROOT_PADDING * 2,
      height: fallbackCompact.height,
    },
    expandedHeight: height,
    reducedMotion,
    debug: debugEnabled,
  });
  const drag = useHorizontalDrag(native, () => machine.current() === "compact", reducedMotion);
  const navigation = useSessionNavigation(
    () => machine.current() === "expanded",
    debug.scenario !== null,
    controller.collapse,
  );
  const expanded = machine.phase === "expanded";
  useEffect(() => {
    const prevent = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", prevent);
    return () => document.removeEventListener("contextmenu", prevent);
  }, []);
  return (
    <>
      <Island
        view={view}
        detail={detailView}
        height={height}
        compactWidth={compactIslandWidth}
        onMeasureCompactWidth={onMeasureCompactWidth}
        expanded={expanded}
        orbTransitioning={orbTransitioning}
        reducedMotion={reducedMotion}
        navigation={{
          ...navigation,
          disabled: !expanded || debug.scenario !== null || navigation.openingSession !== null,
          expanded,
        }}
        drag={{
          onPointerDown: (event) => void drag.onPointerDown(event),
          onPointerMove: drag.onPointerMove,
          onPointerUp: drag.onPointerUp,
          onPointerCancel: drag.onPointerCancel,
        }}
        enter={controller.enter}
        leave={controller.leave}
        toggle={() => {
          if (drag.suppressClick()) return;
          if (expanded) controller.collapse();
          else void controller.expand();
        }}
        onTransitionEnd={(event) => {
          if (
            event.target === event.currentTarget &&
            event.propertyName === "height" &&
            machine.current() === "collapsing"
          )
            void controller.finishCollapse();
        }}
      />
      {debugEnabled && <DebugSwitcher names={debug.names} select={debug.select} />}
    </>
  );
}
export default App;
