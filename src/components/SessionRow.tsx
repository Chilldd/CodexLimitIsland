import type { SessionRowView } from "../islandState";
import { Elapsed } from "./Elapsed";
import { JumpIcon } from "./JumpIcon";
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
      title="在 Codex App 中打开此对话"
      onClick={(event) => {
        event.stopPropagation();
        void navigation.open(row.sessionId);
      }}
    >
      <span className="session-dot" data-attention={row.attention} data-feedback={row.feedback} />
      <span className="session-text">
        <strong title={row.tooltip}>{row.title}</strong>
        <small>{row.subtitle}</small>
      </span>
      <span className="session-meta">
        {row.model && (
          <span className="session-model" title={row.model}>
            {row.model}
          </span>
        )}
        {navigation.openingSession === row.sessionId ? <time>打开中…</time> : <Elapsed {...row.elapsed} />}
      </span>
      <span className="session-open-icon" aria-hidden="true">
        <JumpIcon />
      </span>
    </button>
  );
}
