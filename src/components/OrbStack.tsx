import { ThinkingOrb } from "thinking-orbs";
import type { IslandPresentation } from "../islandState";
export function OrbStack({
  orb,
  expanded,
  transitioning,
  reducedMotion,
}: {
  orb: IslandPresentation["orb"];
  expanded: boolean;
  transitioning: boolean;
  reducedMotion: boolean;
}) {
  return (
    <div className="orb-wrap">
      <ThinkingOrb
        className="orb-small"
        state={orb.state}
        size={20}
        theme="dark"
        speed={orb.speed}
        paused={reducedMotion || (expanded && !transitioning)}
        aria-hidden="true"
      />
      <ThinkingOrb
        className="orb-large"
        state={orb.state}
        size={64}
        theme="dark"
        speed={orb.speed}
        paused={reducedMotion || (!expanded && !transitioning)}
        aria-hidden="true"
      />
    </div>
  );
}
