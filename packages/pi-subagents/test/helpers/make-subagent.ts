import type { CreateSubagentSessionParams } from "#src/lifecycle/create-subagent-session";
import { Subagent, type SubagentExecution } from "#src/lifecycle/subagent";
import type { SubagentSession } from "#src/lifecycle/subagent-session";
import { SubagentState, type SubagentStatus } from "#src/lifecycle/subagent-state";
import type { AgentInvocation, ParentResultMode, SubagentType } from "#src/types";
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
	invocation?: AgentInvocation;
	execution?: SubagentExecution;
	/** Shorthand to set execution.parentSession.toolCallId. Ignored when execution is supplied. */
	toolCallId?: string;
	/** Passive lifecycle state shorthands. */
	status?: SubagentStatus;
	result?: string;
	error?: string;
	startedAt?: number;
	completedAt?: number;
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
	/** Thread parent result visibility into the stub execution. Ignored when `execution` is supplied. */
	parentResultMode?: ParentResultMode;
}

export function createTestSubagent(overrides: TestSubagentOptions = {}): Subagent {
	const { id, type, description, invocation, execution, toolCallId, toolUses, lifetimeUsage, compactionCount, turnCount, activeTools, responseText, maxTurns, parentResultMode, ...stateOverrides } =
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
		invocation,
		execution: execution ?? makeStubExecution({
			...(toolCallId ? { parentSession: { toolCallId } } : {}),
			...(maxTurns !== undefined ? { maxTurns } : {}),
			...(parentResultMode !== undefined ? { parentResultMode } : {}),
		}),
		state,
	});
}
