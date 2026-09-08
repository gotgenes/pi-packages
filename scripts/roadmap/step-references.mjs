/**
 * Reading step references out of improvement-roadmap prose.
 *
 * A roadmap's dependency bullets, parallel tracks, and release batches all name
 * their steps inside sentences, so the reference list has to end where the prose
 * resumes. Two readings are needed, and they differ in strictness on purpose:
 * `parseStepReferenceRun` is a claim the validator holds a step to, so it reads
 * only the leading run; `collectStepMentions` answers "is this step named here
 * at all", so it scans the whole text.
 */

/**
 * A reference to a step, by whichever identity the document uses.
 *
 * A bracketed `[#N]` is a GitHub issue number; a bare integer following
 * `Step`/`Steps` is an ordinal, which the caller resolves against the phase's
 * step headings.
 *
 * @typedef {{ kind: "issue" | "ordinal", n: number }} StepReference
 */

const RUN_TOKEN = /^(?:after|steps?|and|,|\[#\d+\]|\d+)$/i;
const BRACKETED = /^\[#(\d+)\]$/;
const MENTION_RUN = /\bSteps?\b((?:\s*(?:\d+|,|and|→)\s*)+)/g;
const BRACKETED_MENTION = /\[#(\d+)\]/g;

/**
 * Read the leading run of step references from a dependency bullet's value.
 *
 * Consumes only list tokens from the start of the text and stops at the first
 * token that is not one, so a reference carrying different force later in the
 * sentence ("and informed by Step 10") is excluded.
 *
 * This is also what disarms a value opening with `none`: `none` is not a list
 * token, so the run ends before it and a step's own issue number, cited in the
 * prose that follows, cannot read as a self-dependency.
 *
 * @param {string} value
 * @returns {StepReference[]}
 */
export function parseStepReferenceRun(value) {
  const references = [];
  for (const rawToken of value.replace(/,/g, " , ").split(/\s+/)) {
    const token = rawToken.replace(/[.;]$/, "");
    if (token === "") continue;
    if (!RUN_TOKEN.test(token)) break;
    const bracketed = BRACKETED.exec(token);
    if (bracketed) references.push({ kind: "issue", n: Number(bracketed[1]) });
    else if (/^\d+$/.test(token))
      references.push({ kind: "ordinal", n: Number(token) });
  }
  return references;
}

/**
 * Collect every step number mentioned anywhere in a section of prose.
 *
 * Deliberately lenient and unordered: it answers whether a step is named, never
 * who a track's or batch's members are. A plural run lists all but its first
 * member as bare integers (`Steps 1 → 2, 3, 4`), so a literal `Step <n>` search
 * would miss three of those four.
 *
 * @param {string} text
 * @returns {Set<number>}
 */
export function collectStepMentions(text) {
  const mentioned = new Set();
  for (const match of text.matchAll(BRACKETED_MENTION))
    mentioned.add(Number(match[1]));
  for (const run of text.matchAll(MENTION_RUN)) {
    for (const number of run[1].matchAll(/\d+/g))
      mentioned.add(Number(number[0]));
  }
  return mentioned;
}
