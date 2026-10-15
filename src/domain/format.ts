import type { LimitWindow } from "../islandState";

export function percent(value: LimitWindow | null): string {
  return value ? `${Math.round(value.remainingPercent)}%` : "--";
}
export function tone(value: LimitWindow | null): "neutral" | "critical" | "warning" | "healthy" {
  return !value
    ? "neutral"
    : value.remainingPercent <= 10
      ? "critical"
      : value.remainingPercent <= 30
        ? "warning"
        : "healthy";
}
export function resetText(value: LimitWindow | null): string {
  return value?.resetsAt
    ? new Date(value.resetsAt * 1000).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }) + " 重置"
    : "重置时间未知";
}
export function elapsed(startedAt: number | null, now: number): string {
  if (!startedAt) return "";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function exactTokens(value: number | null | undefined): string {
  return value == null ? "暂无数据" : `${value.toLocaleString("zh-CN")} tokens`;
}
