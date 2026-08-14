import { getToolInputPath } from "#src/access-intent/tool-input-path";
import type { PathNormalizer } from "#src/path-normalizer";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import { SessionApproval } from "#src/session-approval";
import { deriveApprovalPattern } from "#src/session-rules";
import type { ToolAccessExtractorLookup } from "#src/tool-access-extractor-registry";
import type { GateDescriptor, GateResult } from "./descriptor";
import { accessFactsFromPath } from "./helpers";
import type { ToolCallContext } from "./types";

/**
 * Build a pure descriptor for the cross-cutting path permission gate (tools).
 *
 * Returns `null` when the gate does not apply (tool is not path-bearing,
 * no extractable path, the `path` surface evaluates to `allow`, or no
 * explicit `path` rule matched — i.e. only the universal default fired).
 * Returns a `GateDescriptor` when the path matches a `deny` or `ask` rule.
 */
export function describePathGate(
  tcc: ToolCallContext,
  resolver: ScopedPermissionResolver,
  normalizer: PathNormalizer,
  extractors?: ToolAccessExtractorLookup,
): GateResult {
  const filePath = getToolInputPath(tcc.toolName, tcc.input, extractors);
  if (!filePath) return null;

  // Emit an access-path intent so the resolver matches the lexical aliases
  // *and* the canonical (symlink-resolved) form, the same set
  // `external_directory` matches (#418, #486).
  const accessPath = normalizer.forPath(filePath);
  const check = resolver.resolve({
    kind: "access-path",
    surface: "path",
    path: accessPath,
    agentName: tcc.agentName ?? undefined,
  });

  if (check.state === "allow") return null;

  // No explicit path rule matched — only the universal default fired.
  // Skip the gate to preserve backward compatibility: configs without a
  // "path" key should not trigger path-level prompts (#58).
  if (check.matchedPattern === undefined) return null;

  // Derive the approval pattern from the lexical absolute form so it matches
  // the policy values a later call produces.
  const pattern = deriveApprovalPattern(accessPath.value());

  const descriptor: GateDescriptor = {
    surface: "path",
    input: { path: filePath },
    denialContext: {
      kind: "path",
      toolName: tcc.toolName,
      pathValue: filePath,
      agentName: tcc.agentName ?? undefined,
    },
    sessionApproval: SessionApproval.single("path", pattern),
    promptDetails: {
      source: "tool_call",
      agentName: tcc.agentName,
      message: formatPathAskPrompt(
        tcc.toolName,
        filePath,
        tcc.agentName ?? undefined,
      ),
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      path: filePath,
      highlightText: filePath,
      accessIntent: accessFactsFromPath("path", accessPath),
    },
    logContext: {
      source: "tool_call",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      agentName: tcc.agentName,
      path: filePath,
    },
    decision: {
      surface: "path",
      value: filePath,
    },
    preCheck: check,
  };

  return descriptor;
}

export function formatPathAskPrompt(
  toolName: string,
  pathValue: string,
  agentName?: string,
): string {
  const subject = agentName ? `Agent '${agentName}'` : "Current agent";
  return `${subject} requested tool '${toolName}' for path '${pathValue}'. Allow this path access?`;
}
