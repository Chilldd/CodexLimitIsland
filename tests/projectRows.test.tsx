import { render, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ExpandedContent } from "../src/components/ExpandedContent";
import { deriveIslandPresentation, resultKey, type TokenUsageState } from "../src/islandState";
import { expandedHeight } from "../src/domain/metrics";
import { active, done, snapshot } from "./fixtures";

const ready = (taskTokens: number, sessionTokens: number): TokenUsageState => ({
  status: "ready",
  taskTokens,
  sessionTokens,
  readyAt: 20_000,
});
const navigation = { disabled: false, expanded: true, openingSession: null, error: null, open: vi.fn(async () => {}) };

test("one and many sessions share project rows, with models and tokens bound by session and turn", () => {
  const first = { ...done(), sessionId: "one", turnId: "one-completed", project: "Same Project", model: "first-model" };
  const second = {
    ...done(),
    sessionId: "two",
    turnId: "two-completed",
    project: "Same Project",
    model: "second-model",
  };
  const older = { ...first, turnId: "old-turn", finishedAt: 19_000 };
  const tokens = {
    [resultKey(first)]: ready(12_000, 30_000),
    [resultKey(second)]: ready(7_000, 90_000),
    [resultKey(older)]: ready(999, 999),
  };
  const completed = deriveIslandPresentation(snapshot([], [older, first, second]), null, tokens, 20_000);
  expect(completed.rows).toHaveLength(2);
  const ui = render(<ExpandedContent view={completed} navigation={navigation} expanded />);
  const rows = ui.container.querySelectorAll(".session-row");
  expect(within(rows[0] as HTMLElement).getByText("first-model")).toBeTruthy();
  expect(rows[0].textContent).toContain("12k");
  expect(rows[0].textContent).toContain("30k");
  expect(rows[0].textContent).not.toContain("90k");
  expect(within(rows[1] as HTMLElement).getByText("second-model")).toBeTruthy();
  expect(rows[1].textContent).toContain("90k");
  const running = deriveIslandPresentation(
    snapshot([{ ...active(), id: "one", currentTurnId: "new-turn", model: "current-model" }], [first]),
    null,
    tokens,
    20_000,
  );
  expect(running.rows).toHaveLength(1);
  expect(running.rows[0]).toMatchObject({
    model: "current-model",
    tokenLabel: "Previous",
    token: ready(12_000, 30_000),
  });
  ui.rerender(<ExpandedContent view={running} navigation={navigation} expanded />);
  expect(ui.container.querySelectorAll(".session-row")).toHaveLength(1);
  expect(ui.container.querySelector(".session-model")?.textContent).toBe("current-model");
});

test("four or more projects remain in the scroll region while the native height stops at three rows", () => {
  const sessions = Array.from({ length: 5 }, (_, i) => ({
    ...active(),
    id: `session-${i}`,
    project: `Project ${i}`,
    model: i === 0 ? null : `model-${i}`,
  }));
  const view = deriveIslandPresentation(snapshot(sessions), null, {}, 20_000);
  const ui = render(<ExpandedContent view={view} navigation={navigation} expanded />);
  const region = ui.getByRole("region", { name: "Project activity" });
  expect(within(region).getAllByRole("button")).toHaveLength(5);
  expect(region.tabIndex).toBe(0);
  expect(expandedHeight(5)).toBe(expandedHeight(3));
  expect(ui.container.querySelector("select")).toBeNull();
  expect(ui.container.querySelectorAll(".session-model")).toHaveLength(4);
  expect(ui.container.querySelectorAll(".session-tokens")).toHaveLength(5);
});
