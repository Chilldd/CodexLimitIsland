import { useEffect, useState } from "react";
import { WORK_IDLE_PROMPTS } from "../domain/idlePrompts";

export function IdlePromptTicker({ active = true }: { active?: boolean }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % WORK_IDLE_PROMPTS.length);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [active]);

  const prompt = WORK_IDLE_PROMPTS[index];

  return (
    <span key={index} className="idle-prompt-text" title={prompt}>
      {prompt}
    </span>
  );
}
