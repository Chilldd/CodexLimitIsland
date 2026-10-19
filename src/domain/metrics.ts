export const ROOT_PADDING = 2;
export const WINDOW_WIDTH = 390;
export const MINIMAL_WIDTH = 96;
export const COMPACT_RUN_WIDTH = 136;
export const COMPACT_WIDTH = 156;
export const COMPACT_MULTI_WIDTH = 172;
export const EXPANDED_WIDTH = 380;
export const EXPANDED_MAX_HEIGHT = 420;
export const EXPANDED_HIT_WIDTH = EXPANDED_WIDTH + ROOT_PADDING * 2;
export const DEBUG_HEIGHT = 550;
export const MORPH_MS = 340;
export const AUTO_COLLAPSE_DELAY_MS = 420;
export const collapseRestoreDelay = (reducedMotion: boolean) => (reducedMotion ? 190 : MORPH_MS + 80);
// 紧凑态宽度档位：run 给 3 字运行文案，result 给「完成 + token」与 4～5 字文案，multi 给「N 运行 · M 完成」。
export type CompactTier = "run" | "result" | "multi";
export const COMPACT_TIER_WIDTHS: Record<CompactTier, number> = {
  run: COMPACT_RUN_WIDTH,
  result: COMPACT_WIDTH,
  multi: COMPACT_MULTI_WIDTH,
};
export const compactSize = (layout: "minimal" | "single" | "multi", tier: CompactTier = "result") => ({
  width: (layout === "minimal" ? MINIMAL_WIDTH : COMPACT_TIER_WIDTHS[tier]) + ROOT_PADDING * 2,
  height: (layout === "minimal" ? 36 : 38) + ROOT_PADDING * 2,
});
export const expandedHeight = (rowCount: number, showTokenSummary: boolean) =>
  Math.min(EXPANDED_MAX_HEIGHT, rowCount > 1 ? 164 + rowCount * 48 : showTokenSummary ? 204 : 154);
