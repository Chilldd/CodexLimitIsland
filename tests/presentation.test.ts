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
  EXPANDED_WIDTH,
  EXPANDED_HIT_WIDTH,
  EXPANDED_MAX_HEIGHT,
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
  const result = { ...done(), project: null, model: null };
  const view = deriveIslandPresentation(snapshot([session], [result]), null, {}, 20_000);
  expect(view.rows[0]).toMatchObject({
    title: "Workspace",
    tooltip: "D:/Sample/Workspace",
    subtitle: "等待审批 · 2 个子代理",
    attention: "permission",
    elapsed: { from: 1, to: null },
  });
  expect(view.rows[1]).toMatchObject({
    title: "Codex 会话",
    tooltip: "",
    feedback: "completed",
    elapsed: { from: 19_100, to: 20_000 },
  });
  expect(view.headline.title).toBe("Codex 会话");
  expect(view.meta).toBeNull();
  const empty = deriveIslandPresentation(
    snapshot([{ ...session, project: "", cwd: null, agents: [] }]),
    null,
    {},
    20_000,
  );
  expect(empty.rows[0]).toMatchObject({ title: "Codex 会话", tooltip: "" });
  expect(empty.meta?.label).toBe("正在连接 Codex");
});
test("Meta, quota tones and ARIA copy preserve existing fallbacks", () => {
  const idle = deriveIslandPresentation(snapshot(), null, {}, 20_000, [], true);
  expect(idle.expandedSubtitle).toBe("暂时无法获取额度");
  expect(idle.meta?.label).toBe("额度读取失败");
  expect(idle.ariaLabel).toBe("Codex 五小时剩余额度 —");
  const normal = deriveIslandPresentation(snapshot(), usage(30), {}, 20_000);
  expect(normal.compactUsage).toEqual({ tone: "warning", percent: "30%", label: "5h" });
  expect(normal.usageRows[0]).toMatchObject({ label: "5 小时剩余", width: "30%", reset: "重置时间未知" });
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
  expect(weeklyCountdown.ariaLabel).toBe("Codex 每周剩余额度 80%");
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
    subtitle: "上次完成 · 12.6k tokens",
  });
  expect(idleAfterResult.meta).toMatchObject({ label: "sol" });
  const idleAfterInterrupted = deriveIslandPresentation(snapshot(), usage(37), {}, 30_000, [], false, "fiveHour", {
    result: { ...result, kind: "interrupted", model: null },
  });
  expect(idleAfterInterrupted.headline).toEqual({
    sessionId: "sample-session",
    title: "Demo",
    subtitle: "上次任务已中断",
  });
  expect(idleAfterInterrupted.meta).toMatchObject({ label: "" });
  const permission = deriveIslandPresentation(
    snapshot([{ ...active(), attention: "permission" }], [result]),
    usage(0),
    {},
    20_000,
  );
  expect(permission.attention).toBe("permission");
  expect(permission.ariaLabel).toBe("等待审批");
  expect(permission.visibleResults).toHaveLength(1);
});
test("CSS tokens, visible size, native hit regions and Tauri/Rust bounds stay aligned", () => {
  const css = readFileSync(resolve("src/styles/tokens.css"), "utf8");
  for (const [key, value] of Object.entries({
    "island-padding": ROOT_PADDING,
    "minimal-width": MINIMAL_WIDTH,
    "compact-width": COMPACT_WIDTH,
    "expanded-width": EXPANDED_WIDTH,
    "expanded-max-height": EXPANDED_MAX_HEIGHT,
  }))
    expect(css).toMatch(new RegExp(`--${key}:\\s*${value}px`));
  expect(css).toMatch(new RegExp(`--morph-duration:\\s*${MORPH_MS}ms`));
  expect(compactSize("minimal")).toEqual({ width: 100, height: 40 });
  expect(compactSize("single")).toEqual({ width: 168, height: 42 });
  expect(EXPANDED_HIT_WIDTH).toBe(384);
  const appCss = readFileSync(resolve("src/App.css"), "utf8");
  expect(appCss).toMatch(/width:\s*var\(--expanded-width\)/);
  for (const width of [MINIMAL_WIDTH, COMPACT_WIDTH, EXPANDED_WIDTH]) expect(appCss).not.toContain(`width: ${width}px`);
  expect(expandedHeight(1, false)).toBe(154);
  expect(expandedHeight(1, true)).toBe(204);
  expect(expandedHeight(9, false)).toBe(420);
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
    expect(view.rows).toHaveLength(view.rowCount);
    expect(view.ariaLabel).toBeTruthy();
    expect(view.headline.subtitle).toBe(view.expandedSubtitle);
  }
});
