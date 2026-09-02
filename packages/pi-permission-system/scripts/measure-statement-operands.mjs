#!/usr/bin/env node
/**
 * Measure the population of bash statement operands that [#839] newly projects.
 *
 * ADR 0013's rule is that a durable number ships with the instrument that
 * produced it, so a later reader can re-run it and falsify the claim rather
 * than argue with it. The population figures in Phase 14 Step 16's `Landed:`
 * note come from this script.
 *
 * Metric: for each intact bash command in the review log, find the operands a
 * statement names directly — the argument-typed children after a
 * `for_statement`'s `in` keyword, and the argument-typed child before a
 * `case_statement`'s — and report how many pass each of the two shape
 * classifiers. Before [#839] the path collector read text only from `command`
 * and `file_redirect` nodes, so *every* one of these tokens was invisible to
 * the `path` and `external_directory` surfaces; the population is therefore the
 * delta's upper bound, tight except where a command names the same path twice
 * and the resolver's dedup folds the repeat.
 *
 * Measured 2026-09-02 against the local review log:
 *
 * | Quantity | Value |
 * | --- | --- |
 * | intact (untruncated) bash commands | 5206 |
 * | commands naming a statement operand | 99 (1.9%) |
 * | `for_statement` nodes | 132 |
 * | `case_statement` nodes | 1 |
 * | argument-typed `for` operand words | 343 |
 * | argument-typed `case` subjects | 1 (`":$PATH:"`, not path-shaped) |
 * | operands the broad classifier accepts (`path`) | 71 |
 * | operands the strict classifier accepts (`external_directory`) | 47 |
 *
 * The log grows with use, so the command count drifts between runs while the
 * node and operand counts are stable for a fixed corpus; re-run rather than
 * trusting any figure to be exact.
 *
 * Two figures this script does not compute, recorded here with the method that
 * produced them so they can be reproduced:
 *
 * - **Slice delta.** Applying [#839] as a spike and diffing real
 *   `BashProgram.parse` output over 5191 intact commands of the same log, with
 *   the session cwd at `~/development/pi/pi-packages`: 22 commands (0.42%) change
 *   `pathRuleCandidates()` and 11 (0.21%) change `externalAccesses()`.
 * - **Prompt delta.** Feeding each of those `externalAccesses()` entries'
 *   `matchValues()` through `normalizeFlatConfig(expandDirectionalSugar(…))`
 *   and `evaluateAnyValue` against the author's real global config, on both
 *   directional `external_directory` surfaces and taking the most restrictive:
 *   3 commands (0.058%) newly prompt, and 0 stop prompting. That figure is
 *   scoped to one policy — re-derive it against your own config rather than
 *   quoting it.
 *
 * Both walks are transcribed here rather than imported, for the reason
 * `measure-statement-descent.mjs` states: transcribing keeps a re-run
 * comparable to the original figures even after the module moves. The parse is
 * the real `tree-sitter-bash`, though — the node types *are* the measurement,
 * so a crude split would measure nothing.
 *
 * A command longer than `reviewLogFieldMaxWidth` (1000) is stored shortened
 * with a trailing ellipsis and re-parses as garbage, so those are excluded —
 * the same filter `measure-statement-descent.mjs` documents.
 *
 * Usage:
 *   node scripts/measure-statement-operands.mjs [path-to-review-log.jsonl]
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

/**
 * Windows drive-letter absolute path (`token-classification.ts`).
 */
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

/** The strict classifier that gates `external_directory`. */
function isStrictPathCandidate(token) {
  if (rejectNonPathToken(token)) return false;
  if (token.startsWith("/")) return true;
  if (token.startsWith("~/")) return true;
  if (token.includes("..")) return true;
  return WINDOWS_DRIVE_PATH_PATTERN.test(token);
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

/**
 * Quote removal, as `resolveNodeText` performs it for the node types this walk
 * reads. An expansion is left as its own text, which is what the real resolver
 * does for every variable outside the `HOME`/`PWD` set.
 */
function resolveText(node) {
  if (node.type === "raw_string") {
    const t = node.text;
    return t.length >= 2 && t.startsWith("'") && t.endsWith("'")
      ? t.slice(1, -1)
      : t;
  }
  if (node.type === "string" || node.type === "concatenation") {
    let out = "";
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child || child.type === '"') continue;
      out += resolveText(child);
    }
    return out;
  }
  return node.text;
}

// ── The operand walk (transcribed from `collectStatementOperandTokens`) ─────

/**
 * The argument-typed operands a statement names directly, on `operandSide` of
 * its `in` keyword.
 */
function statementOperands(node, operandSide) {
  const operands = [];
  let seenIn = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (!child.isNamed) {
      if (child.type === "in") seenIn = true;
      continue;
    }
    const side = seenIn ? "after-in" : "before-in";
    if (side !== operandSide || !ARG_NODE_TYPES.has(child.type)) continue;
    operands.push(resolveText(child));
  }
  return operands;
}

/** Walk a tree, accumulating each statement's directly-named operands. */
function collectStatementOperands(node, out) {
  if (node.type === "for_statement") {
    out.forStatements++;
    out.forOperands.push(...statementOperands(node, "after-in"));
  } else if (node.type === "case_statement") {
    out.caseStatements++;
    out.caseSubjects.push(...statementOperands(node, "before-in"));
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) collectStatementOperands(child, out);
  }
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

  const totals = {
    forStatements: 0,
    caseStatements: 0,
    forOperands: [],
    caseSubjects: [],
  };
  let commandsWithOperands = 0;

  for (const command of intact) {
    const tree = parser.parse(command);
    if (!tree) continue;
    try {
      const before = totals.forOperands.length + totals.caseSubjects.length;
      collectStatementOperands(tree.rootNode, totals);
      const after = totals.forOperands.length + totals.caseSubjects.length;
      if (after > before) commandsWithOperands++;
    } finally {
      tree.delete();
    }
  }

  const operands = [...totals.forOperands, ...totals.caseSubjects];
  const strict = operands.filter(isStrictPathCandidate);
  const broad = operands.filter(isRuleCandidate);
  const pct = (n) => `${((n / intact.length) * 100).toFixed(1)}%`;

  console.log(`log: ${logPath}`);
  console.log("");
  console.log(`deduplicated bash commands:      ${all.length}`);
  console.log(`intact (untruncated):            ${intact.length}`);
  console.log(
    `commands naming a statement operand: ${commandsWithOperands} (${pct(commandsWithOperands)})`,
  );
  console.log(`for_statement nodes:             ${totals.forStatements}`);
  console.log(`case_statement nodes:            ${totals.caseStatements}`);
  console.log(`for/select operand words:        ${totals.forOperands.length}`);
  console.log(`case subject words:              ${totals.caseSubjects.length}`);
  console.log("");
  console.log(
    `reaching the path surface (broad classifier):        ${broad.length}`,
  );
  console.log(
    `reaching external_directory (strict classifier):     ${strict.length}`,
  );
  console.log("");
  console.log(
    "strict-classified operands (the external_directory population):",
  );
  for (const token of [...new Set(strict)].sort()) {
    console.log(`  ${JSON.stringify(token)}`);
  }
}

await main();
