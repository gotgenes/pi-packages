import type { AccessPath } from "#src/access-intent/access-path";
import type { BashProgram } from "#src/access-intent/bash/program";
import type { TokenEffect } from "#src/access-intent/effect";
import { capabilitySurfaceForEffect } from "#src/access-intent/path-surfaces";
import type { PathNormalizer } from "#src/path-normalizer";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import { buildPathAskPayload } from "#src/presentation/path-ask-payload";
import { pickMostRestrictive } from "#src/restrictiveness";
import { SessionApproval } from "#src/session-approval";
import type { PermissionCheckResult } from "#src/types";
import type { GateResult } from "./descriptor";
import { accessFactsFromPath } from "./helpers";
import type { ToolCallContext } from "./types";

/**
 * Build a pure descriptor for the cross-cutting path permission gate (bash).
 *
 * Reads path-rule candidates from the injected `BashProgram` (the broader
 * `path`-rule filter, accepting dot-files and relative paths). Each candidate
 * pairs the raw token with cd-aware policy values and the effect its position
 * proved; the gate evaluates those values against the narrowest `path`-family
 * surface that effect names and returns the most restrictive result, while
 * prompts, logs, and session approvals use the raw token.
 *
 * A proven read resolves on `path_read`, a proven write on `path_write`, and
 * an unproven token on the bare family, whose two members the resolver folds
 * most-restrictive (ADR 0013 §10). The deciding token's surface is the one the
 * descriptor, the payload, the access facts, the decision, and the session
 * approval all carry — a session grant is never wider than what the gate
 * proved.
 *
 * Returns `null` when the gate does not apply (not a shell invocation, no
 * command, no tokens extracted, or all tokens evaluate to `allow`).
 * Returns a `GateBypass` when all tokens are session-covered.
 * Returns a `GateDescriptor` for the most restrictive token needing a check.
 *
 * The shell command (native `bash` or an aliased shell tool) is read from the
 * injected `BashProgram`, which owns the source text it was parsed from, so
 * this gate does not re-derive the input field name (#574).
 */
export function describeBashPathGate(
  tcc: ToolCallContext,
  bashProgram: BashProgram | null,
  resolver: ScopedPermissionResolver,
  normalizer: PathNormalizer,
): GateResult {
  if (!bashProgram) return null;
  const command = bashProgram.commandText();

  const candidates = bashProgram.pathRuleCandidates();
  if (candidates.length === 0) return null;
  const tokens = candidates.map(({ token }) => token);

  // Tokens whose resolved state needs a check (deny/ask), paired with the raw
  // token (prompt/decision display) and its `AccessPath` (whose `value()` is
  // the lexical absolute path the approval pattern is derived from).
  const uncovered: Array<{
    token: string;
    path: AccessPath;
    surface: string;
    effect: TokenEffect;
    check: PermissionCheckResult;
  }> = [];
  let allSessionCovered = true;

  for (const { token, path, effect } of candidates) {
    const surface = capabilitySurfaceForEffect("path", effect.effect);
    const check = resolver.resolve({
      kind: "access-path",
      surface,
      path,
      agentName: tcc.agentName ?? undefined,
    });

    // No explicit path rule matched — only the universal default fired.
    // Treat this token as unrestricted to preserve backward compatibility
    // for configs without a "path" key (#58).
    if (check.matchedPattern === undefined && check.source !== "session") {
      allSessionCovered = false;
      continue;
    }

    if (check.source !== "session") {
      allSessionCovered = false;
    }

    if (check.state === "deny") {
      uncovered.push({ token, path, surface, effect, check });
      break; // Short-circuit on deny.
    }
    if (check.state === "ask") {
      uncovered.push({ token, path, surface, effect, check });
    }
  }

  // All tokens are session-covered — bypass.
  if (allSessionCovered) {
    return {
      action: "allow",
      // Every token was covered, each possibly by a different session pattern
      // -- the surface is one value and the pattern is not. The entry's
      // `tokens` lists what was covered.
      decidedBy: {
        kind: "session_approval",
        surface: "path",
        pattern: null,
      },
      log: {
        event: "permission_request.session_approved",
        details: {
          source: "tool_call",
          toolCallId: tcc.toolCallId,
          toolName: tcc.toolName,
          agentName: tcc.agentName,
          command,
          tokens,
          resolution: "session_approved",
        },
      },
    };
  }

  // Pick the most restrictive (deny > ask > allow, first-wins) uncovered token.
  const worstCheck = pickMostRestrictive(uncovered.map(({ check }) => check));
  const worstEntry = worstCheck
    ? uncovered.find(({ check }) => check === worstCheck)
    : undefined;
  const worstToken = worstEntry?.token ?? null;

  // All tokens evaluate to allow — no restriction.
  if (!worstCheck || !worstToken || !worstEntry) return null;

  // Derive the pattern from the lexical absolute form (the cd-aware resolved
  // path), so it matches the values a later call produces. For an unknown base
  // (`forLiteral`) `value()` is the raw token.
  const pattern = normalizer.approvalPatternFor(worstEntry.path);
  const surface = worstEntry.surface;
  const payload = buildPathAskPayload({
    toolName: tcc.toolName,
    pathValue: worstToken,
    agentName: tcc.agentName,
    matchedPattern: worstCheck.matchedPattern,
    surface,
  });

  return {
    surface,
    input: { path: worstToken },
    payload,
    sessionApproval: SessionApproval.single(surface, pattern),
    promptDetails: {
      source: "tool_call",
      agentName: tcc.agentName,
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      command,
      accessIntent: accessFactsFromPath(surface, worstEntry.path),
    },
    logContext: {
      source: "tool_call",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      agentName: tcc.agentName,
      command,
      path: worstToken,
      // The blame line ADR 0013 §7 asks for: `request.surface` already records
      // the direction, and these two record what established it.
      effect: worstEntry.effect.effect,
      effectSource: worstEntry.effect.source,
    },
    decision: {
      surface,
      value: worstToken,
    },
    preCheck: worstCheck,
  };
}
