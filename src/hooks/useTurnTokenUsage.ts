import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TokenUsage } from "../generated/contracts";
import { resultKey, type TokenUsageState, type TurnResult } from "../islandState";
const RETRY_DELAYS_MS = [300, 800, 800];
const EMPTY_RESULTS: TurnResult[] = [];
type Job = { state: TokenUsageState; pending: boolean; cancelled: boolean; timer?: number; wake?: () => void };
async function load(result: TurnResult, job: Job): Promise<TokenUsageState | null> {
  for (const delay of RETRY_DELAYS_MS) {
    await new Promise<void>((resolve) => {
      job.wake = resolve;
      job.timer = window.setTimeout(resolve, delay);
    });
    job.timer = undefined;
    job.wake = undefined;
    if (job.cancelled) return null;
    try {
      const usage = await invoke<TokenUsage | null>("read_token_usage", {
        sessionId: result.sessionId,
        turnId: result.turnId,
      });
      if (job.cancelled) return null;
      if (usage?.taskTokens != null) return { status: "ready", ...usage, readyAt: Date.now() };
    } catch (error) {
      if (job.cancelled) return null;
      console.error("读取 token 用量失败", error);
      return { status: "unavailable" };
    }
  }
  return { status: "unavailable" };
}
export function useTurnTokenUsage(
  results: TurnResult[],
  held: TurnResult[] = EMPTY_RESULTS,
): Record<string, TokenUsageState> {
  const [states, setStates] = useState<Record<string, TokenUsageState>>({});
  const cache = useRef(new Map<string, Job>());
  const relevant = useRef(new Set<string>());
  useEffect(() => {
    const jobs = cache.current;
    return () => {
      for (const job of jobs.values()) {
        job.cancelled = true;
        window.clearTimeout(job.timer);
        job.wake?.();
      }
      jobs.clear();
    };
  }, []);
  useEffect(() => {
    const jobs = cache.current;
    const completed = [...results, ...held].filter((result) => result.kind === "completed");
    relevant.current = new Set(completed.map(resultKey));
    const publish = () => {
      for (const [key, job] of jobs) if (!relevant.current.has(key) && !job.pending) jobs.delete(key);
      setStates((current) => {
        const entries = [...jobs].map(([key, job]) => [key, job.state] as const);
        if (entries.length === Object.keys(current).length && entries.every(([key, state]) => current[key] === state))
          return current;
        return Object.fromEntries(entries);
      });
    };
    for (const result of completed) {
      const key = resultKey(result);
      if (jobs.has(key)) continue;
      const job: Job = { state: { status: "loading" }, pending: true, cancelled: false };
      jobs.set(key, job);
      void load(result, job).then((state) => {
        if (!state || job.cancelled || jobs.get(key) !== job) return;
        job.pending = false;
        job.state = state;
        publish();
      });
    }
    publish();
  }, [results, held]);
  return states;
}
