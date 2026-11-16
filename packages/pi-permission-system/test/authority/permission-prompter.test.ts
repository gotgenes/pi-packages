import { describe, expect, it, vi } from "vitest";
import { BashProgram } from "#src/access-intent/bash/program";
import type { TerminalAuthorizer } from "#src/authority/authorizer";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import {
  PermissionPrompter,
  type PermissionPrompterDeps,
  type PromptPermissionDetails,
} from "#src/authority/permission-prompter";
import { describeBashExternalDirectoryGate } from "#src/handlers/gates/bash-external-directory";
import type { GateDescriptor } from "#src/handlers/gates/descriptor";
import { posixPathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path/path-normalizer";
import {
  DECIDED_BY_ABSENT_AUTHORITY,
  DECIDED_BY_HUMAN,
} from "#test/helpers/decision-fixtures";
import { makeResolver, makeTcc } from "#test/helpers/gate-fixtures";
import { makeCheckResult } from "#test/helpers/handler-fixtures";
import {
  makePromptDetails,
  makePromptPayload,
} from "#test/helpers/prompt-details-fixtures";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * A terminal stub returning a fixed decision.
 *
 * The default is filler for the tests whose subject is the review entry's
 * shape rather than the outcome; a test asserting a particular outcome passes
 * its own decision.
 */
function makeAuthorizer(
  decision: PermissionPromptDecision = {
    approved: true,
    state: "approved",
    decidedBy: DECIDED_BY_HUMAN,
  },
): TerminalAuthorizer {
  return {
    authorize: vi
      .fn<TerminalAuthorizer["authorize"]>()
      .mockResolvedValue(decision),
  };
}

/**
 * This file's semantic defaults over the shared structural fixture: the review
 * entries assert `agentName` and `toolName` on a no-override call.
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

function makeDeps(
  overrides?: Partial<PermissionPrompterDeps>,
): PermissionPrompterDeps {
  return {
    logger: { review: vi.fn() },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("PermissionPrompter", () => {
  describe("prompt flow", () => {
    it("logs permission_request.waiting before the outcome", async () => {
      const logger = { review: vi.fn() };
      const prompter = new PermissionPrompter(makeDeps({ logger }));
      const authorizer = makeAuthorizer();

      await prompter.prompt(authorizer, makeDetails());

      const calls = logger.review.mock.calls.map((c) => c[0] as string);
      expect(
        calls.indexOf("permission_request.waiting"),
      ).toBeGreaterThanOrEqual(0);
      expect(calls.indexOf("permission_request.waiting")).toBeLessThan(
        calls.indexOf("permission_request.approved"),
      );
    });

    it("calls authorizer.authorize with the details", async () => {
      const authorizer = makeAuthorizer();
      const prompter = new PermissionPrompter(makeDeps());
      const details = makeDetails();

      await prompter.prompt(authorizer, details);

      expect(authorizer.authorize).toHaveBeenCalledWith(details);
    });

    it("logs permission_request.approved when the authorizer approves", async () => {
      const logger = { review: vi.fn() };
      const prompter = new PermissionPrompter(makeDeps({ logger }));
      const authorizer = makeAuthorizer({
        approved: true,
        state: "approved",
        decidedBy: DECIDED_BY_HUMAN,
      });

      await prompter.prompt(authorizer, makeDetails());

      expect(logger.review).toHaveBeenCalledWith(
        "permission_request.approved",
        expect.objectContaining({
          requestId: "req-123",
          resolution: "approved",
        }),
      );
    });

    it("names the width a session grant was recorded at", async () => {
      const logger = { review: vi.fn() };
      const prompter = new PermissionPrompter(makeDeps({ logger }));
      const authorizer = makeAuthorizer({
        approved: true,
        state: "approved_for_session",
        sessionGrantWidth: "family",
        decidedBy: DECIDED_BY_HUMAN,
      });

      await prompter.prompt(authorizer, makeDetails());

      expect(logger.review).toHaveBeenCalledWith(
        "permission_request.approved",
        expect.objectContaining({
          resolution: "approved_for_session",
          sessionGrantWidth: "family",
        }),
      );
    });

    it("names the proven width when a session grant chose no width", async () => {
      const logger = { review: vi.fn() };
      const prompter = new PermissionPrompter(makeDeps({ logger }));
      const authorizer = makeAuthorizer({
        approved: true,
        state: "approved_for_session",
        decidedBy: DECIDED_BY_HUMAN,
      });

      await prompter.prompt(authorizer, makeDetails());

      expect(logger.review).toHaveBeenCalledWith(
        "permission_request.approved",
        expect.objectContaining({ sessionGrantWidth: "proven" }),
      );
    });

    it("names no width for an approval that granted nothing for the session", async () => {
      const logger = { review: vi.fn() };
      const prompter = new PermissionPrompter(makeDeps({ logger }));
      const authorizer = makeAuthorizer({
        approved: true,
        state: "approved",
        decidedBy: DECIDED_BY_HUMAN,
      });

      await prompter.prompt(authorizer, makeDetails());

      const [, details] = logger.review.mock.calls.at(-1) as [
        string,
        Record<string, unknown>,
      ];
      expect(details).not.toHaveProperty("sessionGrantWidth");
    });

    it("logs permission_request.denied when the authorizer denies", async () => {
      const logger = { review: vi.fn() };
      const prompter = new PermissionPrompter(makeDeps({ logger }));
      const authorizer = makeAuthorizer({
        approved: false,
        state: "denied",
        decidedBy: DECIDED_BY_HUMAN,
      });

      await prompter.prompt(authorizer, makeDetails());

      expect(logger.review).toHaveBeenCalledWith(
        "permission_request.denied",
        expect.objectContaining({
          requestId: "req-123",
          resolution: "denied",
        }),
      );
    });

    it("logs confirmation_unavailable resolution when the decision carries the marker", async () => {
      const logger = { review: vi.fn() };
      const prompter = new PermissionPrompter(makeDeps({ logger }));
      const authorizer = makeAuthorizer({
        approved: false,
        state: "denied",
        confirmationUnavailable: true,
        decidedBy: DECIDED_BY_ABSENT_AUTHORITY,
      });

      await prompter.prompt(authorizer, makeDetails());

      expect(logger.review).toHaveBeenCalledWith(
        "permission_request.denied",
        expect.objectContaining({
          resolution: "confirmation_unavailable",
        }),
      );
    });

    it("logs permission_request.denied with denialReason when present", async () => {
      const logger = { review: vi.fn() };
      const prompter = new PermissionPrompter(makeDeps({ logger }));
      const authorizer = makeAuthorizer({
        approved: false,
        state: "denied_with_reason",
        denialReason: "too sensitive",
        decidedBy: DECIDED_BY_HUMAN,
      });

      await prompter.prompt(authorizer, makeDetails());

      expect(logger.review).toHaveBeenCalledWith(
        "permission_request.denied",
        expect.objectContaining({
          denialReason: "too sensitive",
        }),
      );
    });

    it("records who decided on the outcome entry", async () => {
      const logger = { review: vi.fn() };
      const prompter = new PermissionPrompter(makeDeps({ logger }));
      const authorizer = makeAuthorizer({
        approved: true,
        state: "approved",
        decidedBy: { kind: "user", via: "dialog" },
      });

      await prompter.prompt(authorizer, makeDetails());

      expect(logger.review).toHaveBeenCalledWith(
        "permission_request.approved",
        expect.objectContaining({
          decidedBy: { kind: "user", via: "dialog" },
        }),
      );
    });

    it("records the decider on a denial too", async () => {
      const logger = { review: vi.fn() };
      const prompter = new PermissionPrompter(makeDeps({ logger }));
      const authorizer = makeAuthorizer({
        approved: false,
        state: "denied",
        confirmationUnavailable: true,
        decidedBy: { kind: "unavailable", reason: "nobody was home" },
      });

      await prompter.prompt(authorizer, makeDetails());

      expect(logger.review).toHaveBeenCalledWith(
        "permission_request.denied",
        expect.objectContaining({
          decidedBy: { kind: "unavailable", reason: "nobody was home" },
        }),
      );
    });

    it("leaves the waiting entry unattributed — nothing has decided yet", async () => {
      const logger = { review: vi.fn() };
      const prompter = new PermissionPrompter(makeDeps({ logger }));

      await prompter.prompt(makeAuthorizer(), makeDetails());

      const waiting = logger.review.mock.calls.find(
        (call) => call[0] === "permission_request.waiting",
      );
      expect(waiting?.[1]).not.toHaveProperty("decidedBy");
    });

    it("returns the decision from the authorizer", async () => {
      const decision: PermissionPromptDecision = {
        approved: false,
        state: "denied_with_reason",
        decidedBy: DECIDED_BY_HUMAN,
        denialReason: "sensitive",
      };
      const authorizer = makeAuthorizer(decision);
      const prompter = new PermissionPrompter(makeDeps());

      const result = await prompter.prompt(authorizer, makeDetails());

      expect(result).toEqual(decision);
    });
  });

  // ── Review log field coverage ────────────────────────────────────────────

  describe("review log fields", () => {
    it("includes all standard fields in the waiting log entry", async () => {
      const logger = { review: vi.fn() };
      const prompter = new PermissionPrompter(makeDeps({ logger }));
      const authorizer = makeAuthorizer();
      const details = makeDetails({
        toolCallId: "tc-1",
        skillName: "librarian",
        path: "/src/foo.ts",
        command: "git status",
        target: "server:tool",
        toolInputPreview: "{ path: '...' }",
      });

      await prompter.prompt(authorizer, details);

      expect(logger.review).toHaveBeenCalledWith(
        "permission_request.waiting",
        expect.objectContaining({
          requestId: "req-123",
          source: "tool_call",
          agentName: "test-agent",
          toolCallId: "tc-1",
          toolName: "read",
          skillName: "librarian",
          path: "/src/foo.ts",
          command: "git status",
          target: "server:tool",
          toolInputPreview: "{ path: '...' }",
        }),
      );
    });

    it("uses null for optional fields not present in details", async () => {
      const logger = { review: vi.fn() };
      const prompter = new PermissionPrompter(makeDeps({ logger }));
      const authorizer = makeAuthorizer();

      await prompter.prompt(authorizer, makeDetails());

      expect(logger.review).toHaveBeenCalledWith(
        "permission_request.waiting",
        expect.objectContaining({
          toolCallId: null,
          skillName: null,
          path: null,
          command: null,
          target: null,
          toolInputPreview: null,
        }),
      );
    });

    it("records the payload's request facts rather than its prompt wording", async () => {
      const logger = { review: vi.fn() };
      const prompter = new PermissionPrompter(makeDeps({ logger }));
      const authorizer = makeAuthorizer();

      await prompter.prompt(
        authorizer,
        makeDetails({
          payload: makePromptPayload({
            kind: "bash",
            request: {
              ...makePromptPayload().request,
              surface: "bash",
              toolName: "bash",
              value: "rm -rf build",
              matchedPattern: "rm *",
            },
          }),
        }),
      );

      expect(logger.review).toHaveBeenCalledWith(
        "permission_request.waiting",
        expect.objectContaining({ surface: "bash", matchedPattern: "rm *" }),
      );
    });

    it("persists neither the payload nor the prompt sentence", async () => {
      const logger = { review: vi.fn() };
      const prompter = new PermissionPrompter(makeDeps({ logger }));
      const authorizer = makeAuthorizer();

      await prompter.prompt(authorizer, makeDetails());

      // ADR 0010 bounds what the logs accumulate; a complete payload written on
      // every ask would defeat that bound, and a prompt sentence made the log's
      // growth a side effect of how the prompt happened to be worded.
      const [, entry] = logger.review.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(entry).not.toHaveProperty("payload");
      expect(entry).not.toHaveProperty("message");
      expect(entry).not.toHaveProperty("evidence");
    });

    it("names a bash external-directory ask's deciding path and its provenance on every entry", async () => {
      // The ask exactly as the gate raises it, so the entry reads what a human
      // deciding this ask is shown rather than a hand-built payload.
      const tcc = makeTcc({ input: { command: "cat /outside/a.ts" } });
      const normalizer = new PathNormalizer(posixPathFlavor, tcc.cwd);
      const gate = describeBashExternalDirectoryGate(
        tcc,
        await BashProgram.parse("cat /outside/a.ts", normalizer),
        makeResolver(
          makeCheckResult({
            state: "ask",
            toolName: "external_directory_read",
            matchedPattern: "*",
          }),
        ),
        normalizer,
      ) as GateDescriptor;
      const logger = { review: vi.fn() };
      const prompter = new PermissionPrompter(makeDeps({ logger }));

      await prompter.prompt(makeAuthorizer(), {
        requestId: "req-blame",
        payload: gate.payload,
        ...gate.promptDetails,
      });

      const blame = {
        decidingPath: "/outside/a.ts",
        effect: "read",
        effectSource: "core",
      };
      expect(logger.review).toHaveBeenCalledWith(
        "permission_request.waiting",
        expect.objectContaining(blame),
      );
      expect(logger.review).toHaveBeenCalledWith(
        "permission_request.approved",
        expect.objectContaining(blame),
      );
    });
  });
});
