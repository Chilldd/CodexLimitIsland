import type { IslandInteractionState, InteractionEvent } from "../src/islandInteraction";
import type { TurnResult } from "../src/islandState";
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  createNativeQueue,
  createInteractionTimers,
  prepareExpandedWindow,
  restoreCompactWindow,
  MORPH_MS,
  AUTO_COLLAPSE_DELAY_MS,
  collapseRestoreDelay,
} from "../src/nativeOperations.ts";
import { reduceInteraction, selectInteractionViews } from "../src/islandInteraction.ts";
import { deriveIslandPresentation } from "../src/islandState.ts";

const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function fakeClock() {
  let now = 0;
  let next = 0;
  const jobs = new Map<number, { at: number; work: () => void }>();
  return {
    setTimeout(work: () => void, delay: number) {
      const id = ++next;
      jobs.set(id, { at: now + delay, work });
      return id;
    },
    clearTimeout(id: number | undefined) {
      if (id !== undefined) jobs.delete(id);
    },
    tick(delay: number) {
      const until = now + delay;
      while (true) {
        const pending = [...jobs].filter(([, job]) => job.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!pending) break;
        const [id, job] = pending;
        if (id !== undefined) jobs.delete(id);
        now = job.at;
        job.work();
      }
      now = until;
    },
  };
}
function fixture() {
  const queue = createNativeQueue();
  const calls: Array<string | (string | number)[]> = [];
  let state: IslandInteractionState = "compact";
  let large = false;
  let size = { width: 100, height: 40 };
  let resize = async () => {};
  let region = async () => {};
  const transition = (event: InteractionEvent) => {
    const next = reduceInteraction(state, event);
    if (next !== state) queue.invalidate();
    state = next;
  };
  const setSize = async (height: number) => {
    calls.push(["size", height]);
    await resize();
  };
  const setHitRegion = async (width: number, height: number) => {
    calls.push(["region", width, height]);
    await region();
  };
  return {
    queue,
    calls,
    transition,
    get state() {
      return state;
    },
    resize: (work: () => Promise<void>) => {
      resize = work;
    },
    region: (work: () => Promise<void>) => {
      region = work;
    },
    compactSize: (value: { width: number; height: number }) => {
      size = value;
    },
    expand: () =>
      queue.run(async (current) => {
        if (
          await prepareExpandedWindow(
            {
              setSize,
              setHitRegion,
              sized: () => {
                large = true;
              },
              regionSet: () => {},
            },
            154,
            current,
          )
        )
          transition("NATIVE_READY");
      }),
    collapse: () =>
      queue.run(async (current) => {
        if (
          await restoreCompactWindow(
            {
              needsResize: () => large,
              setSize: () => setSize(42),
              sized: () => {
                large = false;
              },
              size: () => size,
              setHitRegion,
              regionSet: () => {},
            },
            current,
          )
        )
          transition("ANIMATION_END");
      }),
  };
}

test("native queue serializes unresolved work and exposes rejection without blocking the next call", async () => {
  const queue = createNativeQueue();
  const first = deferred();
  const calls: Array<string | (string | number)[]> = [];
  const a = queue.run(async () => {
    calls.push("size");
    await first.promise;
  });
  const caught = assert.rejects(a, /native failure/);
  const b = queue.run(async () => {
    calls.push("position");
  });
  await flush();
  assert.deepEqual(calls, ["size"]);
  first.reject(new Error("native failure"));
  await caught;
  await b;
  assert.deepEqual(calls, ["size", "position"]);
});

for (const waitAt of ["resize", "region"] as const) {
  test(`collapse during expansion waiting for ${waitAt} prevents stale NATIVE_READY`, async () => {
    const f = fixture();
    const pending = deferred();
    f[waitAt](() => pending.promise);
    f.transition("EXPAND");
    const expanding = f.expand();
    await flush();
    f.transition("COLLAPSE");
    const collapsing = f.collapse();
    pending.resolve();
    await expanding;
    await collapsing;
    assert.equal(f.state, "compact");
    assert.deepEqual(f.calls.at(-1), ["region", 100, 40]);
    if (waitAt === "resize")
      assert.equal(
        f.calls.some((call) => call[0] === "region" && call[1] === 384),
        false,
      );
  });
  test(`reexpand while collapse waits for ${waitAt} keeps the new expanded target`, async () => {
    const f = fixture();
    f.transition("EXPAND");
    await f.expand();
    const pending = deferred();
    f[waitAt](() => pending.promise);
    f.transition("COLLAPSE");
    const collapsing = f.collapse();
    await flush();
    f.transition("EXPAND");
    const expanding = f.expand();
    pending.resolve();
    await collapsing;
    await expanding;
    assert.equal(f.state, "expanded");
    assert.deepEqual(f.calls.at(-1), ["region", 384, 158]);
  });
  test(`unmount while waiting for ${waitAt} prevents completion and queued native calls`, async () => {
    const f = fixture();
    const pending = deferred();
    f[waitAt](() => pending.promise);
    f.transition("EXPAND");
    const expanding = f.expand();
    await flush();
    const queued = f.queue.run(async () => {
      assert.fail("unmounted work ran");
    });
    f.queue.dispose();
    pending.resolve();
    await expanding;
    await queued;
    assert.equal(f.state, "expanding");
    if (waitAt === "resize") assert.deepEqual(f.calls, [["size", 158]]);
  });
  test(`native ${waitAt} rejection remains observable and a later interaction can recover`, async () => {
    const f = fixture();
    f[waitAt](async () => {
      throw new Error("native failure");
    });
    f.transition("EXPAND");
    await assert.rejects(f.expand(), /native failure/);
    f[waitAt](async () => {});
    f.transition("COLLAPSE");
    await f.collapse();
    f.transition("EXPAND");
    await f.expand();
    assert.equal(f.state, "expanded");
  });
}

test("ABA interaction changes invalidate an old expansion even when its phase matches again", async () => {
  const f = fixture();
  const pending = deferred();
  f.resize(() => pending.promise);
  f.transition("EXPAND");
  const old = f.expand();
  await flush();
  f.transition("COLLAPSE");
  f.transition("EXPAND");
  const latest = f.expand();
  pending.resolve();
  await old;
  await latest;
  assert.equal(f.state, "expanded");
  assert.equal(f.calls.filter((call) => call[0] === "region").length, 1);
});

test("StrictMode cleanup invalidates old queued work before reactivation", async () => {
  const queue = createNativeQueue();
  const calls: Array<string | (string | number)[]> = [];
  const old = queue.run(async () => {
    calls.push("old");
  });
  queue.dispose();
  queue.activate();
  const next = queue.run(async () => {
    calls.push("new");
  });
  await old;
  await next;
  assert.deepEqual(calls, ["new"]);
});

test("Completed expanded then expired collapses directly to the live minimal target once", async () => {
  const done: TurnResult = {
    kind: "completed",
    sessionId: "sample",
    turnId: "turn-1",
    finishedAt: 1000,
    project: "Demo",
    model: null,
    startedAt: 1,
  };
  const snapshot = { sessions: [], recentResults: [], updatedAt: 20000 };
  const live = deriveIslandPresentation(snapshot, null, {}, 20000);
  const retained = deriveIslandPresentation(snapshot, null, {}, 20000, [done]);
  const f = fixture();
  f.transition("EXPAND");
  await f.expand();
  assert.equal(selectInteractionViews(f.state, live, retained).view.layout, "single");
  const resize = deferred();
  f.resize(() => resize.promise);
  f.transition("COLLAPSE");
  const { view, detailView } = selectInteractionViews(f.state, live, retained);
  assert.equal(view.layout, "minimal");
  assert.equal(detailView.primaryResult?.result, done);
  f.compactSize({ width: view.layout === "minimal" ? 100 : 168, height: 40 });
  const collapse = f.collapse();
  await flush();
  resize.resolve();
  await collapse;
  assert.equal(f.state, "compact");
  assert.deepEqual(f.calls, [
    ["size", 158],
    ["region", 384, 158],
    ["size", 42],
    ["region", 100, 40],
  ]);
  assert.equal(selectInteractionViews(f.state, live, retained).detailView.primaryResult, undefined);
});

test("existing morph, mouse leave and restore delays stay unchanged", () => {
  assert.equal(MORPH_MS, 340);
  assert.equal(AUTO_COLLAPSE_DELAY_MS, 420);
  assert.equal(collapseRestoreDelay(false), 420);
  assert.equal(collapseRestoreDelay(true), 190);
});

test("leaving during expansion waits 420ms and reentering cancels pending collapse", () => {
  const clock = fakeClock();
  const timers = createInteractionTimers(clock);
  let state = reduceInteraction("compact", "EXPAND");
  const collapse = () => {
    state = reduceInteraction(state, "COLLAPSE");
  };
  timers.scheduleLeave(collapse);
  clock.tick(419);
  assert.equal(state, "expanding");
  assert.equal(timers.hasPendingLeave(), true);
  timers.cancelLeave();
  clock.tick(1);
  assert.equal(state, "expanding");
  timers.scheduleLeave(collapse);
  clock.tick(420);
  assert.equal(state, "collapsing");
  assert.equal(timers.hasPendingLeave(), false);
});

for (const reducedMotion of [false, true]) {
  test(`restore timer respects reducedMotion=${reducedMotion} and reexpand/unmount cancellation`, () => {
    const clock = fakeClock();
    const timers = createInteractionTimers(clock);
    const calls: Array<string | (string | number)[]> = [];
    timers.scheduleRestore(() => calls.push("restore"), reducedMotion);
    clock.tick(collapseRestoreDelay(reducedMotion) - 1);
    assert.deepEqual(calls, []);
    clock.tick(1);
    assert.deepEqual(calls, ["restore"]);
    timers.scheduleRestore(() => assert.fail("reexpanded restore ran"), reducedMotion);
    timers.cancelRestore();
    clock.tick(1000);
    timers.scheduleLeave(() => assert.fail("unmounted leave ran"));
    timers.scheduleRestore(() => assert.fail("unmounted restore ran"), reducedMotion);
    timers.dispose();
    clock.tick(1000);
    assert.deepEqual(calls, ["restore"]);
  });
}
