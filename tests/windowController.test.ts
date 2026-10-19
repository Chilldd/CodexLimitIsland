import { beforeEach, expect, test, vi } from "vitest";
import { createIslandWindowController, type WindowModel } from "../src/windowController";
import { reduceInteraction, type IslandInteractionState } from "../src/islandInteraction";
import { deferred, flush, nativeFixture } from "./fixtures";

beforeEach(() => vi.useFakeTimers());
function fixture() {
  const native = nativeFixture();
  let phase: IslandInteractionState = "compact";
  const machine = {
    current: () => phase,
    transition: vi.fn((event: Parameters<typeof reduceInteraction>[1]) => {
      phase = reduceInteraction(phase, event);
    }),
  };
  const orb = vi.fn();
  const report = vi.fn();
  const controller = createIslandWindowController(
    native,
    machine,
    { setTimeout: (work, delay) => window.setTimeout(work, delay), clearTimeout: (id) => window.clearTimeout(id) },
    orb,
    report,
  );
  let model: WindowModel = {
    compact: { width: 100, height: 40 },
    expandedHeight: 154,
    reducedMotion: false,
    debug: false,
  };
  controller.update(model);
  controller.activate();
  controller.enter();
  return {
    native,
    machine,
    controller,
    report,
    orb,
    update: (next: Partial<WindowModel>) => {
      model = { ...model, ...next };
      controller.update(model);
    },
  };
}

test("duplicate expansion clicks and transitionend/timer completion share one native restore", async () => {
  const f = fixture();
  const pending = deferred();
  f.native.setSize.mockImplementationOnce(() => pending.promise);
  const expanding = f.controller.expand();
  await flush();
  await f.controller.expand();
  expect(f.native.setSize).toHaveBeenCalledTimes(1);
  pending.resolve();
  await expanding;
  expect(f.machine.current()).toBe("expanded");
  f.controller.collapse();
  f.controller.collapse();
  expect(f.native.setSize).toHaveBeenCalledTimes(1);
  const first = f.controller.finishCollapse();
  const second = f.controller.finishCollapse();
  expect(first).toBe(second);
  await first;
  await vi.advanceTimersByTimeAsync(500);
  expect(f.machine.current()).toBe("compact");
  expect(f.native.setSize.mock.calls).toEqual([
    [390, 158],
    [390, 42],
  ]);
  expect(f.machine.transition.mock.calls.filter(([event]) => event === "ANIMATION_END")).toHaveLength(1);
  f.controller.dispose();
});

test("missing transitionend still restores at the original fallback deadline", async () => {
  const f = fixture();
  await f.controller.expand();
  f.controller.leave();
  await vi.advanceTimersByTimeAsync(419);
  expect(f.machine.current()).toBe("expanded");
  await vi.advanceTimersByTimeAsync(1);
  expect(f.machine.current()).toBe("collapsing");
  await vi.advanceTimersByTimeAsync(419);
  expect(f.machine.current()).toBe("collapsing");
  await vi.advanceTimersByTimeAsync(1);
  expect(f.machine.current()).toBe("compact");
  f.controller.dispose();
});

test("new compact data arriving while shrinking controls the final hit region", async () => {
  const f = fixture();
  await f.controller.expand();
  f.controller.collapse();
  const pending = deferred();
  f.native.setSize.mockImplementationOnce(() => pending.promise);
  const shrinking = f.controller.finishCollapse();
  await flush();
  f.update({ compact: { width: 204, height: 42 } });
  pending.resolve();
  await shrinking;
  expect(f.native.setHitRegion).toHaveBeenLastCalledWith(204, 42);
  expect(f.machine.current()).toBe("compact");
  f.controller.dispose();
});

for (const awaitAt of ["setSize", "setHitRegion"] as const) {
  test(`reexpand and collapse again while old ${awaitAt} is pending does not reuse stale collapse work`, async () => {
    const f = fixture();
    await f.controller.expand();
    const pending = deferred();
    f.native[awaitAt].mockImplementationOnce(() => pending.promise);
    f.controller.collapse();
    const old = f.controller.finishCollapse();
    await flush();
    const expanded = f.controller.expand();
    f.controller.collapse();
    const latest = f.controller.finishCollapse();
    expect(latest).not.toBe(old);
    pending.resolve();
    await Promise.all([old, expanded, latest]);
    expect(f.machine.current()).toBe("compact");
    expect(f.native.setHitRegion).toHaveBeenLastCalledWith(100, 40);
    f.controller.dispose();
  });
  test(`unmount during ${awaitAt} ignores the remainder and all timers`, async () => {
    const f = fixture();
    const pending = deferred();
    f.native[awaitAt].mockImplementationOnce(() => pending.promise);
    const expanded = f.controller.expand();
    await flush();
    f.controller.dispose();
    pending.resolve();
    await expanded;
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.machine.current()).toBe("expanding");
    expect(f.orb).not.toHaveBeenCalled();
    if (awaitAt === "setSize") expect(f.native.setHitRegion).not.toHaveBeenCalled();
  });
}

test("resize and hit-region failure follow recoverable phases and remain observable", async () => {
  const f = fixture();
  f.native.setSize.mockRejectedValueOnce(new Error("size failed"));
  await f.controller.expand();
  expect(f.machine.current()).toBe("compact");
  await f.controller.expand();
  f.native.setSize.mockRejectedValueOnce(new Error("shrink failed"));
  f.controller.collapse();
  await f.controller.finishCollapse();
  expect(f.machine.current()).toBe("expanded");
  f.controller.collapse();
  f.native.setHitRegion.mockRejectedValueOnce(new Error("region failed"));
  await f.controller.finishCollapse();
  expect(f.machine.current()).toBe("compact");
  expect(f.report).toHaveBeenCalledTimes(3);
  f.controller.dispose();
});

test("expanded content height changes serialize and compact updates do not resize mid-morph", async () => {
  const f = fixture();
  await f.controller.expand();
  const pending = deferred();
  f.native.setSize.mockImplementationOnce(() => pending.promise);
  f.update({ expandedHeight: 204 });
  await flush();
  f.update({ expandedHeight: 420 });
  expect(f.native.setSize).toHaveBeenCalledTimes(2);
  pending.resolve();
  await flush();
  expect(f.native.setSize).toHaveBeenLastCalledWith(390, 424);
  f.controller.collapse();
  f.update({ compact: { width: 204, height: 42 } });
  expect(f.native.setSize).toHaveBeenCalledTimes(3);
  await f.controller.finishCollapse();
  expect(f.native.setHitRegion).toHaveBeenLastCalledWith(204, 42);
  f.controller.dispose();
});

test("StrictMode activation replay cancels old work and preserves current debug bounds", async () => {
  const f = fixture();
  f.update({ debug: true });
  f.controller.dispose();
  f.controller.activate();
  await flush();
  expect(f.native.setSize).toHaveBeenLastCalledWith(390, 550);
  expect(f.native.setHitRegion).toHaveBeenLastCalledWith(384, 550);
  f.controller.dispose();
});
