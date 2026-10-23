import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { compactTierFor, deriveIslandPresentation, resultKey } from "../src/islandState";
import type { Activity, Agent, Session, TokenUsageState, TurnResult } from "../src/islandState";
import {
  COMPACT_MULTI_WIDTH,
  COMPACT_RUN_WIDTH,
  COMPACT_WIDTH,
  MINIMAL_WIDTH,
  ROOT_PADDING,
  compactSize,
} from "../src/domain/metrics";
import { active, done, snapshot, usage } from "./fixtures";

const NOW = 20_000;
const ACTIVITY_KINDS: Activity[] = [
  "thinking",
  "working",
  "searching",
  "editing",
  "executing",
  "connecting",
  "compacting",
];
const agent = (id: string): Agent => ({ id, activity: "thinking", attention: "none", lastActivityAt: NOW });
const frame = (sessions: Session[], results: TurnResult[] = [], tokens: Record<string, TokenUsageState> = {}) =>
  deriveIslandPresentation(snapshot(sessions, results), usage(), tokens, NOW);

test("every single-session activity stays in the run tier, so switching activity never resizes the island", () => {
  for (const activity of ACTIVITY_KINDS) {
    const view = frame([{ ...active(), activity }]);
    expect(view.compactLabel.length, activity).toBeLessThanOrEqual(13);
    expect(view.compactTier, activity).toBe("run");
  }
});

test("multi-agent keeps the run tier while permission, quota and several sessions use the result tier", () => {
  const withAgents = frame([{ ...active(), agents: [agent("a"), agent("b")] }]);
  expect(withAgents.compactLabel).toBe("Multi-agent");
  expect(withAgents.compactTier).toBe("run");
  const permission = frame([{ ...active(), attention: "permission" }]);
  expect(permission.compactLabel).toBe("Approval needed");
  expect(permission.compactTier).toBe("result");
  const severalSessions = frame([active(), { ...active(), id: "other" }]);
  expect(severalSessions.compactLabel).toBe("2 active sessions");
  expect(severalSessions.compactTier).toBe("result");
  const quota = deriveIslandPresentation(snapshot(), usage(0), {}, NOW);
  expect(quota.compactLabel).toBe("Rate limit reached");
  expect(quota.compactTier).toBe("result");
});

test("a completed result reserves the token width at once and keeps it while the token loads or fails", () => {
  const result = done();
  const key = resultKey(result);
  const ready: TokenUsageState = { status: "ready", taskTokens: 12_648, sessionTokens: 20_000, readyAt: NOW };
  const tokenStates: Record<string, TokenUsageState>[] = [
    {},
    { [key]: { status: "loading" } },
    { [key]: ready },
    { [key]: { status: "unavailable" } },
  ];
  for (const tokens of tokenStates) {
    expect(frame([], [result], tokens).compactTier).toBe("result");
  }
  const interrupted = frame([], [{ ...result, kind: "interrupted" }]);
  expect(interrupted.compactLabel).toBe("Interrupted");
  expect(interrupted.compactTier).toBe("run");
});

test("an active session next to a visible result uses the multi tier", () => {
  const view = frame([active()], [{ ...done(), sessionId: "other-session" }]);
  expect(view.compactLabel).toBe("1 running · 1 completed");
  expect(view.compactTier).toBe("multi");
  const sameSession = frame([active()], [done()]);
  expect(sameSession.compactLabel).toBe("Thinking...");
  expect(sameSession.rows).toHaveLength(1);
});

test("a normal turn resizes the compact island once, from run to result", () => {
  const result = done();
  const ready: TokenUsageState = { status: "ready", taskTokens: 900, sessionTokens: 1_800, readyAt: NOW };
  const timeline = [
    frame([{ ...active(), activity: "thinking" }]),
    frame([{ ...active(), activity: "executing" }]),
    frame([{ ...active(), activity: "editing", agents: [agent("a"), agent("b")] }]),
    frame([{ ...active(), activity: "searching" }]),
    frame([], [result]),
    frame([], [result], { [resultKey(result)]: ready }),
  ];
  const widths = timeline.map((view) => compactSize(view.layout, view.compactTier).width);
  expect(widths.filter((width, index) => index > 0 && width !== widths[index - 1])).toHaveLength(1);
  expect(widths[0]).toBe(COMPACT_RUN_WIDTH + ROOT_PADDING * 2);
  expect(widths.at(-1)).toBe(COMPACT_WIDTH + ROOT_PADDING * 2);
});

test("compactTierFor classifies labels by their rendered length", () => {
  expect(compactTierFor("Thinking...", false)).toBe("run");
  expect(compactTierFor("Approval needed", false)).toBe("result");
  expect(compactTierFor("Rate limit reached", false)).toBe("result");
  expect(compactTierFor("1 running · 1 completed", false)).toBe("multi");
  expect(compactTierFor("Completed · 368k", true)).toBe("result");
});

test("tier widths, hit regions and CSS tokens stay aligned", () => {
  expect(compactSize("single", "run")).toEqual({ width: COMPACT_RUN_WIDTH + ROOT_PADDING * 2, height: 42 });
  expect(compactSize("single")).toEqual({ width: COMPACT_WIDTH + ROOT_PADDING * 2, height: 42 });
  expect(compactSize("multi", "multi")).toEqual({ width: COMPACT_MULTI_WIDTH + ROOT_PADDING * 2, height: 42 });
  expect(compactSize("minimal", "multi")).toEqual({ width: MINIMAL_WIDTH + ROOT_PADDING * 2, height: 40 });
  expect(COMPACT_RUN_WIDTH).toBeLessThan(COMPACT_WIDTH);
  expect(COMPACT_WIDTH).toBeLessThan(COMPACT_MULTI_WIDTH);
  const tokens = readFileSync(resolve("src/styles/tokens.css"), "utf8");
  expect(tokens).toMatch(new RegExp(`--compact-run-width:\\s*${COMPACT_RUN_WIDTH}px`));
  expect(tokens).toMatch(new RegExp(`--compact-multi-width:\\s*${COMPACT_MULTI_WIDTH}px`));
  const states = readFileSync(resolve("src/styles/states.css"), "utf8");
  expect(states).toContain("var(--compact-run-width)");
  expect(states).toContain("var(--compact-multi-width)");
  expect(states).not.toMatch(/width:\s*\d+px/);
});
