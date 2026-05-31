import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Module mocks ────────────────────────────────────────────────────────────

const { mockConfirmPermission } = vi.hoisted(() => ({
  mockConfirmPermission: vi.fn(),
}));

vi.mock("../src/forwarded-permissions/polling", () => ({
  confirmPermission: mockConfirmPermission,
  processForwardedPermissionRequests: vi.fn().mockResolvedValue(undefined),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_EXTENSION_CONFIG } from "#src/extension-config";
import type { PermissionPromptDecision } from "#src/permission-dialog";
import type { PromptPermissionDetails } from "#src/permission-prompter";
import {
  PermissionPrompter,
  type PermissionPrompterDeps,
} from "#src/permission-prompter";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeCtx(hasUI: boolean): ExtensionContext {
  return {
    hasUI,
    ui: { select: vi.fn(), input: vi.fn() },
    sessionManager: { getSessionDir: vi.fn().mockReturnValue(null) },
  } as unknown as ExtensionContext;
}

function makeDetails(
  overrides?: Partial<PromptPermissionDetails>,
): PromptPermissionDetails {
  return {
    requestId: "req-123",
    source: "tool_call",
    agentName: "test-agent",
    message: "Allow read?",
    toolName: "read",
    ...overrides,
  };
}

function makeDeps(
  overrides?: Partial<PermissionPrompterDeps>,
): PermissionPrompterDeps {
  return {
    getConfig: () => ({ ...DEFAULT_EXTENSION_CONFIG, yoloMode: false }),
    writeReviewLog: vi.fn(),
    subagentSessionsDir: "/sessions/subagents",
    forwardingDir: "/sessions/permission-forwarding",
    events: { emit: vi.fn(), on: vi.fn().mockReturnValue(() => undefined) },
    requestPermissionDecisionFromUi: vi
      .fn()
      .mockResolvedValue({ approved: true, state: "approved" }),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("PermissionPrompter", () => {
  beforeEach(() => {
    mockConfirmPermission.mockReset();
  });

  // ── Yolo-mode auto-approve ───────────────────────────────────────────────

  describe("yolo-mode auto-approve", () => {
    it("returns approved without calling confirmPermission when yoloMode is true", async () => {
      const events = {
        emit: vi.fn(),
        on: vi.fn().mockReturnValue(() => undefined),
      };
      const deps = makeDeps({
        getConfig: () => ({ ...DEFAULT_EXTENSION_CONFIG, yoloMode: true }),
        events,
      });
      const prompter = new PermissionPrompter(deps);

      const decision = await prompter.prompt(makeCtx(false), makeDetails());

      expect(decision).toEqual({
        approved: true,
        state: "approved",
        autoApproved: true,
      });
      expect(mockConfirmPermission).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalledWith(
        "permissions:ui_prompt",
        expect.anything(),
      );
    });

    it("logs permission_request.auto_approved in yolo mode", async () => {
      const writeReviewLog = vi.fn();
      const deps = makeDeps({
        getConfig: () => ({ ...DEFAULT_EXTENSION_CONFIG, yoloMode: true }),
        writeReviewLog,
      });
      const prompter = new PermissionPrompter(deps);

      await prompter.prompt(makeCtx(false), makeDetails());

      expect(writeReviewLog).toHaveBeenCalledWith(
        "permission_request.auto_approved",
        expect.objectContaining({ requestId: "req-123" }),
      );
    });

    it("does not log permission_request.waiting in yolo mode", async () => {
      const writeReviewLog = vi.fn();
      const deps = makeDeps({
        getConfig: () => ({ ...DEFAULT_EXTENSION_CONFIG, yoloMode: true }),
        writeReviewLog,
      });
      const prompter = new PermissionPrompter(deps);

      await prompter.prompt(makeCtx(false), makeDetails());

      expect(writeReviewLog).not.toHaveBeenCalledWith(
        "permission_request.waiting",
        expect.anything(),
      );
    });

    it("does not call confirmPermission with yoloMode even when ctx has UI", async () => {
      const deps = makeDeps({
        getConfig: () => ({ ...DEFAULT_EXTENSION_CONFIG, yoloMode: true }),
      });
      const prompter = new PermissionPrompter(deps);

      await prompter.prompt(makeCtx(true), makeDetails());

      expect(mockConfirmPermission).not.toHaveBeenCalled();
    });
  });

  // ── Non-yolo path ────────────────────────────────────────────────────────

  describe("non-yolo path (UI present)", () => {
    it("logs permission_request.waiting before calling confirmPermission", async () => {
      const writeReviewLog = vi.fn();
      const approved: PermissionPromptDecision = {
        approved: true,
        state: "approved",
      };
      mockConfirmPermission.mockResolvedValue(approved);
      const deps = makeDeps({ writeReviewLog });
      const prompter = new PermissionPrompter(deps);

      await prompter.prompt(makeCtx(true), makeDetails());

      const calls = writeReviewLog.mock.calls.map((c) => c[0] as string);
      expect(
        calls.indexOf("permission_request.waiting"),
      ).toBeGreaterThanOrEqual(0);
      expect(calls.indexOf("permission_request.waiting")).toBeLessThan(
        calls.indexOf("permission_request.approved"),
      );
    });

    it("passes a UI prompt event with normalized surface and value to confirmPermission", async () => {
      const events = {
        emit: vi.fn(),
        on: vi.fn().mockReturnValue(() => undefined),
      };
      mockConfirmPermission.mockResolvedValue({
        approved: true,
        state: "approved",
      });
      const deps = makeDeps({ events });
      const prompter = new PermissionPrompter(deps);

      await prompter.prompt(
        makeCtx(true),
        makeDetails({
          toolName: "bash",
          command: "git push",
          toolInputPreview: "git push",
        }),
      );

      expect(events.emit).not.toHaveBeenCalled();
      expect(mockConfirmPermission.mock.calls[0][4]).toEqual(
        expect.objectContaining({
          protocolVersion: 1,
          requestId: "req-123",
          source: "tool_call",
          surface: "bash",
          value: "git push",
          toolName: "bash",
          command: "git push",
          toolInputPreview: "git push",
        }),
      );
    });

    it("normalizes skill UI prompt events to the skill surface", async () => {
      const events = {
        emit: vi.fn(),
        on: vi.fn().mockReturnValue(() => undefined),
      };
      mockConfirmPermission.mockResolvedValue({
        approved: true,
        state: "approved",
      });
      const deps = makeDeps({ events });
      const prompter = new PermissionPrompter(deps);

      await prompter.prompt(
        makeCtx(true),
        makeDetails({
          source: "skill_input",
          toolName: undefined,
          skillName: "deploy-helper",
        }),
      );

      expect(events.emit).not.toHaveBeenCalled();
      expect(mockConfirmPermission.mock.calls[0][4]).toEqual(
        expect.objectContaining({
          protocolVersion: 1,
          source: "skill_input",
          surface: "skill",
          value: "deploy-helper",
          skillName: "deploy-helper",
        }),
      );
    });

    it("logs permission_request.approved when confirmPermission returns approved", async () => {
      const writeReviewLog = vi.fn();
      mockConfirmPermission.mockResolvedValue({
        approved: true,
        state: "approved",
      });
      const deps = makeDeps({ writeReviewLog });
      const prompter = new PermissionPrompter(deps);

      await prompter.prompt(makeCtx(true), makeDetails());

      expect(writeReviewLog).toHaveBeenCalledWith(
        "permission_request.approved",
        expect.objectContaining({
          requestId: "req-123",
          resolution: "approved",
        }),
      );
    });

    it("logs permission_request.denied when confirmPermission returns denied", async () => {
      const writeReviewLog = vi.fn();
      mockConfirmPermission.mockResolvedValue({
        approved: false,
        state: "denied",
      });
      const deps = makeDeps({ writeReviewLog });
      const prompter = new PermissionPrompter(deps);

      await prompter.prompt(makeCtx(true), makeDetails());

      expect(writeReviewLog).toHaveBeenCalledWith(
        "permission_request.denied",
        expect.objectContaining({
          requestId: "req-123",
          resolution: "denied",
        }),
      );
    });

    it("logs permission_request.denied with denialReason when present", async () => {
      const writeReviewLog = vi.fn();
      mockConfirmPermission.mockResolvedValue({
        approved: false,
        state: "denied_with_reason",
        denialReason: "too sensitive",
      });
      const deps = makeDeps({ writeReviewLog });
      const prompter = new PermissionPrompter(deps);

      await prompter.prompt(makeCtx(true), makeDetails());

      expect(writeReviewLog).toHaveBeenCalledWith(
        "permission_request.denied",
        expect.objectContaining({
          denialReason: "too sensitive",
        }),
      );
    });

    it("returns the decision from confirmPermission", async () => {
      const decision: PermissionPromptDecision = {
        approved: false,
        state: "denied_with_reason",
        denialReason: "sensitive",
      };
      mockConfirmPermission.mockResolvedValue(decision);
      const deps = makeDeps();
      const prompter = new PermissionPrompter(deps);

      const result = await prompter.prompt(makeCtx(true), makeDetails());

      expect(result).toEqual(decision);
    });

    it("passes sessionLabel option to confirmPermission when present", async () => {
      mockConfirmPermission.mockResolvedValue({
        approved: true,
        state: "approved",
      });
      const deps = makeDeps();
      const prompter = new PermissionPrompter(deps);
      const details = makeDetails({ sessionLabel: "Yes, for 'read' tool" });

      await prompter.prompt(makeCtx(true), details);

      expect(mockConfirmPermission).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        { sessionLabel: "Yes, for 'read' tool" },
        expect.objectContaining({ sessionLabel: "Yes, for 'read' tool" }),
      );
    });

    it("passes undefined options to confirmPermission when sessionLabel is absent", async () => {
      mockConfirmPermission.mockResolvedValue({
        approved: true,
        state: "approved",
      });
      const deps = makeDeps();
      const prompter = new PermissionPrompter(deps);

      await prompter.prompt(makeCtx(true), makeDetails());

      expect(mockConfirmPermission).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        undefined,
        expect.objectContaining({ sessionLabel: null }),
      );
    });

    it("passes the message from details to confirmPermission", async () => {
      mockConfirmPermission.mockResolvedValue({
        approved: true,
        state: "approved",
      });
      const deps = makeDeps();
      const prompter = new PermissionPrompter(deps);
      const details = makeDetails({ message: "Allow bash: git status?" });

      await prompter.prompt(makeCtx(true), details);

      expect(mockConfirmPermission).toHaveBeenCalledWith(
        expect.anything(),
        "Allow bash: git status?",
        expect.anything(),
        undefined,
        expect.objectContaining({ message: "Allow bash: git status?" }),
      );
    });
  });

  // ── Review log field coverage ────────────────────────────────────────────

  describe("review log fields", () => {
    it("includes all standard fields in the waiting log entry", async () => {
      const writeReviewLog = vi.fn();
      mockConfirmPermission.mockResolvedValue({
        approved: true,
        state: "approved",
      });
      const deps = makeDeps({ writeReviewLog });
      const prompter = new PermissionPrompter(deps);
      const details = makeDetails({
        toolCallId: "tc-1",
        skillName: "librarian",
        path: "/src/foo.ts",
        command: "git status",
        target: "server:tool",
        toolInputPreview: "{ path: '...' }",
      });

      await prompter.prompt(makeCtx(true), details);

      expect(writeReviewLog).toHaveBeenCalledWith(
        "permission_request.waiting",
        expect.objectContaining({
          requestId: "req-123",
          source: "tool_call",
          agentName: "test-agent",
          message: "Allow read?",
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
      const writeReviewLog = vi.fn();
      mockConfirmPermission.mockResolvedValue({
        approved: true,
        state: "approved",
      });
      const deps = makeDeps({ writeReviewLog });
      const prompter = new PermissionPrompter(deps);

      await prompter.prompt(makeCtx(true), makeDetails());

      expect(writeReviewLog).toHaveBeenCalledWith(
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
  });

  // ── Subagent forwarding path ─────────────────────────────────────────────

  describe("subagent forwarding path", () => {
    it("calls confirmPermission even when ctx has no UI", async () => {
      const forwarded: PermissionPromptDecision = {
        approved: true,
        state: "approved",
      };
      mockConfirmPermission.mockResolvedValue(forwarded);
      const deps = makeDeps();
      const prompter = new PermissionPrompter(deps);

      await prompter.prompt(makeCtx(false), makeDetails());

      expect(mockConfirmPermission).toHaveBeenCalled();
    });

    it("returns the decision from confirmPermission in the subagent path", async () => {
      const forwarded: PermissionPromptDecision = {
        approved: false,
        state: "denied",
      };
      mockConfirmPermission.mockResolvedValue(forwarded);
      const deps = makeDeps();
      const prompter = new PermissionPrompter(deps);

      const result = await prompter.prompt(makeCtx(false), makeDetails());

      expect(result).toEqual(forwarded);
    });

    it("logs the outcome when confirmPermission resolves via forwarding", async () => {
      const writeReviewLog = vi.fn();
      mockConfirmPermission.mockResolvedValue({
        approved: true,
        state: "approved",
      });
      const deps = makeDeps({ writeReviewLog });
      const prompter = new PermissionPrompter(deps);

      await prompter.prompt(makeCtx(false), makeDetails());

      expect(writeReviewLog).toHaveBeenCalledWith(
        "permission_request.approved",
        expect.objectContaining({ requestId: "req-123" }),
      );
    });
  });
});
