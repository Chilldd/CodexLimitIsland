import { AUTO_COLLAPSE_DELAY_MS, collapseRestoreDelay, EXPANDED_HIT_WIDTH, ROOT_PADDING } from "./domain/metrics";
export { MORPH_MS, AUTO_COLLAPSE_DELAY_MS, collapseRestoreDelay } from "./domain/metrics";

type Timer = {
  setTimeout: (work: () => void, delay: number) => number;
  clearTimeout: (id: number | undefined) => void;
};

export function createInteractionTimers(timer: Timer) {
  let leave: number | undefined;
  let restore: number | undefined;
  const cancelLeave = () => {
    timer.clearTimeout(leave);
    leave = undefined;
  };
  const cancelRestore = () => {
    timer.clearTimeout(restore);
    restore = undefined;
  };
  return {
    cancelLeave,
    cancelRestore,
    hasPendingLeave: () => leave !== undefined,
    scheduleLeave(work: () => void) {
      cancelLeave();
      leave = timer.setTimeout(() => {
        leave = undefined;
        work();
      }, AUTO_COLLAPSE_DELAY_MS);
    },
    scheduleRestore(work: () => void, reducedMotion: boolean) {
      cancelRestore();
      restore = timer.setTimeout(() => {
        restore = undefined;
        work();
      }, collapseRestoreDelay(reducedMotion));
    },
    dispose() {
      cancelLeave();
      cancelRestore();
    },
  };
}

export type NativeLease = () => boolean;

/** 串行更新窗口；每次交互转换使旧任务失效，防止等待原生 API 时发生状态回跳。 */
export function createNativeQueue() {
  let tail = Promise.resolve();
  let revision = 0;
  let active = true;
  return {
    invalidate() {
      revision++;
    },
    activate() {
      active = true;
    },
    dispose() {
      active = false;
      revision++;
    },
    run(work: (current: NativeLease) => Promise<void>): Promise<void> {
      const expected = revision;
      const current = () => active && revision === expected;
      const operation = tail.then(async () => {
        if (current()) await work(current);
      });
      // 调用方仍收到原始 rejection；队列本身允许后续操作继续。
      tail = operation.catch(() => {});
      return operation;
    },
  };
}

type ExpandedWindow = {
  setSize: (height: number) => Promise<void>;
  setHitRegion: (width: number, height: number) => Promise<void>;
  sized: () => void;
  regionSet: () => void;
};

export async function prepareExpandedWindow(
  window: ExpandedWindow,
  height: number,
  current: NativeLease,
): Promise<boolean> {
  await window.setSize(height + ROOT_PADDING * 2);
  window.sized();
  if (!current()) return false;
  await window.setHitRegion(EXPANDED_HIT_WIDTH, height + ROOT_PADDING * 2);
  window.regionSet();
  return current();
}

type CompactWindow = {
  needsResize: () => boolean;
  setSize: () => Promise<void>;
  sized: () => void;
  size: () => { width: number; height: number };
  setHitRegion: (width: number, height: number) => Promise<void>;
  regionSet: (width: number) => void;
};

export async function restoreCompactWindow(window: CompactWindow, current: NativeLease): Promise<boolean> {
  if (window.needsResize()) await window.setSize();
  window.sized();
  if (!current()) return false;
  const { width, height } = window.size();
  await window.setHitRegion(width, height);
  window.regionSet(width);
  return current();
}
