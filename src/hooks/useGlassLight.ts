import { useRef, useCallback, useEffect } from "react";

export type GlassLightOptions = {
  /** 初始光束角度，默认为 118deg */
  baseAngle?: number;
  /** 光束角度随 Y 轴偏转系数，默认为 5deg */
  angleShift?: number;
  /** 光束高光沿 X 轴偏位系数，默认为 7% */
  positionShift?: number;
  /** 是否禁用动态微光交互 */
  disabled?: boolean;
};

/**
 * 封装 demo 中的斜光烟晶微动态光照交互。
 * 监听指针在容器内的相对移动，通过 requestAnimationFrame 微调 CSS 变量 --glass-light-angle 与 --glass-light-shift。
 * 离开时平滑复位，自动尊重 prefers-reduced-motion 与触控设备。
 */
export function useGlassLight<T extends HTMLElement = HTMLDivElement>(options: GlassLightOptions = {}) {
  const { baseAngle = 118, angleShift = 5, positionShift = 7, disabled = false } = options;

  const ref = useRef<T | null>(null);
  const frameRef = useRef<number>(0);

  const clearLightProperties = useCallback(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    const el = ref.current;
    if (el) {
      el.style.removeProperty("--glass-light-angle");
      el.style.removeProperty("--glass-light-shift");
    }
  }, []);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<T>) => {
      if (disabled || event.pointerType === "touch") return;
      if (
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }
      const el = ref.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;

      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }

      frameRef.current = requestAnimationFrame(() => {
        el.style.setProperty("--glass-light-angle", `${baseAngle + y * angleShift}deg`);
        el.style.setProperty("--glass-light-shift", `${x * positionShift}%`);
      });
    },
    [disabled, baseAngle, angleShift, positionShift],
  );

  const handlePointerLeave = useCallback(() => {
    clearLightProperties();
  }, [clearLightProperties]);

  useEffect(() => {
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return {
    ref,
    onPointerMove: handlePointerMove,
    onPointerLeave: handlePointerLeave,
    clearLightProperties,
  };
}
