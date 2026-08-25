import type { BashProgram } from "#src/access-intent/bash/program";
import type { PathNormalizer } from "#src/path-normalizer";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import { buildBashExternalDirectoryAskPayload } from "#src/presentation/path-ask-payload";
import { SessionApproval } from "#src/session-approval";
import type { GateResult } from "./descriptor";
import { selectUncoveredExternalPaths } from "./external-directory-policy";
import { accessFactsFromPath } from "./helpers";
import type { ToolCallContext } from "./types";

/**
 * Build a pure descriptor for the bash external-directory permission gate.
 *
 * Reads the external paths from the injected `BashProgram` and checks whether
 * any reference directories outside the working directory. Returns `null` when the gate
 * does not apply (not a shell invocation, no command, or no external paths found).
 * Returns a `GateBypass` when all paths are allowed (by config or session rule).
 * Returns a `GateDescriptor` with multi-pattern sessionApproval for uncovered paths.
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

  const externalPaths = bashProgram.externalAccesses();
  if (externalPaths.length === 0) return null;

  // Resolve every external path on the external_directory surface and keep the
  // ones not already allowed (config-level allows suppress the prompt just as
  // session-level allows do); the shared helper single-sources the #418 alias
  // matching and the worst-uncovered selection.
  const { uncovered: uncoveredEntries, worstCheck } =
    selectUncoveredExternalPaths(
      externalPaths,
      resolver,
      tcc.agentName ?? undefined,
    );
  const uncoveredPaths = uncoveredEntries.map(({ path }) => path.value());

  if (uncoveredPaths.length === 0) {
    return {
      action: "allow",
      // A whole-command bypass covers every external path at once, and each
      // may have matched a different session pattern -- so the surface is one
      // value and the pattern is not. The entry's `externalPaths` lists what
      // was covered.
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
          externalPaths: externalPaths.map((p) => p.value()),
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

  const payload = buildBashExternalDirectoryAskPayload({
    command,
    externalPaths: disclosures,
    cwd: tcc.cwd,
    agentName: tcc.agentName,
    toolName: tcc.toolName,
    matchedPattern: preCheck.matchedPattern,
  });

  const patterns = uncoveredEntries.map(({ path }) =>
    normalizer.approvalPatternFor(path),
  );

  return {
    surface: "external_directory",
    input: {},
    payload,
    sessionApproval: SessionApproval.multiple("external_directory", patterns),
    promptDetails: {
      source: "tool_call",
      agentName: tcc.agentName,
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      command,
      accessIntent: accessFactsFromPath("external_directory", worstEntry.path),
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
      surface: "external_directory",
      value: command,
    },
    preCheck,
  };
}
