import type { UsageRowView } from "../islandState";
import { selectLimitWindow } from "../hooks/useLimitWindow";

export function UsagePanel({ rows }: { rows: UsageRowView[] }) {
  return (
    <div className="usage-rows">
      {rows.map((row) => (
        <div
          className="usage-row"
          key={row.label}
          data-selected={row.selected}
          title="点击设为紧凑态显示的额度窗口"
          onClick={(event) => {
            event.stopPropagation();
            void selectLimitWindow(row.window);
          }}
        >
          <span className="usage-label">{row.label}</span>
          <div className="usage-track">
            <div className={`usage-fill ${row.tone}`} style={{ width: row.width }} />
          </div>
          <strong className={`usage-value ${row.tone}`}>{row.percent}</strong>
          <span className="usage-reset">{row.reset}</span>
        </div>
      ))}
    </div>
  );
}
