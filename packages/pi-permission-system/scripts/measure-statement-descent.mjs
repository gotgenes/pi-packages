#!/usr/bin/env node
/**
 * Measure what the statement-descent enumerator adds over the catch-all it
 * replaced.
 *
 * ADR 0013's rule is that a durable number ships with the instrument that
 * produced it, so a later reader can re-run it and falsify the claim rather
 * than argue with it. The figures in Phase 14 Step 4's `Landed:` note come from
 * this script.
 *
 * Metric: for each intact bash command in the review log, enumerate its units
 * twice — once under the pre-[#742] rule (any unrecognized named statement is
 * emitted whole and never descended) and once under the current one — and count
 * the commands whose unit list grows.
 *
 * Measured 2026-08-29 against the local review log:
 *
 * | Quantity | Value |
 * | --- | --- |
 * | intact commands | 4348 |
 * | commands gaining units | 191 (4.4%) |
 * | units added | 842 |
 * | added units carrying a wrapper head | 11 |
 * | commands with a prefix-position substitution | 0 |
 *
 * The log grows with use, so a later run drifts; re-run rather than trusting
 * the figures to be exact.
 *
 * Verified against a run using the real modules over the same log: diffing
 * `BashProgram.commands()` at the landing commit against the pre-[#742] source
 * reports the same 191 commands and the same 842 added units, and reports zero
 * changes to `pathRuleCandidates()` and `externalAccesses()` outright — which
 * is what the prefix-position row bounds from above without that checkout.
 *
 * Both rules are transcribed here rather than imported, for the reason
 * `measure-core-coverage.mjs` states: the older of the two no longer exists in
 * `src/`, and transcribing the current one keeps a re-run comparable to the
 * original figures even after the module moves. The parse is the real
 * `tree-sitter-bash`, though — the node types *are* the measurement, so a crude
 * split would measure nothing.
 *
 * The last row is what makes the companion claim re-derivable. Step 4's path
 * half changed one thing only: a substitution in `command_name` or env-var
 * prefix position now projects its operands. So the count of commands carrying
 * such a substitution bounds the path-slice delta from above — at zero, the
 * "`pathRuleCandidates()` and `externalAccesses()` change on zero commands"
 * claim follows without re-running the resolver against a checked-out baseline.
 *
 * A command longer than `reviewLogFieldMaxWidth` (1000) is stored shortened
 * with a trailing ellipsis and re-parses as garbage, so those are excluded —
 * without that filter the `ERROR` population reads 111 instead of 1, and the
 * measurement measures the instrument.
 *
 * Usage:
 *   node scripts/measure-statement-descent.mjs [path-to-review-log.jsonl]
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Transcribed node-type vocabulary (`command-enumeration.ts`) ─────────────

/** Containers descended with the enclosing scope unchanged. */
const DESCEND = new Set(["program", "list", "pipeline"]);

/** Genuinely inert: neither a command nor able to host one. */
const SKIP = new Set(["comment", "heredoc_end"]);

/** Not commands, but their subtrees host executions (`nested-execution.ts`). */
const HOST = new Set([
  "file_redirect",
  "heredoc_redirect",
  "herestring_redirect",
  "heredoc_body",
]);

/** Substitution node types whose interior really executes. */
const CONTEXTS = new Set(["command_substitution", "process_substitution"]);

/** Emitted whole, then descended for their statements ([#742]). */
const COMPOUND = new Set([
  "if_statement",
  "while_statement",
  "for_statement",
  "c_style_for_statement",
  "case_statement",
  "function_definition",
  "compound_statement",
  "negated_command",
]);

/** Syntactic groupings inside a compound: descended, never emitted ([#742]). */
const GROUP = new Set(["do_group", "case_item", "elif_clause", "else_clause"]);

/** Every node type the enumerator recognizes as a statement ([#742]). */
const STATEMENT = new Set([
  "command",
  "redirected_statement",
  "subshell",
  "declaration_command",
  "variable_assignment",
  "test_command",
  "unset_command",
  "ERROR",
  ...DESCEND,
  ...COMPOUND,
  ...GROUP,
]);

/** Children supplying no operand of their own (`COMMAND_PREFIX_TYPES`). */
const PREFIX = new Set(["command_name", "variable_assignment"]);

/** Wrappers that always invoke a following command (`INDIRECTION_WRAPPER_NAMES`). */
const INDIRECTION = new Set([
  "sudo",
  "env",
  "xargs",
  "time",
  "nohup",
  "timeout",
  "nice",
  "parallel",
  "rust-parallel",
  "rush",
  "doas",
  "setsid",
  "stdbuf",
  "watch",
  "flock",
]);

/** Wrappers whose payload is an unparsed shell program (`opaque-payload`). */
const OPAQUE = new Set(["bash", "sh", "dash", "zsh", "ksh", "eval"]);

// ── The two enumerators ────────────────────────────────────────────────────

/**
 * Enumerate a program's unit texts under `rule`.
 *
 * `"pre"` is the behavior [#742] replaced: an unrecognized named statement is
 * emitted whole and never descended. `"post"` is current behavior. The two
 * share every other branch, which is the point — the delta they report is the
 * statement descent and nothing else.
 */
function collectUnits(node, rule) {
  const out = [];
  walk(node, rule, out);
  return out;
}

function walk(node, rule, out) {
  if (!node.isNamed) return;
  if (SKIP.has(node.type)) return;

  if (node.type === "command") {
    out.push(commandUnitText(node));
    hosted(node, rule, out);
    return;
  }

  if (node.type === "redirected_statement" || DESCEND.has(node.type)) {
    descendAll(node, rule, out);
    return;
  }

  if (HOST.has(node.type)) {
    hosted(node, rule, out);
    return;
  }

  if (node.type === "subshell") {
    out.push(node.text);
    descendAll(node, rule, out);
    return;
  }

  if (rule === "post" && COMPOUND.has(node.type)) {
    out.push(node.text);
    descendStatements(node, rule, out);
    return;
  }

  if (rule === "post" && GROUP.has(node.type)) {
    descendStatements(node, rule, out);
    return;
  }

  if (rule === "post" && node.type === "ERROR") {
    out.push(node.text);
    return;
  }

  out.push(node.text);
  if (rule === "post") hosted(node, rule, out);
}

function descendAll(node, rule, out) {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walk(child, rule, out);
  }
}

function descendStatements(node, rule, out) {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child?.isNamed) continue;
    if (STATEMENT.has(child.type)) walk(child, rule, out);
    else hosted(child, rule, out);
  }
}

/** Enumerate the commands of every execution context `node` is or contains. */
function hosted(node, rule, out) {
  forEachExecutionIn(node, (contextNode) => descendAll(contextNode, rule, out));
}

function forEachExecutionIn(node, visit) {
  if (CONTEXTS.has(node.type)) visit(node);
  else forEachNestedExecution(node, visit);
}

function forEachNestedExecution(node, visit) {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (CONTEXTS.has(child.type)) visit(child);
    else forEachNestedExecution(child, visit);
  }
}

/** A `command` node's text with any leading env-var assignment prefix stripped. */
function commandUnitText(node) {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.isNamed && child.type !== "variable_assignment") {
      return node.text.slice(child.startIndex - node.startIndex);
    }
  }
  return node.text;
}

// ── The prefix-position population (the path half's upper bound) ────────────

/**
 * True when any `command` node in the tree carries a substitution in
 * `command_name` or env-var prefix position — the only position Step 4's path
 * half changed.
 */
function hasPrefixHostedExecution(node) {
  if (node.type === "command") {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && PREFIX.has(child.type) && containsContext(child))
        return true;
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && hasPrefixHostedExecution(child)) return true;
  }
  return false;
}

function containsContext(node) {
  if (CONTEXTS.has(node.type)) return true;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && containsContext(child)) return true;
  }
  return false;
}

/** The wrapper kind a unit's head word establishes, or null. */
function wrapperKindOf(unit) {
  const words = unit.trim().split(/\s+/);
  const head = (words[0] ?? "").split("/").pop();
  if (OPAQUE.has(head)) return "opaque-payload";
  if (INDIRECTION.has(head)) return "indirection";
  return null;
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

  let grew = 0;
  let added = 0;
  let prefixHosted = 0;
  const wrapperHeads = [];

  for (const command of intact) {
    const tree = parser.parse(command);
    if (!tree) continue;
    try {
      const before = collectUnits(tree.rootNode, "pre");
      const after = collectUnits(tree.rootNode, "post");
      if (after.length > before.length) {
        grew++;
        added += after.length - before.length;
        const known = new Set(before);
        for (const unit of after) {
          if (known.has(unit)) continue;
          const kind = wrapperKindOf(unit);
          if (kind) wrapperHeads.push([kind, unit]);
        }
      }
      if (hasPrefixHostedExecution(tree.rootNode)) prefixHosted++;
    } finally {
      tree.delete();
    }
  }

  const pct = (n) => `${((n / intact.length) * 100).toFixed(1)}%`;
  console.log(`log: ${logPath}`);
  console.log("");
  console.log(`deduplicated bash commands:  ${all.length}`);
  console.log(`intact (untruncated):        ${intact.length}`);
  console.log(`commands gaining units:      ${grew} (${pct(grew)})`);
  console.log(`units added:                 ${added}`);
  console.log(`  of them, wrapper-headed:   ${wrapperHeads.length}`);
  console.log(`prefix-position substitution: ${prefixHosted}`);
  console.log("");
  console.log(
    "added units carrying a wrapper head (the only decision changes,",
  );
  console.log("all allow → ask through the pre-existing floor):");
  for (const [kind, unit] of wrapperHeads) {
    console.log(`  ${kind.padEnd(15)} ${JSON.stringify(unit.slice(0, 70))}`);
  }
}

await main();
