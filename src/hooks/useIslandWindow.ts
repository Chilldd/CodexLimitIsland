import { useEffect, useLayoutEffect, useState } from "react";
import { createIslandWindowController, type WindowModel } from "../windowController";
import type { IslandNativeWindow } from "../nativeWindow";
import { useInteractionMachine } from "./useInteractionMachine";

export function useIslandWindow(
  native: IslandNativeWindow,
  machine: ReturnType<typeof useInteractionMachine>,
  model: WindowModel,
) {
  const [orbTransitioning, setOrbTransitioning] = useState(false);
  const [controller] = useState(() =>
    createIslandWindowController(
      native,
      machine,
      { setTimeout: (work, delay) => window.setTimeout(work, delay), clearTimeout: (id) => window.clearTimeout(id) },
      setOrbTransitioning,
    ),
  );
  useLayoutEffect(() => {
    controller.update(model);
  }, [controller, model]);
  useEffect(() => {
    controller.activate();
    return () => controller.dispose();
  }, [controller]);
  return { controller, orbTransitioning };
}
