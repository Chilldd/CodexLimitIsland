import { useEffect, useState } from "react";
import type { DebugScenario, DebugScenarioName } from "../debugPresentation";

export const debugEnabled = import.meta.env.DEV && new URLSearchParams(location.search).has("debugIsland");
export function useDebugPresentation() {
  const [names, setNames] = useState<readonly DebugScenarioName[]>([]);
  const [selected, setSelected] = useState<{ scenario: DebugScenario | null; at: number }>({ scenario: null, at: 0 });
  useEffect(() => {
    let mounted = true;
    if (debugEnabled)
      void import("../debugPresentation")
        .then((module) => {
          if (mounted) setNames(module.DEBUG_SCENARIOS);
        })
        .catch((error) => console.error("加载状态预览失败", error));
    return () => {
      mounted = false;
    };
  }, []);
  function select(name: DebugScenarioName | null) {
    if (!import.meta.env.DEV) return;
    if (name === null) {
      setSelected({ scenario: null, at: Date.now() });
      return;
    }
    void import("../debugPresentation")
      .then((module) => {
        const at = Date.now();
        setSelected({ scenario: module.createDebugScenario(name, at), at });
      })
      .catch((error) => console.error("切换状态预览失败", error));
  }
  return { names, scenario: selected.scenario, observedAt: selected.at, select };
}
