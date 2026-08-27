import { capabilitySurfaceForTool } from "#src/access-intent/path-surfaces";
import { getToolInputPath } from "#src/access-intent/tool-input-path";
import type { PathNormalizer } from "#src/path-normalizer";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import { buildExternalDirectoryAskPayload } from "#src/presentation/path-ask-payload";
import { SessionApproval } from "#src/session-approval";
import type { ToolAccessExtractorLookup } from "#src/tool-access-extractor-registry";
import type { GateResult } from "./descriptor";
import { resolveExternalDirectoryPolicy } from "./external-directory-policy";
import { accessFactsFromPath } from "./helpers";
import type { ToolCallContext } from "./types";

/**
 * Build a pure descriptor for the external-directory permission gate.
 *
 * Returns `null` when the gate does not apply (no CWD, tool is not
 * path-bearing, or path is inside the working directory).
 * Returns a `GateBypass` for Pi infrastructure reads.
 * Returns a `GateDescriptor` for external paths needing a permission check.
 */
export function describeExternalDirectoryGate(
  tcc: ToolCallContext,
  infraDirs: string[],
  resolver: ScopedPermissionResolver,
  normalizer: PathNormalizer,
  extractors?: ToolAccessExtractorLookup,
): GateResult {
  const externalDirectoryPath = getToolInputPath(
    tcc.toolName,
    tcc.input,
    extractors,
  );
  if (!externalDirectoryPath) return null;

  if (!normalizer.isOutsideWorkingDirectory(externalDirectoryPath)) {
    return null;
  }

  // The boundary decision (above) and the infrastructure-read containment
  // check (below) use the canonical, symlink-resolved path; pattern matching
  // uses the typed and resolved aliases (#418).
  const accessPath = normalizer.forPath(externalDirectoryPath);

  // ── Pi infrastructure read bypass ──────────────────────────────────────
  if (normalizer.isInfrastructureRead(tcc.toolName, accessPath, infraDirs)) {
    return {
      action: "allow",
      // Containment allowed this, not a rule the operator wrote.
      decidedBy: { kind: "infrastructure_read" },
      log: {
        event: "permission_request.infrastructure_auto_allowed",
        details: {
          source: "tool_call",
          toolCallId: tcc.toolCallId,
          toolName: tcc.toolName,
          agentName: tcc.agentName,
          path: externalDirectoryPath,
        },
      },
      decision: {
        surface: tcc.toolName,
        value: externalDirectoryPath,
        result: "allow",
        resolution: "infrastructure_auto_allowed",
        origin: null,
        agentName: tcc.agentName ?? null,
        matchedPattern: null,
      },
    };
  }

  // ── Build descriptor for permission check ───────────────────────────────
  const resolvedAlias = accessPath.resolvedAlias();

  // The narrowest `external_directory`-family surface this tool's identity
  // proves; the bare family name folds both directions (ADR 0013 §10).
  const surface = capabilitySurfaceForTool("external_directory", tcc.toolName);

  // The runner consumes this preCheck and skips its own resolve.
  const preCheck = resolveExternalDirectoryPolicy(
    accessPath,
    resolver,
    surface,
    tcc.agentName ?? undefined,
  );
  const pattern = normalizer.approvalPatternFor(accessPath);

  const payload = buildExternalDirectoryAskPayload({
    toolName: tcc.toolName,
    pathValue: externalDirectoryPath,
    resolvedPath: resolvedAlias,
    cwd: tcc.cwd,
    agentName: tcc.agentName,
    matchedPattern: preCheck.matchedPattern,
    surface,
  });

  return {
    surface,
    input: {},
    preCheck,
    payload,
    sessionApproval: SessionApproval.single(surface, pattern),
    promptDetails: {
      source: "tool_call",
      agentName: tcc.agentName,
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      path: externalDirectoryPath,
      accessIntent: accessFactsFromPath(surface, accessPath),
    },
    logContext: {
      source: "tool_call",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      agentName: tcc.agentName,
      path: externalDirectoryPath,
    },
    decision: {
      surface,
      value: externalDirectoryPath,
    },
  };
}
