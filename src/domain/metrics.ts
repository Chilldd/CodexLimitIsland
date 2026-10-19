export const ROOT_PADDING = 2;
export const WINDOW_WIDTH = 390;
export const MINIMAL_WIDTH = 96;
export const COMPACT_WIDTH = 164;
export const EXPANDED_WIDTH = 380;
export const EXPANDED_MAX_HEIGHT = 420;
export const EXPANDED_HIT_WIDTH = EXPANDED_WIDTH + ROOT_PADDING * 2;
export const DEBUG_HEIGHT = 550;
export const MORPH_MS = 340;
export const AUTO_COLLAPSE_DELAY_MS = 420;
export const collapseRestoreDelay = (reducedMotion: boolean) => (reducedMotion ? 190 : MORPH_MS + 80);
export const compactSize = (layout: "minimal" | "single" | "multi") => ({
  width: (layout === "minimal" ? MINIMAL_WIDTH : COMPACT_WIDTH) + ROOT_PADDING * 2,
  height: (layout === "minimal" ? 36 : 38) + ROOT_PADDING * 2,
});
export const expandedHeight = (rowCount: number, showTokenSummary: boolean) =>
  Math.min(EXPANDED_MAX_HEIGHT, rowCount > 1 ? 164 + rowCount * 48 : showTokenSummary ? 204 : 154);
