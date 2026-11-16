import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Mock } from "vitest";
import { vi } from "vitest";
import type { SubagentSession } from "#src/lifecycle/subagent-session";
import { turnLoopResult } from "#test/helpers/turn-loop-result";

/** The core shape returned by `createMockSession`. */
export interface MockSession {
	messages: unknown[];
	subscribe: Mock<(fn: (event: unknown) => void) => () => void>;
	emit(event: unknown): void;
	/** How many subscriptions are live now: unsubscribed ones are not counted. */
	listenerCount(): number;
	dispose: Mock<() => void>;
	steer: Mock<(...args: unknown[]) => Promise<unknown>>;
	sessionManager: { getSessionFile: Mock<() => unknown> };
	getToolDefinition: Mock<(name: string) => unknown>;
	hasExtensionHandlers: Mock<(eventType: string) => boolean>;
	extensionRunner: { emit: Mock<(event: unknown) => Promise<unknown>> };
	/** The child's current model, as `AgentSession.model` reports it. */
	model: { provider: string; id: string } | undefined;
	/** The child's current thinking level, as `AgentSession.thinkingLevel` reports it. */
	thinkingLevel: string;
}

/**
 * Emit the standard resume event pair onto a MockSession: one assistant
 * message_end carrying usage, then one compaction_end. Shared by the
 * subagent-manager and subagent resume-observer tests, which assert on these
 * exact payloads (input:70/output:30/cacheWrite:5, tokensBefore:999).
 */
export function emitResumeUsageAndCompaction(session: MockSession): void {
	session.emit({ type: "message_end", message: { role: "assistant", usage: { input: 70, output: 30, cacheWrite: 5 } } });
	session.emit({ type: "compaction_end", aborted: false, result: { tokensBefore: 999 }, reason: "overflow" });
}

/**
 * Cast a MockSession to AgentSession for use as a SubagentSession's session.
 *
 * AgentSession is a class with private fields — no plain object satisfies it
 * without a type bridge. Centralising the cast here keeps test files free of
 * SDK imports and makes the intent explicit.
 */
export function toAgentSession(session: MockSession): AgentSession {
	return session as unknown as AgentSession;
}

/**
 * Build a SubagentSession-shaped stub wrapping a MockSession.
 *
 * For tests that only need an Agent to own a `.session` / `.outputFile`: the
 * turn-driving methods are inert vi.fn() spies, and `steer`/`dispose` delegate
 * to the underlying MockSession so existing session-spy assertions keep working.
 * `dispose` resolves a promise, mirroring the real teardown that awaits the
 * child's `session_shutdown` before disposing the session.
 */
export function createSubagentSessionStub(
	session: MockSession = createMockSession(),
	outputFile?: string,
) {
	return {
		session,
		outputFile,
		runTurnLoop: vi.fn().mockResolvedValue(turnLoopResult({ responseText: "done" })),
		steer: vi.fn((message: string): Promise<void> => session.steer(message) as Promise<void>),
		dispose: vi.fn((): Promise<void> => {
			session.dispose();
			return Promise.resolve();
		}),
		getConversation: vi.fn((): string => ""),
		getContextPercent: vi.fn((): number | null => null),
		subscribe: vi.fn((fn: (event: unknown) => void): (() => void) => session.subscribe(fn)),
		getSessionStats: vi.fn(() => ({
			tokens: { input: 0, output: 0, cacheWrite: 0 },
			contextUsage: { percent: null as number | null },
		})),
		get messages(): readonly unknown[] { return session.messages; },
		get agentMessages(): readonly unknown[] { return session.messages; },
		get model(): MockSession["model"] { return session.model; },
		get thinkingLevel(): string { return session.thinkingLevel; },
		getToolDefinition: vi.fn((name: string): unknown => session.getToolDefinition(name)),
	};
}

/**
 * Cast a SubagentSession stub to SubagentSession for assignment to Agent.
 *
 * SubagentSession is a class with private fields — no plain object satisfies it
 * without a type bridge. Centralising the cast keeps test files explicit.
 */
export function toSubagentSession(stub: ReturnType<typeof createSubagentSessionStub>): SubagentSession {
	return stub as unknown as SubagentSession;
}

/**
 * Shared test fixture: subscribable event bus with spy stubs.
 *
 * This is the shared session-mock core. `createFactorySession`
 * (`subagent-session-io.ts`) spreads it to inherit the
 * `messages`/`subscribe`/`emit`/`steer`/`dispose`/`sessionManager` base, and
 * `createSubagentSessionStub` (above) composes it as the wrapped `.session`.
 *
 * All fields are always present — callers that only need `subscribe`/`emit`
 * can ignore the rest. Pass `overrides` to replace or extend specific fields.
 */
export function createMockSession(overrides: Record<string, unknown> = {}): MockSession & Record<string, unknown> {
	const subscribers = new Set<(event: unknown) => void>();

	const subscribe = vi.fn((fn: (event: unknown) => void) => {
		subscribers.add(fn);
		return () => {
			subscribers.delete(fn);
		};
	});

	const base: MockSession = {
		messages: [],
		subscribe,
		emit(event: unknown) {
			for (const fn of subscribers) fn(event);
		},
		listenerCount: () => subscribers.size,
		dispose: vi.fn(),
		steer: vi.fn().mockResolvedValue(undefined),
		sessionManager: { getSessionFile: vi.fn() },
		getToolDefinition: vi.fn((_name: string): unknown => undefined),
		// Extension-runner seam read by emitChildSessionShutdown on disposal (#709).
		// Defaults to "this child has shutdown handlers" so every teardown path
		// under test exercises the emit rather than its skip branch.
		hasExtensionHandlers: vi.fn((_eventType: string): boolean => true),
		extensionRunner: {
			emit: vi.fn((_event: unknown): Promise<unknown> => Promise.resolve(undefined)),
		},
		model: undefined,
		thinkingLevel: "off",
	};

	return { ...base, ...overrides };
}
