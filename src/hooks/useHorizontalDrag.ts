import { createPositionWriter } from "../positionWriter";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { WINDOW_WIDTH } from "../domain/metrics";
import type { IslandNativeWindow, ScreenMonitor } from "../nativeWindow";

type Drag = {
  pointerId: number;
  startX: number;
  startScreenX: number;
  offsetX: number;
  monitors: ScreenMonitor[];
  monitor: ScreenMonitor;
  scale: number;
  moved: boolean;
};
export function useHorizontalDrag(native: IslandNativeWindow, isCompact: () => boolean, reducedMotion: boolean) {
  const [writer] = useState(() =>
    createPositionWriter(
      (x, y) => native.setPosition(x, y),
      (error) => console.error("窗口移动失败", error),
    ),
  );
  const state = useRef({
    drag: null as Drag | null,
    pending: null as number | null,
    frame: undefined as number | undefined,
    target: null as number | null,
    current: null as number | null,
    top: 0,
    reading: null as Promise<void> | null,
    sampleRequested: false,
    suppress: false,
    clickTimer: undefined as number | undefined,
    mounted: true,
  });
  useEffect(() => {
    const current = state.current;
    current.mounted = true;
    writer.activate();
    return () => {
      current.mounted = false;
      writer.dispose();
      current.pending = null;
      current.drag = null;
      window.cancelAnimationFrame(current.frame ?? 0);
      window.clearTimeout(current.clickTimer);
    };
  }, [writer]);
  function animate() {
    const current = state.current;
    if (!current.mounted || current.target == null || current.current == null) return;
    const next =
      Math.abs(current.target - current.current) < 0.5
        ? current.target
        : current.current + (current.target - current.current) * (reducedMotion ? 1 : 0.38);
    current.current = next;
    writer.move(Math.round(next), current.top);
    if (next !== current.target) current.frame = window.requestAnimationFrame(animate);
  }
  async function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || !isCompact()) return;
    const current = state.current;
    const element = event.currentTarget;
    current.pending = event.pointerId;
    element.setPointerCapture(event.pointerId);
    window.cancelAnimationFrame(current.frame ?? 0);
    current.target = null;
    current.drag = null;
    try {
      const { position, monitor, monitors, cursor, scale } = await native.placement();
      if (!current.mounted || !monitor || current.pending !== event.pointerId) return;
      current.top = position.y;
      current.current = position.x;
      current.drag = {
        pointerId: event.pointerId,
        startX: cursor.x,
        startScreenX: event.screenX,
        offsetX: (cursor.x - position.x) / scale,
        monitors,
        monitor,
        scale,
        moved: false,
      };
    } catch (error) {
      console.error("窗口拖动准备失败", error);
    }
  }
  function samplePointer(): Promise<void> {
    const current = state.current;
    current.sampleRequested = true;
    if (current.reading) return current.reading;
    const reading = (async () => {
      while (current.mounted && current.drag && current.sampleRequested) {
        current.sampleRequested = false;
        const drag = current.drag;
        // 使用原生物理坐标，避免跨不同 DPI 屏幕时 screenX 的逻辑坐标跳变。
        const cursor = await native.cursorPosition();
        if (!current.mounted || current.drag !== drag) continue;
        if (!drag.moved && Math.abs(cursor.x - drag.startX) < 5 * drag.scale) continue;
        drag.moved = true;
        current.suppress = true;
        const monitor =
          drag.monitors.find(
            (screen) =>
              cursor.x >= screen.position.x &&
              cursor.x < screen.position.x + screen.size.width &&
              cursor.y >= screen.position.y &&
              cursor.y < screen.position.y + screen.size.height,
          ) ?? drag.monitor;
        const maxX = Math.max(
          monitor.position.x,
          monitor.position.x + monitor.size.width - Math.round(WINDOW_WIDTH * monitor.scaleFactor),
        );
        current.target = Math.round(
          Math.max(monitor.position.x, Math.min(maxX, cursor.x - drag.offsetX * monitor.scaleFactor)),
        );
        current.top = monitor.position.y + Math.round(3 * monitor.scaleFactor);
        if (monitor.position.x !== drag.monitor.position.x || monitor.position.y !== drag.monitor.position.y) {
          current.current = current.target;
        }
        drag.monitor = monitor;
        window.cancelAnimationFrame(current.frame ?? 0);
        current.frame = window.requestAnimationFrame(animate);
      }
    })()
      .catch((error: unknown) => console.error("读取拖动鼠标位置失败", error))
      .finally(() => {
        current.reading = null;
      });
    current.reading = reading;
    return reading;
  }
  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const current = state.current;
    if (!current.drag || current.pending !== event.pointerId) return Promise.resolve();
    if (Math.abs(event.screenX - current.drag.startScreenX) >= 5) current.suppress = true;
    return samplePointer();
  }
  async function onPointerUp(event: PointerEvent<HTMLElement>) {
    const current = state.current;
    if (current.pending !== event.pointerId) return;
    current.pending = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const drag = current.drag;
    await samplePointer();
    if (!current.mounted || current.drag !== drag) return;
    if (drag?.moved && current.target != null) {
      window.cancelAnimationFrame(current.frame ?? 0);
      current.current = current.target;
      writer.move(current.target, current.top);
      void native
        .savePosition?.(current.target, current.top)
        .catch((error) => console.error("窗口位置保存失败", error));
    }
    current.drag = null;
    current.clickTimer = window.setTimeout(() => {
      current.suppress = false;
    }, 0);
  }
  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    suppressClick: () => {
      const current = state.current;
      const suppressed = current.suppress;
      current.suppress = false;
      return suppressed;
    },
  };
}
