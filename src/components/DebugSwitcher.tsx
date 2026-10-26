import type { DebugScenarioName } from "../debugPresentation";
export function DebugSwitcher({
  names,
  select,
}: {
  names: readonly DebugScenarioName[];
  select: (name: DebugScenarioName | null) => void;
}) {
  return (
    <aside className="debug-switcher">
      <button onClick={() => select(null)}>Live</button>
      <button onClick={() => location.assign("?preview=matrix")}>Matrix</button>
      {names.map((name) => (
        <button key={name} onClick={() => select(name)}>
          {name}
        </button>
      ))}
    </aside>
  );
}
