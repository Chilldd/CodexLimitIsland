import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type PointerEventHandler,
  type TransitionEventHandler,
} from "react";
import type { IslandPresentation } from "../islandState";
import type { SystemResourceSnapshot } from "../generated/contracts";
import { OrbStack } from "./OrbStack";
import { ExpandedContent } from "./ExpandedContent";
import type { NavigationView } from "./SessionRow";
type Props = {
  view: IslandPresentation;
  detail: IslandPresentation;
  navigation: NavigationView;
  expanded: boolean;
  systemSnapshot?: SystemResourceSnapshot | null;
  cpuHistory?: number[];
  height: number;
  compactWidth?: number;
  onMeasureCompactWidth?: (width: number) => void;
  orbTransitioning: boolean;
  reducedMotion: boolean;
  enter: () => void;
  leave: () => void;
  toggle: () => void;
  onTransitionEnd: TransitionEventHandler<HTMLElement>;
  drag: {
    onPointerDown: PointerEventHandler<HTMLElement>;
    onPointerMove: PointerEventHandler<HTMLElement>;
    onPointerUp: PointerEventHandler<HTMLElement>;
    onPointerCancel: PointerEventHandler<HTMLElement>;
  };
};
export function Island({
  view,
  detail,
  navigation,
  expanded,
  systemSnapshot,
  cpuHistory,
  height,
  compactWidth,
  onMeasureCompactWidth,
  orbTransitioning,
  reducedMotion,
  enter,
  leave,
  toggle,
  onTransitionEnd,
  drag,
}: Props) {
  const compactRef = useRef<HTMLDivElement>(null);
  const lastKey = useRef<string>("");

  useLayoutEffect(() => {
    if (view.layout === "minimal" || !onMeasureCompactWidth) return;
    const el = compactRef.current;
    if (!el) return;
    const currentKey = `${view.layout}:${view.compactLabel}:${view.compactUsage.label}:${view.compactUsage.percent}`;
    if (lastKey.current === currentKey) return;
    lastKey.current = currentKey;

    const rect = el.getBoundingClientRect();
    if (rect.width > 0) {
      // 左内边距 13px + Orb 20px + 间距 9px = 42px；右内边距对称留白 13px
      const target = Math.min(Math.max(Math.round(rect.width + 55), 126), 290);
      onMeasureCompactWidth(target);
    }
  }, [view.layout, view.compactLabel, view.compactUsage.label, view.compactUsage.percent, onMeasureCompactWidth]);

  return (
    <main
      className={`island layout-${view.layout} ${expanded ? "expanded" : ""}`}
      data-attention={view.attention}
      data-feedback={view.feedback}
      data-tier={view.compactTier}
      style={{
        ...(expanded ? { height } : undefined),
        ...(compactWidth && !expanded && view.layout !== "minimal"
          ? ({ "--adaptive-compact-width": `${compactWidth}px` } as CSSProperties)
          : undefined),
      }}
      tabIndex={0}
      onMouseEnter={enter}
      onMouseLeave={leave}
      {...drag}
      onTransitionEnd={onTransitionEnd}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggle();
      }}
      onClick={(event) => {
        if (!(event.target as Element).closest("button")) toggle();
      }}
      aria-label={view.ariaLabel}
    >
      <div className="island-content">
        <OrbStack orb={view.orb} expanded={expanded} transitioning={orbTransitioning} reducedMotion={reducedMotion} />
        <div className="minimal-copy" aria-hidden={expanded || view.layout !== "minimal"}>
          <span>{view.compactUsage.label}</span>
          <strong className={view.compactUsage.tone}>{view.compactUsage.percent}</strong>
        </div>
        <div ref={compactRef} className="compact-copy" aria-hidden={expanded || view.layout === "minimal"}>
          <span className="activity-label" key={view.compactLabel} title={view.compactLabel}>
            {view.compactLabel.includes(" · ") ? (
              <>
                <span className="activity-main">{view.compactLabel.split(" · ")[0]}</span>
                <small className="activity-sub">{view.compactLabel.split(" · ")[1]}</small>
              </>
            ) : (
              <span className="activity-main">{view.compactLabel}</span>
            )}
          </span>
          <span className="compact-divider" aria-hidden="true" />
          <span className="compact-limit">
            <span>{view.compactUsage.label}</span>
            <strong className={view.compactUsage.tone}>{view.compactUsage.percent}</strong>
          </span>
        </div>
        <ExpandedContent
          view={detail}
          navigation={navigation}
          expanded={expanded}
          systemSnapshot={systemSnapshot}
          cpuHistory={cpuHistory}
        />
      </div>
    </main>
  );
}
