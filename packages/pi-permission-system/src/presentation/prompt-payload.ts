import type { BashCommandContext } from "#src/types";

/**
 * The complete, structured description of a permission ask (ADR 0011 §2).
 *
 * A gate emits one of these instead of a sentence. It is complete by contract:
 * it never truncates and never decides what a human will see. Every consumer is
 * a renderer over it, eliding under its own budget — so elision is a property
 * of a render, never of the payload.
 */
export interface PromptPayload {
  readonly kind: PromptPayloadKind;
  readonly request: PromptRequestFacts;
  /** Complete; each renderer elides to fit its own budget. */
  readonly evidence: readonly PromptEvidence[];
  /** Supplied by registered annotators; always marked as model-generated. */
  readonly annotations: readonly PromptAnnotation[];
}

/**
 * Which ask this payload describes — the renderers' dispatch discriminant.
 *
 * Present because the ask shapes are not separable by surface alone: a tool
 * external-directory ask and a bash one share the `external_directory` surface,
 * and the `path` gate and the per-tool gate differ only in wording. It gives
 * every renderer an exhaustive switch rather than a set of string comparisons a
 * new variant sails past — which is what let the parallel denial-context union
 * ADR 0011 §7 described dissolve into this one (#746).
 */
export type PromptPayloadKind =
  | "bash"
  | "mcp"
  | "tool"
  | "path"
  | "external_directory"
  | "bash_external_directory"
  | "skill"
  | "skill_read"
  | "forwarded";

/**
 * The invariant core (ADR 0011 §3): the facts visible in every render, that no
 * renderer's budget may elide.
 *
 * Named for what it holds — the permission request's own facts, matching the
 * package's `PermissionRequest` / `ForwardedPermissionRequest` vocabulary —
 * rather than for its contract, which this comment states instead.
 */
export interface PromptRequestFacts {
  /** Who is asking, and whether the ask arrived from a subagent. */
  readonly requester: PromptRequester;
  /** The gate surface the rule fired on. */
  readonly surface: string;
  /** The gated tool name; `null` when the ask is not tool-shaped. */
  readonly toolName: string | null;
  /**
   * The invoked tool name when a shell alias re-exposes bash under another
   * name (#574) — "gated as bash, invoked as exec_command" is two facts.
   * `null` when it adds nothing.
   */
  readonly invokedToolName: string | null;
  /** The decision-relevant value: the command, path, MCP target, or skill name. */
  readonly value: string;
  /** The matched rule, including a sentinel such as `<indirection-bash-wrapper>`. */
  readonly matchedPattern: string | null;
  /**
   * Where the offending bash unit runs, when it came from a substitution or a
   * subshell. A fact rather than a rendered clause: it is what makes the
   * matched rule intelligible, and how it reads is the renderer's choice.
   */
  readonly commandContext: BashCommandContext | null;
  /**
   * For bash, the unit that will actually run — including inside an unstrippable
   * wrapper (#713). `null` when it adds nothing over {@link value}.
   */
  readonly executedUnit: string | null;
}

/** Who is asking, one hop below when the ask was forwarded. */
export interface PromptRequester {
  readonly agentName: string | null;
  readonly forwarded: boolean;
  /** The requesting session, for a forwarded ask; `null` for a local one. */
  readonly sessionId: string | null;
}

/**
 * One piece of decision evidence.
 *
 * Complete on the payload; each renderer elides entries and orders them under
 * its own budget (ADR 0011 §4).
 */
export interface PromptEvidence {
  readonly label: string;
  readonly text: string;
  /**
   * A secondary fact bound to this entry that a renderer may show alongside
   * {@link text} or elide independently — a path's symlink-resolved alias, for
   * instance. Bound to the entry rather than listed as a second one so an
   * elision cannot separate the two.
   */
  readonly detail: string | null;
}

/**
 * A model-generated advisory (ADR 0011 §8).
 *
 * The slot owns the attribution and the model-generated marking, so marking is
 * a property of the payload rather than a discipline each annotator must
 * remember. Structurally separate from any verdict: an annotation cannot allow,
 * deny, defer, or suppress.
 */
export interface PromptAnnotation {
  readonly source: string;
  readonly text: string;
}

/** The `requester` facts for an ask raised by this session. */
export function localRequester(agentName: string | null): PromptRequester {
  return { agentName, forwarded: false, sessionId: null };
}

/** Every {@link PromptPayloadKind}, for tolerant reads of a serialized payload. */
const PROMPT_PAYLOAD_KINDS = [
  "bash",
  "mcp",
  "tool",
  "path",
  "external_directory",
  "bash_external_directory",
  "skill",
  "skill_read",
  "forwarded",
] as const satisfies readonly PromptPayloadKind[];

const BASH_COMMAND_CONTEXTS = [
  "command_substitution",
  "process_substitution",
  "subshell",
] as const satisfies readonly BashCommandContext[];

/**
 * Narrow an unknown value to a {@link PromptPayload}, or `undefined`.
 *
 * Lives beside its type so a new request fact updates the guard next door
 * rather than in a distant reader, following `isPermissionDecisionState`'s
 * precedent.
 *
 * All-or-nothing: any malformed field yields `undefined` rather than a
 * half-payload, so a consumer renders its own degraded view instead of
 * presenting corrupt facts (ADR 0011 §9).
 */
export function asPromptPayload(value: unknown): PromptPayload | undefined {
  const candidate = asObject(value);
  if (!candidate) return undefined;

  const kind = PROMPT_PAYLOAD_KINDS.find((entry) => entry === candidate.kind);
  const request = asPromptRequestFacts(candidate.request);
  const evidence = asArrayOf(candidate.evidence, asPromptEvidence);
  const annotations = asArrayOf(candidate.annotations, asPromptAnnotation);
  if (!kind || !request || !evidence || !annotations) return undefined;

  return { kind, request, evidence, annotations };
}

function asPromptRequestFacts(value: unknown): PromptRequestFacts | undefined {
  const candidate = asObject(value);
  if (!candidate) return undefined;

  const requester = asPromptRequester(candidate.requester);
  const commandContext = asNullableMember(
    candidate.commandContext,
    BASH_COMMAND_CONTEXTS,
  );
  if (
    !requester ||
    commandContext === undefined ||
    typeof candidate.surface !== "string" ||
    typeof candidate.value !== "string" ||
    !isNullableString(candidate.toolName) ||
    !isNullableString(candidate.invokedToolName) ||
    !isNullableString(candidate.matchedPattern) ||
    !isNullableString(candidate.executedUnit)
  ) {
    return undefined;
  }

  return {
    requester,
    surface: candidate.surface,
    toolName: candidate.toolName,
    invokedToolName: candidate.invokedToolName,
    value: candidate.value,
    matchedPattern: candidate.matchedPattern,
    commandContext: commandContext.value,
    executedUnit: candidate.executedUnit,
  };
}

function asPromptRequester(value: unknown): PromptRequester | undefined {
  const candidate = asObject(value);
  if (
    !candidate ||
    typeof candidate.forwarded !== "boolean" ||
    !isNullableString(candidate.agentName) ||
    !isNullableString(candidate.sessionId)
  ) {
    return undefined;
  }
  return {
    agentName: candidate.agentName,
    forwarded: candidate.forwarded,
    sessionId: candidate.sessionId,
  };
}

function asPromptEvidence(value: unknown): PromptEvidence | undefined {
  const candidate = asObject(value);
  if (
    !candidate ||
    typeof candidate.label !== "string" ||
    typeof candidate.text !== "string" ||
    !isNullableString(candidate.detail)
  ) {
    return undefined;
  }
  return {
    label: candidate.label,
    text: candidate.text,
    detail: candidate.detail,
  };
}

function asPromptAnnotation(value: unknown): PromptAnnotation | undefined {
  const candidate = asObject(value);
  if (
    !candidate ||
    typeof candidate.source !== "string" ||
    typeof candidate.text !== "string"
  ) {
    return undefined;
  }
  return { source: candidate.source, text: candidate.text };
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Narrow every entry, or `undefined` when the array or any entry is malformed. */
function asArrayOf<T>(
  value: unknown,
  narrow: (entry: unknown) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const narrowed: T[] = [];
  for (const entry of value) {
    const result = narrow(entry);
    if (!result) return undefined;
    narrowed.push(result);
  }
  return narrowed;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * Narrow to `null` or a member of `members`, boxed so a valid `null` is
 * distinguishable from the malformed `undefined`.
 */
function asNullableMember<T extends string>(
  value: unknown,
  members: readonly T[],
): { value: T | null } | undefined {
  if (value === null) return { value: null };
  const member = members.find((entry) => entry === value);
  return member ? { value: member } : undefined;
}

/** Find the evidence entry a renderer knows by label. */
export function findEvidence(
  payload: PromptPayload,
  label: string,
): PromptEvidence | undefined {
  return payload.evidence.find((entry) => entry.label === label);
}

/** Every evidence entry carrying the given label, in payload order. */
export function allEvidence(
  payload: PromptPayload,
  label: string,
): readonly PromptEvidence[] {
  return payload.evidence.filter((entry) => entry.label === label);
}
