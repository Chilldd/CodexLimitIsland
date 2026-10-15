import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { UsageSnapshot } from "../islandState";

export function useUsage() {
  const [state, setState] = useState<{ usage: UsageSnapshot | null; error: string | null; observedAt: number }>({
    usage: null,
    error: null,
    observedAt: 0,
  });
  useEffect(() => {
    let mounted = true;
    let events = 0;
    const listeners: UnlistenFn[] = [];
    const retain = (unlisten: UnlistenFn) => {
      if (mounted) listeners.push(unlisten);
      else unlisten();
    };
    const refresh = async () => {
      const version = events;
      try {
        const usage = await invoke<UsageSnapshot>("read_limits");
        if (mounted && version === events) setState({ usage, error: null, observedAt: Date.now() });
      } catch (error) {
        if (mounted && version === events) setState((current) => ({ ...current, error: String(error) }));
      }
    };
    void (async () => {
      try {
        retain(
          await listen<UsageSnapshot>("usage-updated", (event) => {
            if (!mounted) return;
            events++;
            setState({ usage: event.payload, error: null, observedAt: Date.now() });
          }),
        );
        if (!mounted) return;
        retain(
          await listen<string>("usage-error", (event) => {
            if (mounted) setState((current) => ({ ...current, error: event.payload }));
          }),
        );
        if (mounted) void refresh();
      } catch (error) {
        console.error("额度通知接收失败", error);
        if (mounted) void refresh();
      }
    })();
    return () => {
      mounted = false;
      listeners.forEach((unlisten) => unlisten());
    };
  }, []);
  return state;
}
