import type { CreateSubagentSessionParams } from "#src/lifecycle/create-subagent-session";
import { Subagent, type SubagentExecution } from "#src/lifecycle/subagent";
import type { SubagentSession } from "#src/lifecycle/subagent-session";
import { SubagentState, type SubagentStatus } from "#src/lifecycle/subagent-state";
import type { TurnBudget } from "#src/lifecycle/turn-limits";
import type { SubagentType } from "#src/types";
import { createSubagentSessionStub, toSubagentSession } from "#test/helpers/mock-session";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";

/**
 * A minimal, mandatory SubagentExecution for tests that build a passive record
 * and never call run(). The factory resolves to a default session stub.
 */
export function makeStubExecution(overrides: Partial<SubagentExecution> = {}): SubagentExecution {
	return {
		createSubagentSession: async (_params: CreateSubagentSessionParams): Promise<SubagentSession> =>
			toSubagentSession(createSubagentSessionStub()),
		snapshot: STUB_SNAPSHOT,
		prompt: "do something",
		baseCwd: "",
		...overrides,
	};
}

export interface TestSubagentOptions {
	id?: string;
	type?: SubagentType;
	description?: string;
	/** Defaults to true so a fixture survives the widget's background-only filter. */
	isBackground?: boolean;
	execution?: SubagentExecution;
	/** Shorthand to set execution.parentSession.toolCallId. Ignored when execution is supplied. */
	toolCallId?: string;
	/** Passive lifecycle state shorthands. */
	status?: SubagentStatus;
	result?: string;
	/** Seed the question the agent ended its turn with. */
	pendingQuestion?: string;
	/** Seed what a teardown with no result text reported. */
	workspaceNotice?: string;
	/** Seed the run's turn limit and its use. */
	turnBudget?: TurnBudget;
	error?: string;
	/** Seed the never-started marker (the agent was stopped before it was admitted). */
	stoppedWhileQueued?: boolean;
	startedAt?: number;
	/** Seed when the run last made progress; defaults to startedAt. */
	lastProgressAt?: number;
	completedAt?: number;
	/** Seed the consumed-outcome timestamp (undefined = obligation open). */
	consumedAt?: number;
	/** Seed toolUses. */
	toolUses?: number;
	/** Seed lifetimeUsage. */
	lifetimeUsage?: { input: number; output: number; cacheWrite: number };
	/** Seed compactionCount. */
	compactionCount?: number;
	/** Seed active tools by name. */
	activeTools?: string[];
	/** Seed the run's updates, in order (each replays recordUpdate). */
	runUpdates?: string[];
	/** Seed responseText. */
	responseText?: string;
	/**
	 * Attach a session stub after construction, so the record reads as
	 * session-ready. Defaults to false: a passive fixture has never run, so it has
	 * no session, which is what most callers want.
	 */
	sessionReady?: boolean;
	/**
	 * Transcript path the attached session stub reports. Ignored unless
	 * `sessionReady` is set — a record with no session has no transcript.
	 */
	outputFile?: string;
}

export function createTestSubagent(overrides: TestSubagentOptions = {}): Subagent {
	const { id, type, description, isBackground, execution, toolCallId, runUpdates, sessionReady, outputFile } = overrides;
	// Every seed is named as a literal property, so a key that leaves its owner's
	// init type fails the type check instead of dropping silently. A seed with a
	// default honors an explicit `undefined` (e.g. `completedAt: undefined` for a
	// running fixture), as the spread this replaced did.
	const startedAt = seeded(overrides, "startedAt", 1000);
	const state = new SubagentState({
		// What spans runs
		lastProgressAt: overrides.lastProgressAt ?? startedAt,
		toolUses: overrides.toolUses ?? 3,
		lifetimeUsage: overrides.lifetimeUsage ?? { input: 500, output: 500, cacheWrite: 0 },
		compactionCount: overrides.compactionCount,
		activeTools: overrides.activeTools,
		responseText: overrides.responseText,
	});
	const agent = new Subagent({
		id: id ?? "agent-1",
		type: type ?? "general-purpose",
		description: description ?? "Test task",
		isBackground: isBackground ?? true,
		execution: execution ?? makeStubExecution({
			...(toolCallId ? { parentSession: { toolCallId } } : {}),
		}),
		state,
		// The initial run's outcome
		outcome: {
			status: seeded(overrides, "status", "completed"),
			result: seeded(overrides, "result", "All done."),
			error: overrides.error,
			stoppedWhileQueued: overrides.stoppedWhileQueued,
			startedAt,
			completedAt: seeded(overrides, "completedAt", 2000),
			pendingQuestion: overrides.pendingQuestion,
			workspaceNotice: overrides.workspaceNotice,
			turnBudget: overrides.turnBudget,
			runUpdates,
			consumedAt: overrides.consumedAt,
		},
	});
	// Assigned rather than passed to the constructor: run() is what sets this in
	// production, and a passive fixture never runs.
	if (sessionReady) {
		agent.subagentSession = toSubagentSession(createSubagentSessionStub(undefined, outputFile));
	}
	return agent;
}

/** The override for `key` when the caller supplied one (even `undefined`), else the fixture default. */
function seeded<K extends keyof TestSubagentOptions>(
	overrides: TestSubagentOptions,
	key: K,
	fallback: NonNullable<TestSubagentOptions[K]>,
): TestSubagentOptions[K] {
	return Object.hasOwn(overrides, key) ? overrides[key] : fallback;
}
