import test from "node:test";
import assert from "node:assert/strict";
import { newerActivity, selectIsland } from "../src/islandState.ts";

const now = 1_000_000;
const session = (state, id = state, extra = {}) => ({
  id, project: id, cwd: null, state, currentCommand: null, startedAt: now - 1_000,
  lastActivityAt: now, completedAt: state === "completed" ? now : null,
  model: null, agents: [], ...extra,
});
const view = (sessions, usage = null, at = now) => selectIsland(sessions, usage, at);

test("异步旧快照不能覆盖更新的 Hook 快照", () => {
  const old = { sessions: [session("thinking")], updatedAt: 10 };
  const recent = { sessions: [session("editing")], updatedAt: 11 };
  assert.equal(newerActivity(old, recent), recent);
  assert.equal(newerActivity(recent, old), recent);
});

test("空会话与单会话状态", () => {
  assert.deepEqual({ mode: view([]).mode, active: view([]).activeCount, orb: view([]).orb },
    { mode: "minimal", active: 0, orb: { state: "breathing", speed: .65 } });
  for (const [state, label, orb] of [
    ["thinking", "Thinking…", "solving"], ["editing", "Editing files…", "shaping"],
    ["completed", "Completed", "breathing"],
  ]) {
    const result = view([session(state)]);
    assert.equal(result.mode, "single-session");
    assert.equal(result.label, label);
    assert.equal(result.primary.id, state);
    assert.equal(result.sessions.length, 1);
    assert.equal(result.orb.state, orb);
  }
  const waiting = view([session("waiting")]);
  assert.equal(waiting.mode, "attention");
  assert.equal(waiting.waitingCount, 1);
  assert.deepEqual(waiting.orb, { state: "listening", speed: .75 });
});

test("并行会话及等待状态独立计数", () => {
  const two = view([session("thinking", "a"), session("editing", "b")]);
  assert.equal(two.mode, "multi-session");
  assert.equal(two.activeCount, 2);
  assert.equal(two.sessions.length, 2);
  assert.deepEqual(two.orb, { state: "weaving", speed: 1 });
  const three = view([session("thinking", "a"), session("editing", "b"), session("searching", "c")]);
  assert.equal(three.activeCount, 3);
  assert.equal(three.label, "3 sessions working");
  const mixed = view([session("thinking", "a"), session("waiting", "b")]);
  assert.equal(mixed.mode, "attention");
  assert.equal(mixed.activeCount, 1);
  assert.equal(mixed.waitingCount, 1);
  assert.equal(mixed.primary.id, "b");
});

test("额度耗尽、完成态超时和陈旧会话", () => {
  const quota = { fiveHour: { remainingPercent: 0, resetsAt: null }, weekly: null, updatedAt: 1 };
  const limited = view([session("working")], quota);
  assert.equal(limited.mode, "attention");
  assert.equal(limited.label, "5H limit reached");
  assert.deepEqual(limited.orb, { state: "breathing", speed: .5 });
  assert.equal(view([session("completed")], null, now + 3001).mode, "minimal");
  assert.equal(view([session("thinking", "old", { lastActivityAt: now - 600_001 })]).sessions.length, 0);
  assert.equal(view([session("waiting", "old", { lastActivityAt: now - 600_001 })]).waitingCount, 1);
});

test("多个 Subagent 使用准确数量和 Orb", () => {
  const agents = ["a", "b"].map(id => ({ id, state: "thinking", lastActivityAt: now }));
  const result = view([session("working", "main", { agents })]);
  assert.equal(result.label, "Working · 2 subagents");
  assert.deepEqual(result.orb, { state: "weaving", speed: 1 });
});
