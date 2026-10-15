import type { PointerEventHandler, TransitionEventHandler } from "react";
import type { IslandPresentation } from "../islandState";
import { OrbStack } from "./OrbStack";
import { ExpandedContent } from "./ExpandedContent";
import { Elapsed } from "./Elapsed";
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
      onMouseEnter={enter}
      onMouseLeave={leave}
      {...drag}
      onTransitionEnd={onTransitionEnd}
      onClick={(event) => {
        if (!(event.target as Element).closest("button")) toggle();
      }}
      aria-label={view.ariaLabel}
    >
      <div className="island-content">
        <OrbStack orb={view.orb} expanded={expanded} transitioning={orbTransitioning} reducedMotion={reducedMotion} />
        <div className="minimal-copy">
          <span>{view.compactUsage.label}</span>
          <strong className={view.compactUsage.tone}>{view.compactUsage.percent}</strong>
        </div>
        <div className="compact-copy">
          <span className="activity-label" key={view.compactLabel} title={view.compactLabel}>
            {view.compactLabel}
          </span>
          {view.compactElapsed && <Elapsed {...view.compactElapsed} />}
          <span className="compact-limit">
            <span>{view.compactUsage.label}</span>
            <strong className={view.compactUsage.tone}>{view.compactUsage.percent}</strong>
          </span>
        </div>
        <ExpandedContent view={detail} navigation={navigation} />
      </div>
    </main>
  );
}
