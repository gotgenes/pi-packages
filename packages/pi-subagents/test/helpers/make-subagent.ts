import type { CreateSubagentSessionParams } from "#src/lifecycle/create-subagent-session";
import { Subagent, type SubagentExecution } from "#src/lifecycle/subagent";
import type { SubagentSession } from "#src/lifecycle/subagent-session";
import { SubagentState, type SubagentStatus } from "#src/lifecycle/subagent-state";
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
	error?: string;
	/** Seed the never-started marker (the agent was stopped before it was admitted). */
	stoppedWhileQueued?: boolean;
	startedAt?: number;
	completedAt?: number;
	/** Seed the consumed-outcome timestamp (undefined = obligation open). */
	consumedAt?: number;
	/** Seed toolUses. */
	toolUses?: number;
	/** Seed lifetimeUsage. */
	lifetimeUsage?: { input: number; output: number; cacheWrite: number };
	/** Seed compactionCount. */
	compactionCount?: number;
	/**
	 * Set turnCount. Starts at 1; pass a higher value to simulate multiple turns.
	 * Ignored when `execution` is supplied (maxTurns lives on the execution, not state).
	 */
	turnCount?: number;
	/** Seed active tools by name. */
	activeTools?: string[];
	/** Seed responseText. */
	responseText?: string;
	/** Thread maxTurns into the stub execution. Ignored when `execution` is supplied. */
	maxTurns?: number;
}

export function createTestSubagent(overrides: TestSubagentOptions = {}): Subagent {
	const { id, type, description, isBackground, execution, toolCallId, toolUses, lifetimeUsage, compactionCount, turnCount, activeTools, responseText, maxTurns, ...stateOverrides } =
		overrides;
	const state = new SubagentState({
		status: "completed",
		result: "All done.",
		startedAt: 1000,
		completedAt: 2000,
		toolUses: toolUses ?? 3,
		lifetimeUsage: lifetimeUsage ?? { input: 500, output: 500, cacheWrite: 0 },
		...(compactionCount !== undefined ? { compactionCount } : {}),
		...(turnCount !== undefined ? { turnCount } : {}),
		...(activeTools !== undefined ? { activeTools } : {}),
		...(responseText !== undefined ? { responseText } : {}),
		...stateOverrides,
	});
	return new Subagent({
		id: id ?? "agent-1",
		type: type ?? "general-purpose",
		description: description ?? "Test task",
		isBackground: isBackground ?? true,
		execution: execution ?? makeStubExecution({
			...(toolCallId ? { parentSession: { toolCallId } } : {}),
			...(maxTurns !== undefined ? { maxTurns } : {}),
		}),
		state,
	});
}
