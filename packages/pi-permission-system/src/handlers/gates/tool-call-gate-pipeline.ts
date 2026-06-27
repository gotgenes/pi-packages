import { BashProgram } from "#src/access-intent/bash/program";
import {
  auditBashCommand,
  type BashAuditConfig,
} from "#src/bash-command-auditor";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import type { PermissionCheckResult } from "#src/types";
import type { SkillPromptEntry } from "#src/skill-prompt-sanitizer";
import type { ToolAccessExtractorLookup } from "#src/tool-access-extractor-registry";
import type { ToolInputFormatterLookup } from "#src/tool-input-formatter-registry";
import {
  ToolPreviewFormatter,
  type ToolPreviewFormatterOptions,
} from "#src/tool-preview-formatter";
import { getNonEmptyString, toRecord } from "#src/value-guards";
import { resolveBashCommandCheck } from "./bash-command";
import { describeBashExternalDirectoryGate } from "./bash-external-directory";
import { describeBashPathGate } from "./bash-path";
import type { GateDescriptor, GateResult } from "./descriptor";
import { describeExternalDirectoryGate } from "./external-directory";
import { describePathGate } from "./path";
import type { GateRunner } from "./runner";
import { describeSkillReadGate } from "./skill-read";
import { describeToolGate } from "./tool";
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
  /** Bash command audit config (allowSudo and allowShellEscape flags). */
  getBashAuditConfig(): BashAuditConfig;
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
    // Parse the bash command exactly once per evaluate; the three bash gates
    // share this single BashProgram instead of each re-parsing (#308).
    const command = getNonEmptyString(toRecord(tcc.input).command);
    const bashProgram =
      tcc.toolName === "bash" && command
        ? await BashProgram.parse(command, tcc.cwd)
        : null;

    // Audit for privilege-escalation / shell-escape vectors before any
    // pattern-matching gate runs. This catches sudo, bash -c <dynamic>, and
    // xargs-in-pipeline regardless of what the policy rules say.
    if (tcc.toolName === "bash" && command) {
      const auditConfig = this.inputs.getBashAuditConfig();
      const audit = auditBashCommand(command, auditConfig);

      if (audit.verdict === "block") {
        return { action: "block", reason: audit.reason };
      }

      if (audit.verdict === "ask") {
        // Construct a synthetic check and descriptor so the gate runner can
        // prompt the user via the normal ask flow. The check carries the
        // auditor's reason so denial messages are informative.
        const syntheticCheck: PermissionCheckResult = {
          toolName: "bash",
          state: "ask",
          source: "bash",
          origin: "builtin",
          command,
          reason: audit.reason,
        };
        const auditDescriptor: GateDescriptor = {
          surface: "bash",
          input: { command },
          denialContext: {
            kind: "tool",
            check: syntheticCheck,
            agentName: tcc.agentName ?? undefined,
            input: { command },
          },
          promptDetails: {
            source: "tool_call",
            agentName: tcc.agentName,
            message: audit.reason,
            toolCallId: tcc.toolCallId,
            toolName: "bash",
            command,
          },
          logContext: {
            source: "tool_call",
            toolCallId: tcc.toolCallId,
            toolName: "bash",
            command,
          },
          decision: {
            surface: "bash",
            value: command,
          },
          preResolved: { state: "ask" },
        };
        const auditOutcome = await runner.run(
          auditDescriptor,
          tcc.agentName,
          tcc.toolCallId,
        );
        if (auditOutcome.action === "block") {
          return auditOutcome;
        }
        // User approved — fall through to normal gate evaluation.
      }
    }

    const formatter = new ToolPreviewFormatter(
      this.inputs.getToolPreviewLimits(),
      this.customFormatters,
    );

    const infraDirs = this.inputs.getInfrastructureReadDirs();

    const gateProducers: Array<() => GateResult | Promise<GateResult>> = [
      () =>
        describeSkillReadGate(tcc, () => this.inputs.getActiveSkillEntries()),
      () => describePathGate(tcc, this.resolver, this.customExtractors),
      () =>
        describeExternalDirectoryGate(
          tcc,
          infraDirs,
          this.resolver,
          this.customExtractors,
        ),
      () => describeBashExternalDirectoryGate(tcc, bashProgram, this.resolver),
      () => describeBashPathGate(tcc, bashProgram, this.resolver),
      () => {
        // Bash commands may chain several sub-commands (`a && b`, `a | b`, …);
        // evaluate each unit from the shared parse on the bash surface and
        // select the most restrictive, rather than matching the whole program
        // string (#301). Other tools evaluate their single input directly.
        const toolCheck =
          tcc.toolName === "bash" && bashProgram
            ? resolveBashCommandCheck(
                command ?? "",
                bashProgram.commands(),
                tcc.agentName ?? undefined,
                this.resolver,
              )
            : this.resolver.resolve({
                kind: "tool",
                surface: tcc.toolName,
                input: tcc.input,
                agentName: tcc.agentName ?? undefined,
              });
        const toolDescriptor = describeToolGate(tcc, toolCheck, formatter);
        toolDescriptor.preCheck = toolCheck;
        return toolDescriptor;
      },
    ];

    for (const produce of gateProducers) {
      const outcome = await runner.run(
        await produce(),
        tcc.agentName,
        tcc.toolCallId,
      );
      if (outcome.action === "block") {
        return outcome;
      }
    }

    return { action: "allow" };
  }
}
