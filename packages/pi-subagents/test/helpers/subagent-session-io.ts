import { vi } from "vitest";
import type { AgentConfigLookup } from "#src/config/agent-types";
import type { ChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import type {
	ContinuedTranscript,
	ReopenedSessionManagerLike,
	TranscriptEntryLike,
} from "#src/lifecycle/create-subagent-session";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import type { BranchEntryLike } from "#src/session/recorded-model";
import type { AssemblerIO } from "#src/session/session-config";
import type { ChildTranscriptHeader } from "#src/session/transcript-header";
import type { AgentConfig, PromptInheritance, ShellExec } from "#src/types";
import { makeModel } from "#test/helpers/make-model";
import { createMockSession } from "#test/helpers/mock-session";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";

/** Default AgentConfig returned by createAgentLookup. Matches the Explore stub used in factory tests. */
const DEFAULT_AGENT_CONFIG: AgentConfig = {
	name: "Explore",
	description: "Explore",
	toolNames: ["read"],
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
 * The assemblerIO sub-object only includes the methods that exist on the
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
		// A reopened transcript: EARLIER_TRANSCRIPT's child, whose branch selects
		// EARLIER_MODEL unless a test arms getBranch.
		openSessionManager: vi.fn((_transcript: string) => createReopenedSessionManager()),
		// What EARLIER_TRANSCRIPT's file says before it is opened: the same child.
		readTranscriptHeader: vi.fn((_transcript: string): ChildTranscriptHeader | undefined => ({ ...EARLIER_TRANSCRIPT.header })),
		createSettingsManager: vi.fn().mockReturnValue({}),
		// Identity by default: no package exclusions, so children inherit everything.
		createLoaderSettingsManager: vi.fn().mockImplementation((parent: unknown) => parent),
		createSession: vi.fn(),
		assemblerIO: {
			// Typed against the real signature so a test can read back the
			// inherited-prompt argument the assembler composed.
			buildAgentPrompt: vi.fn<AssemblerIO["buildAgentPrompt"]>(() => "system prompt"),
			loadProjectContext: vi.fn<AssemblerIO["loadProjectContext"]>(() => undefined),
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
		getToolNamesForType: vi.fn((_type: string): string[] => config.toolNames ?? ["read"]),
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
	lifecycle?: ReturnType<typeof createChildLifecycleMock>;
	resolvePromptInheritance?: (provider: string | undefined) => PromptInheritance;
	listParentToolNames?: () => readonly string[];
	currentAgentConfig?: (type: string) => AgentConfig | undefined;
}) {
	return {
		io: overrides?.io ?? createSubagentSessionIO(),
		exec: overrides?.exec ?? vi.fn(),
		registry: overrides?.registry ?? createAgentLookup(),
		lifecycle: overrides?.lifecycle ?? createChildLifecycleMock(),
		resolvePromptInheritance:
			overrides?.resolvePromptInheritance ??
			vi.fn((_provider: string | undefined): PromptInheritance => "full"),
		listParentToolNames:
			overrides?.listParentToolNames ?? vi.fn((): readonly string[] => []),
		// A continued child's type is still defined, as the default agent config.
		currentAgentConfig:
			overrides?.currentAgentConfig ?? vi.fn((_type: string): AgentConfig | undefined => DEFAULT_AGENT_CONFIG),
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
		bound: vi.fn<ChildLifecyclePublisher["bound"]>(),
		completed: vi.fn<ChildLifecyclePublisher["completed"]>(),
		disposed: vi.fn<ChildLifecyclePublisher["disposed"]>(),
	};
}

/**
 * The settled child a factory test continues: its transcript and the identity
 * it was recorded under, which `createReopenedSessionManager()` reopens by default.
 */
export const EARLIER_TRANSCRIPT: ContinuedTranscript = {
	file: "/sessions/tasks/earlier-child.jsonl",
	header: { id: "earlier-child-session-id", cwd: "/work/earlier", parentSession: "parent-id" },
	leafId: "earlier-reply",
	// DEFAULT_AGENT_CONFIG, which the default currentAgentConfig answers with, names no file.
	agentDefinition: "builtin",
};

/** The model EARLIER_TRANSCRIPT's child last replied on; `EARLIER_SNAPSHOT`'s registry knows it. */
export const EARLIER_MODEL = makeModel({ provider: "recorded-provider", id: "recorded-model" });

/** A parent snapshot whose model registry still knows EARLIER_MODEL, so the child can be continued on it. */
export const EARLIER_SNAPSHOT: ParentSnapshot = {
	...STUB_SNAPSHOT,
	modelRegistry: {
		find: (provider: string, modelId: string) =>
			provider === EARLIER_MODEL.provider && modelId === EARLIER_MODEL.id ? EARLIER_MODEL : undefined,
		getAll: () => [EARLIER_MODEL],
	},
};

/** A raw transcript entry as a reopened session manager stub holds it. */
export type ReopenedEntry = TranscriptEntryLike & BranchEntryLike;

/**
 * Entries chained in the order given, each the parent of the next and the
 * first a root: an intact linear transcript. Ids default to `entry-<index>`.
 */
export function chainEntries(entries: readonly (Omit<ReopenedEntry, "id" | "parentId"> & { id?: string })[]): ReopenedEntry[] {
	const chained: ReopenedEntry[] = [];
	for (const [index, entry] of entries.entries()) {
		chained.push({ ...entry, id: entry.id ?? `entry-${index}`, parentId: chained.at(-1)?.id ?? null });
	}
	return chained;
}

/**
 * EARLIER_TRANSCRIPT's entries: the child's prompt, then its reply on
 * EARLIER_MODEL, the entry its last run left last.
 */
const EARLIER_ENTRIES = chainEntries([
	{ type: "message", id: "earlier-prompt", message: { role: "user" } },
	{
		type: "message",
		id: EARLIER_TRANSCRIPT.leafId,
		message: { role: "assistant", provider: EARLIER_MODEL.provider, model: EARLIER_MODEL.id, api: "openai-responses" },
	},
]);

/**
 * A session manager reopened on EARLIER_TRANSCRIPT: the identity it was
 * recorded under, and `entries` (by default its prompt and its reply, which
 * selects EARLIER_MODEL), continued from the last of them. The branch stub
 * returns the entries as they are, standing in for Pi's walk of an intact
 * linear chain. Each method is a typed stub, so a test can arm or inspect it
 * and the whole stays checked against ReopenedSessionManagerLike where it is
 * used.
 */
export function createReopenedSessionManager(entries: readonly ReopenedEntry[] = EARLIER_ENTRIES) {
	const { header } = EARLIER_TRANSCRIPT;
	return {
		newSession: vi.fn<ReopenedSessionManagerLike["newSession"]>(),
		getSessionFile: vi.fn((): string | undefined => EARLIER_TRANSCRIPT.file),
		getSessionId: vi.fn((): string => header.id),
		getHeader: vi.fn((): ReturnType<ReopenedSessionManagerLike["getHeader"]> => ({ ...header })),
		getEntries: vi.fn((): readonly ReopenedEntry[] => entries),
		getLeafId: vi.fn((): string | null => entries.at(-1)?.id ?? null),
		getBranch: vi.fn((): readonly ReopenedEntry[] => entries),
	};
}

/** The default agent config, exported for tests that build mutable wrappers around it. */
export { DEFAULT_AGENT_CONFIG };

/**
 * Shared mock session for createSubagentSession tests.
 *
 * Layers the createSubagentSession factory facet (`prompt`/`abort`/
 * `bindExtensions`/`setActiveToolsByName`/`getActiveToolNames`) on top of the
 * shared `createMockSession` core, which supplies the `messages`/`subscribe`/
 * `emit`/`steer`/`dispose`/`sessionManager` base (a working event bus).
 *
 * Builds the session stub that createSubagentSession's IO resolves
 * (`io.createSession.mockResolvedValue({ session })`).
 *
 * Return type is deliberately unannotated so vi.fn() stubs retain their
 * Mock<...> methods (mock.calls, mockResolvedValue, etc.).
 */
export function createFactorySession() {
	return {
		...createMockSession(),
		prompt: vi.fn().mockResolvedValue(undefined),
		abort: vi.fn(),
		getActiveToolNames: vi.fn((): string[] => ["read"]),
		setActiveToolsByName: vi.fn(),
		bindExtensions: vi.fn(async (): Promise<void> => undefined),
	};
}
