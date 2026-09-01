import { capabilitySurfaceForTool } from "#src/access-intent/path-surfaces";
import { getToolInputPath } from "#src/access-intent/tool-input-path";
import type { PathNormalizer } from "#src/path-normalizer";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import { buildPathAskPayload } from "#src/presentation/path-ask-payload";
import { SessionApproval } from "#src/session-approval";
import type { ToolAccessExtractorLookup } from "#src/tool-access-extractor-registry";
import type { GateDescriptor, GateResult } from "./descriptor";
import {
  accessFactsFromPath,
  buildPathGateLogContext,
  buildPathGatePromptDetails,
} from "./helpers";
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
  const { path: filePath, source: pathSource } = getToolInputPath(
    tcc.toolName,
    tcc.input,
    extractors,
  );
  if (!filePath) return null;

  // The narrowest `path`-family surface this tool's identity proves. A tool
  // that proves nothing narrower emits the bare family name, which the
  // resolver folds over both directional members (ADR 0013 §10).
  const surface = capabilitySurfaceForTool("path", tcc.toolName);

  // Emit an access-path intent so the resolver matches the lexical aliases
  // *and* the canonical (symlink-resolved) form, the same set
  // `external_directory` matches (#418, #486).
  const accessPath = normalizer.forPath(filePath);
  const check = resolver.resolve({
    kind: "access-path",
    surface,
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
  const pattern = normalizer.approvalPatternFor(accessPath);

  const payload = buildPathAskPayload({
    toolName: tcc.toolName,
    pathValue: filePath,
    agentName: tcc.agentName,
    matchedPattern: check.matchedPattern,
    surface,
  });

  const descriptor: GateDescriptor = {
    surface,
    input: { path: filePath },
    payload,
    sessionApproval: SessionApproval.single(surface, pattern),
    promptDetails: buildPathGatePromptDetails(
      tcc,
      filePath,
      accessFactsFromPath(surface, accessPath),
    ),
    logContext: buildPathGateLogContext(tcc, filePath, pathSource),
    decision: {
      surface,
      value: filePath,
    },
    preCheck: check,
  };

  return descriptor;
}
