import type {
  ExtensionContext,
  InputEventResult,
} from "@earendil-works/pi-coding-agent";

import { toRecord } from "../common";
import { suggestSessionPattern } from "../pattern-suggest";
import {
  emitDecisionEvent,
  type PermissionEventBus,
} from "../permission-events";
import { applyPermissionGate } from "../permission-gate";
import type { PromptPermissionDetails } from "../permission-prompter";
import {
  formatMissingToolNameReason,
  formatSkillAskPrompt,
  formatUnknownToolReason,
} from "../permission-prompts";
import type { PermissionSession } from "../permission-session";
import { persistPermissionRule } from "../persist-permission-rule";
import {
  checkRequestedToolRegistration,
  getToolNameFromValue,
  type ToolRegistry,
} from "../tool-registry";
import { describeBashExternalDirectoryGate } from "./gates/bash-external-directory";
import { describeBashPathGate } from "./gates/bash-path";
import type { GateRunnerDeps } from "./gates/descriptor";
import { isGateBypass } from "./gates/descriptor";
import { describeExternalDirectoryGate } from "./gates/external-directory";
import { describePathGate } from "./gates/path";
import { runGateCheck } from "./gates/runner";
import { describeSkillReadGate } from "./gates/skill-read";
import { describeToolGate } from "./gates/tool";
import type { ToolCallContext } from "./gates/types";

/** Minimal subset of InputEvent used by handleInput. */
interface InputPayload {
  text: string;
}

/**
 * Handles permission gate events: tool_call and input.
 *
 * Constructor deps:
 * - `session` — encapsulates all mutable session state and permission operations
 * - `events` — event bus for emitting permissions:decision broadcasts
 * - `toolRegistry` — Pi tool API subset (getAll + setActive)
 */
export class PermissionGateHandler {
  constructor(
    private readonly session: PermissionSession,
    private readonly events: PermissionEventBus,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  async handleToolCall(
    event: unknown,
    ctx: ExtensionContext,
  ): Promise<{ block?: true; reason?: string }> {
    const { session } = this;
    session.activate(ctx);

    const agentName = session.resolveAgentName(ctx);
    const toolName = getToolNameFromValue(event);

    if (!toolName) {
      return { block: true, reason: formatMissingToolNameReason() };
    }

    const registrationCheck = checkRequestedToolRegistration(
      toolName,
      this.toolRegistry.getAll(),
    );
    if (registrationCheck.status === "missing-tool-name") {
      return { block: true, reason: formatMissingToolNameReason() };
    }

    if (registrationCheck.status === "unregistered") {
      return {
        block: true,
        reason: formatUnknownToolReason(
          registrationCheck.requestedToolName,
          registrationCheck.availableToolNames,
        ),
      };
    }

    const input = getEventInput(event);
    const toolCallId =
      typeof (event as Record<string, unknown>).toolCallId === "string"
        ? ((event as Record<string, unknown>).toolCallId as string)
        : "";

    const tcc: ToolCallContext = {
      toolName,
      agentName,
      input,
      toolCallId,
      cwd: ctx.cwd,
    };

    // ── Shared gate adapter closures ─────────────────────────────────────
    const canConfirm = () => session.canPrompt(ctx);
    const promptPermission = (details: PromptPermissionDetails) =>
      session.prompt(ctx, details);
    const emitDecision: GateRunnerDeps["emitDecision"] = (e) =>
      emitDecisionEvent(this.events, e);
    const writeReviewLog = session.logger.review;
    const checkPermission: GateRunnerDeps["checkPermission"] = (
      surface,
      input,
      agent,
      sessionRules,
    ) => session.checkPermission(surface, input, agent, sessionRules);
    const getSessionRuleset = () => session.getSessionRuleset();
    const approveSessionRule = (surface: string, pattern: string) =>
      session.approveSessionRule(surface, pattern);
    const persistCustomPattern: GateRunnerDeps["persistCustomPattern"] = (
      target,
      surface,
      pattern,
      action,
    ) => {
      if (target === "session") {
        throw new Error("Session custom patterns are not persisted to config.");
      }
      return persistPermissionRule({
        agentDir: session.getAgentDir(),
        cwd: ctx.cwd,
        scope: target,
        surface,
        pattern,
        action,
      }).path;
    };

    // ── Shared runner deps (built once, reused for all gates) ────────────
    const runnerDeps: GateRunnerDeps = {
      checkPermission,
      getSessionRuleset,
      approveSessionRule,
      persistCustomPattern,
      refreshConfig: () => session.refreshConfig(ctx),
      writeReviewLog,
      emitDecision,
      canConfirm,
      promptPermission,
    };

    // ── Skill-read gate (descriptor + runner) ───────────────────────────────
    const skillDescriptor = describeSkillReadGate(tcc, () =>
      session.getActiveSkillEntries(),
    );
    if (skillDescriptor) {
      const skillResult = await runGateCheck(
        skillDescriptor,
        tcc.agentName,
        tcc.toolCallId,
        runnerDeps,
      );
      if (skillResult.action === "block") {
        return { block: true, reason: skillResult.reason };
      }
    }

    // ── Path gate for tools (descriptor + runner) ────────────────────────────
    const pathDesc = describePathGate(tcc, checkPermission, getSessionRuleset);
    if (pathDesc) {
      if (isGateBypass(pathDesc)) {
        if (pathDesc.log) {
          writeReviewLog(pathDesc.log.event, pathDesc.log.details);
        }
      } else {
        const pathResult = await runGateCheck(
          pathDesc,
          tcc.agentName,
          tcc.toolCallId,
          runnerDeps,
        );
        if (pathResult.action === "block") {
          return { block: true, reason: pathResult.reason };
        }
      }
    }

    // ── External-directory gate (descriptor + runner) ────────────────────────
    const infraDirs = [
      ...session.getInfrastructureDirs(),
      ...session.getInfrastructureReadPaths(),
    ];
    const extDirDesc = describeExternalDirectoryGate(tcc, infraDirs);
    if (extDirDesc) {
      if (isGateBypass(extDirDesc)) {
        if (extDirDesc.log) {
          writeReviewLog(extDirDesc.log.event, extDirDesc.log.details);
        }
        if (extDirDesc.decision) {
          emitDecision(extDirDesc.decision);
        }
      } else {
        const extDirResult = await runGateCheck(
          extDirDesc,
          tcc.agentName,
          tcc.toolCallId,
          runnerDeps,
        );
        if (extDirResult.action === "block") {
          return { block: true, reason: extDirResult.reason };
        }
      }
    }

    // ── Bash external-directory gate (descriptor + runner) ───────────────────
    const bashExtDesc = await describeBashExternalDirectoryGate(
      tcc,
      checkPermission,
      getSessionRuleset,
    );
    if (bashExtDesc) {
      if (isGateBypass(bashExtDesc)) {
        if (bashExtDesc.log) {
          writeReviewLog(bashExtDesc.log.event, bashExtDesc.log.details);
        }
      } else {
        const bashExtResult = await runGateCheck(
          bashExtDesc,
          tcc.agentName,
          tcc.toolCallId,
          runnerDeps,
        );
        if (bashExtResult.action === "block") {
          return { block: true, reason: bashExtResult.reason };
        }
      }
    }

    // ── Bash path gate (descriptor + runner) ────────────────────────────────
    const bashPathDesc = await describeBashPathGate(
      tcc,
      checkPermission,
      getSessionRuleset,
    );
    if (bashPathDesc) {
      if (isGateBypass(bashPathDesc)) {
        if (bashPathDesc.log) {
          writeReviewLog(bashPathDesc.log.event, bashPathDesc.log.details);
        }
      } else {
        const bashPathResult = await runGateCheck(
          bashPathDesc,
          tcc.agentName,
          tcc.toolCallId,
          runnerDeps,
        );
        if (bashPathResult.action === "block") {
          return { block: true, reason: bashPathResult.reason };
        }
      }
    }

    // ── Normal tool permission gate (descriptor + runner) ────────────────────
    const toolCheck = checkPermission(
      tcc.toolName,
      tcc.input,
      tcc.agentName ?? undefined,
      getSessionRuleset(),
    );
    const toolDescriptor = describeToolGate(tcc, toolCheck);
    toolDescriptor.preCheck = toolCheck;
    const toolResult = await runGateCheck(
      toolDescriptor,
      tcc.agentName,
      tcc.toolCallId,
      runnerDeps,
    );
    if (toolResult.action === "block") {
      return { block: true, reason: toolResult.reason };
    }

    return {};
  }

  async handleInput(
    event: InputPayload,
    ctx: ExtensionContext,
  ): Promise<InputEventResult> {
    const { session } = this;
    session.activate(ctx);

    const skillName = extractSkillNameFromInput(event.text);
    if (!skillName) {
      return { action: "continue" };
    }

    const agentName = session.resolveAgentName(ctx);
    const check = session.checkPermission(
      "skill",
      { name: skillName },
      agentName ?? undefined,
    );

    if (check.state === "deny" && ctx.hasUI) {
      const notifyMessage = agentName
        ? `Skill '${skillName}' is not permitted for agent '${agentName}'.`
        : `Skill '${skillName}' is not permitted by the current skill policy.`;
      ctx.ui.notify(notifyMessage, "warning");
    }

    const skillInputMessage = formatSkillAskPrompt(
      skillName,
      agentName ?? undefined,
    );
    const skillSuggestion = suggestSessionPattern("skill", skillName);
    const skillInputCanConfirm = session.canPrompt(ctx);
    let skillInputAutoApproved = false;
    const skillInputGate = await applyPermissionGate({
      state: check.state,
      canConfirm: skillInputCanConfirm,
      sessionApproval: {
        surface: skillSuggestion.surface,
        pattern: skillSuggestion.pattern,
      },
      promptForApproval: async () => {
        const decision = await session.prompt(ctx, {
          requestId: session.createPermissionRequestId("skill-input"),
          source: "skill_input",
          agentName,
          message: skillInputMessage,
          surface: "skill",
          defaultPersistAction: "allow",
          skillName,
          sessionLabel: skillSuggestion.label,
          customPatternOptions: skillSuggestion.patternOptions,
        });
        skillInputAutoApproved = decision.autoApproved === true;
        return decision;
      },
      writeLog: session.logger.review,
      logContext: {
        source: "skill_input",
        skillName,
        agentName,
        message: skillInputMessage,
      },
      messages: {
        denyReason: skillInputMessage,
        unavailableReason:
          "Skill requires approval, but no interactive UI is available.",
        userDeniedReason: () => "User denied skill.",
      },
    });

    emitDecisionEvent(this.events, {
      surface: "skill",
      value: skillName,
      result: skillInputGate.action === "allow" ? "allow" : "deny",
      resolution:
        check.state === "allow"
          ? "policy_allow"
          : check.state === "deny"
            ? "policy_deny"
            : skillInputGate.action === "allow"
              ? skillInputAutoApproved
                ? "auto_approved"
                : skillInputGate.customPatternApproval
                  ? "approved_with_custom_pattern"
                  : skillInputGate.sessionApproval
                    ? "user_approved_for_session"
                    : "user_approved"
              : skillInputCanConfirm
                ? "user_denied"
                : "confirmation_unavailable",
      origin: check.origin ?? null,
      agentName: agentName ?? null,
      matchedPattern: check.matchedPattern ?? null,
    });

    if (skillInputGate.action === "allow") {
      if (skillInputGate.sessionApproval) {
        session.approveSessionRule(
          skillInputGate.sessionApproval.surface,
          skillInputGate.sessionApproval.pattern,
        );
      }

      if (skillInputGate.customPatternApproval) {
        if (skillInputGate.customPatternApproval.target === "session") {
          session.approveSessionRule(
            "skill",
            skillInputGate.customPatternApproval.pattern,
          );
        } else {
          persistPermissionRule({
            agentDir: session.getAgentDir(),
            cwd: ctx.cwd,
            scope: skillInputGate.customPatternApproval.target,
            surface: "skill",
            pattern: skillInputGate.customPatternApproval.pattern,
            action: "allow",
          });
          session.approveSessionRule(
            "skill",
            skillInputGate.customPatternApproval.pattern,
          );
          session.refreshConfig(ctx);
        }
      }
    }

    if (skillInputGate.action === "block") {
      return { action: "handled" };
    }

    return { action: "continue" };
  }
}

// ── Pure helpers (re-exported from original modules) ──────────────────────

/**
 * Extract the tool input from an event, checking both `input` and `arguments`
 * fields (different Pi SDK versions use different names).
 */
export function getEventInput(event: unknown): unknown {
  const record = toRecord(event);

  if (record.input !== undefined) {
    return record.input;
  }

  if (record.arguments !== undefined) {
    return record.arguments;
  }

  return {};
}

/**
 * Parse a `/skill:<name>` prefix from user input.
 * Returns the skill name, or null if the text is not a skill invocation.
 */
export function extractSkillNameFromInput(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/skill:")) {
    return null;
  }

  const afterPrefix = trimmed.slice("/skill:".length);
  if (!afterPrefix) {
    return null;
  }

  const firstWhitespace = afterPrefix.search(/\s/);
  const skillName = (
    firstWhitespace === -1 ? afterPrefix : afterPrefix.slice(0, firstWhitespace)
  ).trim();
  return skillName || null;
}
