/**
 * A settled child restored across a reload, end to end on Pi's real session
 * machinery: a real child transcript written by a real `AgentSession`, a real
 * parent session file, and a deterministic model that answers from what its
 * request actually carries. Only the model's replies are scripted, so the
 * resumed child can recall the earlier conversation only if the transcript
 * really reached it.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AssistantMessage,
  type FauxProviderHandle,
  fauxAssistantMessage,
  fauxProvider,
  type Model,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import { loadCustomAgents } from "#src/config/custom-agents";
import { createChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import { ConcurrencyLimiter } from "#src/lifecycle/concurrency-limiter";
import { createSubagentSession, type SubagentSessionDeps } from "#src/lifecycle/create-subagent-session";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import { type ChildHistory, SubagentManager } from "#src/lifecycle/subagent-manager";
import { SUBAGENT_RECORD_ENTRY, toPersistedRecord } from "#src/persisted-record";
import { buildAgentPrompt } from "#src/session/prompts";
import { deriveSubagentSessionDir } from "#src/session/session-dir";
import { readTranscriptHeader } from "#src/session/transcript-header";

const CODE_WORD = "PERIWINKLE";
/** The prompt of a child that holds the only concurrency slot until the test lets it answer. */
const OCCUPY = "Occupy the only slot.";
const RECALL = "What was the code word?";

/** The text of every user message a request carries, in order. */
function userTexts(context: TranscriptContext): string[] {
  return context.messages.flatMap((message) => {
    if (message.role !== "user") return [];
    if (typeof message.content === "string") return [message.content];
    return message.content.flatMap((part) => (part.type === "text" ? [part.text] : []));
  });
}

/**
 * The scripted model: it notes a code word it is given, and asked to recall
 * one, answers with whatever code word the request's own conversation holds.
 */
function answer(context: TranscriptContext): AssistantMessage {
  const said = userTexts(context);
  const latest = said.at(-1) ?? "";
  if (!latest.includes(RECALL)) return fauxAssistantMessage("Noted.");
  const given = said.map((text) => /code word is (\w+)/.exec(text)?.[1]).find((word) => word !== undefined);
  return fauxAssistantMessage(given ? `The code word was ${given}.` : "I was never told a code word.");
}

describe("restoring a settled child from its real transcript", () => {
  let root: string;
  let project: string;
  let agentDir: string;
  let faux: FauxProviderHandle;
  let runtime: ModelRuntime;
  let registry: ModelRegistry;
  /** The model each request ran on, in order. */
  let requestedModels: string[];
  /** The user messages each request carried, in order. */
  let requests: string[][];
  /** The tool allowlist each child session was created with, in order. */
  let allowlists: string[][];
  /** Lets the slot-holding child answer, freeing its slot. */
  let releaseOccupant: () => void;
  const managers: SubagentManager[] = [];

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "pi-restore-real-"));
    project = join(root, "project");
    agentDir = join(root, "agent");
    mkdirSync(project);
    mkdirSync(agentDir);
    requestedModels = [];
    requests = [];
    allowlists = [];
    // The host's own global agents stay out: this directory defines none unless a test writes one.
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    agentTypes.reload();
    const occupied = Promise.withResolvers<void>(); // eslint-disable-line @typescript-eslint/no-invalid-void-type -- Promise.withResolvers<void> is valid; rule does not allow void in generic fn call type args
    releaseOccupant = () => { occupied.resolve(); };
    faux = fauxProvider({ provider: "faux", models: [{ id: "scripted" }, { id: "parent-default" }] });
    const respond = (context: TranscriptContext, _options: unknown, _state: unknown, model: Model<string>) => {
      requestedModels.push(model.id);
      requests.push(userTexts(context));
      if (userTexts(context).at(-1) === OCCUPY) return occupied.promise.then(() => fauxAssistantMessage("Held it."));
      return answer(context);
    };
    faux.setResponses(Array.from({ length: 8 }, () => respond));
    runtime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: null,
      allowModelNetwork: false,
    });
    runtime.registerNativeProvider(faux.provider);
    registry = new ModelRegistry(runtime);
  });

  afterEach(async () => {
    await Promise.all(managers.splice(0).map((manager) => manager.dispose()));
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * The agent definitions every manager and factory here reads: the built-ins,
   * then the project's `.pi/agents/` and the test's own global agent directory.
   */
  const agentTypes = new AgentTypeRegistry(() => (project ? loadCustomAgents(project) : new Map()));

  /** The session-assembly deps the composition root builds, on the real SDK. */
  function realDeps(): SubagentSessionDeps {
    return {
      io: {
        detectEnv: () => Promise.resolve({ isGitRepo: false, branch: "", platform: "linux" }),
        getAgentDir: () => agentDir,
        deriveSessionDir: deriveSubagentSessionDir,
        createResourceLoader: (opts) => new DefaultResourceLoader(opts),
        createSessionManager: (cwd, dir) => SessionManager.create(cwd, dir),
        openSessionManager: (transcript) => SessionManager.open(transcript),
        readTranscriptHeader,
        createSettingsManager: (cwd, dir) => SettingsManager.create(cwd, dir),
        createLoaderSettingsManager: (parent) => parent,
        createSession: ({ sessionManager, resourceLoader, modelRegistry: _modelRegistry, ...rest }) => {
          allowlists.push(rest.tools);
          return createAgentSession({
            ...rest,
            sessionManager: sessionManager as SessionManager,
            resourceLoader: resourceLoader as ResourceLoader,
            modelRuntime: runtime,
          });
        },
        assemblerIO: { buildAgentPrompt, loadProjectContext: () => undefined },
      },
      exec: () => Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false }),
      registry: agentTypes,
      lifecycle: createChildLifecyclePublisher(() => {}),
      resolvePromptInheritance: () => "full",
      listParentToolNames: () => [],
      currentAgentConfig: (type) => {
        agentTypes.reload();
        return agentTypes.findEnabledConfig(type);
      },
    };
  }

  /** The parent as a manager snapshots it: on another model than the child's. */
  function snapshot(): ParentSnapshot {
    return {
      cwd: project,
      systemPrompt: "You are the parent.",
      model: registry.find("faux", "parent-default"),
      modelRegistry: registry,
    };
  }

  /**
   * A manager over the real SDK. Given `record`, it appends each finished run
   * there as the extension's events observer does.
   */
  function createManager(history?: ChildHistory, maxConcurrent = 4, record?: SessionManager): SubagentManager {
    const deps = realDeps();
    const manager = new SubagentManager({
      createSubagentSession: (params) => createSubagentSession(params, deps),
      limiter: new ConcurrencyLimiter(() => maxConcurrent),
      baseCwd: project,
      registry: agentTypes,
      history,
      observer: record && {
        onSubagentRunStarted: () => {},
        onSubagentRunFinished: (finished, run) => { record.appendCustomEntry(SUBAGENT_RECORD_ENTRY, toPersistedRecord(finished, run)); },
        onSubagentCompacted: () => {},
        onSubagentCreated: () => {},
      },
    });
    managers.push(manager);
    return manager;
  }

  /**
   * Run a child per code word to completion under one manager, each recording
   * its run in one real parent session file as the extension does, then tear
   * that manager down: what a `/reload` or a restart leaves on disk.
   */
  async function runChildrenThenRestart(codeWords: string[]) {
    const parent = SessionManager.create(project, join(root, "sessions"));
    parent.appendMessage({ role: "user", content: "Delegate this", timestamp: 1 });
    const parentSession = { parentSessionFile: parent.getSessionFile()!, parentSessionId: parent.getSessionId() };

    const earlier = createManager(undefined, 4, parent);
    const children = [];
    for (const word of codeWords) {
      const child = await earlier.spawnAndWait(snapshot(), "Explore", `Remember this: the code word is ${word}.`, {
        description: "Hold a code word",
        model: registry.find("faux", "scripted"),
        maxTurns: 3,
        parentSession,
      });
      children.push({ id: child.id, transcript: child.outputFile!, lifetimeUsage: { ...child.lifetimeUsage } });
    }
    await earlier.dispose();
    return { children, parentFile: parent.getSessionFile()! };
  }

  /** One child, run and recorded as `runChildrenThenRestart` does. */
  async function runChildThenRestart() {
    const { children: [child], parentFile } = await runChildrenThenRestart([CODE_WORD]);
    return { ...child, parentFile };
  }

  /**
   * A fresh manager over the parent session reopened from disk, on a parent
   * snapshot from `parentSnapshot`. Given `recording`, it records each finished
   * run in that parent file, for a later restart to read.
   */
  function restartedManager(
    parentFile: string,
    maxConcurrent?: number,
    options: { recording?: boolean; parentSnapshot?: () => ParentSnapshot } = {},
  ): SubagentManager {
    const parent = SessionManager.open(parentFile);
    return createManager(
      {
        entries: () => parent.getEntries(),
        snapshot: options.parentSnapshot ?? snapshot,
        parentSession: () => ({ parentSessionFile: parentFile, parentSessionId: parent.getSessionId() }),
        transcriptHeader: readTranscriptHeader,
      },
      maxConcurrent,
      options.recording ? parent : undefined,
    );
  }

  /** Whether the model was ever asked to answer a recall. */
  function recallReachedTheModel(): boolean {
    return requests.some((said) => said.at(-1) === RECALL);
  }

  it("continues the child's own conversation under its original id", async () => {
    const { id, parentFile } = await runChildThenRestart();
    expect(requests).toEqual([[`Remember this: the code word is ${CODE_WORD}.`]]);

    const outcome = await restartedManager(parentFile).resume(id, "What was the code word?", { background: false });

    if (outcome.kind !== "resumed") throw new Error(`resume refused: ${outcome.reason}`);
    expect(outcome.record.id).toBe(id);
    expect(outcome.record.status).toBe("completed");
    expect(outcome.record.result).toBe(`The code word was ${CODE_WORD}.`);
    expect(requests.at(-1)).toEqual([`Remember this: the code word is ${CODE_WORD}.`, "What was the code word?"]);
  });

  it("appends the resumed run to the same transcript, under the same session", async () => {
    const { id, transcript, parentFile } = await runChildThenRestart();
    const before = readTranscriptHeader(transcript);

    const outcome = await restartedManager(parentFile).resume(id, "What was the code word?", { background: false });

    if (outcome.kind !== "resumed") throw new Error(`resume refused: ${outcome.reason}`);
    expect(outcome.record.outputFile).toBe(transcript);
    expect(readTranscriptHeader(transcript)).toEqual(before);
    const reopened = SessionManager.open(transcript).buildSessionContext();
    // The system entry is the sectioned system prompt Pi recorded before the first turn.
    expect(reopened.messages.map((message) => message.role)).toEqual(["system", "user", "assistant", "user", "assistant"]);
  });

  it("runs on the model the child selected, not the parent's", async () => {
    const { id, parentFile } = await runChildThenRestart();

    await restartedManager(parentFile).resume(id, "What was the code word?", { background: false });

    expect(requestedModels).toEqual(["scripted", "scripted"]);
  });

  it("holds the resumed run to the turn limit the child ran under", async () => {
    const { id, parentFile } = await runChildThenRestart();

    const outcome = await restartedManager(parentFile).resume(id, "What was the code word?", { background: false });

    if (outcome.kind !== "resumed") throw new Error(`resume refused: ${outcome.reason}`);
    expect(outcome.record.turnBudget).toEqual({ maxTurns: 3, used: 1, phase: "within" });
  });

  it("keeps the turn limit across a restart whose resume was stopped before it started", async () => {
    const { id, parentFile } = await runChildThenRestart();
    const between = restartedManager(parentFile, 1, { recording: true });
    between.spawn(snapshot(), "Explore", OCCUPY, {
      description: "Hold the slot",
      model: registry.find("faux", "scripted"),
      background: { kind: "explicit", isBackground: true },
    });
    await vi.waitFor(() => { expect(requests.at(-1)).toEqual([OCCUPY]); });
    const queued = between.startResume(id, RECALL, { background: true });
    if (queued.kind !== "started") throw new Error(`resume refused: ${queued.reason}`);
    expect(between.abort(id)).toBe(true);
    expect(queued.record.stoppedWhileQueued).toBe(true);
    releaseOccupant();
    await between.waitForAll();
    await between.dispose();

    const outcome = await restartedManager(parentFile).resume(id, RECALL, { background: false });

    if (outcome.kind !== "resumed") throw new Error(`resume refused: ${outcome.reason}`);
    expect(outcome.record.result).toBe(`The code word was ${CODE_WORD}.`);
    expect(outcome.record.turnBudget).toEqual({ maxTurns: 3, used: 1, phase: "within" });
  });

  it("adds the resumed run's usage to what the child used before the restart", async () => {
    const { id, transcript, parentFile, lifetimeUsage: before } = await runChildThenRestart();
    expect(before.input + before.output).toBeGreaterThan(0);

    const outcome = await restartedManager(parentFile).resume(id, RECALL, { background: false });

    if (outcome.kind !== "resumed") throw new Error(`resume refused: ${outcome.reason}`);
    const resumedReply = SessionManager.open(transcript).buildSessionContext().messages.at(-1);
    if (resumedReply?.role !== "assistant") throw new Error("the resumed run left no reply");
    const { input, output, cacheWrite } = resumedReply.usage;
    expect(outcome.record.lifetimeUsage).toEqual({
      input: before.input + input,
      output: before.output + output,
      cacheWrite: before.cacheWrite + cacheWrite,
    });
  });

  it("refuses a sibling's transcript put at the child's path, leaving it untouched and running nothing", async () => {
    const { children: [child, sibling], parentFile } = await runChildrenThenRestart([CODE_WORD, "TANGERINE"]);
    copyFileSync(sibling.transcript, child.transcript);
    const siblingBytes = readFileSync(child.transcript);
    // The sibling's header is a genuine one: the same parent, and the same directory.
    expect(readTranscriptHeader(child.transcript)?.parentSession).toBe(readTranscriptHeader(sibling.transcript)?.parentSession);

    const outcome = await restartedManager(parentFile).resume(child.id, RECALL, { background: false });

    expect(outcome).toEqual({ kind: "refused", reason: "no-session" });
    expect(recallReachedTheModel()).toBe(false);
    expect(readFileSync(child.transcript)).toEqual(siblingBytes);
  });

  it("refuses a transcript cut short of the child's last exchange, running nothing", async () => {
    const parent = SessionManager.create(project, join(root, "sessions"));
    parent.appendMessage({ role: "user", content: "Delegate this", timestamp: 1 });
    const earlier = createManager(undefined, 4, parent);
    const child = await earlier.spawnAndWait(snapshot(), "Explore", `Remember this: the code word is ${CODE_WORD}.`, {
      description: "Hold a code word",
      model: registry.find("faux", "scripted"),
      parentSession: { parentSessionFile: parent.getSessionFile()!, parentSessionId: parent.getSessionId() },
    });
    const firstExchange = readFileSync(child.outputFile!, "utf8");
    await earlier.resume(child.id, "Also remember this: the second code word is TANGERINE.", { background: false });
    await earlier.dispose();
    // Back to the first exchange: a genuine prefix of the child's own transcript.
    writeFileSync(child.outputFile!, firstExchange);

    const outcome = await restartedManager(parent.getSessionFile()!).resume(child.id, RECALL, { background: false });

    if (outcome.kind !== "resumed") throw new Error(`resume refused: ${outcome.reason}`);
    expect(outcome.record.status).toBe("error");
    expect(outcome.record.error).toBe(
      `Transcript ${child.outputFile} no longer holds the conversation its last run left; it was not restored.`,
    );
    expect(recallReachedTheModel()).toBe(false);
    expect(readFileSync(child.outputFile!, "utf8")).toBe(firstExchange);
  });

  it("refuses a child whose recorded model the parent no longer has, sending its conversation nowhere else", async () => {
    const { id, transcript, parentFile } = await runChildThenRestart();
    const bytes = readFileSync(transcript);
    const withoutScripted = () => ({
      ...snapshot(),
      modelRegistry: {
        find: (provider: string, modelId: string) => (modelId === "scripted" ? undefined : registry.find(provider, modelId)),
        getAll: () => registry.getAll().filter((model) => model.id !== "scripted"),
      },
    });

    const outcome = await restartedManager(parentFile, undefined, { parentSnapshot: withoutScripted }).resume(id, RECALL, {
      background: false,
    });

    if (outcome.kind !== "resumed") throw new Error(`resume refused: ${outcome.reason}`);
    expect(outcome.record.status).toBe("error");
    expect(outcome.record.error).toBe(
      'The child\'s transcript selects "faux/scripted", which is not available; the child was not restored.',
    );
    expect(requestedModels).toEqual(["scripted"]);
    expect(readFileSync(transcript)).toEqual(bytes);
  });

  it("refuses a child whose read-only project definition was deleted, uncovering the built-in that grants bash", async () => {
    const definition = join(project, ".pi", "agents", "Explore.md");
    mkdirSync(join(project, ".pi", "agents"), { recursive: true });
    writeFileSync(definition, "---\ndescription: Explores by reading\ntools: read\n---\n\nRead only.\n");
    agentTypes.reload();
    const { id, transcript, parentFile } = await runChildThenRestart();
    expect(allowlists).toEqual([["read", "ask_parent", "notify_parent"]]);
    const bytes = readFileSync(transcript);
    rmSync(definition);

    const outcome = await restartedManager(parentFile).resume(id, RECALL, { background: false });

    expect(outcome).toEqual({ kind: "refused", reason: "agent-type-unavailable" });
    expect(allowlists).toHaveLength(1);
    expect(recallReachedTheModel()).toBe(false);
    expect(readFileSync(transcript)).toEqual(bytes);
  });

  it("refuses a transcript with an entry lost from the middle, though its header, leaf, and later exchange remain", async () => {
    const { id, transcript, parentFile } = await runChildThenRestart();
    const between = restartedManager(parentFile, 4, { recording: true });
    await between.resume(id, "Here is a second message.", { background: false });
    await between.dispose();
    const lines = readFileSync(transcript, "utf8").trimEnd().split("\n");
    // The first reply: the second exchange still follows it, now naming a parent the file does not hold.
    lines.splice(lines.findIndex((line) => line.includes('"role":"assistant"')), 1);
    const damaged = `${lines.join("\n")}\n`;
    writeFileSync(transcript, damaged);
    const askedBefore = requests.length;

    const outcome = await restartedManager(parentFile).resume(id, RECALL, { background: false });

    if (outcome.kind !== "resumed") throw new Error(`resume refused: ${outcome.reason}`);
    expect(outcome.record.status).toBe("error");
    expect(outcome.record.error).toBe(
      `Transcript ${transcript} no longer holds the conversation its last run left; it was not restored.`,
    );
    expect(requests).toHaveLength(askedBefore);
    expect(readFileSync(transcript, "utf8")).toBe(damaged);
  });

  it("continues a compacted child from its summary, though Pi's projection of it holds no prompt", async () => {
    const { id, transcript, parentFile } = await runChildThenRestart();
    // A split-turn compaction as Pi persists one: the prompt is summarised, the reply kept.
    const child = SessionManager.open(transcript);
    const reply = child.getBranch().find((entry) => entry.type === "message" && entry.message.role === "assistant");
    if (!reply) throw new Error("the child left no reply");
    child.appendCompaction(`The user said the code word is ${CODE_WORD}.`, reply.id, 200_000);
    expect(SessionManager.open(transcript).buildSessionContext().messages.map((message) => message.role)).toEqual([
      "system",
      "compactionSummary",
      "assistant",
    ]);
    // The child's run recorded the transcript as it stood after the compaction.
    const parent = SessionManager.open(parentFile);
    const recorded = parent.getEntries().findLast((entry) => entry.type === "custom" && entry.customType === SUBAGENT_RECORD_ENTRY);
    if (recorded?.type !== "custom") throw new Error("no record of the child");
    parent.appendCustomEntry(SUBAGENT_RECORD_ENTRY, { ...(recorded.data as object), transcriptLeafId: child.getLeafId() });

    const outcome = await restartedManager(parentFile).resume(id, RECALL, { background: false });

    if (outcome.kind !== "resumed") throw new Error(`resume refused: ${outcome.reason}`);
    expect(outcome.record.status).toBe("completed");
    expect(outcome.record.result).toBe(`The code word was ${CODE_WORD}.`);
    // It answered from the summary: the original prompt was compacted away.
    expect(requests.at(-1)).not.toContain(`Remember this: the code word is ${CODE_WORD}.`);
  });

  describe("a transcript changed while its resume waits for a concurrency slot", () => {
    /**
     * Accept a background resume of the restored child while another child holds
     * the only slot, let `change` rewrite the transcript in that queue gap, then
     * free the slot and wait for the resume to settle. Returns the transcript's
     * bytes as `change` left them, or undefined when it removed the file.
     */
    async function resumeAcrossQueueGap(change: (transcript: string) => void) {
      const { id, transcript, parentFile } = await runChildThenRestart();
      const manager = restartedManager(parentFile, 1);
      manager.spawn(snapshot(), "Explore", OCCUPY, {
        description: "Hold the slot",
        model: registry.find("faux", "scripted"),
        background: { kind: "explicit", isBackground: true },
      });
      await vi.waitFor(() => { expect(requests.at(-1)).toEqual([OCCUPY]); });

      const start = manager.startResume(id, RECALL, { background: true });
      if (start.kind !== "started") throw new Error(`resume refused: ${start.reason}`);
      expect(start.record.status).toBe("queued");
      change(transcript);
      const left = existsSync(transcript) ? readFileSync(transcript) : undefined;

      releaseOccupant();
      await start.record.promise;
      return { record: start.record, transcript, left };
    }

    /** Whether the model was ever asked to answer the resume's prompt. */
    function resumeReachedTheModel(): boolean {
      return requests.some((said) => said.at(-1) === RECALL);
    }

    /** A copy of `content` opened the way the factory opens a transcript, to show what Pi does to it. */
    function bytesAfterPiOpens(content: string): string {
      const probe = join(root, "probe.jsonl");
      writeFileSync(probe, content);
      SessionManager.open(probe);
      return readFileSync(probe, "utf8");
    }

    it("resumes the unchanged transcript once the slot frees", async () => {
      const { record } = await resumeAcrossQueueGap(() => {});

      expect(record.status).toBe("completed");
      expect(record.result).toBe(`The code word was ${CODE_WORD}.`);
    });

    it("fails the resume, running nothing, when the file is gone", async () => {
      const { record, transcript } = await resumeAcrossQueueGap((file) => { rmSync(file); });

      expect(record.status).toBe("error");
      expect(record.error).toBe(`Transcript ${transcript} no longer holds this child's session; it was not restored.`);
      expect(resumeReachedTheModel()).toBe(false);
      expect(existsSync(transcript)).toBe(false);
    });

    it("fails the resume, leaving the file untouched, when it was cut back to the entries before its conversation", async () => {
      const { record, transcript, left } = await resumeAcrossQueueGap((file) => {
        const lines = readFileSync(file, "utf8").split("\n");
        const firstPrompt = lines.findIndex((line) => line.includes('"role":"user"'));
        writeFileSync(file, `${lines.slice(0, firstPrompt).join("\n")}\n`);
      });
      // Pi's header, its model and thinking-level entries, and the system prompt it recorded survive.
      expect(left?.toString("utf8")).toContain('"role":"system"');
      expect(left?.toString("utf8")).not.toContain('"role":"user"');

      expect(record.status).toBe("error");
      expect(record.error).toBe(
        `Transcript ${transcript} no longer holds the conversation its last run left; it was not restored.`,
      );
      expect(resumeReachedTheModel()).toBe(false);
      expect(readFileSync(transcript)).toEqual(left);
    });

    it("fails the resume, leaving the file empty, when it was truncated to 0 bytes", async () => {
      // Pi initialises an empty file it opens with a new session header.
      expect(bytesAfterPiOpens("")).not.toBe("");

      const { record, transcript, left } = await resumeAcrossQueueGap((file) => { writeFileSync(file, ""); });

      expect(left?.length).toBe(0);
      expect(record.status).toBe("error");
      expect(record.error).toBe(`Transcript ${transcript} no longer holds this child's session; it was not restored.`);
      expect(resumeReachedTheModel()).toBe(false);
      expect(readFileSync(transcript)).toEqual(left);
    });

    it("fails the resume, leaving the file untouched, when another session replaced it", async () => {
      const stranger = SessionManager.create(project, join(root, "elsewhere"));
      stranger.newSession({ parentSession: "someone-else" });
      stranger.appendMessage({ role: "user", content: "Not this child's conversation", timestamp: 1 });
      stranger.appendMessage(fauxAssistantMessage("Nor its reply."));
      const strangerFile = stranger.getSessionFile()!;

      const { record, transcript, left } = await resumeAcrossQueueGap((file) => { copyFileSync(strangerFile, file); });

      expect(record.status).toBe("error");
      expect(record.error).toBe(`Transcript ${transcript} no longer holds this child's session; it was not restored.`);
      expect(resumeReachedTheModel()).toBe(false);
      expect(readFileSync(transcript)).toEqual(left);
    });

    it("fails the resume, leaving the file untouched, when an older-format session Pi would migrate replaced it", async () => {
      const older = [
        { type: "session", id: "older-stranger", timestamp: "2026-01-01T00:00:00.000Z", cwd: project },
        { type: "message", timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: "Older conversation", timestamp: 1 } },
      ].map((entry) => `${JSON.stringify(entry)}\n`).join("");
      // Pi rewrites a session in an older format as it loads it.
      expect(bytesAfterPiOpens(older)).not.toBe(older);

      const { record, transcript, left } = await resumeAcrossQueueGap((file) => { writeFileSync(file, older); });

      expect(record.status).toBe("error");
      expect(record.error).toBe(`Transcript ${transcript} no longer holds this child's session; it was not restored.`);
      expect(resumeReachedTheModel()).toBe(false);
      expect(readFileSync(transcript, "utf8")).toBe(older);
      expect(left?.toString("utf8")).toBe(older);
    });
  });
});
