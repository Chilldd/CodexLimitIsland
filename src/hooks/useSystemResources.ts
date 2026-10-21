import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { SystemResourceSnapshot } from "../generated/contracts";

const HISTORY_LIMIT = 12;

export function useSystemResources(active: boolean) {
  const [snapshot, setSnapshot] = useState<SystemResourceSnapshot | null>(null);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);

  useEffect(() => {
    if (!active) {
      void invoke("stop_resource_sampling").catch((error) => console.error("停止系统资源监控失败", error));
      return;
    }

    let mounted = true;
    let unlisten: UnlistenFn | undefined;

    const handleSnapshot = (data: SystemResourceSnapshot) => {
      if (!mounted) return;
      setSnapshot(data);
      setCpuHistory((prev) => {
        const next = [...prev, data.total.cpu_percent];
        if (next.length > HISTORY_LIMIT) {
          return next.slice(next.length - HISTORY_LIMIT);
        }
        return next;
      });
    };

    void (async () => {
      try {
        const remove = await listen<SystemResourceSnapshot>("resource-snapshot", (event) => {
          handleSnapshot(event.payload);
        });
        if (!mounted) {
          remove();
          return;
        }
        unlisten = remove;

        await invoke("start_resource_sampling");
        const initial = await invoke<SystemResourceSnapshot>("read_resource_snapshot");
        if (initial && initial.sample_time_ms > 0) {
          handleSnapshot(initial);
        }
      } catch (error) {
        console.error("启动系统资源监控失败", error);
      }
    })();

    return () => {
      mounted = false;
      unlisten?.();
      void invoke("stop_resource_sampling").catch((error) => console.error("停止系统资源监控失败", error));
    };
  }, [active]);

  return { snapshot, cpuHistory };
}
