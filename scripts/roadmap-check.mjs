#!/usr/bin/env node
// Check a package's live improvement roadmap against its own published inputs.
//
// Read-only and offline. Every step publishes its Impact/Risk/Priority scores,
// its `Release:` tag, and its place in the dependency diagram so the ranking is
// auditable in the committed document — and until now nothing verified that
// those published inputs agreed with each other, or with the prose around them
// (Refs #894).
//
// Usage:
//   ./scripts/roadmap-check.mjs                 # every package with a roadmap
//   ./scripts/roadmap-check.mjs pi-subagents    # one package
//
// Exit status is the answer: 0 when no error was found (warnings may still be
// printed), 1 when an error was found, and 2 when the question could not be
// answered — a package that does not exist, or a named package whose
// architecture document carries no roadmap section.
//
// An error's inputs parse strictly, so a violation is unambiguous. A warning
// reads prose on at least one side, so it reports omissions rather than
// asserting a partition.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseRoadmap } from "./roadmap/parse-roadmap.mjs";
import { validateRoadmap } from "./roadmap/validate-roadmap.mjs";

const EXIT_CLEAN = 0;
const EXIT_FINDINGS = 1;
const EXIT_UNANSWERABLE = 2;

/**
 * @typedef {object} CheckResult
 * @property {0|1|2} code
 * @property {string} report
 */

/**
 * Check the roadmaps of the named packages, or of every package that has one.
 *
 * @param {object} options
 * @param {string} options.root the repository root
 * @param {string[]} options.packages package directory names; empty means all
 * @returns {CheckResult}
 */
export function checkRoadmaps({ root, packages }) {
  const selected = packages.length > 0 ? packages : listPackages(root);
  const lines = [];
  let code = EXIT_CLEAN;

  for (const pkg of selected) {
    const documentPath = path.join(
      "packages",
      pkg,
      "docs",
      "architecture",
      "architecture.md",
    );
    const document = read(path.join(root, documentPath));
    const roadmap = document === null ? null : parseRoadmap(document);

    if (roadmap === null) {
      // Only an explicitly named package makes a missing roadmap an answer the
      // command owes: sweeping every package, most have none by design.
      if (packages.length === 0) continue;
      lines.push(
        `${documentPath}: no \`## Improvement roadmap\` section to check`,
      );
      code = EXIT_UNANSWERABLE;
      continue;
    }

    const findings = validateRoadmap(roadmap);
    lines.push(...describe(documentPath, roadmap, findings));
    if (
      code !== EXIT_UNANSWERABLE &&
      findings.some((f) => f.severity === "error")
    ) {
      code = EXIT_FINDINGS;
    }
  }

  return { code, report: `${lines.join("\n")}\n` };
}

/**
 * @param {string} documentPath
 * @param {import("./roadmap/parse-roadmap.mjs").Roadmap} roadmap
 * @param {import("./roadmap/validate-roadmap.mjs").Finding[]} findings
 * @returns {string[]}
 */
function describe(documentPath, roadmap, findings) {
  const counts = `${roadmap.steps.length} steps, ${findings.length} findings`;
  return [
    `${documentPath} — ${roadmap.phaseTitle} (${counts})`,
    ...findings.map((finding) => {
      const subject =
        finding.stepIssue === null ? "" : `#${finding.stepIssue} `;
      return `  ${finding.severity.padEnd(7)} ${subject}${finding.message}`;
    }),
  ];
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function listPackages(root) {
  return readdirSync(path.join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * @param {string} filePath
 * @returns {string|null} null when the file does not exist
 */
function read(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const result = checkRoadmaps({
    root: repositoryRoot,
    packages: process.argv.slice(2),
  });
  process.stdout.write(result.report);
  process.exitCode = result.code;
}
