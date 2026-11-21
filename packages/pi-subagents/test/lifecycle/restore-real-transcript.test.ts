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
    rmSync(root, { recursive: true, force: true });
  });

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
        createSession: ({ sessionManager, resourceLoader, modelRegistry: _modelRegistry, ...rest }) =>
          createAgentSession({
            ...rest,
            sessionManager: sessionManager as SessionManager,
            resourceLoader: resourceLoader as ResourceLoader,
            modelRuntime: runtime,
          }),
        assemblerIO: { buildAgentPrompt, loadProjectContext: () => undefined },
      },
      exec: () => Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false }),
      registry: new AgentTypeRegistry(() => new Map()),
      lifecycle: createChildLifecyclePublisher(() => {}),
      resolvePromptInheritance: () => "full",
      listParentToolNames: () => [],
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

  function createManager(history?: ChildHistory, maxConcurrent = 4): SubagentManager {
    const deps = realDeps();
    const manager = new SubagentManager({
      createSubagentSession: (params) => createSubagentSession(params, deps),
      limiter: new ConcurrencyLimiter(() => maxConcurrent),
      baseCwd: project,
      registry: new AgentTypeRegistry(() => new Map()),
      history,
    });
    managers.push(manager);
    return manager;
  }

  /**
   * Run a child to completion under one manager, record its run in a real parent
   * session file as the extension does, then tear that manager down: what a
   * `/reload` or a restart leaves on disk.
   */
  async function runChildThenRestart() {
    const parent = SessionManager.create(project, join(root, "sessions"));
    parent.appendMessage({ role: "user", content: "Delegate this", timestamp: 1 });
    const parentSession = { parentSessionFile: parent.getSessionFile()!, parentSessionId: parent.getSessionId() };

    const earlier = createManager();
    const child = await earlier.spawnAndWait(snapshot(), "Explore", `Remember this: the code word is ${CODE_WORD}.`, {
      description: "Hold a code word",
      model: registry.find("faux", "scripted"),
      maxTurns: 3,
      parentSession,
    });
    parent.appendCustomEntry(SUBAGENT_RECORD_ENTRY, toPersistedRecord(child, child.latestRun));
    await earlier.dispose();
    return { id: child.id, transcript: child.outputFile!, parentFile: parent.getSessionFile()! };
  }

  /** A fresh manager over the parent session reopened from disk. */
  function restartedManager(parentFile: string, maxConcurrent?: number): SubagentManager {
    const parent = SessionManager.open(parentFile);
    return createManager(
      {
        entries: () => parent.getEntries(),
        snapshot,
        parentSession: () => ({ parentSessionFile: parentFile, parentSessionId: parent.getSessionId() }),
        transcriptHeader: readTranscriptHeader,
      },
      maxConcurrent,
    );
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
