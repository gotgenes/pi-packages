import { BashProgram } from "#src/access-intent/bash/program";
import { getPathBearingToolPath } from "#src/access-intent/tool-input-path";
import {
  resolveShellInvocation,
  type ShellInvocation,
} from "#src/access-intent/tool-kind";
import type { ShellToolsConfig } from "#src/config-schema";
import type { PathNormalizer } from "#src/path-normalizer";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import type { SkillPromptEntry } from "#src/skill-prompt-sanitizer";
import type { ToolAccessExtractorLookup } from "#src/tool-access-extractor-registry";
import type { ToolInputFormatterLookup } from "#src/tool-input-formatter-registry";
import {
  ToolPreviewFormatter,
  type ToolPreviewFormatterOptions,
} from "#src/tool-preview-formatter";
import type { PermissionCheckResult } from "#src/types";
import { resolveBashCommandCheck } from "./bash-command";
import { describeBashExternalDirectoryGate } from "./bash-external-directory";
import { describeBashPathGate } from "./bash-path";
import type { GateResult } from "./descriptor";
import { describeExternalDirectoryGate } from "./external-directory";
import { describePathGate } from "./path";
import type { GateRunner } from "./runner";
import { describeSkillReadGate } from "./skill-read";
import { describeToolGate, type ToolPathAccess } from "./tool";
import type { GateOutcome, ToolCallContext } from "./types";

/**
 * Narrow interface the pipeline needs from its session-side dependency.
 *
 * The three query methods needed to assemble gate inputs.
 * The resolver is injected separately as a constructor parameter.
 *
 * `PermissionSession` satisfies this structurally at the construction call
 * site; no `implements` clause is needed and would create a layer-inversion
 * import from the domain module into the handler layer.
 */
export interface ToolCallGateInputs {
  /** Active skill prompt entries for the skill-read gate. */
  getActiveSkillEntries(): SkillPromptEntry[];
  /** Combined infrastructure read directories (static + config-derived). */
  getInfrastructureReadDirs(): string[];
  /** Resolved tool-preview formatter options from the current config. */
  getToolPreviewLimits(): ToolPreviewFormatterOptions;
  /** The session's path normalizer (platform + cwd baked in). */
  getPathNormalizer(): PathNormalizer;
  /**
   * The configured shell-tool aliases (`shellTools`), or `undefined` when none
   * are set. Consulted by {@link resolveShellInvocation} so an aliased shell
   * tool is gated through the bash stack at parity with native `bash` (#574).
   */
  getShellToolAliases(): ShellToolsConfig | undefined;
}

/**
 * Owns the ordered tool-call gate-producer assembly and the run loop.
 *
 * Constructed once in the composition root and injected into
 * `PermissionGateHandler`. `evaluate(tcc, runner)` encapsulates:
 * - bash-command extraction and single `BashProgram.parse` (#308)
 * - `ToolPreviewFormatter` construction from `getToolPreviewLimits()`
 * - infrastructure-dir list from `getInfrastructureReadDirs()`
 * - all six gate producers in their prescribed order
 * - the run loop that returns the first block outcome, or allow
 */
export class ToolCallGatePipeline {
  constructor(
    private readonly resolver: ScopedPermissionResolver,
    private readonly inputs: ToolCallGateInputs,
    private readonly customFormatters?: ToolInputFormatterLookup,
    private readonly customExtractors?: ToolAccessExtractorLookup,
  ) {}

  async evaluate(
    tcc: ToolCallContext,
    runner: GateRunner,
  ): Promise<GateOutcome> {
    // Resolve the shell invocation once: native `bash` and any tool recorded in
    // `shellTools` both yield a command (+ optional workdir); every other tool
    // yields null (#574). The three bash gates then share the single BashProgram
    // parsed from that command instead of each re-parsing (#308).
    const shell = resolveShellInvocation(
      tcc.toolName,
      tcc.input,
      this.inputs.getShellToolAliases(),
    );
    const normalizer = this.inputs.getPathNormalizer();
    const bashProgram = shell?.command
      ? await BashProgram.parse(shell.command, normalizer, {
          workdir: shell.workdir,
        })
      : null;

    const formatter = new ToolPreviewFormatter(
      this.inputs.getToolPreviewLimits(),
      this.customFormatters,
    );

    const infraDirs = this.inputs.getInfrastructureReadDirs();

    const gateProducers: Array<() => GateResult | Promise<GateResult>> = [
      () =>
        describeSkillReadGate(tcc, normalizer, () =>
          this.inputs.getActiveSkillEntries(),
        ),
      () =>
        describePathGate(tcc, this.resolver, normalizer, this.customExtractors),
      () =>
        describeExternalDirectoryGate(
          tcc,
          infraDirs,
          this.resolver,
          normalizer,
          this.customExtractors,
        ),
      () =>
        describeBashExternalDirectoryGate(
          tcc,
          bashProgram,
          this.resolver,
          normalizer,
        ),
      () => describeBashPathGate(tcc, bashProgram, this.resolver, normalizer),
      () => {
        const { toolCheck, pathAccess } = this.resolvePerToolCheck(
          tcc,
          shell,
          bashProgram,
          normalizer,
        );
        const toolDescriptor = describeToolGate(
          tcc,
          toolCheck,
          formatter,
          pathAccess,
          shell,
        );
        toolDescriptor.preCheck = toolCheck;
        return toolDescriptor;
      },
    ];

    for (const produce of gateProducers) {
      const outcome = await runner.run(await produce(), tcc.agentName);
      if (outcome.action === "block") {
        return outcome;
      }
    }

    return { action: "allow" };
  }

  /**
   * Resolve the per-tool gate's check, choosing the intent by tool shape:
   * bash chains its sub-commands; a path-bearing tool with a path emits an
   * `access-path` intent (so the per-tool surface matches lexical ∪ canonical,
   * #502); every other tool (and a path-bearing tool with no path) keeps the
   * raw `tool` intent the manager normalizes.
   *
   * Returns the resolved path alongside the check, already paired with the
   * session scope approving it grants — derived here, where the normalizer
   * lives, rather than inside the gate (#655).
   */
  private resolvePerToolCheck(
    tcc: ToolCallContext,
    shell: ShellInvocation | null,
    bashProgram: BashProgram | null,
    normalizer: PathNormalizer,
  ): { toolCheck: PermissionCheckResult; pathAccess?: ToolPathAccess } {
    if (shell) {
      if (bashProgram) {
        return {
          toolCheck: resolveBashCommandCheck(
            bashProgram.commandText(),
            bashProgram.commands(),
            tcc.agentName ?? undefined,
            this.resolver,
          ),
        };
      }
      // A shell invocation whose command did not parse (e.g. empty) still
      // resolves on the `bash` surface, so an aliased tool never falls through
      // to its own extension-tool surface.
      return {
        toolCheck: this.resolver.resolve({
          kind: "tool",
          surface: "bash",
          input: { command: shell.command },
          agentName: tcc.agentName ?? undefined,
        }),
      };
    }

    const filePath = getPathBearingToolPath(tcc.toolName, tcc.input);
    if (filePath !== null) {
      const accessPath = normalizer.forPath(filePath);
      return {
        pathAccess: {
          path: accessPath,
          approvalPattern: normalizer.approvalPatternFor(accessPath),
        },
        toolCheck: this.resolver.resolve({
          kind: "access-path",
          surface: tcc.toolName,
          path: accessPath,
          agentName: tcc.agentName ?? undefined,
        }),
      };
    }

    return {
      toolCheck: this.resolver.resolve({
        kind: "tool",
        surface: tcc.toolName,
        input: tcc.input,
        agentName: tcc.agentName ?? undefined,
      }),
    };
  }
}
