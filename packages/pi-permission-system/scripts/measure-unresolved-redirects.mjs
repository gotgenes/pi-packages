#!/usr/bin/env node
/**
 * Measure what [#814] changes about redirect effect attribution.
 *
 * ADR 0013's rule is that a durable number ships with the instrument that
 * produced it, so a later reader can re-run it and falsify the claim rather
 * than argue with it. The figures in Phase 14 Step 12's `Landed:` note and in
 * `docs/plans/0814-unresolvable-redirect-proves-nothing.md` come from this
 * script.
 *
 * Metric: for each intact bash command in the review log, find every
 * `file_redirect` / `herestring_redirect` node and compute the effect its
 * destination is attributed both before and after [#814] — before, from the
 * operator that survived tree-sitter's error recovery; after, demoted to
 * `unproven` when `parseUnresolvedAt` says the parse did not resolve there.
 * Report how many commands change.
 *
 * `tree-sitter-bash` 0.25.1 has no node for the read-write open `<>`, and its
 * recovery discards the half it cannot attach either *inside* the redirect
 * (`cat <> rw.txt`) or as the *preceding sibling* of one (`cat <> ~/rw.txt`).
 * Reading a proof off the surviving half made one command's answer a function
 * of its filename, and the `read` half was a fail-open. The population measured
 * here is the delta's upper bound: a changed attribution reaches a gate only if
 * the token is also path-shaped, which the last section reports separately.
 *
 * Measured 2026-09-03 against the local review log:
 *
 * | Quantity | Value |
 * | --- | --- |
 * | intact (untruncated) distinct bash commands | 5352 |
 * | commands whose redirect names a file | 2619 (48.9%) |
 * | commands carrying an unresolvable redirect | 1 (0.019%) |
 * | commands whose redirect attribution changes | 1 (0.019%) |
 * | changed attributions | 1 (`"tail"`: write → unproven) |
 * | changed attributions on a path-shaped token | 0 |
 *
 * The one command that changes carries no `<>` at all — it is
 * `git commit -F - <<'MSG' 2>&1 | tail -4`, the valid bash that ADR 0013's
 * 2026-08-29 amendment records `tree-sitter-bash` 0.25.1 cannot parse (each
 * pairing parses alone; the three together do not). Its `tail` token is not
 * path-shaped, so it reaches no path surface and no prompt changes.
 *
 * The corpus holds no executed read-write open. The literal `<>` appears in 13
 * commands, every one of them as quoted text rather than as an operator — a
 * `Provider<>` grep pattern, and spike scripts from this issue's own
 * investigation passing `'cat <> rw.txt'` as an argument. Counting the
 * substring is therefore not a measurement of the population, which is why
 * this script counts unresolved *redirect nodes* instead.
 *
 * A change is monotonically at-least-as-restrictive: `unproven` consults both
 * directional surfaces most-restrictive, where a proof consults one. So this
 * measurement bounds *added* prompts and there are no removed ones to count.
 *
 * The log grows with use, so every figure here drifts between runs. Re-run
 * rather than trusting any figure to be exact, and read a small difference from
 * these as log growth rather than as a change in behavior.
 *
 * The walks are transcribed here rather than imported, for the reason
 * `measure-statement-descent.mjs` states: transcribing keeps a re-run
 * comparable to the original figures even after the module moves. The parse is
 * the real `tree-sitter-bash`, though — the node types *are* the measurement.
 *
 * A command longer than `reviewLogFieldMaxWidth` (1000) is stored shortened
 * with a trailing ellipsis and re-parses as garbage, so those are excluded —
 * the same filter `measure-statement-operands.mjs` documents.
 *
 * Usage:
 *   node scripts/measure-unresolved-redirects.mjs [path-to-review-log.jsonl]
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Transcribed vocabulary ─────────────────────────────────────────────────

/** Argument value node types (`node-text.ts`'s `ARG_NODE_TYPES`). */
const ARG_NODE_TYPES = new Set([
  "word",
  "concatenation",
  "string",
  "raw_string",
]);

/** Descriptor destination types (`redirect-analysis.ts`). */
const DESCRIPTOR_NODE_TYPES = new Set(["file_descriptor", "number"]);

/** The redirect node types the collectors read (`token-collection.ts`). */
const REDIRECT_NODE_TYPES = new Set(["file_redirect", "herestring_redirect"]);

/** The operator table (`command-effects.ts`). */
const OUTPUT_REDIRECT_OPERATORS = new Set([">", ">>", ">|", "&>", "&>>"]);
const INPUT_REDIRECT_OPERATORS = new Set(["<", "<<<"]);
const DESCRIPTOR_CAPABLE_OPERATORS = new Set([">&", "<&"]);

/** Windows drive-letter absolute path (`token-classification.ts`). */
const WINDOWS_DRIVE_PATH_PATTERN = /^[a-zA-Z]:[/\\]/;

/** URL prefix (`token-classification.ts`). */
const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/** The shared rejection prelude (`token-classification.ts`). */
function rejectNonPathToken(token) {
  if (!token) return true;
  if (token.startsWith("-")) return true;
  const eqIndex = token.indexOf("=");
  const slashIndex = token.indexOf("/");
  if (eqIndex !== -1 && (slashIndex === -1 || eqIndex < slashIndex))
    return true;
  if (URL_PATTERN.test(token)) return true;
  if (token.startsWith("@") && !token.startsWith("@/")) return true;
  return false;
}

/**
 * The broad classifier that gates `path`, under the POSIX flavor (`/` is the
 * only separator). A win32 run would also count `\`; the log is POSIX.
 */
function isRuleCandidate(token) {
  if (rejectNonPathToken(token)) return false;
  if (token.startsWith(".")) return true;
  if (token.includes("/")) return true;
  if (token.includes("..")) return true;
  return WINDOWS_DRIVE_PATH_PATTERN.test(token);
}

// ── The redirect walk (transcribed from `redirect-analysis.ts`) ────────────

/** The redirect's operator: its first unnamed child (`redirectOperatorOf`). */
function redirectOperatorOf(node) {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && !child.isNamed) return child.type;
  }
  return "";
}

/** The operator table's answer, or `null` when the redirect names no file. */
function operatorEffect(operator, destinationIsDescriptor) {
  if (DESCRIPTOR_CAPABLE_OPERATORS.has(operator)) {
    if (destinationIsDescriptor) return null;
    return operator === ">&" ? "write" : "read";
  }
  if (OUTPUT_REDIRECT_OPERATORS.has(operator)) return "write";
  if (INPUT_REDIRECT_OPERATORS.has(operator)) return "read";
  return "unproven";
}

/** Whether tree-sitter failed to resolve the syntax at `node`. */
function parseUnresolvedAt(node) {
  return node.hasError || (node.previousSibling?.hasError ?? false);
}

/**
 * Every argument-shaped destination a redirect names, with the effect
 * attributed to it before and after the change.
 */
function redirectAttributions(redirect) {
  const operator = redirectOperatorOf(redirect);
  const unresolved = parseUnresolvedAt(redirect);
  const attributions = [];
  for (let i = 0; i < redirect.childCount; i++) {
    const child = redirect.child(i);
    if (!child || !ARG_NODE_TYPES.has(child.type)) continue;
    const before = operatorEffect(
      operator,
      DESCRIPTOR_NODE_TYPES.has(child.type),
    );
    if (before === null) continue;
    attributions.push({
      token: child.text,
      before,
      after: unresolved ? "unproven" : before,
    });
  }
  return attributions;
}

/** Walk a tree, accumulating every redirect's destination attributions. */
function collectAttributions(node, out) {
  if (REDIRECT_NODE_TYPES.has(node.type)) {
    out.push(...redirectAttributions(node));
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) collectAttributions(child, out);
  }
  return out;
}

/**
 * How many of a tree's redirects the parse could not resolve.
 *
 * Counted separately from the attributions, because a redirect can be
 * unresolvable and still name no argument-shaped destination to attribute
 * anything to — `cat <>&1` is the case, and it is exactly where the wrapper
 * floor was being cleared for a form nobody understood.
 */
function countUnresolvedRedirects(node) {
  let count =
    REDIRECT_NODE_TYPES.has(node.type) && parseUnresolvedAt(node) ? 1 : 0;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) count += countUnresolvedRedirects(child);
  }
  return count;
}

// ── Report ─────────────────────────────────────────────────────────────────

const DEFAULT_LOG = join(
  homedir(),
  ".pi/agent/extensions/pi-permission-system/logs",
  "pi-permission-system-permission-review.jsonl",
);

async function loadParser() {
  const { Parser, Language } = await import("web-tree-sitter");
  const req = createRequire(import.meta.url);
  await Parser.init({
    locateFile: () => req.resolve("web-tree-sitter/web-tree-sitter.wasm"),
  });
  const parser = new Parser();
  parser.setLanguage(
    await Language.load(req.resolve("tree-sitter-bash/tree-sitter-bash.wasm")),
  );
  return parser;
}

function readCommands(logPath) {
  const seen = new Set();
  for (const line of readFileSync(logPath, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.toolName !== "bash") continue;
    const command = entry.command ?? entry.toolInput?.command;
    if (typeof command !== "string" || command === "") continue;
    seen.add(command);
  }
  return [...seen];
}

async function main() {
  const logPath = process.argv[2] ?? DEFAULT_LOG;
  const parser = await loadParser();
  const all = readCommands(logPath);
  // A truncated entry re-parses as garbage; see the header.
  const intact = all.filter((command) => !command.endsWith("…"));

  let withRedirect = 0;
  let withUnresolvedRedirect = 0;
  const changes = [];

  for (const command of intact) {
    const tree = parser.parse(command);
    if (!tree) continue;
    try {
      const attributions = collectAttributions(tree.rootNode, []);
      if (attributions.length > 0) withRedirect++;
      if (countUnresolvedRedirects(tree.rootNode) > 0) withUnresolvedRedirect++;
      const changed = attributions.filter((a) => a.before !== a.after);
      if (changed.length > 0) changes.push({ command, changed });
    } finally {
      tree.delete();
    }
  }

  const changedAttributions = changes.flatMap(({ changed }) => changed);
  const pathShaped = changedAttributions.filter(({ token }) =>
    isRuleCandidate(token),
  );
  const pct = (n) => `${((n / intact.length) * 100).toFixed(3)}%`;

  console.log(`log: ${logPath}`);
  console.log("");
  console.log(`intact distinct bash commands:      ${intact.length}`);
  console.log(
    `whose redirect names a file:        ${withRedirect} (${pct(withRedirect)})`,
  );
  console.log(
    `carrying an unresolvable redirect:  ${withUnresolvedRedirect} (${pct(withUnresolvedRedirect)})`,
  );
  console.log("");
  console.log(
    `commands whose attribution changes: ${changes.length} (${pct(changes.length)})`,
  );
  console.log(
    `changed attributions:               ${changedAttributions.length}`,
  );
  console.log(
    `…of which are path-shaped:          ${pathShaped.length} (the ones that reach a gate)`,
  );

  if (changes.length > 0) {
    console.log("");
    console.log("Each change (command, then token: before → after):");
    for (const { command, changed } of changes) {
      console.log(`  ${command.slice(0, 160)}`);
      for (const { token, before, after } of changed) {
        console.log(
          `    ${JSON.stringify(token)}: ${before} → ${after}${
            isRuleCandidate(token) ? "  [path-shaped]" : ""
          }`,
        );
      }
    }
  }
}

await main();
