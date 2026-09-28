import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { resultKey, type TokenUsageState, type TurnResult } from "./islandState";

type TokenUsage = { taskTokens: number | null; sessionTokens: number | null };
const RETRY_DELAYS_MS = [300, 800, 800];
async function loadTurnTokenUsage(result: TurnResult, cancelled: () => boolean): Promise<TokenUsageState | null> {
  for (const delay of RETRY_DELAYS_MS) {
    await new Promise(resolve => window.setTimeout(resolve, delay));
    if (cancelled()) return null;
    try {
      const usage = await invoke<TokenUsage | null>("read_token_usage", { sessionId: result.sessionId, turnId: result.turnId });
      if (cancelled()) return null;
      if (usage?.taskTokens != null) return { status: "ready", ...usage, readyAt: Date.now() };
    } catch (error) {
      console.error("读取 token 用量失败", error);
      return { status: "unavailable" };
    }
  }
  return { status: "unavailable" };
}
export function useTurnTokenUsage(results: TurnResult[]): Record<string, TokenUsageState> {
  const [states, setStates] = useState<Record<string, TokenUsageState>>({});
  const started = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    for (const result of results) {
      if (result.kind !== "completed") continue;
      const key = resultKey(result);
      if (started.current.has(key)) continue;
      started.current.add(key);
      setStates(current => ({ ...current, [key]: { status: "loading" } }));
      void loadTurnTokenUsage(result, () => !mounted.current).then(state => { if (state && mounted.current) setStates(current => ({ ...current, [key]: state })); });
    }
  }, [results]);
  return states;
}
