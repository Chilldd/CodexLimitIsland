import type { UsageRowView } from "../islandState";
import { selectLimitWindow } from "../hooks/useLimitWindow";
import { GlassContainer } from "./GlassContainer";

export function UsagePanel({ rows }: { rows: UsageRowView[] }) {
  return (
    <div className="usage-rows">
      {rows.map((row) => (
        <GlassContainer
          as="button"
          type="button"
          className="usage-row"
          elevation="card"
          key={row.label}
          data-selected={row.selected}
          aria-pressed={row.selected}
          aria-label={`${row.label}: ${row.percent} remaining`}
          title={`${row.label}: ${row.percent} remaining. Show this limit in the compact island`}
          onClick={(event) => {
            event.stopPropagation();
            void selectLimitWindow(row.window);
          }}
        >
          <span className="usage-label">
            {row.label}
            <span className="usage-selection" aria-hidden="true">
              <svg
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m2.2 6 2.4 2.4 5.2-5.1" />
              </svg>
            </span>
          </span>
          <div className="usage-track">
            <div className={`usage-fill ${row.tone}`} style={{ width: row.width }} />
          </div>
          <strong className={`usage-value ${row.tone}`}>
            {row.percent.endsWith("%") ? (
              <>
                {row.percent.slice(0, -1)}
                <span className="usage-unit">%</span>
              </>
            ) : (
              row.percent
            )}
          </strong>
          <span className="usage-reset">{row.reset}</span>
        </GlassContainer>
      ))}
    </div>
  );
}
