import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type PointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { ThinkingOrb } from "thinking-orbs";
import { deriveIslandPresentation, effectiveAttention, newerActivity, resultKey, sessionLabel, type ActivitySnapshot, type LimitWindow, type TurnResult, type UsageSnapshot } from "./islandState";
import { reduceInteraction, type InteractionEvent, type IslandInteractionState } from "./islandInteraction";
import { useTurnTokenUsage } from "./turnTokenUsage";
import type { DebugScenario, DebugScenarioName } from "./debugPresentation";
import "./App.css";

const appWindow = getCurrentWindow();
const debugEnabled = import.meta.env.DEV && new URLSearchParams(location.search).has("debugIsland");
const MORPH_MS = 340;
const AUTO_COLLAPSE_DELAY_MS = 260;
const emptySnapshot: ActivitySnapshot = { sessions: [], recentResults: [], updatedAt: 0 };
function setHitRegion(width: number, height: number) { return invoke<void>("set_window_hit_region", { width: debugEnabled ? 384 : width, height: debugEnabled ? 550 : height }); }
function percent(value: LimitWindow | null) { return value ? `${Math.round(value.remainingPercent)}%` : "--"; }
function tone(value: LimitWindow | null) { return !value ? "neutral" : value.remainingPercent <= 10 ? "critical" : value.remainingPercent <= 30 ? "warning" : "healthy"; }
function resetText(value: LimitWindow | null) { return value?.resetsAt ? new Date(value.resetsAt * 1000).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "重置时间未知"; }
function elapsed(startedAt: number | null, now: number) { if (!startedAt) return ""; const seconds = Math.max(0, Math.floor((now - startedAt) / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
function exactTokens(value: number | null | undefined) { return value == null ? "暂无数据" : `${value.toLocaleString("zh-CN")} tokens`; }
function UsageRow({ label, value }: { label: string; value: LimitWindow | null }) { return <div className="usage-row"><span className="usage-label">{label}</span><div className="usage-track"><div className={`usage-fill ${tone(value)}`} style={{ width: `${value?.remainingPercent ?? 0}%` }} /></div><strong className={`usage-value ${tone(value)}`}>{percent(value)}</strong><span className="usage-reset">{resetText(value)}</span></div>; }

function App() {
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [activity, setActivity] = useState<ActivitySnapshot>(emptySnapshot);
  const [heldResults, setHeldResults] = useState<TurnResult[]>([]);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [debugNames, setDebugNames] = useState<readonly DebugScenarioName[]>([]);
  const [debugScenario, setDebugScenario] = useState<DebugScenario | null>(null);
  const [interaction, dispatchInteraction] = useReducer(reduceInteraction, "compact" as IslandInteractionState);
  const interactionRef = useRef<IslandInteractionState>("compact");
  const transition = (event: InteractionEvent) => { interactionRef.current = reduceInteraction(interactionRef.current, event); dispatchInteraction(event); };
  const [orbTransitioning, setOrbTransitioning] = useState(false);
  const [now, setNow] = useState(Date.now());
  const leaveTimer = useRef<number | undefined>(undefined);
  const shrinkTimer = useRef<number | undefined>(undefined);
  const orbTimer = useRef<number | undefined>(undefined);
  const regionTimer = useRef<number | undefined>(undefined);
  const expandedHeightRef = useRef(154);
  const regionWidth = useRef(0);
  const nativeLarge = useRef(false);
  const nativeOperation = useRef<Promise<void>>(Promise.resolve());
  const collapseOperation = useRef<Promise<void> | null>(null);
  const pointerInside = useRef(false);
  const compactSize = useRef({ width: 120, height: 40 });
  const usageEventCount = useRef(0);
  const drag = useRef<{ pointerId: number; startX: number; windowX: number; minX: number; maxX: number; scale: number; moved: boolean } | null>(null);
  const pendingDrag = useRef<number | null>(null);
  const dragFrame = useRef<number | undefined>(undefined);
  const dragTarget = useRef<number | null>(null);
  const dragCurrent = useRef<number | null>(null);
  const dragTop = useRef(0);
  const suppressClick = useRef(false);
  const expanded = interaction === "expanded";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tokens = useTurnTokenUsage(activity.recentResults);
  const displayActivity = debugScenario?.snapshot ?? activity;
  const displayUsage = debugScenario ? debugScenario.usage : usage;
  const displayTokens = debugScenario ? debugScenario.tokens : tokens;
  const view = useMemo(() => deriveIslandPresentation(displayActivity, displayUsage, displayTokens, now, debugScenario ? debugScenario.snapshot.recentResults : heldResults), [displayActivity, displayUsage, displayTokens, now, debugScenario, heldResults]);
  const expandedHeight = Math.min(420, view.rowCount > 1 ? 164 + view.rowCount * 48 : view.showTokenSummary ? 204 : 154);
  expandedHeightRef.current = expandedHeight;
  const compactWidth = view.layout === "minimal" ? 120 : 224;
  const compactHeight = view.layout === "minimal" ? 40 : 42;
  compactSize.current = { width: compactWidth, height: compactHeight };
  useEffect(() => { if (debugEnabled) void import("./debugPresentation").then(module => setDebugNames(module.DEBUG_SCENARIOS)).catch(error => console.error("加载状态预览失败", error)); }, []);
  useEffect(() => { if (debugEnabled) void appWindow.setSize(new LogicalSize(390, 550)).then(() => setHitRegion(384, 550)).catch(error => console.error("调整状态预览窗口失败", error)); }, []);
  function selectDebug(name: DebugScenarioName | null) {
    if (name === null) { setDebugScenario(null); setNow(Date.now()); return; }
    void import("./debugPresentation").then(module => { const at = Date.now(); setDebugScenario(module.createDebugScenario(name, at)); setNow(at); }).catch(error => console.error("切换状态预览失败", error));
  }
  useEffect(() => { const prevent = (event: MouseEvent) => event.preventDefault(); document.addEventListener("contextmenu", prevent); return () => document.removeEventListener("contextmenu", prevent); }, []);
  const refreshUsage = useCallback(async () => { const version = usageEventCount.current; try { const next = await invoke<UsageSnapshot>("read_limits"); if (version === usageEventCount.current) { setUsage(next); setNow(Date.now()); setUsageError(null); } } catch (error) { if (version === usageEventCount.current) setUsageError(String(error)); } }, []);
  useEffect(() => { let mounted = true; let unlistenUsage: (() => void) | undefined; let unlistenError: (() => void) | undefined; void (async () => { try { unlistenUsage = await listen<UsageSnapshot>("usage-updated", event => { if (mounted) { usageEventCount.current++; setUsage(event.payload); setNow(Date.now()); setUsageError(null); } }); unlistenError = await listen<string>("usage-error", event => { if (mounted) setUsageError(event.payload); }); if (mounted) void refreshUsage(); } catch (error) { console.error("额度通知接收失败", error); if (mounted) void refreshUsage(); } })(); return () => { mounted = false; unlistenUsage?.(); unlistenError?.(); }; }, [refreshUsage]);
  useEffect(() => { let mounted = true; let unlisten: (() => void) | undefined; void (async () => { try { unlisten = await listen<ActivitySnapshot>("activity-updated", event => { if (mounted) { setActivity(current => newerActivity(current, event.payload)); setNow(Date.now()); } }); const next = await invoke<ActivitySnapshot>("read_activity"); if (mounted) { setActivity(current => newerActivity(current, next)); setNow(Date.now()); } } catch (error) { console.error("会话状态接收失败", error); } })(); return () => { mounted = false; unlisten?.(); }; }, []);
  // 展开期间保留全部结果，避免紧凑反馈超时或 Rust 清理数据后抹掉 Token 展示。
  useEffect(() => {
    if (!expanded) return;
    if (activity.recentResults.length) setHeldResults(current => {
      const byKey = new Map(current.map(result => [resultKey(result), result]));
      activity.recentResults.forEach(result => byKey.set(resultKey(result), result));
      return byKey.size === current.length ? current : [...byKey.values()];
    });
  }, [expanded, activity.recentResults]);
  useEffect(() => { if (!view.sessions.length) return; const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(timer); }, [view.sessions.length]);
  useEffect(() => { if (view.nextUpdateAt == null) return; const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, view.nextUpdateAt - Date.now())); return () => window.clearTimeout(timer); }, [view.nextUpdateAt]);
  useEffect(() => { setNow(Date.now()); }, [tokens]);
  useEffect(() => () => { window.clearTimeout(leaveTimer.current); window.clearTimeout(shrinkTimer.current); window.clearTimeout(orbTimer.current); window.clearTimeout(regionTimer.current); window.cancelAnimationFrame(dragFrame.current ?? 0); }, []);
  useEffect(() => { if (expanded) void runNative(async () => { if (interactionRef.current !== "expanded") return; await appWindow.setSize(new LogicalSize(390, debugEnabled ? 550 : expandedHeight + 4)); await setHitRegion(384, expandedHeight + 4); regionWidth.current = 384; }).catch(error => console.error("窗口尺寸调整失败", error)); }, [expanded, expandedHeight]);
  useEffect(() => {
    if (expanded || nativeLarge.current) return;
    window.clearTimeout(regionTimer.current);
    const delay = compactWidth < regionWidth.current ? (reducedMotion ? 150 : MORPH_MS) : 0;
    regionTimer.current = window.setTimeout(() => { void runNative(async () => {
      if (interactionRef.current !== "compact" || nativeLarge.current) return;
      await setHitRegion(compactWidth, compactHeight);
      regionWidth.current = compactWidth;
    }).catch(error => console.error("窗口点击区域调整失败", error)); }, delay);
    return () => window.clearTimeout(regionTimer.current);
  }, [expanded, compactWidth, compactHeight, reducedMotion]);
  function animateOrbHandoff() { window.clearTimeout(orbTimer.current); setOrbTransitioning(true); orbTimer.current = window.setTimeout(() => setOrbTransitioning(false), reducedMotion ? 150 : MORPH_MS); }
  function scheduleCollapse() {
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => { leaveTimer.current = undefined; collapse(); }, AUTO_COLLAPSE_DELAY_MS);
  }
  // 原生窗口尺寸和点击区域必须按顺序更新，快速展开/收起时后一个操作负责最终状态。
  function runNative(work: () => Promise<void>): Promise<void> {
    const operation = nativeOperation.current.then(work, work);
    nativeOperation.current = operation.catch(() => {});
    return operation;
  }
  function finishCollapse(): Promise<void> {
    if (collapseOperation.current) return collapseOperation.current;
    if (interactionRef.current !== "collapsing") return Promise.resolve();
    window.clearTimeout(shrinkTimer.current);
    const operation = runNative(async () => {
      if (interactionRef.current !== "collapsing") return;
      try {
        if (nativeLarge.current) await appWindow.setSize(new LogicalSize(390, debugEnabled ? 550 : 42));
        nativeLarge.current = false;
        if (interactionRef.current !== "collapsing") return;
        const { width, height } = compactSize.current;
        await setHitRegion(width, height);
        regionWidth.current = width;
        transition("ANIMATION_END");
        setHeldResults([]);
        setNow(Date.now());
      } catch (error) {
        console.error("窗口收起失败", error);
        if (interactionRef.current === "collapsing") {
          if (nativeLarge.current) transition("COLLAPSE_FAILED");
          else {
            const { width, height } = compactSize.current;
            try { await setHitRegion(width, height); regionWidth.current = width; }
            catch (retryError) { console.error("窗口点击区域恢复失败", retryError); }
            if (interactionRef.current === "collapsing") { transition("ANIMATION_END"); setHeldResults([]); setNow(Date.now()); }
          }
        }
      }
    });
    collapseOperation.current = operation;
    void operation.finally(() => { if (collapseOperation.current === operation) collapseOperation.current = null; });
    return operation;
  }
  async function expand() {
    if (interactionRef.current !== "compact" && interactionRef.current !== "collapsing") return;
    window.clearTimeout(shrinkTimer.current); window.clearTimeout(regionTimer.current);
    transition("EXPAND");
    await runNative(async () => {
      if (interactionRef.current !== "expanding") return;
      try {
        const height = expandedHeightRef.current;
        await appWindow.setSize(new LogicalSize(390, debugEnabled ? 550 : height + 4));
        nativeLarge.current = true;
        if ((interactionRef.current as IslandInteractionState) !== "expanding") return;
        await setHitRegion(384, height + 4); regionWidth.current = 384;
        if ((interactionRef.current as IslandInteractionState) !== "expanding") return;
        animateOrbHandoff(); transition("NATIVE_READY");
        if (!pointerInside.current && leaveTimer.current === undefined) scheduleCollapse();
      } catch (error) {
        console.error("窗口展开失败", error);
        if (interactionRef.current === "expanding") {
          if (nativeLarge.current) { animateOrbHandoff(); transition("NATIVE_READY"); if (!pointerInside.current && leaveTimer.current === undefined) scheduleCollapse(); }
          else transition("EXPAND_FAILED");
        }
      }
    });
  }
  function collapse() {
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = undefined;
    if (interactionRef.current !== "expanded" && interactionRef.current !== "expanding") return;
    transition("COLLAPSE"); animateOrbHandoff();
    // 过渡结束后再缩小原生窗口，避免内容在收起途中被系统裁掉。
    shrinkTimer.current = window.setTimeout(() => void finishCollapse(), reducedMotion ? 190 : MORPH_MS + 80);
  }
  function onEnter() { pointerInside.current = true; window.clearTimeout(leaveTimer.current); leaveTimer.current = undefined; }
  function onLeave() { pointerInside.current = false; scheduleCollapse(); }
  function animateDrag() {
    const target = dragTarget.current; const current = dragCurrent.current;
    if (target == null || current == null) return;
    const next = Math.abs(target - current) < 0.5 ? target : current + (target - current) * (reducedMotion ? 1 : 0.38);
    dragCurrent.current = next;
    void appWindow.setPosition(new PhysicalPosition(Math.round(next), dragTop.current)).catch(error => console.error("窗口移动失败", error));
    if (next !== target) dragFrame.current = window.requestAnimationFrame(animateDrag);
  }
  async function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || interactionRef.current !== "compact") return;
    const element = event.currentTarget; pendingDrag.current = event.pointerId; element.setPointerCapture(event.pointerId);
    window.cancelAnimationFrame(dragFrame.current ?? 0);
    try {
      const [position, monitor, scale] = await Promise.all([appWindow.outerPosition(), currentMonitor(), appWindow.scaleFactor()]);
      if (!monitor || pendingDrag.current !== event.pointerId) return;
      const width = Math.round(390 * scale); dragTop.current = position.y; dragCurrent.current = position.x;
      drag.current = { pointerId: event.pointerId, startX: event.screenX, windowX: position.x, minX: monitor.position.x, maxX: monitor.position.x + monitor.size.width - width, scale, moved: false };
    } catch (error) { console.error("窗口拖动准备失败", error); }
  }
  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const state = drag.current; if (!state || state.pointerId !== event.pointerId) return;
    const delta = (event.screenX - state.startX) * state.scale;
    if (!state.moved && Math.abs(delta) < 5 * state.scale) return;
    state.moved = true; suppressClick.current = true;
    dragTarget.current = Math.max(state.minX, Math.min(state.maxX, state.windowX + delta));
    if (dragCurrent.current == null) dragCurrent.current = state.windowX;
    window.cancelAnimationFrame(dragFrame.current ?? 0); dragFrame.current = window.requestAnimationFrame(animateDrag);
  }
  function onPointerUp(event: PointerEvent<HTMLElement>) {
    if (pendingDrag.current !== event.pointerId) return;
    pendingDrag.current = null; drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId);
    window.setTimeout(() => { suppressClick.current = false; }, 0);
  }
  return <><main className={`island layout-${view.layout} ${expanded ? "expanded" : ""}`} data-attention={view.attention} data-feedback={view.feedback} style={expanded ? { height: expandedHeight } : undefined} onMouseEnter={onEnter} onMouseLeave={onLeave} onPointerDown={event => void onPointerDown(event)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onTransitionEnd={event => { if (event.target === event.currentTarget && event.propertyName === "height" && interactionRef.current === "collapsing") void finishCollapse(); }} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } expanded ? collapse() : void expand(); }} aria-label={view.layout === "minimal" ? `Codex 五小时剩余额度 ${percent(displayUsage?.fiveHour ?? null)}` : view.compactLabel}>
    <div className="island-content"><div className="orb-wrap"><ThinkingOrb className="orb-small" state={view.orb.state} size={20} theme="dark" speed={view.orb.speed} paused={reducedMotion || (expanded && !orbTransitioning)} aria-hidden="true" /><ThinkingOrb className="orb-large" state={view.orb.state} size={64} theme="dark" speed={view.orb.speed} paused={reducedMotion || (!expanded && !orbTransitioning)} aria-hidden="true" /></div>
      <div className="minimal-copy"><span>5 小时</span><strong className={tone(displayUsage?.fiveHour ?? null)}>{percent(displayUsage?.fiveHour ?? null)}</strong></div>
      <div className="compact-copy"><span className="activity-label" key={view.compactLabel} title={view.compactLabel}>{view.compactLabel}</span>{view.layout === "single" && view.primarySession && <time>{elapsed(view.primarySession.startedAt, now)}</time>}<span className="compact-limit">5 小时 <strong className={tone(displayUsage?.fiveHour ?? null)}>{percent(displayUsage?.fiveHour ?? null)}</strong></span></div>
      <div className="expanded-copy"><div className="activity-head"><span key={view.expandedTitle} title={view.expandedTitle}>{view.expandedTitle}</span>{view.layout !== "multi" && <><strong title={view.primarySession?.project ?? view.primaryResult?.result.project ?? ""}>{view.primarySession?.project || view.primaryResult?.result.project || "Codex"}</strong><small>{view.expandedSubtitle}</small></>}</div>
        {view.showTokenSummary && view.token?.status === "ready" && <div className="token-summary"><div><span>本次任务</span><strong>{exactTokens(view.token.taskTokens)}</strong></div><div><span>当前会话</span><strong>{exactTokens(view.token.sessionTokens)}</strong></div></div>}
        {view.rowCount > 1 && <div className="session-list">{view.sessions.map(session => <div className="session-row" key={`session:${session.id}`}><span className="session-dot" data-attention={effectiveAttention(session)} /><div className="session-text"><strong title={session.project ?? session.cwd ?? ""}>{session.project || session.cwd?.split(/[\\/]/).pop() || "Codex 会话"}</strong><small>{sessionLabel(session)}{session.agents.filter(agent => agent.activity !== null).length > 1 ? ` · ${session.agents.filter(agent => agent.activity !== null).length} 个子代理` : ""}</small></div><time>{elapsed(session.startedAt, now)}</time></div>)}{view.visibleResults.map(({ result, label }) => <div className="session-row" key={`result:${resultKey(result)}`}><span className="session-dot" data-feedback={result.kind} /><div className="session-text"><strong title={result.project ?? ""}>{result.project || "Codex 会话"}</strong><small>{label}</small></div><time>{elapsed(result.startedAt, result.finishedAt)}</time></div>)}</div>}
        <div className="usage-rows"><UsageRow label="5 小时额度" value={displayUsage?.fiveHour ?? null} /><UsageRow label="每周额度" value={displayUsage?.weekly ?? null} /></div>
        <div className="meta"><span>{view.primarySession?.model || view.primaryResult?.result.model || (usageError ? "额度读取失败" : displayUsage ? "额度已更新" : "正在连接 Codex")}</span><time>{view.primarySession ? elapsed(view.primarySession.startedAt, now) : view.primaryResult ? elapsed(view.primaryResult.result.startedAt, view.primaryResult.result.finishedAt) : displayUsage ? new Date(displayUsage.updatedAt * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : ""}</time></div>
      </div></div></main>{debugEnabled && <aside className="debug-switcher"><button onClick={() => selectDebug(null)}>Live</button>{debugNames.map(name => <button key={name} onClick={() => selectDebug(name)}>{name}</button>)}</aside>}</>;
}
export default App;
