import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { LimitDisplayWindow } from "../generated/contracts";

export function useLimitWindow(): LimitDisplayWindow {
  const [windowPreference, setWindowPreference] = useState<LimitDisplayWindow>("fiveHour");

  useEffect(() => {
    let mounted = true;
    let unlisten: UnlistenFn | undefined;

    void (async () => {
      try {
        const initial = await invoke<LimitDisplayWindow>("read_limit_display_window");
        if (mounted) {
          setWindowPreference(initial);
        }
      } catch (error) {
        console.error("读取展示限额设置失败", error);
      }

      try {
        unlisten = await listen<LimitDisplayWindow>("limit-window-changed", (event) => {
          if (mounted) {
            setWindowPreference(event.payload);
          }
        });
      } catch (error) {
        console.error("监听展示限额变更事件失败", error);
      }
    })();

    return () => {
      mounted = false;
      if (unlisten) unlisten();
    };
  }, []);

  return windowPreference;
}

export async function selectLimitWindow(window: LimitDisplayWindow): Promise<void> {
  try {
    await invoke("set_limit_display_window", { window });
  } catch (error) {
    console.error("切换展示限额设置失败", error);
  }
}
