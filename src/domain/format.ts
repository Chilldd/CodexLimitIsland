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
export function resetSummary(value: LimitWindow | null, label: string, now: number): string {
  if (!value) return "随时可开始新对话";
  if (value.resetsAt != null) {
    const minutes = Math.ceil((value.resetsAt * 1000 - now) / 60_000);
    if (minutes <= 0) return `${label}即将重置`;
    if (minutes < 60) return `${label} ${minutes}m 后重置`;
    if (minutes < 24 * 60) {
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest > 0 ? `${label} ${hours}h ${rest}m 后重置` : `${label} ${hours}h 后重置`;
    }
    const days = Math.floor(minutes / (24 * 60));
    const hours = Math.floor((minutes % (24 * 60)) / 60);
    return hours > 0 ? `${label} ${days}d ${hours}h 后重置` : `${label} ${days}d 后重置`;
  }
  const remaining = Math.round(value.remainingPercent);
  if (remaining <= 0) return "请等待下个周期重置";
  if (remaining >= 100) return `${label}充足，随时可用`;
  return `${label}剩余 ${remaining}%`;
}
