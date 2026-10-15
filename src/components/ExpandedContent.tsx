import type { IslandPresentation } from "../islandState";
import { exactTokens } from "../domain/format";
import { SessionRow, type NavigationView } from "./SessionRow";
import { UsagePanel } from "./UsagePanel";
import { Elapsed } from "./Elapsed";
export function ExpandedContent({ view, navigation }: { view: IslandPresentation; navigation: NavigationView }) {
  const { headline, meta } = view;
  return (
    <div className="expanded-copy">
      <div className="activity-head">
        <span key={view.expandedTitle} title={view.expandedTitle}>
          {view.expandedTitle}
        </span>
        {view.layout !== "multi" && (
          <>
            {headline.sessionId ? (
              <button
                type="button"
                className="session-link"
                disabled={navigation.disabled}
                tabIndex={navigation.expanded ? 0 : -1}
                title="在 Codex App 中打开此对话"
                onClick={(event) => {
                  event.stopPropagation();
                  void navigation.open(headline.sessionId!);
                }}
              >
                <strong>{headline.title}</strong>
                <span aria-hidden="true">↗</span>
              </button>
            ) : (
              <strong>Codex</strong>
            )}
            <small>
              {navigation.openingSession === headline.sessionId ? "正在打开 Codex App…" : headline.subtitle}
            </small>
          </>
        )}
        <div className="meta">
          {navigation.error ? (
            <span className="navigation-error" role="alert" title={navigation.error}>
              {navigation.error}
            </span>
          ) : (
            meta && (
              <>
                <span>{meta.label}</span>
                {meta.elapsed ? <Elapsed {...meta.elapsed} /> : <time>{meta.time}</time>}
              </>
            )
          )}
        </div>
      </div>
      {view.showTokenSummary && view.token?.status === "ready" && (
        <div className="token-summary">
          <div>
            <span>本次任务</span>
            <strong>{exactTokens(view.token.taskTokens)}</strong>
          </div>
          <div>
            <span>当前会话</span>
            <strong>{exactTokens(view.token.sessionTokens)}</strong>
          </div>
        </div>
      )}
      {view.rowCount > 1 && (
        <div className="session-list">
          {view.rows.map((row) => (
            <SessionRow key={row.key} row={row} navigation={navigation} />
          ))}
        </div>
      )}
      <UsagePanel rows={view.usageRows} />
    </div>
  );
}
