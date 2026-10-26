import type { SystemResourceSnapshot } from "./generated/contracts";
import {
  resultKey,
  type Activity,
  type ActivitySnapshot,
  type Agent,
  type Session,
  type TokenUsageState,
  type TurnResult,
  type UsageSnapshot,
} from "./islandState";

export const FIXED_DEBUG_NOW = 1_761_206_400_000;

export const DEBUG_SCENARIOS = [
  "Idle",
  "Thinking",
  "Searching",
  "Editing",
  "Executing",
  "Connecting",
  "Compacting",
  "Permission",
  "Agent Permission",
  "Completed Loading",
  "Completed Ready",
  "Expired Completed Expanded",
  "Interrupted",
  "2 Active Sessions",
  "1 Active + 1 Completed",
  "2 Active + 1 Completed",
  "2 Completed",
  "Multi Agent",
  "Quota Exhausted",
  "Quota + Permission",
] as const;
export type DebugScenarioName = (typeof DEBUG_SCENARIOS)[number];
export type DebugScenario = {
  snapshot: ActivitySnapshot;
  usage: UsageSnapshot;
  tokens: Record<string, TokenUsageState>;
  systemSnapshot: SystemResourceSnapshot;
  cpuHistory: number[];
};

export type ReadmeTarget = {
  id: "compact-pill" | "expanded-completed" | "expanded-thinking" | "expanded-multi";
  fileName: string;
  title: string;
  scenario: DebugScenarioName;
  expanded: boolean;
};

export const README_TARGETS: readonly ReadmeTarget[] = [
  {
    id: "compact-pill",
    fileName: "compact-pill.png",
    title: "Floating Capsule (Compact)",
    scenario: "Idle",
    expanded: false,
  },
  {
    id: "expanded-completed",
    fileName: "expanded-completed.png",
    title: "Task Completed & Token Summary (Expanded)",
    scenario: "Completed Ready",
    expanded: true,
  },
  {
    id: "expanded-thinking",
    fileName: "expanded-thinking.png",
    title: "Real-Time Thinking & Actions",
    scenario: "Thinking",
    expanded: true,
  },
  {
    id: "expanded-multi",
    fileName: "expanded-multi.png",
    title: "Multi-Session & Sub-Agent Tracking",
    scenario: "2 Active + 1 Completed",
    expanded: true,
  },
];

const MB = 1024 * 1024;

function buildSystemResources(
  name: DebugScenarioName,
  now: number,
): {
  systemSnapshot: SystemResourceSnapshot;
  cpuHistory: number[];
} {
  if (name === "Idle" || name === "Quota Exhausted") {
    return {
      systemSnapshot: {
        app: { cpu_percent: 0.4, memory_bytes: 310 * MB },
        tasks: { cpu_percent: 0, memory_bytes: 0 },
        total: { cpu_percent: 0.4, memory_bytes: 310 * MB },
        sample_time_ms: now,
      },
      cpuHistory: [0.4, 0.5, 0.4, 0.4, 0.3, 0.4],
    };
  }
  if (
    name === "Completed Loading" ||
    name === "Completed Ready" ||
    name === "Expired Completed Expanded" ||
    name === "Interrupted" ||
    name === "2 Completed"
  ) {
    return {
      systemSnapshot: {
        app: { cpu_percent: 0.8, memory_bytes: 320 * MB },
        tasks: { cpu_percent: 0.4, memory_bytes: 160 * MB },
        total: { cpu_percent: 1.2, memory_bytes: 480 * MB },
        sample_time_ms: now,
      },
      cpuHistory: [1.0, 1.1, 1.0, 1.2, 1.3, 1.2],
    };
  }
  if (
    name === "2 Active Sessions" ||
    name === "1 Active + 1 Completed" ||
    name === "2 Active + 1 Completed" ||
    name === "Multi Agent" ||
    name === "Agent Permission"
  ) {
    return {
      systemSnapshot: {
        app: { cpu_percent: 1.5, memory_bytes: 350 * MB },
        tasks: { cpu_percent: 3.3, memory_bytes: 330 * MB },
        total: { cpu_percent: 4.8, memory_bytes: 680 * MB },
        sample_time_ms: now,
      },
      cpuHistory: [3.2, 3.8, 4.1, 4.5, 4.6, 4.8],
    };
  }
  return {
    systemSnapshot: {
      app: { cpu_percent: 1.2, memory_bytes: 340 * MB },
      tasks: { cpu_percent: 2.3, memory_bytes: 180 * MB },
      total: { cpu_percent: 3.5, memory_bytes: 520 * MB },
      sample_time_ms: now,
    },
    cpuHistory: [2.1, 2.6, 3.1, 2.9, 3.6, 3.5],
  };
}

export function createDebugScenario(name: DebugScenarioName, now: number): DebugScenario {
  const session = (
    id: string,
    activity: Activity = "thinking",
    agents: Agent[] = [],
    attention: Session["attention"] = "none",
  ): Session => ({
    id,
    project: id,
    cwd: null,
    lifecycle: "active",
    activity,
    attention,
    currentCommand: null,
    startedAt: now - 94_000,
    lastActivityAt: now,
    model: "gpt-6-sol",
    currentTurnId: `${id}-turn`,
    agents,
  });
  const result = (id: string, kind: TurnResult["kind"] = "completed"): TurnResult => ({
    kind,
    sessionId: id,
    turnId: `${id}-turn`,
    finishedAt: now,
    project: id,
    model: "gpt-6-sol",
    startedAt: now - 94_000,
  });
  const agent = (id: string, attention: Agent["attention"] = "none"): Agent => ({
    id,
    activity: "working",
    attention,
    lastActivityAt: now,
  });
  const snapshot: ActivitySnapshot = { sessions: [], recentResults: [], updatedAt: now };
  const usage: UsageSnapshot = {
    fiveHour: { remainingPercent: 51, resetsAt: null },
    weekly: { remainingPercent: 84, resetsAt: null },
    updatedAt: now / 1000,
  };
  const tokens: Record<string, TokenUsageState> = {};
  const active = (activity: Activity) => {
    snapshot.sessions = [session("CodexLimitIsland", activity)];
  };
  if (["Thinking", "Searching", "Editing", "Executing", "Connecting", "Compacting"].includes(name))
    active(name.toLowerCase() as Activity);
  if (name === "Permission" || name === "Quota + Permission")
    snapshot.sessions = [session("CodexLimitIsland", "executing", [], "permission")];
  if (name === "Agent Permission")
    snapshot.sessions = [
      session("OtherProject"),
      session("CodexLimitIsland", "executing", [agent("worker", "permission")]),
    ];
  if (name === "Completed Loading" || name === "Completed Ready" || name === "Interrupted")
    snapshot.recentResults = [result("CodexLimitIsland", name === "Interrupted" ? "interrupted" : "completed")];
  if (name === "Expired Completed Expanded")
    snapshot.recentResults = [{ ...result("CodexLimitIsland"), finishedAt: now - 20_000 }];
  if (name === "2 Active Sessions" || name === "2 Active + 1 Completed")
    snapshot.sessions = [session("CodexLimitIsland"), { ...session("OtherProject", "editing"), model: "gpt-6.1-sol" }];
  if (name === "1 Active + 1 Completed") snapshot.sessions = [session("CodexLimitIsland")];
  if (name === "1 Active + 1 Completed" || name === "2 Active + 1 Completed")
    snapshot.recentResults = [{ ...result("FinishedProject"), model: "gpt-6-astra" }];
  if (name === "2 Completed")
    snapshot.recentResults = [result("FinishedProject"), { ...result("OtherProject"), model: null }];
  if (name === "Multi Agent") snapshot.sessions = [session("CodexLimitIsland", "working", [agent("a"), agent("b")])];
  if (name === "Quota Exhausted" || name === "Quota + Permission")
    usage.fiveHour = { remainingPercent: 0, resetsAt: null };
  for (const item of snapshot.recentResults) {
    if (item.kind !== "completed") continue;
    tokens[resultKey(item)] =
      name === "Completed Loading"
        ? { status: "loading" }
        : {
            status: "ready",
            taskTokens: item.sessionId === "OtherProject" ? 8_300 : 12_648,
            sessionTokens: 20_000,
            readyAt: name === "Expired Completed Expanded" ? now - 20_000 : now,
          };
  }
  return { snapshot, usage, tokens, ...buildSystemResources(name, now) };
}
