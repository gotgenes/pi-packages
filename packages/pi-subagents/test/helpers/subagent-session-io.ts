import { vi } from "vitest";
import type { AgentConfigLookup } from "#src/config/agent-types";
import type { ChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import type { AgentConfig, ShellExec } from "#src/types";
import { createMockSession } from "#test/helpers/mock-session";

/** Default AgentConfig returned by createAgentLookup. Matches the Explore stub used in factory tests. */
const DEFAULT_AGENT_CONFIG: AgentConfig = {
	name: "Explore",
	description: "Explore",
	builtinToolNames: ["read"],
	systemPrompt: "You are Explore.",
	promptMode: "replace",
	inheritContext: false,
	runInBackground: false,
};

/**
 * Shared SubagentSessionIO stub factory for createSubagentSession tests.
 *
 * Return type is deliberately unannotated so vi.fn() stubs retain their
 * Mock<...> methods (mockResolvedValue, mock.calls, etc.).
 *
 * The assemblerIO sub-object only includes the method that exists on the
 * production AssemblerIO interface. The stale buildMemoryBlock and
 * buildReadOnlyMemoryBlock stubs from older test files are intentionally omitted.
 *
 * To customize assemblerIO methods after creation, configure the returned Mock:
 *   const io = createSubagentSessionIO();
 *   io.assemblerIO.buildAgentPrompt.mockReturnValue("custom");
 */
export function createSubagentSessionIO() {
	return {
		detectEnv: vi.fn().mockResolvedValue({ isGitRepo: false, branch: "", platform: "linux" }),
		getAgentDir: vi.fn().mockReturnValue("/mock/agent-dir"),
		createResourceLoader: vi.fn().mockReturnValue({ reload: vi.fn().mockResolvedValue(undefined) }),
		deriveSessionDir: vi.fn().mockReturnValue("/mock/session-dir/tasks"),
		createSessionManager: vi.fn().mockReturnValue({
			newSession: vi.fn(),
			getSessionFile: vi.fn().mockReturnValue("/sessions/child.jsonl"),
			getSessionId: vi.fn().mockReturnValue("child-session-id"),
		}),
		createSettingsManager: vi.fn().mockReturnValue({}),
		createSession: vi.fn(),
		assemblerIO: {
			buildAgentPrompt: vi.fn((..._args: unknown[]): string => "system prompt"),
		},
	};
}

/**
 * Shared AgentConfigLookup stub.
 *
 * Returns the default Explore config (same as the static mock used in the
 * createSubagentSession tests). Pass a partial config to override specific fields.
 *
 * Tests that need per-test config mutation (create-subagent-session-extension-tools)
 * keep their local mutable wrapper and use DEFAULT_AGENT_CONFIG as a starting
 * point if needed.
 */
export function createAgentLookup(configOverrides?: Partial<AgentConfig>) {
	const config: AgentConfig = { ...DEFAULT_AGENT_CONFIG, ...configOverrides };
	return {
		resolveAgentConfig: vi.fn((_type: string): AgentConfig => config),
		getToolNamesForType: vi.fn((_type: string): string[] => config.builtinToolNames ?? ["read"]),
	};
}

/**
 * Shared SubagentSessionDeps stub factory for tests that call createSubagentSession().
 *
 * Bundles createSubagentSessionIO(), a no-op exec stub, and a default agent
 * lookup into the SubagentSessionDeps shape expected by createSubagentSession().
 *
 * Each field accepts an override so tests can supply a locally-configured `io`
 * (e.g. one whose createSession mock is pre-armed), a shared exec, or a custom
 * agent lookup. The `io` override keeps its mock methods (the param type is the
 * unannotated createSubagentSessionIO() shape), so callers can still assert on it.
 */
export function createSubagentSessionDeps(overrides?: {
	io?: ReturnType<typeof createSubagentSessionIO>;
	exec?: ShellExec;
	registry?: AgentConfigLookup;
	getExcludedExtensionPackages?: () => readonly string[];
	lifecycle?: ReturnType<typeof createChildLifecycleMock>;
}) {
	return {
		io: overrides?.io ?? createSubagentSessionIO(),
		exec: overrides?.exec ?? vi.fn(),
		registry: overrides?.registry ?? createAgentLookup(),
		getExcludedExtensionPackages: overrides?.getExcludedExtensionPackages ?? (() => []),
		lifecycle: overrides?.lifecycle ?? createChildLifecycleMock(),
	};
}

/**
 * Mock ChildLifecyclePublisher for lifecycle tests.
 *
 * Each method is a vi.fn() so tests can assert emit calls and ordering
 * (via mock.invocationCallOrder) relative to session.bindExtensions().
 * Return type is unannotated so the vi.fn() Mock<...> methods survive.
 */
export function createChildLifecycleMock() {
	return {
		spawning: vi.fn<ChildLifecyclePublisher["spawning"]>(),
		sessionCreated: vi.fn<ChildLifecyclePublisher["sessionCreated"]>(),
		completed: vi.fn<ChildLifecyclePublisher["completed"]>(),
		disposed: vi.fn<ChildLifecyclePublisher["disposed"]>(),
	};
}

/** The default agent config, exported for tests that build mutable wrappers around it. */
export { DEFAULT_AGENT_CONFIG };

export interface FactorySessionOptions {
	/** Tools active before bindExtensions(). Default ["read"]. */
	toolsBeforeBind?: string[];
	/** Tools active after bindExtensions(). Defaults to toolsBeforeBind (no extension registration). */
	toolsAfterBind?: string[];
}

/**
 * Shared mock session for createSubagentSession tests.
 *
 * Layers the createSubagentSession factory facet (`prompt`/`abort`/
 * `bindExtensions`/`setActiveToolsByName`/`getActiveToolNames`) on top of the
 * shared `createMockSession` core, which supplies the `messages`/`subscribe`/
 * `emit`/`steer`/`dispose`/`sessionManager` base (a working event bus).
 *
 * Builds the session stub that createSubagentSession's IO resolves
 * (`io.createSession.mockResolvedValue({ session })`). `getActiveToolNames`
 * returns `toolsBeforeBind` until `bindExtensions()` is awaited, then
 * `toolsAfterBind` — modelling extension-registered tools joining the active
 * set during bind. When `toolsAfterBind` is omitted the set is unchanged.
 *
 * Return type is deliberately unannotated so vi.fn() stubs retain their
 * Mock<...> methods (mock.calls, mockResolvedValue, etc.).
 */
export function createFactorySession(options: FactorySessionOptions = {}) {
	const before = options.toolsBeforeBind ?? ["read"];
	const after = options.toolsAfterBind ?? before;
	let bound = false;
	return {
		...createMockSession(),
		prompt: vi.fn().mockResolvedValue(undefined),
		abort: vi.fn(),
		getActiveToolNames: vi.fn(() => (bound ? after : before)),
		setActiveToolsByName: vi.fn(),
		bindExtensions: vi.fn(async () => {
			bound = true;
		}),
	};
}
