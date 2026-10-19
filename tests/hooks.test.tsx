import { StrictMode, type PointerEvent } from "react";
import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useUsage } from "../src/hooks/useUsage";
import { useActivity } from "../src/hooks/useActivity";
import { useReducedMotion } from "../src/hooks/useReducedMotion";
import { useHeldResults } from "../src/hooks/useHeldResults";
import { useIslandPresentation } from "../src/hooks/useIslandPresentation";
import { useSessionNavigation } from "../src/hooks/useSessionNavigation";
import { useHorizontalDrag } from "../src/hooks/useHorizontalDrag";
import { useTurnTokenUsage } from "../src/hooks/useTurnTokenUsage";
import { useLimitWindow } from "../src/hooks/useLimitWindow";
import { Elapsed } from "../src/components/Elapsed";
import App from "../src/App";
import { SessionRow } from "../src/components/SessionRow";
import { ExpandedContent } from "../src/components/ExpandedContent";
import { IdlePromptTicker } from "../src/components/IdlePromptTicker";
import { WORK_IDLE_PROMPTS } from "../src/domain/idlePrompts";
import { deriveIslandPresentation } from "../src/islandState";
import { resultKey, type ActivitySnapshot, type UsageSnapshot, type TokenUsageState } from "../src/islandState";
import type { IslandInteractionState } from "../src/islandInteraction";
import { active, deferred, done, flush, nativeFixture, snapshot, usage } from "./fixtures";

const bridge = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
  listen: vi.fn<(name: string, callback: (event: { payload: unknown }) => void) => Promise<() => void>>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: bridge.listen }));
vi.mock("thinking-orbs", () => ({
  ThinkingOrb: ({ className, size, paused }: { className: string; size: number; paused: boolean }) => (
    <canvas className={className} width={size} height={size} data-paused={paused} />
  ),
}));
let listeners: Map<string, (event: { payload: unknown }) => void>;
function mediaFixture(initial = false) {
  let matches = initial;
  const media = Object.assign(new EventTarget(), {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  });
  Object.defineProperty(media, "matches", { get: () => matches });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
  return {
    media,
    change: (value: boolean) => {
      matches = value;
      media.dispatchEvent(new Event("change"));
    },
  };
}
const flushReact = () => act(flush);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(20_000);
  listeners = new Map();
  bridge.invoke
    .mockReset()
    .mockImplementation(async (command) =>
      command === "read_activity" ? snapshot() : command === "read_limits" ? usage() : null,
    );
  bridge.listen.mockReset().mockImplementation(async (name, callback) => {
    listeners.set(name, callback);
    return () => {
      if (listeners.get(name) === callback) listeners.delete(name);
    };
  });
  mediaFixture();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, value: vi.fn() });
});

test("usage events win over a late initial query including a late rejection", async () => {
  for (const rejected of [false, true]) {
    const pending = deferred<UsageSnapshot>();
    bridge.invoke.mockReturnValueOnce(pending.promise);
    const hook = renderHook(useUsage);
    await flushReact();
    act(() => listeners.get("usage-updated")!({ payload: usage(38) }));
    await act(async () => {
      if (rejected) pending.reject(new Error("old request"));
      else pending.resolve(usage(90));
      await flush();
    });
    expect(hook.result.current.usage?.fiveHour?.remainingPercent).toBe(38);
    expect(hook.result.current.error).toBeNull();
    hook.unmount();
  }
});

test("late subscription registration cleans up after unmount instead of leaving a listener", async () => {
  for (const useSubscription of [useUsage, useActivity]) {
    const registration = deferred<() => void>();
    const remove = vi.fn();
    bridge.listen.mockReturnValueOnce(registration.promise);
    const hook = renderHook(() => useSubscription());
    hook.unmount();
    await act(async () => {
      registration.resolve(remove);
      await flush();
    });
    expect(remove).toHaveBeenCalledTimes(1);
  }
});

test("activity version guard keeps new event when initial read returns an older snapshot", async () => {
  const pending = deferred<ActivitySnapshot>();
  bridge.invoke.mockReturnValueOnce(pending.promise);
  const hook = renderHook(useActivity);
  await flushReact();
  const latest = snapshot([active()], [], 30_000);
  act(() => listeners.get("activity-updated")!({ payload: latest }));
  await act(async () => {
    pending.resolve(snapshot([], [], 10_000));
    await flush();
  });
  expect(hook.result.current.snapshot).toBe(latest);
  hook.unmount();
  expect(listeners.has("activity-updated")).toBe(false);
});

test("StrictMode subscriptions ignore callbacks from a disposed registration", async () => {
  const callbacks: Array<(event: { payload: unknown }) => void> = [];
  const removes: ReturnType<typeof vi.fn>[] = [];
  bridge.listen.mockImplementation(async (_, callback) => {
    callbacks.push(callback);
    const remove = vi.fn();
    removes.push(remove);
    return remove;
  });
  const hook = renderHook(useActivity, { wrapper: StrictMode });
  await flushReact();
  act(() => callbacks[0]({ payload: snapshot([active()], [], 100_000) }));
  expect(hook.result.current.snapshot.sessions).toHaveLength(0);
  act(() => callbacks.at(-1)!({ payload: snapshot([active()], [], 30_000) }));
  expect(hook.result.current.snapshot.sessions).toHaveLength(1);
  hook.unmount();
  expect(removes.every((remove) => remove.mock.calls.length === 1)).toBe(true);
});

test("reduced motion updates live and removes the media listener on unmount", () => {
  const media = mediaFixture();
  const remove = vi.spyOn(media.media, "removeEventListener");
  const hook = renderHook(useReducedMotion);
  expect(hook.result.current).toBe(false);
  act(() => media.change(true));
  expect(hook.result.current).toBe(true);
  act(() => media.change(false));
  expect(hook.result.current).toBe(false);
  hook.unmount();
  expect(remove).toHaveBeenCalledOnce();
});

test("held Results survive registry cleanup and collapsing, and release only in compact", () => {
  const result = done();
  const hook = renderHook(({ results, phase }) => useHeldResults(results, phase), {
    initialProps: { results: [result], phase: "compact" as IslandInteractionState },
  });
  expect(hook.result.current).toEqual([]);
  hook.rerender({ results: [result], phase: "expanding" });
  expect(hook.result.current).toEqual([result]);
  hook.rerender({ results: [], phase: "expanded" });
  expect(hook.result.current).toEqual([result]);
  hook.rerender({ results: [], phase: "collapsing" });
  expect(hook.result.current).toEqual([result]);
  hook.rerender({ results: [], phase: "compact" });
  expect(hook.result.current).toEqual([]);
});

test("Presentation has no active-session second tick, but Result and late Token still expire", async () => {
  const result = done();
  let renders = 0;
  const hook = renderHook(
    ({ data, tokens }) => {
      renders++;
      return useIslandPresentation(data, null, tokens, [], "compact", 20_000, false);
    },
    { initialProps: { data: snapshot([active()], [result]), tokens: {} as Record<string, TokenUsageState> } },
  );
  const initial = renders;
  await act(() => vi.advanceTimersByTimeAsync(1_000));
  expect(renders).toBe(initial);
  await act(() => vi.advanceTimersByTimeAsync(2_000));
  expect(hook.result.current.view.visibleResults).toEqual([]);
  vi.setSystemTime(25_000);
  hook.rerender({
    data: snapshot(),
    tokens: { [resultKey(result)]: { status: "ready", taskTokens: 200, sessionTokens: 900, readyAt: 25_000 } },
  });
  hook.rerender({
    data: snapshot([], [result]),
    tokens: { [resultKey(result)]: { status: "ready", taskTokens: 200, sessionTokens: 900, readyAt: 25_000 } },
  });
  expect(hook.result.current.view.compactLabel).toBe("完成 · 200");
  await act(() => vi.advanceTimersByTimeAsync(2_799));
  expect(hook.result.current.view.visibleResults).toHaveLength(1);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(hook.result.current.view.visibleResults).toHaveLength(0);
});

test("Elapsed updates its own text without rerendering the parent", async () => {
  let renders = 0;
  function Parent() {
    renders++;
    return <Elapsed from={1} to={null} />;
  }
  const ui = render(<Parent />);
  expect(ui.container.textContent).toBe("0:19");
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(ui.container.textContent).toBe("0:20");
  expect(renders).toBe(1);
  ui.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test("Token query uses Completed Result identity and keeps ready data after snapshot cleanup", async () => {
  const result = done();
  bridge.invoke.mockResolvedValue({ taskTokens: 321, sessionTokens: 900 });
  const hook = renderHook(({ results, held }) => useTurnTokenUsage(results, held), {
    initialProps: { results: [result], held: [result] },
  });
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith("read_token_usage", {
    sessionId: result.sessionId,
    turnId: result.turnId,
  });
  hook.rerender({ results: [], held: [result] });
  expect(hook.result.current[resultKey(result)]).toMatchObject({ status: "ready", taskTokens: 321 });
  hook.rerender({ results: [], held: [] });
  expect(hook.result.current).toEqual({});
});

test("navigation prevents concurrent requests, reports errors, and ignores completion after unmount", async () => {
  const pending = deferred();
  bridge.invoke.mockReturnValueOnce(pending.promise);
  const collapse = vi.fn();
  const hook = renderHook(() => useSessionNavigation(() => true, false, collapse));
  let opening!: Promise<void>;
  act(() => {
    opening = hook.result.current.open("first");
    void hook.result.current.open("second");
  });
  expect(hook.result.current.openingSession).toBe("first");
  expect(bridge.invoke).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.resolve();
    await opening;
  });
  expect(collapse).toHaveBeenCalledTimes(1);
  bridge.invoke.mockRejectedValueOnce(new Error("navigation failed"));
  await act(() => hook.result.current.open("first"));
  expect(hook.result.current.error).toContain("navigation failed");
  const late = deferred();
  bridge.invoke.mockReturnValueOnce(late.promise);
  act(() => {
    opening = hook.result.current.open("first");
  });
  hook.unmount();
  late.resolve();
  await opening;
  expect(collapse).toHaveBeenCalledTimes(1);
});

test("horizontal drag preserves DPI threshold, 0.38 smoothing, pointer capture and monitor bounds", async () => {
  const native = nativeFixture();
  const hook = renderHook(() => useHorizontalDrag(native, () => true, false));
  const element = document.createElement("main");
  const pointer = (screenX: number) =>
    ({ button: 0, pointerId: 1, screenX, currentTarget: element }) as unknown as PointerEvent<HTMLElement>;
  await act(() => hook.result.current.onPointerDown(pointer(10)));
  expect(element.setPointerCapture).toHaveBeenCalledWith(1);
  act(() => hook.result.current.onPointerMove(pointer(14)));
  await act(() => vi.advanceTimersByTimeAsync(16));
  expect(native.setPosition).not.toHaveBeenCalled();
  act(() => hook.result.current.onPointerMove(pointer(30)));
  await act(() => vi.advanceTimersByTimeAsync(16));
  expect(native.setPosition).toHaveBeenLastCalledWith(215, 3);
  act(() => hook.result.current.onPointerMove(pointer(1000)));
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(native.setPosition).toHaveBeenLastCalledWith(320, 3);
  act(() => hook.result.current.onPointerMove(pointer(-1000)));
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(native.setPosition).toHaveBeenLastCalledWith(100, 3);
  act(() => hook.result.current.onPointerUp(pointer(1000)));
  expect(element.releasePointerCapture).toHaveBeenCalledWith(1);
  expect(hook.result.current.suppressClick()).toBe(true);
  expect(hook.result.current.suppressClick()).toBe(false);
  hook.unmount();
});

test("App keeps completed Token while expanded and restores the minimal target exactly once", async () => {
  const result = done();
  const native = nativeFixture();
  bridge.invoke.mockImplementation(async (command) =>
    command === "read_activity"
      ? snapshot([], [result])
      : command === "read_token_usage"
        ? { taskTokens: 321, sessionTokens: 900 }
        : usage(),
  );
  const ui = render(
    <StrictMode>
      <App native={native} />
    </StrictMode>,
  );
  await flushReact();
  const main = ui.container.querySelector("main")!;
  fireEvent.mouseEnter(main);
  fireEvent.click(main);
  await flushReact();
  expect(main.classList.contains("expanded")).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(20_000));
  act(() => listeners.get("activity-updated")!({ payload: snapshot([], [], 40_000) }));
  expect(ui.container.querySelector(".token-summary")?.textContent).toContain("321 tokens");
  native.setHitRegion.mockClear();
  native.setSize.mockClear();
  fireEvent.mouseLeave(main);
  await act(() => vi.advanceTimersByTimeAsync(420));
  expect(main.classList.contains("layout-minimal")).toBe(true);
  expect(ui.container.querySelector(".token-summary")).not.toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(native.setSize.mock.calls).toEqual([[390, 42]]);
  expect(native.setHitRegion.mock.calls).toEqual([[100, 40]]);
  expect(ui.container.querySelector(".token-summary")).toBeNull();
  expect(ui.container.querySelector(".session-link")?.textContent).toContain("Demo");
  expect(ui.container.querySelector(".activity-head small")?.textContent).toBe("上次完成 · 321 tokens");
  expect(ui.container.querySelector(".meta > span")?.textContent).toBe("sol");
  expect(console.error).not.toHaveBeenCalled();
});

test("Session and headline navigation buttons stop propagation and keep busy/disabled states", () => {
  const open = vi.fn(async () => {});
  const toggle = vi.fn();
  const view = deriveIslandPresentation(snapshot([active()], [done()]), null, {}, 20_000);
  const navigation = { open, disabled: false, expanded: true, openingSession: null, error: null };
  const row = render(
    <div onClick={toggle}>
      <SessionRow row={view.rows[0]} navigation={navigation} />
    </div>,
  );
  fireEvent.click(row.getByRole("button"));
  expect(open).toHaveBeenCalledExactlyOnceWith("sample-session");
  expect(toggle).not.toHaveBeenCalled();
  row.rerender(
    <SessionRow row={view.rows[0]} navigation={{ ...navigation, disabled: true, openingSession: "sample-session" }} />,
  );
  expect(row.getByRole("button").textContent).toContain("打开中…");
  expect((row.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  row.unmount();
  const single = deriveIslandPresentation(snapshot([active()]), null, {}, 20_000);
  open.mockClear();
  const headline = render(
    <div onClick={toggle}>
      <ExpandedContent view={single} navigation={navigation} expanded={true} />
    </div>,
  );
  fireEvent.click(headline.getByRole("button"));
  expect(open).toHaveBeenCalledExactlyOnceWith("sample-session");
  expect(toggle).not.toHaveBeenCalled();
});

test("drag position preparation finishing after unmount cannot schedule native movement", async () => {
  const native = nativeFixture();
  const pending = deferred<Awaited<ReturnType<typeof native.placement>>>();
  native.placement.mockReturnValue(pending.promise);
  const hook = renderHook(() => useHorizontalDrag(native, () => true, false));
  const element = document.createElement("main");
  const event = {
    button: 0,
    pointerId: 1,
    screenX: 10,
    currentTarget: element,
  } as unknown as PointerEvent<HTMLElement>;
  const preparation = hook.result.current.onPointerDown(event);
  hook.unmount();
  pending.resolve({
    position: { x: 200, y: 3 },
    monitor: { position: { x: 0, y: 0 }, size: { width: 1000, height: 800 } },
    scale: 1,
  });
  await preparation;
  await vi.advanceTimersByTimeAsync(1000);
  expect(native.setPosition).not.toHaveBeenCalled();
});

test("useLimitWindow reads initial preference and updates upon limit-window-changed event", async () => {
  bridge.invoke.mockResolvedValueOnce("fiveHour");
  const hook = renderHook(useLimitWindow);
  expect(hook.result.current).toBe("fiveHour");
  await act(async () => {
    await Promise.resolve();
  });
  expect(hook.result.current).toBe("fiveHour");

  act(() => listeners.get("limit-window-changed")!({ payload: "week" }));
  expect(hook.result.current).toBe("week");

  hook.unmount();
  expect(listeners.has("limit-window-changed")).toBe(false);
});

test("IdlePromptTicker renders initial work joke and advances every 5 seconds when active", async () => {
  const ui = render(<IdlePromptTicker active={true} />);
  expect(ui.container.textContent).toBe(WORK_IDLE_PROMPTS[0]);

  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(ui.container.textContent).toBe(WORK_IDLE_PROMPTS[1]);

  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(ui.container.textContent).toBe(WORK_IDLE_PROMPTS[2]);

  ui.rerender(<IdlePromptTicker active={false} />);
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(ui.container.textContent).toBe(WORK_IDLE_PROMPTS[2]);
  ui.unmount();
});
