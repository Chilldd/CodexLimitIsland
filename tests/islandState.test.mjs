import test from "node:test";
import assert from "node:assert/strict";
import { deriveIslandPresentation, newerActivity, resultKey } from "../src/islandState.ts";
import { reduceInteraction } from "../src/islandInteraction.ts";
const now = 20_000;
const usage = (remainingPercent) => ({ fiveHour: { remainingPercent, resetsAt: null }, weekly: null, updatedAt: 0 });
const session = (id, activity = "thinking", attention = "none", agents = []) => ({ id, project: id, cwd: null, lifecycle: "active", activity, attention, currentCommand: null, startedAt: 1, lastActivityAt: now, model: null, currentTurnId: "t", agents });
const result = (kind = "completed", finishedAt = now) => ({ kind, sessionId: "s", turnId: "t", finishedAt });
const snapshot = (sessions = [], recentResults = [], updatedAt = 1) => ({ sessions, recentResults, updatedAt });
const derive = (sessions = [], results = [], quota = null, tokens = {}, at = now) => deriveIslandPresentation(snapshot(sessions, results), quota, tokens, at);
test("layout follows active sessions without frontend stale filtering", () => {
  assert.equal(derive().layout, "minimal");
  assert.equal(derive([session("s")]).layout, "single");
  assert.equal(derive([session("s"), session("b")]).layout, "multi");
  assert.equal(derive([session("s", "executing")], [], null, {}, now + 11 * 60_000).layout, "single");
});
test("permission retains layout and wins over quota", () => {
  const view = derive([session("s", "thinking", "permission"), session("b")], [], usage(0));
  assert.equal(view.layout, "multi");
  assert.equal(view.attention, "permission");
  assert.equal(view.compactLabel, "等待审批");
  assert.equal(derive([], [], usage(0)).attention, "quota");
});
test("completed feedback and token states", () => {
  const done = result(); const key = resultKey(done);
  assert.equal(derive([], [done], null, { [key]: { status: "loading" } }).compactLabel, "已完成");
  assert.equal(derive([], [done], null, { [key]: { status: "unavailable" } }).compactLabel, "已完成");
  const ready = { status: "ready", taskTokens: 12_600, sessionTokens: 20_000, readyAt: now };
  assert.equal(derive([], [done], null, { [key]: ready }).compactLabel, "完成 · 12.6k");
  assert.equal(derive([], [done], null, { [key]: ready }, now + 2_700).feedback, "completed");
  assert.equal(derive([], [done], null, {}, now + 3_001).layout, "minimal");
});
test("expanded result remains visible after the compact timeout and backend retention", () => {
  const done = result(); const key = resultKey(done);
  const ready = { status: "ready", taskTokens: 12_600, sessionTokens: 20_000, readyAt: now + 1_000 };
  const held = deriveIslandPresentation(snapshot(), null, { [key]: ready }, now + 20_000, done);
  assert.equal(held.compactLabel, "完成 · 12.6k");
  assert.equal(held.showTokenSummary, true);
  assert.equal(deriveIslandPresentation(snapshot(), null, { [key]: ready }, now + 20_000).layout, "minimal");
});
test("interruption and multi agent are distinct", () => {
  assert.equal(derive([], [result("interrupted")]).compactLabel, "已中断");
  const agents = ["a", "b"].map(id => ({ id, activity: "thinking", attention: "none", lastActivityAt: now }));
  assert.equal(derive([session("s", "thinking", "none", agents)]).orb.state, "weaving");
});
test("each activity maps to its action orb and copy", () => {
  const expected = { thinking: "solving", working: "working", searching: "searching", editing: "shaping", executing: "working", connecting: "connecting", compacting: "composing" };
  for (const [activity, orb] of Object.entries(expected)) {
    const view = derive([session("s", activity)]);
    assert.equal(view.orb.state, orb);
    assert.notEqual(view.compactLabel, "Codex");
  }
});
test("older snapshot cannot replace newer", () => {
  const old = snapshot([], [], 1); const current = snapshot([session("s")], [], 2);
  assert.equal(newerActivity(current, old), current);
});
test("interaction reducer handles normal and quick transitions", () => {
  let state = "compact";
  for (const [event, expected] of [["EXPAND", "expanding"], ["NATIVE_READY", "expanded"], ["COLLAPSE", "collapsing"], ["ANIMATION_END", "compact"]]) {
    state = reduceInteraction(state, event); assert.equal(state, expected);
  }
  state = reduceInteraction("expanding", "COLLAPSE");
  assert.equal(state, "collapsing");
  assert.equal(reduceInteraction(state, "EXPAND"), "expanding");
  assert.equal(reduceInteraction("expanded", "EXPAND"), "expanded");
  assert.equal(reduceInteraction("collapsing", "COLLAPSE_FAILED"), "expanded");
  assert.equal(reduceInteraction("expanding", "EXPAND_FAILED"), "compact");
});
