import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ExpandedContent } from "../src/components/ExpandedContent";
import { deriveIslandPresentation } from "../src/islandState";
import { active, done, snapshot } from "./fixtures";

test("multiple tasks render their own Hook models, including completed results", () => {
  vi.useFakeTimers();
  vi.setSystemTime(20_000);
  const view = deriveIslandPresentation(
    snapshot(
      [
        { ...active(), id: "one", project: "Project One", model: "gpt-6-sol" },
        { ...active(), id: "two", project: "Project Two", model: "gpt-6.1-sol" },
        { ...active(), id: "unknown", project: "Unknown Model", model: null },
      ],
      [{ ...done(), project: "Finished Project", model: "gpt-6-astra" }],
    ),
    null,
    {},
    20_000,
  );
  render(
    <ExpandedContent
      view={view}
      expanded
      navigation={{ disabled: false, expanded: true, openingSession: null, error: null, open: vi.fn() }}
    />,
  );
  for (const [project, model] of [
    ["Project One", "gpt-6-sol"],
    ["Project Two", "gpt-6.1-sol"],
    ["Finished Project", "gpt-6-astra"],
  ]) {
    const row = screen.getByRole("button", { name: new RegExp(project) });
    expect(within(row).getByText(model).getAttribute("title")).toBe(model);
  }
  const unknown = screen.getByRole("button", { name: /Unknown Model/ });
  expect(unknown.querySelector(".session-model")).toBeNull();
  expect(within(unknown).getByText("正在思考…")).toBeTruthy();
});

test("models stay attached to the selected task across single and multi layouts", () => {
  const session = { ...active(), model: "gpt-6-sol" };
  const result = { ...done(), model: "gpt-6-astra" };
  const single = deriveIslandPresentation(snapshot([session]), null, {}, 20_000);
  expect(single.meta?.label).toBe("gpt-6-sol");
  expect(single.rows[0]).toMatchObject({ model: "gpt-6-sol" });
  const multi = deriveIslandPresentation(snapshot([session], [result]), null, {}, 20_000);
  expect(multi.meta).toBeNull();
  expect(multi.rows).toMatchObject([{ model: "gpt-6-sol" }, { model: "gpt-6-astra" }]);
  const completed = deriveIslandPresentation(snapshot([], [result]), null, {}, 20_000);
  expect(completed.meta?.label).toBe("gpt-6-astra");
  expect(completed.rows[0]).toMatchObject({ model: "gpt-6-astra" });
});
