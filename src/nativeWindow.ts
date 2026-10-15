import { invoke } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";

export type Placement = {
  position: { x: number; y: number };
  monitor: { position: { x: number; y: number }; size: { width: number; height: number } } | null;
  scale: number;
};
export type IslandNativeWindow = {
  setSize: (width: number, height: number) => Promise<void>;
  setHitRegion: (width: number, height: number) => Promise<void>;
  setPosition: (x: number, y: number) => Promise<void>;
  placement: () => Promise<Placement>;
};
export const nativeWindow: IslandNativeWindow = {
  setSize: (width, height) => getCurrentWindow().setSize(new LogicalSize(width, height)),
  setHitRegion: (width, height) => invoke<void>("set_window_hit_region", { width, height }),
  setPosition: (x, y) => getCurrentWindow().setPosition(new PhysicalPosition(x, y)),
  placement: async () => {
    const window = getCurrentWindow();
    const [position, monitor, scale] = await Promise.all([
      window.outerPosition(),
      currentMonitor(),
      window.scaleFactor(),
    ]);
    return { position, monitor, scale };
  },
};
