import test from "node:test";
import assert from "node:assert/strict";
import { deriveIslandPresentation, effectiveAttention, newerActivity, resultKey, sessionLabel } from "../src/islandState.ts";
import { reduceInteraction, shouldUseHeldResults } from "../src/islandInteraction.ts";
const now = 20_000;
const usage = (remainingPercent) => ({ fiveHour: { remainingPercent, resetsAt: null }, weekly: null, updatedAt: 0 });
const session = (id, activity = "thinking", attention = "none", agents = [], lastActivityAt = now) => ({ id, project: id, cwd: null, lifecycle: "active", activity, attention, currentCommand: null, startedAt: 1, lastActivityAt, model: null, currentTurnId: "t", agents });
const result = (kind = "completed", finishedAt = now, sessionId = "s") => ({ kind, sessionId, turnId: `${sessionId}-turn`, finishedAt, project: sessionId, model: "sol", startedAt: finishedAt - 900 });
const snapshot = (sessions = [], recentResults = [], updatedAt = 1) => ({ sessions, recentResults, updatedAt });
const derive = (sessions = [], results = [], quota = null, tokens = {}, at = now, held = []) => deriveIslandPresentation(snapshot(sessions, results), quota, tokens, at, held);
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
test("agent permission selects the correct session and row attention", () => {
  const agent = { id: "worker", activity: "working", attention: "permission", lastActivityAt: now };
  const waiting = session("WaitingProject", "executing", "none", [agent], now - 100);
  const view = derive([session("RecentProject"), waiting]);
  assert.equal(view.primarySession.id, "WaitingProject");
  assert.equal(view.attention, "permission");
  assert.equal(effectiveAttention(waiting), "permission");
  assert.equal(sessionLabel(waiting), "等待审批");
  assert.equal(view.sessions[0].id, "WaitingProject");
});
test("one active and one completed keep both rows and token", () => {
  const done = result();
  const ready = { status: "ready", taskTokens: 12_648, sessionTokens: 20_000, readyAt: now };
  const view = derive([session("active")], [done], null, { [resultKey(done)]: ready });
  assert.equal(view.layout, "multi");
  assert.equal(view.compactLabel, "1 运行 · 1 完成");
  assert.equal(view.rowCount, 2);
  assert.equal(view.visibleResults[0].label, "任务完成 · 12,648 tokens");
  assert.equal(view.visibleResults[0].token, ready);
});
test("multiple active and results have stable explicit order", () => {
  const old = result("completed", now - 100, "old");
  const recent = result("completed", now, "recent");
  const view = derive([session("b", "thinking", "none", [], now - 10), session("a", "editing")], [old, recent]);
  assert.equal(view.layout, "multi");
  assert.equal(view.rowCount, 4);
  assert.equal(view.compactLabel, "2 运行 · 2 完成");
  assert.deepEqual(view.sessions.map(item => item.id), ["a", "b"]);
  assert.deepEqual(view.visibleResults.map(item => item.result.sessionId), ["recent", "old"]);
});
test("two completed results and active interrupted result stay visible", () => {
  const a = result("completed", now, "a"); const b = result("completed", now - 50, "b");
  assert.equal(derive([], [a, b]).visibleResults.length, 2);
  const interrupted = result("interrupted");
  const view = derive([session("active")], [interrupted]);
  assert.equal(view.visibleResults[0].label, "任务已中断");
  assert.equal(view.rowCount, 2);
});
test("completed context and token loading states", () => {
  const done = result(); const key = resultKey(done);
  const loading = derive([], [done], null, { [key]: { status: "loading" } });
  assert.equal(loading.compactLabel, "已完成");
  assert.equal(loading.primaryResult.result.project, "s");
  assert.equal(loading.primaryResult.result.model, "sol");
  assert.equal(loading.primaryResult.result.startedAt, now - 900);
  assert.equal(derive([], [done], null, { [key]: { status: "unavailable" } }).compactLabel, "已完成");
  const ready = { status: "ready", taskTokens: 12_600, sessionTokens: 20_000, readyAt: now };
  assert.equal(derive([], [done], null, { [key]: ready }).compactLabel, "完成 · 12.6k");
  assert.equal(derive([], [done], null, { [key]: ready }).showTokenSummary, true);
});
test("normal and token ready result expiry use one-shot deadlines", () => {
  const done = result(); const key = resultKey(done);
  assert.equal(derive([], [done]).nextUpdateAt, now + 3_000);
  assert.equal(derive([], [done], null, {}, now + 3_000).layout, "minimal");
  const ready = { status: "ready", taskTokens: 12_600, sessionTokens: 20_000, readyAt: now + 500 };
  assert.equal(derive([], [done], null, { [key]: ready }).nextUpdateAt, now + 3_300);
  assert.equal(derive([], [done], null, { [key]: ready }, now + 3_299).layout, "single");
  assert.equal(derive([], [done], null, { [key]: ready }, now + 3_300).layout, "minimal");
});
test("expanded results survive backend retention and compact timeout", () => {
  const a = result(); const b = result("interrupted", now - 50, "b");
  const view = derive([], [], null, {}, now + 20_000, [a, b]);
  assert.equal(view.visibleResults.length, 2);
  assert.equal(view.nextUpdateAt, null);
  assert.equal(derive([], [], null, {}, now + 20_000).layout, "minimal");
});
test("held results affect expanded shape but not collapsing target", () => {
  assert.deepEqual(["compact", "expanding", "expanded", "collapsing"].map(shouldUseHeldResults), [false, true, true, false]);
  const done = result("completed", now - 20_000);
  const expired = snapshot([], [done]);
  const retained = [done];
  const viewFor = (state, at) => deriveIslandPresentation(expired, null, {}, at, shouldUseHeldResults(state) ? retained : []);
  assert.equal(viewFor("expanded", now).layout, "single");
  assert.equal(viewFor("collapsing", now).layout, "minimal");
  assert.equal(deriveIslandPresentation(expired, null, {}, now, retained).primaryResult.result, done);
  const fresh = result("completed", now - 1_000);
  assert.equal(deriveIslandPresentation(snapshot([], [fresh]), null, {}, now, shouldUseHeldResults("collapsing") ? [fresh] : []).layout, "single");
});
test("multi agent orb and activity orb mapping", () => {
  const agents = ["a", "b"].map(id => ({ id, activity: "thinking", attention: "none", lastActivityAt: now }));
  assert.equal(derive([session("s", "thinking", "none", agents)]).orb.state, "weaving");
  const expected = { thinking: "solving", working: "working", searching: "searching", editing: "shaping", executing: "working", connecting: "connecting", compacting: "composing" };
  for (const [activity, orb] of Object.entries(expected)) assert.equal(derive([session("s", activity)]).orb.state, orb);
});
test("older snapshot cannot replace newer", () => {
  const old = snapshot([], [], 1); const current = snapshot([session("s")], [], 2);
  assert.equal(newerActivity(current, old), current);
});
test("interaction reducer handles normal, quick and failed transitions", () => {
  let state = "compact";
  for (const [event, expected] of [["EXPAND", "expanding"], ["NATIVE_READY", "expanded"], ["COLLAPSE", "collapsing"], ["ANIMATION_END", "compact"]]) {
    state = reduceInteraction(state, event); assert.equal(state, expected);
  }
  assert.equal(reduceInteraction("expanding", "COLLAPSE"), "collapsing");
  assert.equal(reduceInteraction("collapsing", "EXPAND"), "expanding");
  assert.equal(reduceInteraction("collapsing", "COLLAPSE_FAILED"), "expanded");
  assert.equal(reduceInteraction("expanding", "EXPAND_FAILED"), "compact");
});
