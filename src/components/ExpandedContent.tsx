import type { IslandPresentation } from "../islandState";
import type { SystemResourceSnapshot } from "../generated/contracts";
import { SessionRow, type NavigationView } from "./SessionRow";
import { UsagePanel } from "./UsagePanel";
import { Elapsed } from "./Elapsed";
import { IdlePromptTicker } from "./IdlePromptTicker";
import { SystemResourceRow } from "./SystemResourceRow";

export function ExpandedContent({
  view,
  navigation,
  expanded,
  systemSnapshot,
  cpuHistory,
}: {
  view: IslandPresentation;
  navigation: NavigationView;
  expanded: boolean;
  systemSnapshot?: SystemResourceSnapshot | null;
  cpuHistory?: number[];
}) {
  return (
    <div className="expanded-copy" aria-hidden={!expanded} inert={expanded ? undefined : true}>
      <div
        className="activity-head"
        data-activity={view.primarySession?.activity ?? undefined}
        data-attention={view.attention}
        data-feedback={view.feedback}
      >
        <span key={view.expandedTitle} title={view.expandedTitle}>
          {view.expandedTitle}
          <span className="text-shimmer" aria-hidden="true">
            {view.expandedTitle}
          </span>
        </span>
        <div className="meta">{view.meta?.elapsed && <Elapsed {...view.meta.elapsed} />}</div>
        <span className="island-chevron" aria-hidden="true" />
      </div>
      <div className="project-heading">
        <span>{view.activityHeading.title}</span>
        <span>{view.activityHeading.summary}</span>
      </div>
      <div className="session-list" role="region" aria-label="Project activity" tabIndex={expanded ? 0 : -1}>
        {view.rows.length ? (
          view.rows.map((row) => <SessionRow key={row.key} row={row} navigation={navigation} />)
        ) : (
          <div className="project-empty">
            <strong>Codex</strong>
            {view.isIdle ? <IdlePromptTicker active={expanded} /> : <span>{view.expandedSubtitle}</span>}
          </div>
        )}
      </div>
      {navigation.error && (
        <span className="navigation-error" role="alert" title={navigation.error}>
          {navigation.error}
        </span>
      )}
      <SystemResourceRow snapshot={systemSnapshot ?? null} cpuHistory={cpuHistory ?? []} />
      <div className="quota-heading">
        <span>Rate limits</span>
      </div>
      <UsagePanel rows={view.usageRows} />
    </div>
  );
}
