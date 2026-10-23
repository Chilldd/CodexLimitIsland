import { expect, test } from "vitest";
import { deriveIslandPresentation, resultKey } from "../src/islandState";
import { active, done, snapshot, usage } from "./fixtures";
import { WORK_IDLE_PROMPTS } from "../src/domain/idlePrompts";
import {
  compactSize,
  expandedHeight,
  ROOT_PADDING,
  MINIMAL_WIDTH,
  COMPACT_WIDTH,
  COMPACT_HEIGHT,
  EXPANDED_WIDTH,
  EXPANDED_HIT_WIDTH,
  EXPANDED_MAX_HEIGHT,
  SESSION_ROW_HEIGHT,
  WINDOW_WIDTH,
  DEBUG_HEIGHT,
  MORPH_MS,
} from "../src/domain/metrics";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEBUG_SCENARIOS, createDebugScenario } from "../src/debugPresentation";

test("row titles, tooltip fallback, agents and result metadata are derived without interaction state", () => {
  const session = {
    ...active(),
    project: null,
    cwd: "D:/Sample/Workspace",
    agents: [
      { id: "one", activity: "thinking" as const, attention: "none" as const, lastActivityAt: 1 },
      { id: "two", activity: "working" as const, attention: "permission" as const, lastActivityAt: 1 },
    ],
  };
  const result = { ...done(), sessionId: "finished-session", project: null, model: null };
  const view = deriveIslandPresentation(snapshot([session], [result]), null, {}, 20_000);
  expect(view.rows[0]).toMatchObject({
    title: "Workspace",
    tooltip: "D:/Sample/Workspace",
    subtitle: "Approval needed · 2 agents",
    attention: "permission",
    elapsed: { from: 1, to: null },
  });
  expect(view.rows[1]).toMatchObject({
    title: "Codex session",
    tooltip: "",
    feedback: "completed",
    elapsed: { from: 19_100, to: 20_000 },
  });
  expect(view.headline.title).toBe("Codex session");
  expect(view.meta).toBeNull();
  const empty = deriveIslandPresentation(
    snapshot([{ ...session, project: "", cwd: null, agents: [] }]),
    null,
    {},
    20_000,
  );
  expect(empty.rows[0]).toMatchObject({ title: "Codex session", tooltip: "" });
  expect(empty.meta?.label).toBe("Connecting to Codex");
});
test("Meta, quota tones and ARIA copy preserve existing fallbacks", () => {
  const idle = deriveIslandPresentation(snapshot(), null, {}, 20_000, [], true);
  expect(idle.expandedSubtitle).toBe("Limits temporarily unavailable");
  expect(idle.meta?.label).toBe("Unable to read limits");
  expect(idle.ariaLabel).toBe("Codex 5-hour remaining —");
  const normal = deriveIslandPresentation(snapshot(), usage(30), {}, 20_000);
  expect(normal.compactUsage).toEqual({ tone: "warning", percent: "30%", label: "5h" });
  expect(normal.usageRows[0]).toMatchObject({
    window: "fiveHour",
    selected: true,
    label: "5h",
    width: "30%",
    reset: "Reset time unavailable",
  });
  expect(normal.usageRows[1]).toMatchObject({
    window: "week",
    selected: false,
    label: "7d",
  });
  expect(normal.expandedSubtitle).toBe(WORK_IDLE_PROMPTS[0]);
  expect(normal.meta).toMatchObject({ label: "" });
  const countdown = deriveIslandPresentation(
    snapshot(),
    {
      fiveHour: { remainingPercent: 37, resetsAt: 20 + 2 * 3600 + 33 * 60 },
      weekly: { remainingPercent: 77, resetsAt: 20 + 6 * 86400 + 2 * 3600 },
      updatedAt: 20,
    },
    {},
    20_000,
  );
  expect(countdown.expandedSubtitle).toBe(WORK_IDLE_PROMPTS[0]);
  expect(countdown.meta).toMatchObject({ label: "" });
  const weeklyCountdown = deriveIslandPresentation(
    snapshot(),
    {
      fiveHour: null,
      weekly: { remainingPercent: 80, resetsAt: 20 + 6 * 86400 + 2 * 3600 },
      updatedAt: 20,
    },
    {},
    20_000,
    [],
    false,
    "week",
  );
  expect(weeklyCountdown.compactUsage).toEqual({ tone: "healthy", percent: "80%", label: "7d" });
  expect(weeklyCountdown.expandedSubtitle).toBe(WORK_IDLE_PROMPTS[0]);
  expect(weeklyCountdown.meta).toMatchObject({ label: "" });
  expect(weeklyCountdown.ariaLabel).toBe("Codex weekly remaining 80%");
  expect(weeklyCountdown.usageRows[0]).toMatchObject({ window: "fiveHour", selected: false });
  expect(weeklyCountdown.usageRows[1]).toMatchObject({ window: "week", selected: true });
  const result = done();
  const ready = { status: "ready" as const, taskTokens: 12_648, sessionTokens: 20_000, readyAt: 20_000 };
  const completed = deriveIslandPresentation(snapshot([], [result]), usage(), { [resultKey(result)]: ready }, 20_000);
  expect(completed.meta).toEqual({ label: "sol", elapsed: { from: 19_100, to: 20_000 } });
  const idleAfterResult = deriveIslandPresentation(
    snapshot([], [result]),
    usage(37),
    { [resultKey(result)]: ready },
    30_000,
  );
  expect(idleAfterResult.layout).toBe("minimal");
  expect(idleAfterResult.headline).toEqual({
    sessionId: "sample-session",
    title: "Demo",
    subtitle: "Last completed · 12.6k tokens",
  });
  expect(idleAfterResult.meta).toMatchObject({ label: "sol" });
  const idleAfterInterrupted = deriveIslandPresentation(snapshot(), usage(37), {}, 30_000, [], false, "fiveHour", {
    result: { ...result, kind: "interrupted", model: null },
  });
  expect(idleAfterInterrupted.headline).toEqual({
    sessionId: "sample-session",
    title: "Demo",
    subtitle: "Previous task interrupted",
  });
  expect(idleAfterInterrupted.meta).toMatchObject({ label: "" });
  const permission = deriveIslandPresentation(
    snapshot([{ ...active(), attention: "permission" }], [result]),
    usage(0),
    {},
    20_000,
  );
  expect(permission.attention).toBe("permission");
  expect(permission.ariaLabel).toBe("Approval needed");
  expect(permission.visibleResults).toHaveLength(1);
});
test("CSS tokens, visible size, native hit regions and Tauri/Rust bounds stay aligned", () => {
  const css = readFileSync(resolve("src/styles/tokens.css"), "utf8");
  for (const [key, value] of Object.entries({
    "island-padding": ROOT_PADDING,
    "minimal-width": MINIMAL_WIDTH,
    "compact-width": COMPACT_WIDTH,
    "compact-height": COMPACT_HEIGHT,
    "expanded-width": EXPANDED_WIDTH,
    "expanded-max-height": EXPANDED_MAX_HEIGHT,
    "session-row-height": SESSION_ROW_HEIGHT,
  }))
    expect(css).toMatch(new RegExp(`--${key}:\\s*${value}px`));
  expect(css).toMatch(new RegExp(`--morph-duration:\\s*${MORPH_MS}ms`));
  expect(compactSize("minimal")).toEqual({ width: 100, height: 40 });
  expect(compactSize("single")).toEqual({ width: 160, height: 42 });
  expect(EXPANDED_HIT_WIDTH).toBe(384);
  const appCss = ["island", "compact", "expanded", "resources", "usage", "sessions", "states"]
    .map((name) => readFileSync(resolve(`src/styles/${name}.css`), "utf8"))
    .join("\n");
  expect(appCss).toMatch(/width:\s*var\(--expanded-width\)/);
  expect(appCss).toMatch(/height:\s*var\(--session-row-height\)/);
  for (const width of [MINIMAL_WIDTH, COMPACT_WIDTH, EXPANDED_WIDTH]) expect(appCss).not.toContain(`width: ${width}px`);
  expect(expandedHeight(0)).toBe(306);
  expect(expandedHeight(1)).toBe(306);
  expect(expandedHeight(2)).toBe(356);
  expect(expandedHeight(3)).toBe(406);
  expect(expandedHeight(9)).toBe(406);
  expect(expandedHeight(9)).toBeLessThanOrEqual(EXPANDED_MAX_HEIGHT);
  const config = JSON.parse(readFileSync(resolve("src-tauri/tauri.conf.json"), "utf8"));
  expect(config.app.windows[0]).toMatchObject({ width: WINDOW_WIDTH, height: compactSize("single").height });
  const rust = readFileSync(resolve("src-tauri/src/window/hit_region.rs"), "utf8");
  expect(rust).toContain(`(100.0..=${WINDOW_WIDTH}.0)`);
  expect(rust).toContain(`(40.0..=${EXPANDED_MAX_HEIGHT + ROOT_PADDING * 2}.0)`);
  expect(rust).toContain(`height == ${DEBUG_HEIGHT}.0`);
});
test("all 20 debug scenarios provide typed rows and consistent headline/ARIA contracts", () => {
  expect(DEBUG_SCENARIOS).toHaveLength(20);
  for (const name of DEBUG_SCENARIOS) {
    const scene = createDebugScenario(name, 20_000);
    const view = deriveIslandPresentation(
      scene.snapshot,
      scene.usage,
      scene.tokens,
      20_000,
      scene.snapshot.recentResults,
    );
    expect(new Set(view.rows.map((row) => row.sessionId)).size).toBe(view.rows.length);
    expect(view.ariaLabel).toBeTruthy();
    expect(view.headline.subtitle).toBe(view.expandedSubtitle);
  }
});
