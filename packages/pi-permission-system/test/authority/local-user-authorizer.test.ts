import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AskDialogQueue } from "#src/authority/ask-dialog-queue";
import { LocalUserAuthorizer } from "#src/authority/local-user-authorizer";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import { requestPermissionDecision } from "#src/authority/permission-prompt-component";
import type { PromptPermissionDetails } from "#src/authority/permission-prompter";
import type { NotificationSession } from "#src/presentation/prompt-notification";
import { DECIDED_BY_HUMAN } from "#test/helpers/decision-fixtures";
import {
  makePromptDetails,
  makePromptPayload,
} from "#test/helpers/prompt-details-fixtures";
import { makePromptPreferences } from "#test/helpers/prompt-view-fixtures";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * This file's semantic defaults over the shared structural fixture: several
 * cases assert `agentName` and `toolName` on a no-override call.
 */
function makeDetails(
  overrides?: Partial<PromptPermissionDetails>,
): PromptPermissionDetails {
  return makePromptDetails({
    requestId: "req-123",
    agentName: "test-agent",
    toolName: "read",
    ...overrides,
  });
}

/** A `PermissionPromptUi` double; the tool-expansion accessors go unused here. */
function makePromptUi() {
  return {
    select: vi.fn(),
    input: vi.fn(),
    custom: vi.fn(),
    getToolsExpanded: vi.fn(() => false),
    setToolsExpanded: vi.fn(),
  };
}

/**
 * A `PermissionEventBus` double. `onEmit` observes the emission without
 * replacing it, so a test that cares about emit-versus-present ordering can
 * still build its deps through {@link makeDeps}.
 */
function makeEvents(onEmit?: () => void) {
  return {
    emit: vi.fn(() => {
      onEmit?.();
    }),
    on: vi.fn().mockReturnValue(() => undefined),
  };
}

/** Drain every pending microtask, so a queued presentation has had its turn. */
function settleMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

const APPROVED: PermissionPromptDecision = {
  approved: true,
  state: "approved",
  decidedBy: DECIDED_BY_HUMAN,
};

function makeDeps(
  overrides: {
    events?: ReturnType<typeof makeEvents>;
    dialogs?: AskDialogQueue;
    requestPermissionDecision?: typeof requestPermissionDecision;
  } = {},
) {
  const describeSession = vi.fn(
    (): NotificationSession => ({ name: "refactor-auth", cwd: "/w/repo" }),
  );
  const events = overrides.events ?? makeEvents();
  const dialogs = overrides.dialogs ?? new AskDialogQueue();
  const ui = makePromptUi();
  const decisionFn =
    overrides.requestPermissionDecision ??
    vi.fn<typeof requestPermissionDecision>().mockResolvedValue({
      approved: true,
      state: "approved",
      decidedBy: DECIDED_BY_HUMAN,
    });
  return {
    deps: {
      ui,
      mode: "tui" as const,
      events,
      dialogs,
      getPromptPreferences: () => makePromptPreferences(),
      requestPermissionDecision: decisionFn,
      describeSession,
    },
    describeSession,
    events,
    dialogs,
    ui,
    decisionFn,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("LocalUserAuthorizer", () => {
  it("emits a UI prompt event with normalized surface and value", async () => {
    const { deps, events } = makeDeps();
    const authorizer = new LocalUserAuthorizer(deps);

    await authorizer.authorize(
      makeDetails({
        toolName: "bash",
        command: "git push",
        toolInputPreview: "git push",
      }),
    );

    expect(events.emit).toHaveBeenCalledWith("permissions:ui_prompt", {
      requestId: "req-123",
      source: "tool_call",
      surface: "bash",
      value: "git push",
      agentName: "test-agent",
      request: makePromptPayload().request,
      forwarding: null,
    });
  });

  it("normalizes skill prompt events to the skill surface", async () => {
    const { deps, events } = makeDeps();
    const authorizer = new LocalUserAuthorizer(deps);

    await authorizer.authorize(
      makeDetails({
        source: "skill_input",
        toolName: undefined,
        skillName: "deploy-helper",
      }),
    );

    expect(events.emit).toHaveBeenCalledWith("permissions:ui_prompt", {
      requestId: "req-123",
      source: "skill_input",
      surface: "skill",
      value: "deploy-helper",
      agentName: "test-agent",
      request: makePromptPayload().request,
      forwarding: null,
    });
  });

  it("calls requestPermissionDecision with the threaded view, title, and payload", async () => {
    const { deps, ui, decisionFn } = makeDeps();
    const authorizer = new LocalUserAuthorizer(deps);
    const details = makeDetails();

    await authorizer.authorize(details);

    expect(decisionFn).toHaveBeenCalledWith(
      {
        mode: "tui",
        ui,
        ...makePromptPreferences(),
        notice: {
          title: "pi \u2014 refactor-auth",
          body: "Permission Required: read",
        },
      },
      "Permission Required",
      details.payload,
      undefined,
    );
  });

  describe("notification notice", () => {
    it("reads the session when each prompt opens, not when the authorizer is built", async () => {
      const { deps, describeSession, decisionFn, ui } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(makeDetails());
      describeSession.mockReturnValue({ name: "renamed", cwd: "/w/repo" });
      await authorizer.authorize(makeDetails());

      expect(decisionFn).toHaveBeenLastCalledWith(
        {
          mode: "tui",
          ui,
          ...makePromptPreferences(),
          notice: {
            title: "pi \u2014 renamed",
            body: "Permission Required: read",
          },
        },
        "Permission Required",
        expect.anything(),
        undefined,
      );
    });
  });

  it("passes the sessionLabel option when present", async () => {
    const { deps, decisionFn } = makeDeps();
    const authorizer = new LocalUserAuthorizer(deps);

    await authorizer.authorize(
      makeDetails({ sessionLabel: "Yes, for 'read' tool" }),
    );

    expect(decisionFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.anything(),
      { sessionLabel: "Yes, for 'read' tool" },
    );
  });

  describe("session label for a path ask that proves no direction", () => {
    it("names a bare external_directory directory approval by its contents glob", async () => {
      const { deps, decisionFn } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          sessionApproval: {
            grants: [
              { surface: "external_directory", pattern: "/r/a" },
              { surface: "external_directory", pattern: "/r/a/*" },
            ],
          },
        }),
      );

      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        { sessionLabel: 'Yes, allow access to "/r/a/*" for this session' },
      );
    });

    it("names a bare path approval by its pattern", async () => {
      const { deps, decisionFn } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          sessionApproval: { grants: [{ surface: "path", pattern: "/r/*" }] },
        }),
      );

      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        { sessionLabel: 'Yes, allow access to "/r/*" for this session' },
      );
    });

    it("keeps a gate-supplied label over the fallback", async () => {
      const { deps, decisionFn } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          sessionLabel: 'Yes, allow edit "/r/*" for this session',
          sessionApproval: { grants: [{ surface: "path", pattern: "/r/*" }] },
        }),
      );

      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        { sessionLabel: 'Yes, allow edit "/r/*" for this session' },
      );
    });

    it("adds no label for a grant on a non-path surface", async () => {
      const { deps, decisionFn } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          sessionApproval: { grants: [{ surface: "bash", pattern: "git *" }] },
        }),
      );

      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        undefined,
      );
    });
  });

  it("emits the UI event before calling requestPermissionDecision", async () => {
    const calls: string[] = [];
    const decisionFn = vi.fn<typeof requestPermissionDecision>(() => {
      calls.push("dialog");
      return Promise.resolve({
        approved: true,
        state: "approved",
        decidedBy: DECIDED_BY_HUMAN,
      });
    });
    const { deps } = makeDeps({
      events: makeEvents(() => {
        calls.push("emit");
      }),
      requestPermissionDecision: decisionFn,
    });
    const authorizer = new LocalUserAuthorizer(deps);

    await authorizer.authorize(makeDetails());

    expect(calls).toEqual(["emit", "dialog"]);
  });

  describe("forwarded provenance", () => {
    it("emits a non-degraded forwarded event with populated forwarding and the child's display projection", async () => {
      const { deps, events } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          source: "tool_call",
          agentName: "Explore",
          surface: "bash",
          value: "git push",
          forwarding: {
            requesterAgentName: "Explore",
            requesterSessionId: "child-session",
          },
        }),
      );

      expect(events.emit).toHaveBeenCalledWith("permissions:ui_prompt", {
        requestId: "req-123",
        source: "tool_call",
        surface: "bash",
        value: "git push",
        agentName: "Explore",
        request: makePromptPayload().request,
        forwarding: {
          requesterAgentName: "Explore",
          requesterSessionId: "child-session",
        },
      });
    });

    it("uses the '(Subagent)' dialog title when the ask is forwarded", async () => {
      const { deps, ui, decisionFn } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);
      const details = makeDetails({
        forwarding: {
          requesterAgentName: "Explore",
          requesterSessionId: "child-session",
        },
      });

      await authorizer.authorize(details);

      // The notice carries the same forwarded title the dialog does.
      expect(decisionFn).toHaveBeenCalledWith(
        {
          mode: "tui",
          ui,
          ...makePromptPreferences(),
          notice: {
            title: "pi \u2014 refactor-auth",
            body: "Permission Required (Subagent): read",
          },
        },
        "Permission Required (Subagent)",
        details.payload,
        undefined,
      );
    });

    it("offers a sessionScope when the forwarded ask carries a suggestion", async () => {
      const { deps, decisionFn } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          toolName: "bash",
          command: "git push",
          forwarding: {
            requesterAgentName: "Explore",
            requesterSessionId: "child-session",
          },
          sessionApproval: { grants: [{ surface: "bash", pattern: "git *" }] },
        }),
      );

      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        "Permission Required (Subagent)",
        expect.anything(),
        {
          sessionScope: {
            subagentLabel: "This subagent ('Explore') only",
            servingSessionLabel:
              'The whole session — allow bash "git *" for parent and all subagents',
          },
        },
      );
    });

    it("names every path in the scope label when the ask covers several", async () => {
      const { deps, decisionFn } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          toolName: "bash",
          command: "cat /outside/a.ts > /elsewhere/b.ts",
          forwarding: {
            requesterAgentName: "Explore",
            requesterSessionId: "child-session",
          },
          sessionApproval: {
            grants: [
              { surface: "external_directory_read", pattern: "/outside/*" },
              { surface: "external_directory_write", pattern: "/elsewhere/*" },
            ],
          },
        }),
      );

      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        expect.objectContaining({
          sessionScope: expect.objectContaining({
            servingSessionLabel:
              "The whole session — allow external_directory 2 paths for parent and all subagents",
          }),
        }),
      );
    });

    it("names every pattern of a forwarded bash chain's grants in the scope label", async () => {
      const { deps, decisionFn } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          toolName: "bash",
          command: "cd sub",
          forwarding: {
            requesterAgentName: "Explore",
            requesterSessionId: "child-session",
          },
          sessionApproval: {
            grants: [
              { surface: "bash", pattern: "cd sub*" },
              { surface: "bash", pattern: "npm test*" },
            ],
          },
        }),
      );

      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        "Permission Required (Subagent)",
        expect.anything(),
        {
          sessionScope: {
            subagentLabel: "This subagent ('Explore') only",
            servingSessionLabel:
              'The whole session — allow bash "cd sub*", "npm test*" for parent and all subagents',
          },
        },
      );
    });

    it("offers no sessionScope for a forwarded ask without a suggestion", async () => {
      const { deps, decisionFn } = makeDeps();
      const authorizer = new LocalUserAuthorizer(deps);

      await authorizer.authorize(
        makeDetails({
          forwarding: {
            requesterAgentName: "Explore",
            requesterSessionId: "child-session",
          },
        }),
      );

      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        undefined,
      );
    });
  });

  describe("both-directions session grant (#813)", () => {
    /** Assert the options a bash ask with these grants reaches the dialog with. */
    async function expectOptionsFor(
      grants: { surface: string; pattern: string }[],
      expected: unknown,
    ) {
      const { deps, decisionFn } = makeDeps();
      await new LocalUserAuthorizer(deps).authorize(
        makeDetails({ toolName: "bash", sessionApproval: { grants } }),
      );
      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        expected,
      );
    }

    it("offers the width option when every grant proves one direction", async () => {
      await expectOptionsFor(
        [{ surface: "external_directory_write", pattern: "/tmp/*" }],
        {
          sessionLabel: 'Yes, allow writes to "/tmp/*" for this session',
          sessionWidth: {
            label: 'Yes, allow reads and writes to "/tmp/*" for this session',
          },
        },
      );
    });

    it("counts the paths when several grants prove the same direction", async () => {
      await expectOptionsFor(
        [
          { surface: "external_directory_read", pattern: "/outside/a/*" },
          { surface: "external_directory_read", pattern: "/outside/b/*" },
        ],
        {
          sessionLabel: "Yes, allow reads to 2 paths for this session",
          sessionWidth: {
            label: "Yes, allow reads and writes to 2 paths for this session",
          },
        },
      );
    });

    it("offers no width option when the grants prove different directions", async () => {
      await expectOptionsFor(
        [
          { surface: "external_directory_read", pattern: "/outside/a/*" },
          { surface: "external_directory_write", pattern: "/outside/b/*" },
        ],
        { sessionLabel: "Yes, allow access to 2 paths for this session" },
      );
    });

    it("offers no width option for a non-directional surface", async () => {
      await expectOptionsFor(
        [{ surface: "bash", pattern: "git *" }],
        undefined,
      );
    });

    it("offers no width option for an ask with no suggestion at all", async () => {
      const { deps, decisionFn } = makeDeps();
      await new LocalUserAuthorizer(deps).authorize(makeDetails());
      expect(decisionFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        undefined,
      );
    });
  });

  it("returns the decision from requestPermissionDecision", async () => {
    const decision: PermissionPromptDecision = {
      approved: false,
      state: "denied",
      decidedBy: DECIDED_BY_HUMAN,
    };
    const { deps } = makeDeps({
      requestPermissionDecision: vi
        .fn<typeof requestPermissionDecision>()
        .mockResolvedValue(decision),
    });
    const authorizer = new LocalUserAuthorizer(deps);

    const result = await authorizer.authorize(makeDetails());

    expect(result).toEqual(decision);
  });

  describe("one dialog at a time", () => {
    /**
     * A pair of asks whose first dialog stays open until the test answers it,
     * so "the second one has not been shown yet" is observable.
     */
    function makeOverlappingAsks() {
      const open = Promise.withResolvers<PermissionPromptDecision>();
      const decisionFn = vi
        .fn<typeof requestPermissionDecision>()
        .mockReturnValueOnce(open.promise)
        .mockResolvedValue(APPROVED);
      const { deps, events, dialogs } = makeDeps({
        requestPermissionDecision: decisionFn,
      });
      const authorizer = new LocalUserAuthorizer(deps);
      return {
        decisionFn,
        events,
        dialogs,
        answerFirst: () => {
          open.resolve(APPROVED);
        },
        first: authorizer.authorize(makeDetails()),
        second: authorizer.authorize(makeDetails()),
      };
    }

    describe("with an answer window", () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it("times each ask from when its own dialog is shown, not from when it queued", async () => {
        const { deps } = makeDeps({ requestPermissionDecision });
        // Pi's select resolves undefined when its signal dismisses it.
        deps.ui.select.mockImplementation(
          (
            _title: string,
            _options: string[],
            opts?: { signal?: AbortSignal },
          ) =>
            new Promise<string | undefined>((resolve) => {
              opts?.signal?.addEventListener(
                "abort",
                () => {
                  resolve(undefined);
                },
                { once: true },
              );
            }),
        );
        const authorizer = new LocalUserAuthorizer({
          ...deps,
          mode: "rpc",
          getPromptPreferences: () =>
            makePromptPreferences({ promptTimeoutMs: 60_000 }),
        });
        const unanswered = {
          approved: false,
          state: "denied",
          confirmationUnavailable: true,
          decidedBy: { kind: "unanswered", timeoutMs: 60_000 },
        };
        let secondSettled = false;

        const first = authorizer.authorize(makeDetails());
        const second = authorizer.authorize(makeDetails());
        void second.then(() => {
          secondSettled = true;
        });

        await vi.advanceTimersByTimeAsync(60_000);
        await expect(first).resolves.toStrictEqual(unanswered);
        expect(deps.ui.select).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(59_999);
        expect(secondSettled).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await expect(second).resolves.toStrictEqual(unanswered);
      });
    });

    it("does not present a second ask while the first dialog is open", async () => {
      const asks = makeOverlappingAsks();
      await settleMicrotasks();

      expect(asks.decisionFn).toHaveBeenCalledTimes(1);

      asks.answerFirst();
      await expect(asks.first).resolves.toEqual(APPROVED);
      await expect(asks.second).resolves.toEqual(APPROVED);
      expect(asks.decisionFn).toHaveBeenCalledTimes(2);
    });

    it("announces the second ask only when its dialog is presented", async () => {
      const asks = makeOverlappingAsks();
      await settleMicrotasks();

      expect(asks.events.emit).toHaveBeenCalledTimes(1);

      asks.answerFirst();
      await asks.first;
      await settleMicrotasks();

      expect(asks.events.emit).toHaveBeenCalledTimes(2);
      await asks.second;
    });

    it("answers a released ask as unavailable, never as a user denial", async () => {
      const asks = makeOverlappingAsks();
      await settleMicrotasks();

      asks.dialogs.releaseAll("the session ended");

      await expect(asks.first).resolves.toEqual({
        approved: false,
        state: "denied",
        confirmationUnavailable: true,
        denialReason: "the session ended",
        decidedBy: { kind: "unavailable", reason: "the session ended" },
      });
      await expect(asks.second).resolves.toEqual({
        approved: false,
        state: "denied",
        confirmationUnavailable: true,
        denialReason: "the session ended",
        decidedBy: { kind: "unavailable", reason: "the session ended" },
      });
    });
  });
});
