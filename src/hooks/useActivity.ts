import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { newerActivity, type ActivitySnapshot } from "../islandState";

const empty: ActivitySnapshot = { sessions: [], recentResults: [], updatedAt: 0 };
export function useActivity() {
  const [state, setState] = useState({ snapshot: empty, observedAt: 0 });
  useEffect(() => {
    let mounted = true;
    let unlisten: UnlistenFn | undefined;
    const update = (snapshot: ActivitySnapshot) => {
      if (mounted)
        setState((current) => ({ snapshot: newerActivity(current.snapshot, snapshot), observedAt: Date.now() }));
    };
    void (async () => {
      try {
        const remove = await listen<ActivitySnapshot>("activity-updated", (event) => update(event.payload));
        if (!mounted) {
          remove();
          return;
        }
        unlisten = remove;
        update(await invoke<ActivitySnapshot>("read_activity"));
      } catch (error) {
        console.error("会话状态接收失败", error);
      }
    })();
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);
  return state;
}
