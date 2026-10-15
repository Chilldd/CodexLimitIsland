import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useTurnTokenUsage } from "../src/hooks/useTurnTokenUsage";
import { resultKey, type TurnResult } from "../src/islandState";
import { done, deferred } from "./fixtures";
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
beforeEach(() => {
  vi.useFakeTimers();
  bridge.invoke.mockReset();
});
test("1000 completed turns are pruned after snapshot and held results release them", async () => {
  bridge.invoke.mockResolvedValue({ taskTokens: 3, sessionTokens: 30 });
  const hook = renderHook(({ results, held }) => useTurnTokenUsage(results, held), {
    initialProps: { results: [] as TurnResult[], held: [] as TurnResult[] },
  });
  for (let i = 0; i < 1000; i++) {
    const result = { ...done(), turnId: `turn-${i}` };
    hook.rerender({ results: [result], held: [] });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(Object.keys(hook.result.current)).toHaveLength(1);
    hook.rerender({ results: [], held: [result] });
    expect(hook.result.current[resultKey(result)]).toMatchObject({ status: "ready", taskTokens: 3 });
    hook.rerender({ results: [], held: [] });
    expect(hook.result.current).toEqual({});
  }
  expect(bridge.invoke).toHaveBeenCalledTimes(1000);
  hook.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
test("pending usage survives snapshot expiry while expanded and stale promises cannot revive unmounted jobs", async () => {
  const result = done();
  const pending = deferred<{ taskTokens: number; sessionTokens: number }>();
  bridge.invoke.mockReturnValue(pending.promise);
  const hook = renderHook(({ results, held }) => useTurnTokenUsage(results, held), {
    initialProps: { results: [result], held: [] as TurnResult[] },
    wrapper: StrictMode,
  });
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(bridge.invoke).toHaveBeenCalledOnce();
  hook.rerender({ results: [], held: [result] });
  expect(hook.result.current[resultKey(result)]).toEqual({ status: "loading" });
  await act(async () => pending.resolve({ taskTokens: 9, sessionTokens: 90 }));
  expect(hook.result.current[resultKey(result)]).toMatchObject({ status: "ready", taskTokens: 9 });
  hook.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
test("unmount cancels retry timers and late native completion is ignored", async () => {
  const result = done();
  const pending = deferred<{ taskTokens: number; sessionTokens: number }>();
  bridge.invoke.mockReturnValue(pending.promise);
  const first = renderHook(() => useTurnTokenUsage([result]));
  first.unmount();
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(bridge.invoke).not.toHaveBeenCalled();
  const second = renderHook(() => useTurnTokenUsage([result]));
  await act(() => vi.advanceTimersByTimeAsync(300));
  second.unmount();
  await act(async () => pending.resolve({ taskTokens: 3, sessionTokens: 30 }));
  expect(vi.getTimerCount()).toBe(0);
});
