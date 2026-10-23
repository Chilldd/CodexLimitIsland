import type { LimitWindow } from "../islandState";

export function percent(value: LimitWindow | null): string {
  return value ? `${Math.round(value.remainingPercent)}%` : "—";
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
    ? "Resets " +
        new Date(value.resetsAt * 1000).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
    : "Reset time unavailable";
}
export function elapsed(startedAt: number | null, now: number): string {
  if (!startedAt) return "";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function exactTokens(value: number | null | undefined): string {
  return value == null ? "Not available" : `${value.toLocaleString("en-US")} tokens`;
}
export function resetSummary(value: LimitWindow | null, label: string, now: number): string {
  if (!value) return "Ready for a new session";
  if (value.resetsAt != null) {
    const minutes = Math.ceil((value.resetsAt * 1000 - now) / 60_000);
    if (minutes <= 0) return `${label} resets soon`;
    if (minutes < 60) return `${label} resets in ${minutes}m`;
    if (minutes < 24 * 60) {
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest > 0 ? `${label} resets in ${hours}h ${rest}m` : `${label} resets in ${hours}h`;
    }
    const days = Math.floor(minutes / (24 * 60));
    const hours = Math.floor((minutes % (24 * 60)) / 60);
    return hours > 0 ? `${label} resets in ${days}d ${hours}h` : `${label} resets in ${days}d`;
  }
  const remaining = Math.round(value.remainingPercent);
  if (remaining <= 0) return "Waiting for the next reset";
  if (remaining >= 100) return `${label} fully available`;
  return `${label}: ${remaining}% remaining`;
}
