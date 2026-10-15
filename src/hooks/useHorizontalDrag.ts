import { createPositionWriter } from "../positionWriter";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { WINDOW_WIDTH } from "../domain/metrics";
import type { IslandNativeWindow } from "../nativeWindow";

type Drag = {
  pointerId: number;
  startX: number;
  windowX: number;
  minX: number;
  maxX: number;
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
    try {
      const { position, monitor, scale } = await native.placement();
      if (!current.mounted || !monitor || current.pending !== event.pointerId) return;
      current.top = position.y;
      current.current = position.x;
      current.drag = {
        pointerId: event.pointerId,
        startX: event.screenX,
        windowX: position.x,
        minX: monitor.position.x,
        maxX: monitor.position.x + monitor.size.width - Math.round(WINDOW_WIDTH * scale),
        scale,
        moved: false,
      };
    } catch (error) {
      console.error("窗口拖动准备失败", error);
    }
  }
  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const current = state.current;
    const drag = current.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = (event.screenX - drag.startX) * drag.scale;
    if (!drag.moved && Math.abs(delta) < 5 * drag.scale) return;
    drag.moved = true;
    current.suppress = true;
    current.target = Math.max(drag.minX, Math.min(drag.maxX, drag.windowX + delta));
    if (current.current == null) current.current = drag.windowX;
    window.cancelAnimationFrame(current.frame ?? 0);
    current.frame = window.requestAnimationFrame(animate);
  }
  function onPointerUp(event: PointerEvent<HTMLElement>) {
    const current = state.current;
    if (current.pending !== event.pointerId) return;
    current.pending = null;
    current.drag = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
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
