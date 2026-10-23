import type { SystemResourceSnapshot } from "../generated/contracts";
import { GlassContainer } from "./GlassContainer";

function ResourceIcon({ kind }: { kind: "cpu" | "ram" | "desktop" | "tasks" }) {
  return (
    <svg
      className={`sys-icon sys-icon-${kind}`}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "cpu" && (
        <>
          <rect x="4" y="4" width="8" height="8" rx="1.5" />
          <path d="M6 2v2m4-2v2M6 12v2m4-2v2M2 6h2m-2 4h2m8-4h2m-2 4h2" />
          <path d="M6.5 6.5h3v3h-3z" />
        </>
      )}
      {kind === "ram" && (
        <>
          <rect x="2" y="4" width="12" height="7" rx="1.4" />
          <path d="M5 6.5v2m3-2v2m3-2v2M4 11v2m3-2v2m3-2v2m3-2v2" />
        </>
      )}
      {kind === "desktop" && (
        <>
          <rect x="2" y="2.5" width="12" height="8" rx="1.4" />
          <path d="M8 10.5v3m-3 0h6" />
        </>
      )}
      {kind === "tasks" && (
        <>
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.8" />
          <path d="m4 6 2 2-2 2m4 0h3" />
        </>
      )}
    </svg>
  );
}

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
  const total = snapshot?.total ?? { cpu_percent: 0, memory_bytes: 0 };
  const app = snapshot?.app ?? { cpu_percent: 0, memory_bytes: 0 };
  const tasks = snapshot?.tasks ?? { cpu_percent: 0, memory_bytes: 0 };

  const points = sparklinePoints(cpuHistory);

  const cpuColor =
    total.cpu_percent >= 60
      ? "var(--tone-critical-fg, #ef4444)"
      : total.cpu_percent >= 15
        ? "var(--tone-active-fg, #38bdf8)"
        : "var(--monitor-value)";

  return (
    <GlassContainer className="system-resource-row" elevation="card" interactive={false}>
      <div className="sys-view-summary" title="Codex total: Desktop + Tasks/CLI">
        <div className="sys-metrics-left">
          <ResourceIcon kind="cpu" />
          <span className="sys-label">CPU</span>
          <strong className="sys-value" title={formatCpu(total.cpu_percent)}>
            {formatCpu(total.cpu_percent)}
          </strong>
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
          <ResourceIcon kind="ram" />
          <span className="sys-label">RAM</span>
          <strong className="sys-value" title={formatBytes(total.memory_bytes)}>
            {formatBytes(total.memory_bytes)}
          </strong>
        </div>
      </div>

      <div className="sys-view-detail">
        <div className="sys-detail-col">
          <ResourceIcon kind="desktop" />
          <span className="sys-col-name">Desktop</span>
          <span className="sys-col-val" title={`${formatCpu(app.cpu_percent)} · ${formatBytes(app.memory_bytes)}`}>
            <span className="sys-detail-cpu">{formatCpu(app.cpu_percent)}</span>
            <span className="sys-separator" aria-hidden="true">
              ·
            </span>
            <span className="sys-detail-memory">{formatBytes(app.memory_bytes)}</span>
          </span>
        </div>
        <div className="sys-detail-col">
          <ResourceIcon kind="tasks" />
          <span className="sys-col-name">Tasks/CLI</span>
          <span className="sys-col-val" title={`${formatCpu(tasks.cpu_percent)} · ${formatBytes(tasks.memory_bytes)}`}>
            <span className="sys-detail-cpu">{formatCpu(tasks.cpu_percent)}</span>
            <span className="sys-separator" aria-hidden="true">
              ·
            </span>
            <span className="sys-detail-memory">{formatBytes(tasks.memory_bytes)}</span>
          </span>
        </div>
      </div>
    </GlassContainer>
  );
}
