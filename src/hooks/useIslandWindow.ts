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
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void native
      .onScaleChanged?.(() => void controller.refreshScale())
      .then((remove) => {
        if (disposed) remove();
        else unlisten = remove;
      })
      .catch((error) => console.error("监听屏幕缩放变化失败", error));
    return () => {
      disposed = true;
      unlisten?.();
      controller.dispose();
    };
  }, [controller, native]);
  return { controller, orbTransitioning };
}
