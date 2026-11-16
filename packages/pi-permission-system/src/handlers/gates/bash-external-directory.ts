import type { BashProgram } from "#src/access-intent/bash/program";
import type { PathNormalizer } from "#src/path/path-normalizer";
import type { ScopedPermissionResolver } from "#src/policy/permission-resolver";
import { buildBashExternalDirectoryAskPayload } from "#src/presentation/path-ask-payload";
import { SessionApproval } from "#src/session/session-approval";
import type { GateResult } from "./descriptor";
import {
  selectUncoveredExternalPaths,
  type UncoveredExternalPath,
} from "./external-directory-policy";
import { accessFactsFromPath } from "./helpers";
import type { ToolCallContext } from "./types";

/**
 * Build a pure descriptor for the bash external-directory permission gate.
 *
 * Reads the external paths from the injected `BashProgram` and checks whether
 * any reference directories outside the working directory. Returns `null` when the gate
 * does not apply (not a shell invocation, no command, or no external paths found).
 * Returns `null` when every path is allowed by a config rule or the universal
 * fallback — like any policy allow, it writes no review entry. Returns a
 * `GateBypass` recording a session approval when every path is allowed and at
 * least one was covered by a session grant.
 * Returns a `GateDescriptor` with multi-pattern sessionApproval for uncovered paths.
 *
 * Each path is resolved on the narrowest `external_directory`-family surface
 * its own attributed effect names, and the session approval records one grant
 * per uncovered path at that same surface (#810) — so an ask mixing a proven
 * read with a proven write grants each path only its own direction, never both
 * on both. Two paths sharing a directory derive the same glob and so grant
 * both directions there, which is what the prompt showed.
 *
 * The shell command (native `bash` or an aliased shell tool) is read from the
 * injected `BashProgram`, which owns the source text it was parsed from, so
 * this gate does not re-derive the input field name (#574).
 */
export function describeBashExternalDirectoryGate(
  tcc: ToolCallContext,
  bashProgram: BashProgram | null,
  resolver: ScopedPermissionResolver,
  normalizer: PathNormalizer,
): GateResult {
  if (!bashProgram) return null;
  const command = bashProgram.commandText();

  const externalAccesses = bashProgram.externalAccesses();
  if (externalAccesses.length === 0) return null;

  // Resolve every external path on the external_directory surface and keep the
  // ones not already allowed (config-level allows suppress the prompt just as
  // session-level allows do), noting which allowed ones a session grant
  // covered; the shared helper single-sources the #418 alias matching and the
  // worst-uncovered selection.
  const {
    uncovered: uncoveredEntries,
    sessionCovered,
    worstCheck,
  } = selectUncoveredExternalPaths(
    externalAccesses,
    resolver,
    tcc.agentName ?? undefined,
  );
  const uncoveredPaths = uncoveredEntries.map(({ path }) => path.value());

  if (uncoveredPaths.length === 0) {
    // No session grant decided any path: policy alone allowed the command.
    if (sessionCovered.length === 0) return null;
    return {
      action: "allow",
      // A whole-command bypass covers every session-granted path at once, and
      // each may have matched a different session pattern -- so the surface is
      // one value and the pattern is not. The entry's `externalPaths` lists the
      // paths a grant covered, never the ones policy allowed.
      decidedBy: {
        kind: "session_approval",
        surface: "external_directory",
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
          externalPaths: sessionCovered.map((path) => path.value()),
          resolution: "session_approved",
        },
      },
    };
  }

  // After the early bypass, at least one path is uncovered, so worstCheck is
  // defined; the fallback keeps TypeScript happy across the early return. A
  // config-level "deny" is preserved (not downgraded to the catch-all "ask").
  const preCheck = worstCheck ?? uncoveredEntries[0].check;
  // The AccessPath the decision was made against — its facts ride the wire.
  const worstEntry =
    uncoveredEntries.find(({ check }) => check === preCheck) ??
    uncoveredEntries[0];

  const disclosures = uncoveredEntries.map(({ path }) => ({
    path: path.value(),
    resolvedPath: path.resolvedAlias(),
  }));

  const surface = worstEntry.surface;
  // A token the parse could not read as bash will (`/@(etc)` read as `/@`, a
  // backslash-newline splitting a word) licenses nothing, since a license
  // relieves an ask.
  const licensed =
    bashProgram.readsVerbatim() &&
    namesNothingOnDisk(uncoveredEntries, normalizer);
  const payload = buildBashExternalDirectoryAskPayload({
    command,
    externalPaths: disclosures,
    decidingPath: { path: worstEntry.path.value(), effect: worstEntry.effect },
    cwd: tcc.cwd,
    agentName: tcc.agentName,
    toolName: tcc.toolName,
    matchedPattern: preCheck.matchedPattern,
    surface,
  });

  return {
    surface,
    input: {},
    payload,
    sessionApproval: SessionApproval.forGrants(
      uncoveredEntries.flatMap((entry) =>
        normalizer
          .approvalPatternsFor(entry.path)
          .map((pattern) => ({ surface: entry.surface, pattern })),
      ),
    ),
    promptDetails: {
      source: "tool_call",
      agentName: tcc.agentName,
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      command,
      accessIntent: {
        ...accessFactsFromPath(surface, worstEntry.path),
        ...(licensed ? { delegationLicense: "nothing-on-disk" as const } : {}),
      },
    },
    logContext: {
      source: "tool_call",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      agentName: tcc.agentName,
      command,
      externalPaths: uncoveredPaths,
    },
    decision: {
      surface,
      value: command,
    },
    preCheck,
  };
}

/**
 * Whether every uncovered path earns the nothing-on-disk delegation license
 * (ADR 0007, amendment 8): located (spelled verbatim as the absolute path it
 * names), not a proven write, and naming nothing on disk below the filesystem
 * root. One path that fails withholds it from the whole ask, since a link's
 * verdict covers the whole command.
 */
function namesNothingOnDisk(
  entries: readonly UncoveredExternalPath[],
  normalizer: PathNormalizer,
): boolean {
  return entries.every(
    ({ path, effect, unlocated }) =>
      unlocated === undefined &&
      effect.effect !== "write" &&
      normalizer.namesNothingBelowRoot(path),
  );
}
