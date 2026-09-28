import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { ThinkingOrb } from "thinking-orbs";
import { newerActivity, selectIsland, sessionLabel, type Activity, type ActivitySnapshot, type LimitWindow, type Session, type UsageSnapshot } from "./islandState";
import "./App.css";

const appWindow = getCurrentWindow();
const debugEnabled = import.meta.env.DEV && new URLSearchParams(location.search).has("debugIsland");
const MORPH_MS = 340;
function setHitRegion(width: number, height: number) { return invoke<void>("set_window_hit_region", { width, height }); }
function percent(value: LimitWindow | null) { return value ? `${Math.round(value.remainingPercent)}%` : "--"; }
function tone(value: LimitWindow | null) { return !value ? "neutral" : value.remainingPercent <= 10 ? "critical" : value.remainingPercent <= 30 ? "warning" : "healthy"; }
function resetText(value: LimitWindow | null) { return value?.resetsAt ? new Date(value.resetsAt * 1000).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "重置时间未知"; }
function elapsed(startedAt: number | null, now: number) { if (!startedAt) return ""; const seconds = Math.max(0, Math.floor((now - startedAt) / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
type TokenUsage = { taskTokens: number | null; sessionTokens: number | null };
function tokenKey(session: Session) { return `${session.id}:${session.completedAt}`; }
function compactTokens(value: number | null | undefined) { return value == null ? "暂无数据" : value >= 1000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(value); }
function numberTokens(value: number | null | undefined) { return value == null ? "暂无数据" : value.toLocaleString("zh-CN"); }
function exactTokens(value: number | null | undefined) { return value == null ? "暂无数据" : `${value.toLocaleString("zh-CN")} tokens`; }
function UsageRow({ label, value }: { label: string; value: LimitWindow | null }) { return <div className="usage-row"><span className="usage-label">{label}</span><div className="usage-track"><div className={`usage-fill ${tone(value)}`} style={{ width: `${value?.remainingPercent ?? 0}%` }} /></div><strong className={`usage-value ${tone(value)}`}>{percent(value)}</strong><span className="usage-reset">{resetText(value)}</span></div>; }
function mockSession(id: string, state: Activity, now: number): Session { return { id, project: id, cwd: null, state, currentCommand: "dotnet test src/YuG.Api/YuG.Api.csproj", startedAt: now - 94000, lastActivityAt: now, completedAt: state === "completed" ? now : null, model: "Sol", agents: [] }; }

function App() {
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [activity, setActivity] = useState<ActivitySnapshot>({ sessions: [], updatedAt: 0 });
  const [tokenUsages, setTokenUsages] = useState<Record<string, TokenUsage | null>>({});
  const [heldCompleted, setHeldCompleted] = useState<Session[]>([]);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [orbTransitioning, setOrbTransitioning] = useState(false);
  const [now, setNow] = useState(Date.now());
  const leaveTimer = useRef<number | undefined>(undefined);
  const shrinkTimer = useRef<number | undefined>(undefined);
  const orbTimer = useRef<number | undefined>(undefined);
  const regionTimer = useRef<number | undefined>(undefined);
  const expandedHeightRef = useRef(154);
  const regionWidth = useRef(0);
  const nativeExpanded = useRef(false);
  const closingNative = useRef(false);
  const pointerInside = useRef(false);
  const compactSize = useRef({ width: 120, height: 40 });
  const usageEventCount = useRef(0);
  const expandedRef = useRef(false);
  const expandingRef = useRef(false);
  const drag = useRef<{ pointerId: number; startX: number; windowX: number; minX: number; maxX: number; scale: number; moved: boolean } | null>(null);
  const pendingDrag = useRef<number | null>(null);
  const dragFrame = useRef<number | undefined>(undefined);
  const dragTarget = useRef<number | null>(null);
  const dragCurrent = useRef<number | null>(null);
  const dragTop = useRef(0);
  const suppressClick = useRef(false);
  const [debugSessions, setDebugSessions] = useState<Session[] | null>(null);
  useEffect(() => {
    const preventContextMenu = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", preventContextMenu);
    return () => document.removeEventListener("contextmenu", preventContextMenu);
  }, []);
  const refreshUsage = useCallback(async () => { const version = usageEventCount.current; try { const next = await invoke<UsageSnapshot>("read_limits"); if (version === usageEventCount.current) { setUsage(next); setUsageError(null); } } catch (error) { if (version === usageEventCount.current) setUsageError(String(error)); } }, []);
  useEffect(() => { let mounted = true; let unlistenUsage: (() => void) | undefined; let unlistenError: (() => void) | undefined; void (async () => { try { unlistenUsage = await listen<UsageSnapshot>("usage-updated", event => { if (mounted) { usageEventCount.current++; setUsage(event.payload); setUsageError(null); } }); unlistenError = await listen<string>("usage-error", event => { if (mounted) setUsageError(event.payload); }); if (mounted) void refreshUsage(); } catch (error) { console.error("额度通知接收失败", error); if (mounted) void refreshUsage(); } })(); return () => { mounted = false; unlistenUsage?.(); unlistenError?.(); }; }, [refreshUsage]);
  useEffect(() => { let mounted = true; let unlisten: (() => void) | undefined; const applyActivity = (next: ActivitySnapshot) => { setActivity(current => newerActivity(current, next)); const completed = next.sessions.filter(session => session.state === "completed"); if (expandedRef.current && completed.length) setHeldCompleted(current => { const byId = new Map(current.map(session => [session.id, session])); completed.forEach(session => byId.set(session.id, session)); return [...byId.values()]; }); }; void (async () => { try { unlisten = await listen<ActivitySnapshot>("activity-updated", event => { if (mounted) applyActivity(event.payload); }); const next = await invoke<ActivitySnapshot>("read_activity"); if (mounted) applyActivity(next); } catch (error) { console.error("会话状态接收失败", error); } })(); return () => { mounted = false; unlisten?.(); }; }, []);
  useEffect(() => { const completed = activity.sessions.filter(session => session.state === "completed"); if (!completed.length) return; let cancelled = false; const timers: number[] = []; for (const session of completed) { const key = tokenKey(session); if (key in tokenUsages) continue; const query = async (attempt: number) => { try { const result = await invoke<TokenUsage | null>("read_token_usage", { sessionId: session.id, turnId: session.currentTurnId ?? null }); if (cancelled) return; if ((!result || result.taskTokens == null) && attempt < 2) { timers.push(window.setTimeout(() => void query(attempt + 1), 800)); return; } setTokenUsages(current => ({ ...current, [key]: result })); } catch (error) { if (!cancelled) { console.error("读取 token 用量失败", error); setTokenUsages(current => ({ ...current, [key]: null })); } } }; timers.push(window.setTimeout(() => void query(0), 300)); } return () => { cancelled = true; timers.forEach(window.clearTimeout); }; }, [activity.sessions, tokenUsages]);
  useEffect(() => { if (!(debugSessions ?? activity.sessions).some(s => s.state !== "idle") && !heldCompleted.length) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [activity.sessions, debugSessions, heldCompleted]);
  useEffect(() => () => { window.clearTimeout(leaveTimer.current); window.clearTimeout(shrinkTimer.current); window.clearTimeout(orbTimer.current); window.clearTimeout(regionTimer.current); window.cancelAnimationFrame(dragFrame.current ?? 0); }, []);
  const sessions = debugSessions ?? [...activity.sessions, ...heldCompleted.filter(held => !activity.sessions.some(session => session.id === held.id))];
  const viewNow = heldCompleted.length ? Math.min(now, Math.min(...heldCompleted.map(session => session.completedAt ?? now)) + 3_000) : now;
  const view = useMemo(() => selectIsland(sessions, usage, viewNow), [sessions, usage, viewNow]);
  const mode = expanded ? "expanded" : view.mode;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const completedPrimary = view.sessions.length === 1 && view.primary?.state === "completed" ? view.primary : null;
  const primaryTokens = completedPrimary ? tokenUsages[tokenKey(completedPrimary)] : null;
  const expandedHeight = Math.min(420, view.sessions.length > 1 ? 164 + view.sessions.length * 48 : completedPrimary ? 204 : 154);
  expandedHeightRef.current = expandedHeight;
  const compactWidth = view.mode === "minimal" ? 120 : 224;
  const compactHeight = view.mode === "minimal" ? 40 : 42;
  compactSize.current = { width: compactWidth, height: compactHeight };
  useEffect(() => { if (expanded) void appWindow.setSize(new LogicalSize(390, expandedHeight + 4)).then(() => setHitRegion(384, expandedHeight + 4)).catch(error => console.error("窗口尺寸调整失败", error)); }, [expanded, expandedHeight]);
  useEffect(() => {
    if (expanded || nativeExpanded.current) return;
    window.clearTimeout(regionTimer.current);
    const delay = compactWidth < regionWidth.current ? (reducedMotion ? 150 : MORPH_MS) : 0;
    regionTimer.current = window.setTimeout(() => {
      void setHitRegion(compactWidth, compactHeight).then(() => { regionWidth.current = compactWidth; }).catch(error => console.error("窗口点击区域调整失败", error));
    }, delay);
    return () => window.clearTimeout(regionTimer.current);
  }, [expanded, compactWidth, compactHeight, reducedMotion]);
  function animateOrbHandoff() {
    window.clearTimeout(orbTimer.current);
    setOrbTransitioning(true);
    orbTimer.current = window.setTimeout(() => setOrbTransitioning(false), reducedMotion ? 150 : MORPH_MS);
  }
  async function finishCollapse() {
    if (expandedRef.current || expandingRef.current || !nativeExpanded.current || closingNative.current) return;
    window.clearTimeout(shrinkTimer.current);
    closingNative.current = true;
    try {
      await appWindow.setSize(new LogicalSize(390, 42));
      if (expandedRef.current || expandingRef.current) return;
      nativeExpanded.current = false;
      const { width, height } = compactSize.current;
      await setHitRegion(width, height);
      regionWidth.current = width;
    } catch (error) { console.error("窗口收起失败", error); }
    finally { closingNative.current = false; }
  }
  async function expand() {
    window.clearTimeout(shrinkTimer.current);
    window.clearTimeout(regionTimer.current);
    if (expandedRef.current || expandingRef.current) return;
    expandingRef.current = true;
    try {
      const height = expandedHeightRef.current;
      await appWindow.setSize(new LogicalSize(390, height + 4));
      nativeExpanded.current = true;
      await setHitRegion(384, height + 4);
      regionWidth.current = 384;
      expandedRef.current = true;
      setHeldCompleted(activity.sessions.filter(session => session.state === "completed" && Date.now() - (session.completedAt ?? 0) <= 12_000));
      animateOrbHandoff();
      setExpanded(true);
    } catch (error) { console.error("窗口展开失败", error); }
    finally {
      expandingRef.current = false;
      if (!pointerInside.current && expandedRef.current) collapse();
      else if (!expandedRef.current && nativeExpanded.current) void finishCollapse();
    }
  }
  function collapse() {
    window.clearTimeout(leaveTimer.current);
    setHeldCompleted([]);
    if (!expandedRef.current) return;
    expandedRef.current = false;
    animateOrbHandoff();
    setExpanded(false);
    // 过渡结束后再缩小原生窗口，避免内容在收起途中被系统裁掉。
    shrinkTimer.current = window.setTimeout(() => void finishCollapse(), reducedMotion ? 190 : MORPH_MS + 80);
  }
  function onEnter() { pointerInside.current = true; window.clearTimeout(leaveTimer.current); }
  function onLeave() { pointerInside.current = false; leaveTimer.current = window.setTimeout(collapse, 260); }
  function animateDrag() {
    const target = dragTarget.current;
    const current = dragCurrent.current;
    if (target == null || current == null) return;
    const next = Math.abs(target - current) < 0.5 ? target : current + (target - current) * (reducedMotion ? 1 : 0.38);
    dragCurrent.current = next;
    void appWindow.setPosition(new PhysicalPosition(Math.round(next), dragTop.current)).catch(error => console.error("窗口移动失败", error));
    if (next !== target) dragFrame.current = window.requestAnimationFrame(animateDrag);
  }
  async function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || expandedRef.current) return;
    const element = event.currentTarget;
    pendingDrag.current = event.pointerId;
    element.setPointerCapture(event.pointerId);
    window.cancelAnimationFrame(dragFrame.current ?? 0);
    try {
      const [position, monitor, scale] = await Promise.all([appWindow.outerPosition(), currentMonitor(), appWindow.scaleFactor()]);
      if (!monitor || pendingDrag.current !== event.pointerId) return;
      const width = Math.round(390 * scale);
      dragTop.current = position.y;
      dragCurrent.current = position.x;
      drag.current = { pointerId: event.pointerId, startX: event.screenX, windowX: position.x, minX: monitor.position.x, maxX: monitor.position.x + monitor.size.width - width, scale, moved: false };
    } catch (error) { console.error("窗口拖动准备失败", error); }
  }
  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const delta = (event.screenX - state.startX) * state.scale;
    if (!state.moved && Math.abs(delta) < 5 * state.scale) return;
    state.moved = true;
    suppressClick.current = true;
    dragTarget.current = Math.max(state.minX, Math.min(state.maxX, state.windowX + delta));
    if (dragCurrent.current == null) dragCurrent.current = state.windowX;
    window.cancelAnimationFrame(dragFrame.current ?? 0);
    dragFrame.current = window.requestAnimationFrame(animateDrag);
  }
  function onPointerUp(event: PointerEvent<HTMLElement>) {
    if (pendingDrag.current !== event.pointerId) return;
    pendingDrag.current = null;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    window.setTimeout(() => { suppressClick.current = false; }, 0);
  }
  function setMock(states: Activity[]) { if (!debugEnabled) return; const at = Date.now(); setNow(at); setDebugSessions(states.map((state, index) => mockSession(["YuGNetDDD", "TerminalManager", "AgentUniverse"][index] ?? `Session ${index + 1}`, state, at))); }
  const activeAgents = view.primary?.agents.filter(agent => agent.state !== "completed" && agent.state !== "idle").length ?? 0;
  const secondary = view.mode === "multi-session" ? `${view.sessions.length} 个会话` : view.primary?.state === "completed" ? "本次任务已结束" : activeAgents > 1 ? `${activeAgents} 个子代理` : view.mode === "minimal" ? "额度状态" : view.primary?.state === "waiting" ? "需要你的确认" : "正在处理当前会话";
  const quotaExhausted = usage?.fiveHour?.remainingPercent === 0 || usage?.weekly?.remainingPercent === 0;
  const signal = quotaExhausted ? "quota" : view.waitingCount ? "waiting" : view.primary?.state === "completed" ? "completed" : "normal";
  return <><main className={`island ${mode}`} data-signal={signal} style={expanded ? { height: expandedHeight } : undefined} onMouseEnter={onEnter} onMouseLeave={onLeave} onPointerDown={event => void onPointerDown(event)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onTransitionEnd={event => { if (event.target === event.currentTarget && event.propertyName === "height" && !expandedRef.current) void finishCollapse(); }} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } expanded ? collapse() : void expand(); }} aria-label={view.mode === "minimal" ? `Codex 五小时剩余额度 ${percent(usage?.fiveHour ?? null)}` : view.label}>
    <div className="island-content"><div className="orb-wrap"><ThinkingOrb className="orb-small" state={view.orb.state} size={20} theme="dark" speed={view.orb.speed} paused={reducedMotion || (expanded && !orbTransitioning)} aria-hidden="true" /><ThinkingOrb className="orb-large" state={view.orb.state} size={64} theme="dark" speed={view.orb.speed} paused={reducedMotion || (!expanded && !orbTransitioning)} aria-hidden="true" /></div>
      <div className="minimal-copy"><span>5 小时</span><strong className={tone(usage?.fiveHour ?? null)}>{percent(usage?.fiveHour ?? null)}</strong></div>
      <div className="compact-copy"><span className="activity-label" key={view.label} title={view.label}>{completedPrimary ? `完成 · ${compactTokens(primaryTokens?.taskTokens)}` : view.label}</span>{view.mode === "single-session" && !completedPrimary && <time>{elapsed(view.primary?.startedAt ?? null, now)}</time>}<span className="compact-limit">5 小时 <strong className={tone(usage?.fiveHour ?? null)}>{percent(usage?.fiveHour ?? null)}</strong></span></div>
      <div className="expanded-copy"><div className="activity-head"><span key={view.expandedLabel} title={view.expandedLabel}>{view.expandedLabel}</span>{view.mode !== "multi-session" && <><strong title={view.primary?.project ?? ""}>{view.sessions.length === 1 ? view.primary?.project || "Codex 会话" : view.sessions.length > 1 ? `${view.sessions.length} 个会话` : "Codex"}</strong><small>{secondary}</small></>}</div>
        {completedPrimary && <div className="token-summary"><div><span>本次任务</span><strong>{exactTokens(primaryTokens?.taskTokens)}</strong></div><div><span>当前会话</span><strong>{exactTokens(primaryTokens?.sessionTokens)}</strong></div></div>}
        {view.sessions.length > 1 && <div className="session-list">{view.sessions.map(session => { const tokens = session.state === "completed" ? tokenUsages[tokenKey(session)] : null; return <div className="session-row" key={session.id}><span className={`session-dot ${session.state}`} /><div className="session-text"><strong title={session.project ?? session.cwd ?? ""}>{session.project || session.cwd?.split(/[\\/]/).pop() || "Codex 会话"}</strong><small title={session.state === "completed" ? `本次任务 ${exactTokens(tokens?.taskTokens)}；当前会话 ${exactTokens(tokens?.sessionTokens)}` : sessionLabel(session)}>{session.state === "completed" ? `任务 ${numberTokens(tokens?.taskTokens)} · 会话 ${numberTokens(tokens?.sessionTokens)}` : `${sessionLabel(session)}${session.agents.filter(agent => agent.state !== "completed" && agent.state !== "idle").length > 1 ? ` · ${session.agents.filter(agent => agent.state !== "completed" && agent.state !== "idle").length} 个子代理` : ""}`}</small></div><time>{elapsed(session.startedAt, now)}</time></div>; })}</div>}
        <div className="usage-rows"><UsageRow label="5 小时额度" value={usage?.fiveHour ?? null} /><UsageRow label="每周额度" value={usage?.weekly ?? null} /></div>
        <div className="meta"><span>{view.primary?.model || (usageError ? "额度读取失败" : usage ? "额度已更新" : "正在连接 Codex")}</span><time>{view.primary ? elapsed(view.primary.startedAt, now) : usage ? new Date(usage.updatedAt * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : ""}</time></div>
      </div></div></main>
    {debugEnabled && <aside className="debug-switcher">{[["Idle", []], ["Thinking", ["thinking"]], ["Editing", ["editing"]], ["Waiting", ["waiting"]], ["2 sessions", ["thinking", "editing"]], ["3 sessions", ["thinking", "editing", "searching"]], ["2+waiting", ["thinking", "editing", "waiting"]], ["completed", ["completed"]]].map(([name, states]) => <button key={name as string} onClick={() => setMock(states as Activity[])}>{name as string}</button>)}</aside>}</>;
}
export default App;
