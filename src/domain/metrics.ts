export const ROOT_PADDING = 2;
export const WINDOW_WIDTH = 390;
export const MINIMAL_WIDTH = 96;
export const COMPACT_RUN_WIDTH = 136;
export const COMPACT_WIDTH = 156;
export const COMPACT_MULTI_WIDTH = 172;
export const COMPACT_HEIGHT = 38;
export const EXPANDED_WIDTH = 380;
export const EXPANDED_MAX_HEIGHT = 440;
export const SESSION_ROW_HEIGHT = 50;
export const MAX_VISIBLE_PROJECTS = 3;
export const EXPANDED_HIT_WIDTH = EXPANDED_WIDTH + ROOT_PADDING * 2;
export const DEBUG_HEIGHT = 550;
export const MORPH_MS = 340;
export const AUTO_COLLAPSE_DELAY_MS = 420;
export const collapseRestoreDelay = (reducedMotion: boolean) => (reducedMotion ? 190 : MORPH_MS + 80);
// 英文紧凑态按字符数预留宽度；实际渲染后由测量值校准。
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
// 72px 项目区起点 + 184px 底部监控与额度区，列表最多展示三行。
export const expandedHeight = (rowCount: number) =>
  256 + Math.min(MAX_VISIBLE_PROJECTS, Math.max(1, rowCount)) * SESSION_ROW_HEIGHT;
