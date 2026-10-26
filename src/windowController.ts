import {
  createInteractionTimers,
  createNativeQueue,
  prepareExpandedWindow,
  restoreCompactWindow,
} from "./nativeOperations";
import {
  DEBUG_HEIGHT,
  EXPANDED_HIT_WIDTH,
  MORPH_MS,
  WINDOW_WIDTH,
  compactSize,
  expandedHeight,
} from "./domain/metrics";
import type { IslandNativeWindow } from "./nativeWindow";
import type { InteractionEvent, IslandInteractionState } from "./islandInteraction";

export type WindowModel = {
  compact: { width: number; height: number };
  expandedHeight: number;
  reducedMotion: boolean;
  debug: boolean;
};
export type WindowMachine = { current: () => IslandInteractionState; transition: (event: InteractionEvent) => void };
export type WindowTimer = {
  setTimeout: (work: () => void, delay: number) => number;
  clearTimeout: (id: number | undefined) => void;
};

export function createIslandWindowController(
  native: IslandNativeWindow,
  machine: WindowMachine,
  timer: WindowTimer,
  orbChanged: (active: boolean) => void,
  report: (message: string, error: unknown) => void = console.error,
) {
  const queue = createNativeQueue();
  const timers = createInteractionTimers(timer);
  let model: WindowModel = {
    compact: compactSize("minimal"),
    expandedHeight: expandedHeight(1),
    reducedMotion: false,
    debug: false,
  };
  let active = false;
  let nativeLarge = false;
  let nativeExpandedHeight: number | null = null;
  let regionWidth = 0;
  let regionHeight = 0;
  let pointerInside = false;
  let collapseOperation: Promise<void> | null = null;
  let orbTimer: number | undefined;
  let regionTimer: number | undefined;
  let lastPhase: IslandInteractionState = "compact";
  const setSize = (height: number) => native.setSize(WINDOW_WIDTH, model.debug ? DEBUG_HEIGHT : height);
  const setRegion = async (width: number, height: number) => {
    await native.setHitRegion(model.debug ? EXPANDED_HIT_WIDTH : width, model.debug ? DEBUG_HEIGHT : height);
    regionWidth = width;
    regionHeight = height;
  };
  const expandedWindow = () => ({
    setSize,
    setHitRegion: setRegion,
    sized: () => {
      nativeLarge = true;
    },
    regionSet: () => {
      regionWidth = EXPANDED_HIT_WIDTH;
    },
  });
  function transition(event: InteractionEvent) {
    const before = machine.current();
    machine.transition(event);
    if (before !== machine.current()) {
      queue.invalidate();
      collapseOperation = null;
    }
  }
  function animateOrb() {
    timer.clearTimeout(orbTimer);
    orbChanged(true);
    orbTimer = timer.setTimeout(
      () => {
        if (active) orbChanged(false);
      },
      model.reducedMotion ? 150 : MORPH_MS,
    );
  }
  function collapse() {
    timers.cancelLeave();
    if (!active || !["expanded", "expanding"].includes(machine.current())) return;
    transition("COLLAPSE");
    animateOrb();
    timers.scheduleRestore(() => void finishCollapse(), model.reducedMotion);
  }
  function finishCollapse(): Promise<void> {
    if (collapseOperation) return collapseOperation;
    if (!active || machine.current() !== "collapsing") return Promise.resolve();
    timers.cancelRestore();
    const operation = queue.run(async (current) => {
      if (machine.current() !== "collapsing") return;
      try {
        const ready = await restoreCompactWindow(
          {
            needsResize: () => nativeLarge,
            setSize: () => setSize(compactSize("single").height),
            sized: () => {
              nativeLarge = false;
              nativeExpandedHeight = null;
            },
            size: () => model.compact,
            setHitRegion: setRegion,
            regionSet: (width) => {
              regionWidth = width;
            },
          },
          current,
        );
        if (ready) {
          transition("ANIMATION_END");
          if (regionWidth !== model.compact.width || regionHeight !== model.compact.height) {
            update(model, true);
          }
        }
      } catch (error) {
        report("窗口收起失败", error);
        if (!current() || machine.current() !== "collapsing") return;
        if (nativeLarge) transition("COLLAPSE_FAILED");
        else {
          try {
            const { width, height } = model.compact;
            await setRegion(width, height);
            regionWidth = width;
          } catch (retryError) {
            report("窗口点击区域恢复失败", retryError);
          }
          if (current() && machine.current() === "collapsing") transition("ANIMATION_END");
        }
      }
    });
    collapseOperation = operation;
    void operation.finally(() => {
      if (collapseOperation === operation) collapseOperation = null;
    });
    return operation;
  }
  async function expand() {
    if (!active || !["compact", "collapsing"].includes(machine.current())) return;
    timers.cancelRestore();
    timer.clearTimeout(regionTimer);
    transition("EXPAND");
    await queue.run(async (current) => {
      if (machine.current() !== "expanding") return;
      try {
        const height = model.expandedHeight;
        nativeExpandedHeight = null;
        if (!(await prepareExpandedWindow(expandedWindow(), height, current))) return;
        nativeExpandedHeight = height;
        animateOrb();
        transition("NATIVE_READY");
        if (!pointerInside && !timers.hasPendingLeave()) timers.scheduleLeave(collapse);
      } catch (error) {
        report("窗口展开失败", error);
        if (!current() || machine.current() !== "expanding") return;
        if (nativeLarge) {
          animateOrb();
          transition("NATIVE_READY");
          if (!pointerInside && !timers.hasPendingLeave()) timers.scheduleLeave(collapse);
        } else transition("EXPAND_FAILED");
      }
    });
  }
  function update(next: WindowModel, force = false) {
    const previous = model;
    model = next;
    const phase = machine.current();
    const phaseChanged = phase !== lastPhase;
    lastPhase = phase;
    if (!active) return;
    if (phase === "expanded" && (force || previous.expandedHeight !== next.expandedHeight || phaseChanged)) {
      void queue
        .run(async (current) => {
          if (machine.current() !== "expanded") return;
          const height = model.expandedHeight;
          if (nativeExpandedHeight === height) return;
          nativeExpandedHeight = null;
          if (await prepareExpandedWindow(expandedWindow(), height, current)) nativeExpandedHeight = height;
        })
        .catch((error) => report("窗口尺寸调整失败", error));
    }
    if (phase !== "compact" || nativeLarge) return;
    // 收起操作已经设置好同一点击区时，不再因 React 阶段提交重复调整。
    if (!force && regionWidth === next.compact.width && regionHeight === next.compact.height) return;
    timer.clearTimeout(regionTimer);
    const { width, height } = next.compact;
    const applyRegion = async () => {
      if (machine.current() !== "compact" || nativeLarge) return;
      if (regionWidth === width && regionHeight === height) return;
      await setRegion(width, height);
      regionWidth = width;
    };
    regionTimer = timer.setTimeout(
      () => {
        void applyRegion().catch((error) => report("窗口点击区域调整失败", error));
      },
      width < regionWidth ? (model.reducedMotion ? 150 : MORPH_MS) : 0,
    );
  }
  return {
    update,
    expand,
    collapse,
    finishCollapse,
    refreshScale() {
      if (!active) return Promise.resolve();
      return queue
        .run(async (current) => {
          if (current() && regionWidth > 0 && regionHeight > 0) await setRegion(regionWidth, regionHeight);
        })
        .catch((error) => report("屏幕缩放变化后更新点击区域失败", error));
    },
    enter() {
      pointerInside = true;
      timers.cancelLeave();
    },
    leave() {
      pointerInside = false;
      timers.scheduleLeave(collapse);
    },
    activate() {
      active = true;
      queue.activate();
      if (model.debug)
        void queue
          .run(async (current) => {
            await setSize(DEBUG_HEIGHT);
            if (current()) await setRegion(EXPANDED_HIT_WIDTH, DEBUG_HEIGHT);
          })
          .catch((error) => report("调整状态预览窗口失败", error));
      update(model, true);
    },
    dispose() {
      active = false;
      queue.dispose();
      timers.dispose();
      timer.clearTimeout(orbTimer);
      timer.clearTimeout(regionTimer);
    },
  };
}
