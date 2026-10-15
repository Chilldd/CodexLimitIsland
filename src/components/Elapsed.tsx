import { useEffect, useState } from "react";
import { elapsed } from "../domain/format";
import type { ElapsedView } from "../islandState";
export function Elapsed({ from, to }: ElapsedView) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!from || to != null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [from, to]);
  return <time>{elapsed(from, to ?? now)}</time>;
}
