import {
  describeBashCommandContext,
  flaggedElements,
  valueLabel,
} from "#src/presentation/fact-vocabulary";
import { fitLinesToWidth } from "#src/presentation/line-fitting";
import type { PromptPayload } from "#src/presentation/prompt-payload";

/**
 * Render a {@link PromptPayload} for a human deciding an ask (ADR 0011 §5).
 *
 * The payload is complete by contract, so this is where elision happens: the
 * dialog and the `select`/`input` fallback both render through here under
 * their own budget, which is what makes a bounded prompt a property of the
 * render rather than of what the gate assembled.
 *
 * The layout is one fact per line, `label : value`, labels aligned. A fact
 * whose text an earlier line already carries is not repeated — a bash ask's
 * gate surface is its tool name, and a generic tool ask's value is the tool —
 * so every line the render spends states something new.
 */
export function renderPromptDialog(
  payload: PromptPayload,
  budget: DialogBudget,
  paint: HighlightPaint = plainText,
): DialogView {
  const core = coreFacts(payload).map((fact) =>
    capField(fact, budget.fieldMaxWidth),
  );
  const evidence = evidenceFacts(payload).map((fact) =>
    capField(fact, budget.fieldMaxWidth),
  );
  const blocks = layout(
    [...core, ...evidence],
    flaggedElements(payload),
    paint,
  ).map((block) => fitLinesToWidth(block, budget.width));
  const fitted = fitToRows(
    blocks.slice(0, core.length).flat(),
    blocks.slice(core.length),
    budget.maxRows,
  );
  return {
    lines: fitted.lines,
    elided:
      fitted.dropped || [...core, ...evidence].some((fact) => fact.clipped),
  };
}

/**
 * How much room a render has, as the operator configured it.
 *
 * Separate from the terminal width, which only the component rendering a frame
 * knows — the configured half is read once per ask, the width once per frame.
 */
export interface RenderBudget {
  /** Maximum rendered rows. */
  readonly maxRows: number;
  /** Maximum characters of any one field's text. */
  readonly fieldMaxWidth: number;
}

/** A {@link RenderBudget} against the width its rows are counted at. */
export interface DialogBudget extends RenderBudget {
  /** Terminal width the lines are wrapped to, so a row count is meaningful. */
  readonly width: number;
}

/**
 * The budget when the operator configures neither field.
 *
 * Twenty-four rows plus the decision options and the hint fit a thirty-row
 * terminal; four hundred characters is roughly four wrapped rows, which is what
 * actually bounds a here-string command.
 */
export const DEFAULT_RENDER_BUDGET: RenderBudget = {
  maxRows: 24,
  fieldMaxWidth: 400,
};

/** The two prompt-budget knobs, as the extension config carries them. */
export interface PromptBudgetConfig {
  readonly promptMaxRows?: number;
  readonly promptFieldMaxWidth?: number;
}

/** The configured budget, falling back per field to {@link DEFAULT_RENDER_BUDGET}. */
export function resolveRenderBudget(config: PromptBudgetConfig): RenderBudget {
  return {
    maxRows: config.promptMaxRows ?? DEFAULT_RENDER_BUDGET.maxRows,
    fieldMaxWidth:
      config.promptFieldMaxWidth ?? DEFAULT_RENDER_BUDGET.fieldMaxWidth,
  };
}

/**
 * Paints the flagged element — the command, path, or target the rule fired on.
 *
 * A render concern, so the fallback and the review log pass nothing: only the
 * TUI has a theme to paint with.
 */
export type HighlightPaint = (text: string) => string;

/** What a renderer produced, and whether it had to leave anything out. */
export interface DialogView {
  /** Wrapped to the budget's width: each entry is one visual row. */
  readonly lines: readonly string[];
  /** True when any field was shortened or any entry dropped. */
  readonly elided: boolean;
}

/**
 * The budget that elides nothing — the complete view an operator must be able
 * to reach while the decision is pending (ADR 0011 §4).
 */
export function completeViewBudget(width: number): DialogBudget {
  return {
    maxRows: Number.POSITIVE_INFINITY,
    fieldMaxWidth: Number.POSITIVE_INFINITY,
    width,
  };
}

const plainText: HighlightPaint = (text) => text;

/** One rendered fact. */
interface Fact {
  readonly label: string;
  readonly text: string;
}

/** A fact narrowed to the budget, and whether that cost it anything. */
interface CappedFact extends Fact {
  readonly clipped: boolean;
}

/**
 * Narrow one field's text to the budget.
 *
 * A quantity bound applied uniformly, never a content filter: it does not read
 * the value to decide what to hide, which is what keeps it a cap rather than
 * redaction (ADR 0010). The marker is a bare ellipsis — a character or line
 * count is a number the operator cannot act on, and ADR 0011 §4 rejects it in
 * favour of reaching the complete view.
 */
function capField(fact: Fact, fieldMaxWidth: number): CappedFact {
  if (fact.text.length <= fieldMaxWidth) {
    return { ...fact, clipped: false };
  }
  return {
    ...fact,
    text: `${fact.text.slice(0, fieldMaxWidth)}\u2026`,
    clipped: true,
  };
}

/**
 * Fit the rendered blocks into the row budget.
 *
 * The core is exempt and the evidence is what gives way: §3 outranks §5, so a
 * core that alone overruns the budget still renders whole — the field cap is
 * what bounds it, and the row budget is what bounds the evidence. A drop costs
 * one row for its marker, taken only when there is something to mark.
 */
function fitToRows(
  core: readonly string[],
  evidence: readonly (readonly string[])[],
  maxRows: number,
): { lines: string[]; dropped: boolean } {
  const total = evidence.reduce((rows, block) => rows + block.length, 0);
  if (core.length + total <= maxRows) {
    return { lines: [...core, ...evidence.flat()], dropped: false };
  }
  const limit = maxRows - ELISION_MARKER_ROWS;
  const lines = [...core];
  for (const block of evidence) {
    // An entry is shown whole or not at all: half a path is worse evidence
    // than none, and the reader cannot tell the halves apart.
    if (lines.length + block.length > limit) {
      break;
    }
    lines.push(...block);
  }
  if (lines.length < maxRows) {
    lines.push(ELISION_MARKER);
  }
  return { lines, dropped: true };
}

/**
 * What an elision states: that there is more, and nothing else.
 *
 * Character and line counts were considered and rejected (ADR 0011 §4) — they
 * are a number the operator cannot act on, and they spend budget the evidence
 * itself should hold.
 */
const ELISION_MARKER = "\u2026";
const ELISION_MARKER_ROWS = 1;

/**
 * The invariant core (ADR 0011 §3), in reading order: who is asking, what they
 * called, what gated it, the decision-relevant value, and what will actually
 * run.
 */
function coreFacts(payload: PromptPayload): Fact[] {
  const { request } = payload;
  const facts: Fact[] = [];
  const requester = requesterFact(payload);
  if (requester) {
    facts.push(requester);
  }
  if (request.toolName !== null) {
    facts.push({ label: "tool", text: toolText(payload) });
  }
  // The surface is stated already when it *is* the tool name (a bash ask) or
  // when it is the word the value line is labelled with (a path ask reads
  // `path : /tmp/x`), so a line for it would repeat rather than add.
  const label = valueLabel(payload);
  if (request.surface !== request.toolName && request.surface !== label) {
    facts.push({ label: "surface", text: request.surface });
  }
  if (request.matchedPattern !== null) {
    facts.push({ label: "rule", text: request.matchedPattern });
  }
  if (request.value !== "" && request.value !== request.toolName) {
    facts.push({ label, text: request.value });
  }
  if (request.executedUnit !== null) {
    facts.push({ label: "runs", text: request.executedUnit });
  }
  const context = describeBashCommandContext(request.commandContext);
  if (context !== undefined) {
    facts.push({ label: "context", text: context });
  }
  return facts;
}

/**
 * The decision evidence, in payload order.
 *
 * An entry's `detail` rides its own line rather than becoming a second entry,
 * so an elision can never show a path while dropping what it resolves to.
 */
function evidenceFacts(payload: PromptPayload): Fact[] {
  return payload.evidence.map((entry) => ({
    label: entry.label,
    text:
      entry.detail === null ? entry.text : `${entry.text} → ${entry.detail}`,
  }));
}

/**
 * Who is asking.
 *
 * A forwarded ask always names its requester — that the ask came from a
 * subagent is itself a core fact — while an unnamed local requester states
 * nothing, and a line asserting the default would spend a row saying so.
 */
function requesterFact(payload: PromptPayload): Fact | undefined {
  const { agentName, forwarded, sessionId } = payload.request.requester;
  if (!forwarded) {
    return agentName ? { label: "agent", text: agentName } : undefined;
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- || intentional: a version-skewed request carries "" rather than null
  const name = agentName || "unknown";
  return {
    label: "subagent",
    text: sessionId ? `${name} · session ${sessionId}` : name,
  };
}

/** The gated tool, and the name the agent actually called when they differ. */
function toolText(payload: PromptPayload): string {
  const { toolName, invokedToolName } = payload.request;
  return invokedToolName === null
    ? String(toolName)
    : `${String(toolName)} (invoked as ${invokedToolName})`;
}

/**
 * Align the labels into a `label : value` column.
 *
 * A field carrying its own newlines (a here-string, a multi-line preview)
 * continues under the column rather than back at the margin, so the eye can
 * still tell a continuation from the next fact.
 */
function layout(
  facts: readonly Fact[],
  flagged: readonly string[],
  paint: HighlightPaint,
): string[][] {
  const width = Math.max(0, ...facts.map((fact) => fact.label.length));
  const indent = " ".repeat(width + 3);
  return facts.map((fact) => {
    // A fact that *is* the flagged element paints whole; any other line paints
    // the whole-token occurrences of it, so `ls` stays plain inside `lsof`.
    const highlight = flagged.includes(fact.text)
      ? paint
      : (line: string) => paintTokens(line, flagged, paint);
    return fact.text
      .split("\n")
      .map((line, index) =>
        index === 0
          ? `${fact.label.padEnd(width)} : ${highlight(line)}`
          : indent + highlight(line),
      );
  });
}

/** Characters a path, command, or target may contain, so a match is a whole token. */
const TOKEN_CHARACTER = /[\w/.-]/;

/** Paint every whole-token occurrence of each flagged text within one line. */
function paintTokens(
  line: string,
  flagged: readonly string[],
  paint: HighlightPaint,
): string {
  return flagged.reduce(
    (painted, needle) => paintOccurrences(painted, needle, paint),
    line,
  );
}

function paintOccurrences(
  line: string,
  needle: string,
  paint: HighlightPaint,
): string {
  if (needle === "" || needle.includes("\n")) {
    return line;
  }
  let result = "";
  let cursor = 0;
  for (
    let at = line.indexOf(needle, cursor);
    at !== -1;
    at = line.indexOf(needle, cursor)
  ) {
    const end = at + needle.length;
    const whole =
      !TOKEN_CHARACTER.test(line[at - 1] ?? " ") &&
      !TOKEN_CHARACTER.test(line[end] ?? " ");
    result += line.slice(cursor, at) + (whole ? paint(needle) : needle);
    cursor = end;
  }
  return result + line.slice(cursor);
}
