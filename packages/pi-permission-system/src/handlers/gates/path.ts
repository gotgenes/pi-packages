import { resolveSymlinkAsync } from "#src/canonicalize-path";
import { getToolInputPath, normalizePathForComparison } from "#src/path-utils";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import { SessionApproval } from "#src/session-approval";
import { deriveApprovalPattern } from "#src/session-rules";
import type { ToolAccessExtractorLookup } from "#src/tool-access-extractor-registry";
import type { GateDescriptor, GateResult } from "./descriptor";
import type { ToolCallContext } from "./types";

/**
 * Build a pure descriptor for the cross-cutting path permission gate (tools).
 *
 * Before evaluating configured path rules the gate resolves symlinks via
 * `fs.realpath()` so a symlink pointing at a protected path cannot bypass a
 * `path: deny` rule (issue #493).
 *
 * Symlink resolution is skipped when no explicit `path`-surface rules are
 * configured (`resolver.hasPathRules()` returns false) to avoid a needless
 * `realpath` syscall on every tool invocation.
 *
 * Returns `null` when the gate does not apply (tool is not path-bearing,
 * no extractable path, the `path` surface evaluates to `allow`, or no
 * explicit `path` rule matched — i.e. only the universal default fired).
 * Returns a deny {@link GateDescriptor} when `realpath` fails (dangling
 * symlink, EPERM, ELOOP, …). Returns a `GateDescriptor` when the path
 * matches a `deny` or `ask` rule.
 */
export async function describePathGate(
  tcc: ToolCallContext,
  resolver: ScopedPermissionResolver,
  extractors?: ToolAccessExtractorLookup,
): Promise<GateResult> {
  const filePath = getToolInputPath(tcc.toolName, tcc.input, extractors);
  if (!filePath) return null;

  // Resolve symlinks before evaluating path rules to prevent traversal attacks.
  // Only incur the realpath syscall when explicit path rules are configured.
  let pathToCheck = filePath;
  if (resolver.hasPathRules?.(tcc.agentName ?? undefined)) {
    const absolutePath = normalizePathForComparison(filePath, tcc.cwd);
    if (absolutePath) {
      const resolved = await resolveSymlinkAsync(absolutePath);
      if (resolved === null) {
        // Dangling symlink, ELOOP, EPERM, or ENOENT — deny unconditionally.
        return buildSymlinkErrorDescriptor(tcc, filePath);
      }
      if (resolved !== absolutePath) {
        // Symlink points elsewhere: evaluate rules against the real target.
        pathToCheck = resolved;
      }
    }
  }

  const check = resolver.resolve({
    kind: "tool",
    surface: "path",
    input: { path: pathToCheck },
    agentName: tcc.agentName ?? undefined,
  });

  if (check.state === "allow") return null;

  // No explicit path rule matched — only the universal default fired.
  // Skip the gate to preserve backward compatibility: configs without a
  // "path" key should not trigger path-level prompts (#58).
  if (check.matchedPattern === undefined) return null;

  // Approval pattern uses the original filePath so users approve the path
  // they specified, not the internal symlink target.
  const approvalPath = normalizePathForComparison(filePath, tcc.cwd);
  const pattern = deriveApprovalPattern(approvalPath);

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

/**
 * Deny descriptor emitted when `fs.realpath()` fails for the tool's path.
 *
 * A `preResolved` deny bypasses the interactive-prompt branch so unresolvable
 * symlinks are always blocked, regardless of `canConfirm`.
 */
function buildSymlinkErrorDescriptor(
  tcc: ToolCallContext,
  filePath: string,
): GateDescriptor {
  return {
    surface: "path",
    input: { path: filePath },
    denialContext: {
      kind: "path",
      toolName: tcc.toolName,
      pathValue: filePath,
      agentName: tcc.agentName ?? undefined,
    },
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
    },
    logContext: {
      source: "tool_call",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      agentName: tcc.agentName,
      path: filePath,
      symlinkResolutionFailed: true,
    },
    decision: {
      surface: "path",
      value: filePath,
    },
    preResolved: { state: "deny" },
  };
}

export function formatPathAskPrompt(
  toolName: string,
  pathValue: string,
  agentName?: string,
): string {
  const subject = agentName ? `Agent '${agentName}'` : "Current agent";
  return `${subject} requested tool '${toolName}' for path '${pathValue}'. Allow this path access?`;
}
