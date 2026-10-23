export const WORK_IDLE_PROMPTS = [
  "Ready for your next task.",
  "A quiet moment between ideas.",
  "Your next idea starts here.",
  "Standing by for a new session.",
  "A fresh perspective is one prompt away.",
  "Take a breath. Then build something.",
  "A little space for your next idea.",
  "The next chapter is yours.",
  "One prompt. New possibilities.",
  "Good work starts with a clear thought.",
  "Room for one more good idea.",
  "Whenever you are ready.",
  "Your workspace, at rest.",
  "A new task is just a thought away.",
  "Time for a fresh start.",
  "A quiet workspace for your next move.",
  "Small steps make good progress.",
  "Ready when inspiration strikes.",
  "What would you like to make next?",
  "A moment to think, a chance to create.",
  "Your next question is welcome.",
  "Keep a little room for curiosity.",
  "The next step can be a simple one.",
  "Pick up where your ideas left off.",
] as const;

export function getIdlePrompt(now = 0): string {
  const slot = Math.floor(now / (5 * 60 * 1000));
  return WORK_IDLE_PROMPTS[Math.abs(slot) % WORK_IDLE_PROMPTS.length];
}
