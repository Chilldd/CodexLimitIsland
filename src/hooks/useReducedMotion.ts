import { useCallback, useState, useSyncExternalStore } from "react";

export function useReducedMotion() {
  const [media] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)"));
  const subscribe = useCallback(
    (changed: () => void) => {
      media.addEventListener("change", changed);
      return () => media.removeEventListener("change", changed);
    },
    [media],
  );
  return useSyncExternalStore(subscribe, () => media.matches);
}
