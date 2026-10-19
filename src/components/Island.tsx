import type { PointerEventHandler, TransitionEventHandler } from "react";
import type { IslandPresentation } from "../islandState";
import { OrbStack } from "./OrbStack";
import { ExpandedContent } from "./ExpandedContent";
import type { NavigationView } from "./SessionRow";
type Props = {
  view: IslandPresentation;
  detail: IslandPresentation;
  navigation: NavigationView;
  expanded: boolean;
  height: number;
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
  height,
  orbTransitioning,
  reducedMotion,
  enter,
  leave,
  toggle,
  onTransitionEnd,
  drag,
}: Props) {
  return (
    <main
      className={`island layout-${view.layout} ${expanded ? "expanded" : ""}`}
      data-attention={view.attention}
      data-feedback={view.feedback}
      style={expanded ? { height } : undefined}
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
        <div className="compact-copy" aria-hidden={expanded || view.layout === "minimal"}>
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
          <span className="compact-limit">
            <span>{view.compactUsage.label}</span>
            <strong className={view.compactUsage.tone}>{view.compactUsage.percent}</strong>
          </span>
        </div>
        <ExpandedContent view={detail} navigation={navigation} expanded={expanded} />
      </div>
    </main>
  );
}
