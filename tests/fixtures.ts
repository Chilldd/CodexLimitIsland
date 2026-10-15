import { vi } from "vitest";
import type { ActivitySnapshot, Session, TurnResult, UsageSnapshot } from "../src/islandState";
import type { IslandNativeWindow } from "../src/nativeWindow";

export const done = (at = 20_000): TurnResult => ({
  kind: "completed",
  sessionId: "sample-session",
  turnId: "sample-turn",
  finishedAt: at,
  project: "Demo",
  model: "sol",
  startedAt: at - 900,
});
export const active = (): Session => ({
  id: "sample-session",
  project: "Demo",
  cwd: null,
  lifecycle: "active",
  activity: "thinking",
  attention: "none",
  currentCommand: null,
  startedAt: 1,
  lastActivityAt: 20_000,
  model: null,
  currentTurnId: "sample-turn",
  agents: [],
});
export const snapshot = (
  sessions: Session[] = [],
  recentResults: TurnResult[] = [],
  updatedAt = 20_000,
): ActivitySnapshot => ({ sessions, recentResults, updatedAt });
export const usage = (remaining = 72): UsageSnapshot => ({
  fiveHour: { remainingPercent: remaining, resetsAt: null },
  weekly: null,
  updatedAt: 20,
});
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export const nativeFixture = () => ({
  setSize: vi.fn<IslandNativeWindow["setSize"]>(async () => {}),
  setHitRegion: vi.fn<IslandNativeWindow["setHitRegion"]>(async () => {}),
  setPosition: vi.fn<IslandNativeWindow["setPosition"]>(async () => {}),
  placement: vi.fn<IslandNativeWindow["placement"]>(async () => ({
    position: { x: 200, y: 3 },
    monitor: { position: { x: 100, y: 0 }, size: { width: 1000, height: 800 } },
    scale: 2,
  })),
});
export const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
