import { invoke } from "@tauri-apps/api/core";
import {
  availableMonitors,
  cursorPosition,
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
} from "@tauri-apps/api/window";

export type ScreenMonitor = {
  position: { x: number; y: number };
  size: { width: number; height: number };
  scaleFactor: number;
};
export type Placement = {
  position: { x: number; y: number };
  monitor: ScreenMonitor | null;
  monitors: ScreenMonitor[];
  cursor: { x: number; y: number };
  scale: number;
};
export type IslandNativeWindow = {
  setSize: (width: number, height: number) => Promise<void>;
  setHitRegion: (width: number, height: number) => Promise<void>;
  setPosition: (x: number, y: number) => Promise<void>;
  savePosition?: (x: number, y: number) => Promise<void>;
  cursorPosition: () => Promise<{ x: number; y: number }>;
  onScaleChanged?: (handler: () => void) => Promise<() => void>;
  placement: () => Promise<Placement>;
};
export const nativeWindow: IslandNativeWindow = {
  setSize: (width, height) => getCurrentWindow().setSize(new LogicalSize(width, height)),
  setHitRegion: (width, height) => invoke<void>("set_window_hit_region", { width, height }),
  setPosition: (x, y) => getCurrentWindow().setPosition(new PhysicalPosition(x, y)),
  savePosition: (x, y) => invoke<void>("save_window_position", { x, y }),
  cursorPosition,
  onScaleChanged: (handler) => getCurrentWindow().onScaleChanged(handler),
  placement: async () => {
    const window = getCurrentWindow();
    const [position, monitor, scale, monitors, cursor] = await Promise.all([
      window.outerPosition(),
      currentMonitor(),
      window.scaleFactor(),
      availableMonitors(),
      cursorPosition(),
    ]);
    return { position, monitor, scale, monitors, cursor };
  },
};
