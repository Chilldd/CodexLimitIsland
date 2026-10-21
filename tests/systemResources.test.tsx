import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { SystemResourceRow } from "../src/components/SystemResourceRow";
import type { SystemResourceSnapshot } from "../src/generated/contracts";

test("renders empty resource metrics gracefully", () => {
  const { container } = render(<SystemResourceRow snapshot={null} cpuHistory={[]} />);
  expect(screen.getByText("CPU")).toBeTruthy();
  expect(screen.getByText("RAM")).toBeTruthy();
  expect(screen.getAllByText("0%").length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText("0 MB").length).toBeGreaterThanOrEqual(1);
  const polyline = container.querySelector("polyline");
  expect(polyline).toBeTruthy();
  expect(screen.getByText("桌面端")).toBeTruthy();
  expect(screen.getByText("任务/CLI")).toBeTruthy();
});

test("renders aggregated metrics and toggles in-place detail view on hover and click", () => {
  const snapshot: SystemResourceSnapshot = {
    total: {
      cpu_percent: 24.5,
      memory_bytes: 800 * 1024 * 1024,
    },
    app: {
      cpu_percent: 4.5,
      memory_bytes: 600 * 1024 * 1024,
    },
    tasks: {
      cpu_percent: 20.0,
      memory_bytes: 200 * 1024 * 1024,
    },
    sample_time_ms: 1000,
  };

  const history = [5.0, 10.0, 18.0, 24.5];
  const { container } = render(<SystemResourceRow snapshot={snapshot} cpuHistory={history} />);

  expect(screen.getByText("25%")).toBeTruthy();
  expect(screen.getByText("800 MB")).toBeTruthy();
  expect(screen.getByText("(600 MB + 200 MB)")).toBeTruthy();

  const row = container.querySelector(".system-resource-row");
  expect(row).toBeTruthy();
  expect(row?.classList.contains("showing-detail")).toBe(false);

  // Hover 进入原位明细视图，绝不弹窗遮挡
  fireEvent.mouseEnter(row!);
  expect(row?.classList.contains("showing-detail")).toBe(true);
  expect(screen.getByText("4.5% · 600 MB")).toBeTruthy();
  expect(screen.getByText("20% · 200 MB")).toBeTruthy();

  fireEvent.mouseLeave(row!);
  expect(row?.classList.contains("showing-detail")).toBe(false);

  // 点击可锁定切换
  fireEvent.click(row!);
  expect(row?.classList.contains("showing-detail")).toBe(true);

  const polyline = container.querySelector("polyline");
  expect(polyline?.getAttribute("points")).toBeTruthy();
  expect(polyline?.getAttribute("points")?.split(" ").length).toBe(4);
});
