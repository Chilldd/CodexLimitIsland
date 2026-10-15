// 由 Rust ts-rs 生成；运行 npm.cmd run contracts:generate，请勿手工编辑。
export type Activity = "thinking" | "working" | "searching" | "editing" | "executing" | "connecting" | "compacting";

export type Attention = "none" | "permission";

export type Lifecycle = "idle" | "active";

export type TurnResultKind = "completed" | "interrupted";

export type Agent = { id: string, activity: Activity | null, attention: Attention, lastActivityAt: number, };

export type Session = { id: string, project: string | null, cwd: string | null, lifecycle: Lifecycle, activity: Activity | null, attention: Attention, currentCommand: string | null, startedAt: number | null, lastActivityAt: number, model: string | null, currentTurnId: string | null, agents: Array<Agent>, };

export type TurnResult = { kind: TurnResultKind, sessionId: string, turnId: string | null, finishedAt: number, project: string | null, model: string | null, startedAt: number | null, };

export type ActivitySnapshot = { sessions: Array<Session>, recentResults: Array<TurnResult>, updatedAt: number, };

export type LimitWindow = { remainingPercent: number, resetsAt: number | null, };

export type UsageSnapshot = { fiveHour: LimitWindow | null, weekly: LimitWindow | null, updatedAt: number, };

export type LimitDisplayWindow = "fiveHour" | "week";

export type TokenUsage = { taskTokens: number | null, sessionTokens: number | null, };
