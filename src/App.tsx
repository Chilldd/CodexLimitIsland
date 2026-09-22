import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { ThinkingOrb } from "thinking-orbs";
import { newerActivity, selectIsland, sessionLabel, type Activity, type ActivitySnapshot, type LimitWindow, type Session, type UsageSnapshot } from "./islandState";
import "./App.css";

const appWindow = getCurrentWindow();
const debugEnabled = import.meta.env.DEV && new URLSearchParams(location.search).has("debugIsland");
function setHitRegion(width: number, height: number) { return invoke<void>("set_window_hit_region", { width, height }); }
function percent(value: LimitWindow | null) { return value ? `${Math.round(value.remainingPercent)}%` : "--"; }
function tone(value: LimitWindow | null) { return !value ? "neutral" : value.remainingPercent <= 10 ? "critical" : value.remainingPercent <= 30 ? "warning" : "healthy"; }
function resetText(value: LimitWindow | null) { return value?.resetsAt ? new Date(value.resetsAt * 1000).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "重置时间未知"; }
function elapsed(startedAt: number | null, now: number) { if (!startedAt) return ""; const seconds = Math.max(0, Math.floor((now - startedAt) / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
function UsageRow({ label, value }: { label: string; value: LimitWindow | null }) { return <div className="usage-row"><span className="usage-label">{label}</span><div className="usage-track"><div className={`usage-fill ${tone(value)}`} style={{ width: `${value?.remainingPercent ?? 0}%` }} /></div><strong className={`usage-value ${tone(value)}`}>{percent(value)}</strong><span className="usage-reset">{resetText(value)}</span></div>; }
function mockSession(id: string, state: Activity, now: number): Session { return { id, project: id, cwd: null, state, currentCommand: "dotnet test src/YuG.Api/YuG.Api.csproj", startedAt: now - 94000, lastActivityAt: now, completedAt: state === "completed" ? now : null, model: "Sol", agents: [] }; }

function App() {
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [activity, setActivity] = useState<ActivitySnapshot>({ sessions: [], updatedAt: 0 });
  const [usageError, setUsageError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [orbTransitioning, setOrbTransitioning] = useState(false);
  const [now, setNow] = useState(Date.now());
  const enterTimer = useRef<number | undefined>(undefined);
  const leaveTimer = useRef<number | undefined>(undefined);
  const shrinkTimer = useRef<number | undefined>(undefined);
  const regionTimer = useRef<number | undefined>(undefined);
  const regionWidth = useRef(390);
  const usageEventCount = useRef(0);
  const expandedRef = useRef(false);
  const expandingRef = useRef(false);
  const [debugSessions, setDebugSessions] = useState<Session[] | null>(null);
  useEffect(() => {
    const preventContextMenu = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", preventContextMenu);
    return () => document.removeEventListener("contextmenu", preventContextMenu);
  }, []);
  const refreshUsage = useCallback(async () => { const version = usageEventCount.current; try { const next = await invoke<UsageSnapshot>("read_limits"); if (version === usageEventCount.current) { setUsage(next); setUsageError(null); } } catch (error) { if (version === usageEventCount.current) setUsageError(String(error)); } }, []);
  useEffect(() => { let mounted = true; let unlistenUsage: (() => void) | undefined; let unlistenError: (() => void) | undefined; void (async () => { try { unlistenUsage = await listen<UsageSnapshot>("usage-updated", event => { if (mounted) { usageEventCount.current++; setUsage(event.payload); setUsageError(null); } }); unlistenError = await listen<string>("usage-error", event => { if (mounted) setUsageError(event.payload); }); if (mounted) void refreshUsage(); } catch (error) { console.error("额度通知接收失败", error); if (mounted) void refreshUsage(); } })(); return () => { mounted = false; unlistenUsage?.(); unlistenError?.(); }; }, [refreshUsage]);
  useEffect(() => { let mounted = true; let unlisten: (() => void) | undefined; const applyActivity = (next: ActivitySnapshot) => setActivity(current => newerActivity(current, next)); void (async () => { try { unlisten = await listen<ActivitySnapshot>("activity-updated", event => { if (mounted) applyActivity(event.payload); }); const next = await invoke<ActivitySnapshot>("read_activity"); if (mounted) applyActivity(next); } catch (error) { console.error("会话状态接收失败", error); } })(); return () => { mounted = false; unlisten?.(); }; }, []);
  useEffect(() => { setOrbTransitioning(true); const timer = window.setTimeout(() => setOrbTransitioning(false), 300); return () => window.clearTimeout(timer); }, [expanded]);
  useEffect(() => { if (!(debugSessions ?? activity.sessions).some(s => s.state !== "idle")) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [activity.sessions, debugSessions]);
  useEffect(() => () => { window.clearTimeout(enterTimer.current); window.clearTimeout(leaveTimer.current); window.clearTimeout(shrinkTimer.current); window.clearTimeout(regionTimer.current); }, []);
  const sessions = debugSessions ?? activity.sessions;
  const view = useMemo(() => selectIsland(sessions, usage, now), [sessions, usage, now]);
  const mode = expanded ? "expanded" : view.mode;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const expandedHeight = Math.min(420, view.sessions.length > 1 ? 164 + view.sessions.length * 48 : 154);
  const compactWidth = view.mode === "minimal" ? 112 : 222;
  const compactHeight = view.mode === "minimal" ? 40 : 42;
  useEffect(() => { if (expanded) void appWindow.setSize(new LogicalSize(390, expandedHeight + 4)).then(() => setHitRegion(384, expandedHeight + 4)).catch(error => console.error("窗口尺寸调整失败", error)); }, [expandedHeight]);
  useEffect(() => {
    if (expanded) return;
    window.clearTimeout(regionTimer.current);
    const delay = compactWidth < regionWidth.current ? (reducedMotion ? 150 : 300) : 0;
    regionTimer.current = window.setTimeout(() => {
      void setHitRegion(compactWidth, compactHeight).then(() => { regionWidth.current = compactWidth; }).catch(error => console.error("窗口点击区域调整失败", error));
    }, delay);
    return () => window.clearTimeout(regionTimer.current);
  }, [expanded, compactWidth, compactHeight, reducedMotion]);
  async function expand() { window.clearTimeout(enterTimer.current); window.clearTimeout(shrinkTimer.current); window.clearTimeout(regionTimer.current); if (expandedRef.current || expandingRef.current) return; expandingRef.current = true; try { await appWindow.setSize(new LogicalSize(390, expandedHeight + 4)); await setHitRegion(384, expandedHeight + 4); regionWidth.current = 384; expandedRef.current = true; setExpanded(true); } catch (error) { console.error("窗口展开失败", error); } finally { expandingRef.current = false; } }
  function collapse() { window.clearTimeout(leaveTimer.current); if (!expandedRef.current) return; expandedRef.current = false; window.clearTimeout(shrinkTimer.current); setExpanded(false); shrinkTimer.current = window.setTimeout(() => void appWindow.setSize(new LogicalSize(390, 42)).catch(error => console.error("窗口尺寸调整失败", error)), reducedMotion ? 150 : 300); }
  function onEnter() { window.clearTimeout(leaveTimer.current); if (!expandedRef.current) enterTimer.current = window.setTimeout(() => void expand(), 100); }
  function onLeave() { window.clearTimeout(enterTimer.current); leaveTimer.current = window.setTimeout(collapse, 300); }
  function setMock(states: Activity[]) { if (!debugEnabled) return; const at = Date.now(); setNow(at); setDebugSessions(states.map((state, index) => mockSession(["YuGNetDDD", "TerminalManager", "AgentUniverse"][index] ?? `Session ${index + 1}`, state, at))); }
  const header = view.mode === "minimal" ? "Codex idle" : view.mode === "multi-session" ? `${view.activeCount} sessions active` : view.mode === "attention" ? "状态提醒" : view.primary?.state === "completed" ? "Completed" : "Working";
  return <><main className={`island ${mode}`} style={expanded ? { height: expandedHeight } : undefined} onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={() => expanded ? collapse() : void expand()} aria-label={view.mode === "minimal" ? `Codex 五小时剩余额度 ${percent(usage?.fiveHour ?? null)}` : view.label}>
    <div className="island-content"><div className="orb-wrap"><ThinkingOrb className="orb-small" state={view.orb.state} size={20} theme="dark" speed={view.orb.speed} paused={reducedMotion || (expanded && !orbTransitioning)} aria-hidden="true" /><ThinkingOrb className="orb-large" state={view.orb.state} size={64} theme="dark" speed={view.orb.speed} paused={reducedMotion || (!expanded && !orbTransitioning)} aria-hidden="true" /></div>
      <div className="minimal-copy"><span>5H</span><strong className={tone(usage?.fiveHour ?? null)}>{percent(usage?.fiveHour ?? null)}</strong></div>
      <div className="compact-copy"><span className="activity-label" title={view.label}>{view.label}</span>{view.mode === "single-session" && <time>{elapsed(view.primary?.startedAt ?? null, now)}</time>}<span className="compact-limit">5H <strong className={tone(usage?.fiveHour ?? null)}>{percent(usage?.fiveHour ?? null)}</strong></span></div>
      <div className="expanded-copy"><div className="activity-head"><span>{header}</span><strong>{view.sessions.length === 1 ? view.primary?.project || "Codex Session" : view.sessions.length > 1 ? `${view.sessions.length} sessions` : "Codex"}</strong><small title={view.label}>{view.label || "额度状态"}</small></div>
        {view.sessions.length > 1 && <div className="session-list">{view.sessions.map(session => <div className="session-row" key={session.id}><span className={`session-dot ${session.state}`} /><div className="session-text"><strong title={session.project ?? session.cwd ?? ""}>{session.project || session.cwd?.split(/[\\/]/).pop() || "Codex Session"}</strong><small title={sessionLabel(session)}>{sessionLabel(session)}{session.agents.filter(agent => agent.state !== "completed").length > 1 ? ` · ${session.agents.filter(agent => agent.state !== "completed").length} subagents` : ""}</small></div><time>{elapsed(session.startedAt, now)}</time></div>)}</div>}
        <div className="usage-rows"><UsageRow label="5H" value={usage?.fiveHour ?? null} /><UsageRow label="WEEK" value={usage?.weekly ?? null} /></div>
        <div className="meta"><span>{view.primary?.model || (usageError ? "额度读取失败" : usage ? "额度已更新" : "正在连接 Codex")}</span><time>{view.primary ? elapsed(view.primary.startedAt, now) : usage ? new Date(usage.updatedAt * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : ""}</time></div>
      </div></div></main>
    {debugEnabled && <aside className="debug-switcher">{[["Idle", []], ["Thinking", ["thinking"]], ["Editing", ["editing"]], ["Waiting", ["waiting"]], ["2 sessions", ["thinking", "editing"]], ["3 sessions", ["thinking", "editing", "searching"]], ["2+waiting", ["thinking", "editing", "waiting"]], ["completed", ["completed"]]].map(([name, states]) => <button key={name as string} onClick={() => setMock(states as Activity[])}>{name as string}</button>)}</aside>}</>;
}
export default App;
