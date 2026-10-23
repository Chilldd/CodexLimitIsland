import { compactTokens, type SessionRowView } from "../islandState";
import { Elapsed } from "./Elapsed";
import { exactTokens } from "../domain/format";
export type NavigationView = {
  disabled: boolean;
  expanded: boolean;
  openingSession: string | null;
  error: string | null;
  open: (id: string) => Promise<void>;
};
export function SessionRow({ row, navigation }: { row: SessionRowView; navigation: NavigationView }) {
  return (
    <button
      type="button"
      className="session-row"
      disabled={navigation.disabled}
      tabIndex={navigation.expanded ? 0 : -1}
      title="Open this session in Codex"
      onClick={(event) => {
        event.stopPropagation();
        void navigation.open(row.sessionId);
      }}
    >
      <span className="session-text">
        <span className="session-primary">
          <span className="session-dot" data-attention={row.attention} data-feedback={row.feedback} />
          <span className="session-primary-left">
            <strong title={row.tooltip || row.title}>{row.title}</strong>
            <small title={row.subtitle}>{row.subtitle}</small>
          </span>
          {navigation.openingSession === row.sessionId ? <time>Opening...</time> : <Elapsed {...row.elapsed} />}
        </span>
        <span className="session-secondary">
          <span className="session-tokens">
            {row.token?.status === "ready" ? (
              <>
                <span title={`${row.tokenLabel ?? "Task"}: ${exactTokens(row.token.taskTokens)}`}>
                  {row.tokenLabel ?? "Task"}{" "}
                  <b>{row.token.taskTokens == null ? "—" : compactTokens(row.token.taskTokens)}</b>
                </span>
                <span title={`Session total: ${exactTokens(row.token.sessionTokens)} (as of last completion)`}>
                  Session <b>{row.token.sessionTokens == null ? "—" : compactTokens(row.token.sessionTokens)}</b>
                </span>
              </>
            ) : (
              <span>
                {row.token?.status === "loading"
                  ? "Loading tokens..."
                  : row.token?.status === "unavailable"
                    ? "Tokens unavailable"
                    : "Token —"}
              </span>
            )}
          </span>
          {row.model && (
            <span className="session-model" title={row.model}>
              {row.model}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
