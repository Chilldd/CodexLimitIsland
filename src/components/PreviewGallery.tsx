import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEBUG_SCENARIOS,
  FIXED_DEBUG_NOW,
  README_TARGETS,
  createDebugScenario,
  type DebugScenarioName,
} from "../debugPresentation";
import type { PreviewMode } from "../hooks/useDebugPresentation";
import { ROOT_PADDING, compactSize, expandedHeight } from "../domain/metrics";
import type { SystemResourceSnapshot } from "../generated/contracts";
import { deriveIslandPresentation, type IslandPresentation } from "../islandState";
import { Island } from "./Island";
import "../App.css";

const noop = () => {};
const noopAsync = async () => {};

function freezePresentation(view: IslandPresentation, now: number): IslandPresentation {
  return {
    ...view,
    meta: view.meta
      ? {
          ...view.meta,
          ...(view.meta.elapsed
            ? { elapsed: { from: view.meta.elapsed.from, to: view.meta.elapsed.to ?? now } }
            : undefined),
        }
      : null,
    rows: view.rows.map((row) => ({
      ...row,
      elapsed: { from: row.elapsed.from, to: row.elapsed.to ?? now },
    })),
  };
}

function buildScenarioViews(name: DebugScenarioName, now = FIXED_DEBUG_NOW) {
  const scene = createDebugScenario(name, now);
  const compactView = freezePresentation(
    deriveIslandPresentation(scene.snapshot, scene.usage, scene.tokens, now, []),
    now,
  );
  const expandedView = freezePresentation(
    deriveIslandPresentation(scene.snapshot, scene.usage, scene.tokens, now, scene.snapshot.recentResults),
    now,
  );
  return {
    scene,
    compactView,
    expandedView,
  };
}

function PreviewIsland({
  view,
  expanded,
  systemSnapshot,
  cpuHistory,
}: {
  view: IslandPresentation;
  expanded: boolean;
  systemSnapshot: SystemResourceSnapshot;
  cpuHistory: number[];
}) {
  const fallbackCompact = compactSize(view.layout, view.compactTier);
  const [adaptiveWidth, setAdaptiveWidth] = useState<number | null>(null);
  const onMeasureCompactWidth = useCallback((target: number) => {
    setAdaptiveWidth((prev) => {
      if (prev === target || (prev != null && Math.abs(prev - target) <= 1)) {
        return prev;
      }
      return target;
    });
  }, []);

  const compactIslandWidth =
    view.layout === "minimal"
      ? fallbackCompact.width - ROOT_PADDING * 2
      : (adaptiveWidth ?? fallbackCompact.width - ROOT_PADDING * 2);
  const height = expandedHeight(view.rows.length);

  return (
    <Island
      view={view}
      detail={view}
      height={height}
      compactWidth={compactIslandWidth}
      onMeasureCompactWidth={onMeasureCompactWidth}
      expanded={expanded}
      systemSnapshot={systemSnapshot}
      cpuHistory={cpuHistory}
      orbTransitioning={false}
      reducedMotion={true}
      navigation={{
        openingSession: null,
        error: null,
        disabled: true,
        expanded,
        open: noopAsync,
      }}
      drag={{
        onPointerDown: noop,
        onPointerMove: noop,
        onPointerUp: noop,
        onPointerCancel: noop,
      }}
      enter={noop}
      leave={noop}
      toggle={noop}
      onTransitionEnd={noop}
    />
  );
}

export default function PreviewGallery({ initialMode }: { initialMode: PreviewMode }) {
  const [mode, setMode] = useState<PreviewMode>(initialMode);
  const isCapture = useMemo(() => new URLSearchParams(location.search).has("capture"), []);

  const matrixItems = useMemo(
    () =>
      DEBUG_SCENARIOS.map((name, index) => ({
        index: index + 1,
        name,
        ...buildScenarioViews(name, FIXED_DEBUG_NOW),
      })),
    [],
  );

  const readmeItems = useMemo(
    () =>
      README_TARGETS.map((target) => {
        const { scene, compactView, expandedView } = buildScenarioViews(target.scenario, FIXED_DEBUG_NOW);
        return {
          ...target,
          scene,
          view: target.expanded ? expandedView : compactView,
        };
      }),
    [],
  );

  useEffect(() => {
    document.documentElement.dataset.preview = mode;
    if (isCapture) {
      document.documentElement.dataset.capture = "true";
    }
    delete document.documentElement.dataset.captureReady;

    let raf1 = 0;
    let raf2 = 0;
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        document.documentElement.dataset.captureReady = "true";
      });
    });

    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      delete document.documentElement.dataset.preview;
      delete document.documentElement.dataset.capture;
      delete document.documentElement.dataset.captureReady;
    };
  }, [mode, isCapture]);

  function switchMode(next: PreviewMode) {
    const url = new URL(location.href);
    url.searchParams.set("preview", next);
    history.replaceState(null, "", url);
    setMode(next);
  }

  return (
    <div className={`preview-shell preview-mode-${mode}`}>
      {!isCapture && (
        <header className="preview-toolbar">
          <div className="preview-toolbar-title">
            <strong>Codex Limit Island · UI Preview</strong>
            <span>
              Fixed Scenarios ({DEBUG_SCENARIOS.length} Matrix / {README_TARGETS.length} README)
            </span>
          </div>
          <nav className="preview-toolbar-nav">
            <button type="button" data-active={mode === "matrix"} onClick={() => switchMode("matrix")}>
              All States Matrix ({DEBUG_SCENARIOS.length})
            </button>
            <button type="button" data-active={mode === "readme"} onClick={() => switchMode("readme")}>
              README Shots ({README_TARGETS.length})
            </button>
            <a href="?debugIsland">Interactive Debug</a>
          </nav>
        </header>
      )}

      {mode === "readme" ? (
        <section className="preview-readme-stage" data-readme-root>
          {readmeItems.map((item) => (
            <article key={item.id} className="preview-readme-card">
              {!isCapture && (
                <header className="preview-card-header">
                  <strong>{item.fileName}</strong>
                  <span>
                    {item.title} · {item.scenario}
                  </span>
                </header>
              )}
              <div className="preview-capture-target" data-readme-id={item.id}>
                <PreviewIsland
                  view={item.view}
                  expanded={item.expanded}
                  systemSnapshot={item.scene.systemSnapshot}
                  cpuHistory={item.scene.cpuHistory}
                />
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="preview-matrix-stage" data-matrix-root>
          <header className="preview-matrix-banner">
            <div>
              <h1>Codex Limit Island · All States Matrix</h1>
              <p>
                {DEBUG_SCENARIOS.length} standardized scenarios · Compact capsule &amp; Expanded panel side-by-side
                verification
              </p>
            </div>
            <span className="preview-matrix-badge">v0.2.0 · Deep Space Minimal</span>
          </header>
          <div className="preview-matrix-grid">
            {matrixItems.map(({ index, name, scene, compactView, expandedView }) => (
              <article key={name} className="preview-matrix-card" data-scenario={name}>
                <header className="preview-card-header">
                  <div className="preview-card-title">
                    <span className="preview-card-index">#{String(index).padStart(2, "0")}</span>
                    <strong>{name}</strong>
                  </div>
                  <div className="preview-card-tags">
                    <span>{compactView.layout}</span>
                    <span>tier:{compactView.compactTier}</span>
                    {compactView.attention !== "none" && <span data-tone="warn">{compactView.attention}</span>}
                    {compactView.feedback !== "none" && <span data-tone="ok">{compactView.feedback}</span>}
                  </div>
                </header>
                <div className="preview-compact-slot">
                  <span className="preview-slot-label">COMPACT</span>
                  <PreviewIsland
                    view={compactView}
                    expanded={false}
                    systemSnapshot={scene.systemSnapshot}
                    cpuHistory={scene.cpuHistory}
                  />
                </div>
                <div className="preview-expanded-slot">
                  <PreviewIsland
                    view={expandedView}
                    expanded={true}
                    systemSnapshot={scene.systemSnapshot}
                    cpuHistory={scene.cpuHistory}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
