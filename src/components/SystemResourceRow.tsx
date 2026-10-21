import { useState } from "react";
import type { SystemResourceSnapshot } from "../generated/contracts";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${Math.round(mb)} MB`;
}

function formatCpu(percent: number): string {
  if (percent <= 0) return "0%";
  if (percent < 0.1) return "<0.1%";
  if (percent < 10) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

function sparklinePoints(history: number[], width = 42, height = 12): string {
  if (history.length < 2) {
    return `0,${height / 2} ${width},${height / 2}`;
  }
  const max = Math.max(5, ...history);
  const step = width / (history.length - 1);
  return history
    .map((val, idx) => {
      const x = (idx * step).toFixed(1);
      const normalized = Math.min(1, Math.max(0, val / max));
      const y = (height - normalized * (height - 2) - 1).toFixed(1);
      return `${x},${y}`;
    })
    .join(" ");
}

export function SystemResourceRow({
  snapshot,
  cpuHistory,
}: {
  snapshot: SystemResourceSnapshot | null;
  cpuHistory: number[];
}) {
  const [hovered, setHovered] = useState(false);
  const [locked, setLocked] = useState(false);

  const total = snapshot?.total ?? { cpu_percent: 0, memory_bytes: 0 };
  const app = snapshot?.app ?? { cpu_percent: 0, memory_bytes: 0 };
  const tasks = snapshot?.tasks ?? { cpu_percent: 0, memory_bytes: 0 };

  const hasTasks = tasks.memory_bytes > 0 || tasks.cpu_percent > 0.05;
  const points = sparklinePoints(cpuHistory);

  const cpuColor =
    total.cpu_percent >= 60
      ? "var(--tone-critical-fg, #ef4444)"
      : total.cpu_percent >= 15
        ? "var(--tone-active-fg, #38bdf8)"
        : "rgba(226, 235, 235, 0.75)";

  const showDetail = hovered || locked;

  return (
    <div
      className={`system-resource-row ${showDetail ? "showing-detail" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => {
        e.stopPropagation();
        setLocked((prev) => !prev);
      }}
    >
      {/* 默认总览视态：CPU 走势图 + RAM 总和 */}
      <div className="sys-view-summary">
        <div className="sys-metrics-left">
          <span className="sys-badge">
            <span className="sys-label">CPU</span>
            <strong style={{ color: cpuColor }}>{formatCpu(total.cpu_percent)}</strong>
          </span>
          <svg className="sys-sparkline" width="42" height="12" viewBox="0 0 42 12" aria-hidden="true">
            <polyline
              fill="none"
              stroke={cpuColor}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={points}
            />
          </svg>
        </div>
        <div className="sys-metrics-right">
          <span className="sys-badge">
            <span className="sys-label">RAM</span>
            <strong>{formatBytes(total.memory_bytes)}</strong>
          </span>
          {hasTasks && (
            <span className="sys-sub-metrics">
              ({formatBytes(app.memory_bytes)} + {formatBytes(tasks.memory_bytes)})
            </span>
          )}
        </div>
      </div>

      {/* Hover / 点击原位切出的明细视态：彻底避免弹窗遮挡或被窗口边缘裁剪 */}
      <div className="sys-view-detail" aria-hidden={!showDetail}>
        <div className="sys-detail-col">
          <span className="sys-dot app-dot" />
          <span className="sys-col-name">桌面端</span>
          <span className="sys-col-val">
            {formatCpu(app.cpu_percent)} · {formatBytes(app.memory_bytes)}
          </span>
        </div>
        <div className="sys-detail-col">
          <span className={`sys-dot ${hasTasks ? "task-dot active" : "task-dot"}`} />
          <span className="sys-col-name">任务/CLI</span>
          <span className="sys-col-val">
            {formatCpu(tasks.cpu_percent)} · {formatBytes(tasks.memory_bytes)}
          </span>
        </div>
      </div>
    </div>
  );
}
