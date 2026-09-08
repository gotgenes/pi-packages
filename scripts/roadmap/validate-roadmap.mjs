/**
 * Checking an improvement roadmap's published inputs against each other.
 *
 * The roadmap publishes its scores, release tags, and dependency graph so the
 * ranking is auditable in the committed document. Publishing them and then
 * maintaining the surrounding prose by hand leaves the two free to disagree,
 * and nothing checked that they agreed (#894).
 *
 * Severity tracks how strictly the input parses, not how much the finding
 * matters. An error's inputs are strict enough that a violation is
 * unambiguous; a warning reads prose on at least one side, so it reports
 * omissions and never asserts a partition.
 */

import { collectStepMentions } from "./step-references.mjs";

/**
 * @typedef {object} Finding
 * @property {"error"|"warning"} severity
 * @property {number|null} stepIssue the step the finding is about, or null for a phase-wide one
 * @property {string} message
 */

const RELEASE_INDEPENDENT = "independent";
const RELEASE_BATCH = /^batch "([^"]+)"$/;
const BATCH_BULLET = /\*\*Batch "([^"]+)":?\*\*([^\n]*)/g;
const BATCH_TAIL = /tail = (?:Step )?\[?#?(\d+)\]?/;

/**
 * @param {import("./parse-roadmap.mjs").Roadmap} roadmap
 * @returns {Finding[]}
 */
export function validateRoadmap(roadmap) {
  return [
    ...roadmap.steps.flatMap((step) => [
      ...checkScores(step),
      ...checkReleaseTag(step),
      ...checkStepBatchResolves(step, roadmap),
      ...checkStepHasNode(step, roadmap),
      ...checkDependencyClaim(step, roadmap),
      ...checkStepIsNamedInProse(step, roadmap),
    ]),
    ...checkBatchTails(roadmap),
    ...checkNodesAreSteps(roadmap),
    ...checkAcyclic(roadmap),
  ];
}

/**
 * `Priority = Impact × (6 − Risk)` is the prioritization framework's own
 * formula, published per step so the ranking is auditable rather than taken on
 * trust. The message names both inputs, because a mismatch is as often a
 * mistyped Impact or Risk as a mistyped Priority.
 *
 * @param {import("./parse-roadmap.mjs").RoadmapStep} step
 * @returns {Finding[]}
 */
function checkScores(step) {
  if (step.scores === null) {
    return [error(step, "no **Impact / Risk / Priority** line")];
  }
  const { impact, risk, priority } = step.scores;
  const expected = impact * (6 - risk);
  if (priority === expected) return [];
  return [
    error(
      step,
      `published Priority ${priority}, but Impact ${impact} × (6 − Risk ${risk}) is ${expected}`,
    ),
  ];
}

/**
 * A step declares its release coordination on exactly one `Release:` line, so
 * `/plan-issue` and `/ship` can grep for it rather than read prose.
 *
 * @param {import("./parse-roadmap.mjs").RoadmapStep} step
 * @returns {Finding[]}
 */
function checkReleaseTag(step) {
  if (step.releaseTags.length !== 1) {
    return [
      error(
        step,
        `has ${step.releaseTags.length} \`Release:\` lines, expected exactly 1`,
      ),
    ];
  }
  const [tag] = step.releaseTags;
  if (tag === RELEASE_INDEPENDENT || RELEASE_BATCH.test(tag)) return [];
  return [
    error(
      step,
      `has an unrecognized \`Release:\` value ${JSON.stringify(tag)}`,
    ),
  ];
}

/**
 * @param {import("./parse-roadmap.mjs").RoadmapStep} step
 * @param {import("./parse-roadmap.mjs").Roadmap} roadmap
 * @returns {Finding[]}
 */
function checkStepBatchResolves(step, roadmap) {
  const name = batchNameOf(step);
  if (name === null || batchBullets(roadmap).has(name)) return [];
  return [
    error(
      step,
      `names batch ${JSON.stringify(name)}, which has no bullet in \`Release batches\``,
    ),
  ];
}

/**
 * The last member a batch bullet lists is the batch tail — the step whose
 * landing completes the batch — so a tail naming a step that is not in the
 * batch leaves `/plan-issue` recommending a release for the wrong step.
 *
 * @param {import("./parse-roadmap.mjs").Roadmap} roadmap
 * @returns {Finding[]}
 */
function checkBatchTails(roadmap) {
  const findings = [];
  for (const [name, bullet] of batchBullets(roadmap)) {
    const tail = BATCH_TAIL.exec(bullet);
    if (tail === null) continue;
    const named = Number(tail[1]);
    const declaring = roadmap.steps.filter(
      (step) => batchNameOf(step) === name,
    );
    if (
      declaring.some((step) => step.issue === named || step.ordinal === named)
    )
      continue;
    findings.push(
      phaseError(
        `batch ${JSON.stringify(name)} names #${named} as its tail, but #${named} does not declare that batch`,
      ),
    );
  }
  return findings;
}

/**
 * @param {import("./parse-roadmap.mjs").Roadmap} roadmap
 * @returns {Map<string, string>}
 */
function batchBullets(roadmap) {
  return new Map(
    [...roadmap.batchesText.matchAll(BATCH_BULLET)].map((bullet) => [
      bullet[1],
      bullet[2],
    ]),
  );
}

/**
 * @param {import("./parse-roadmap.mjs").RoadmapStep} step
 * @returns {string|null}
 */
function batchNameOf(step) {
  if (step.releaseTags.length !== 1) return null;
  const batch = RELEASE_BATCH.exec(step.releaseTags[0]);
  return batch === null ? null : batch[1];
}

/**
 * Membership, not counts: a step missing from the diagram and an unrelated node
 * present in it are two findings, and comparing sizes reports neither.
 *
 * @param {import("./parse-roadmap.mjs").RoadmapStep} step
 * @param {import("./parse-roadmap.mjs").Roadmap} roadmap
 * @returns {Finding[]}
 */
function checkStepHasNode(step, roadmap) {
  if (roadmap.nodeIssues.includes(step.issue)) return [];
  return [error(step, "has no node in the dependency diagram")];
}

/**
 * @param {import("./parse-roadmap.mjs").Roadmap} roadmap
 * @returns {Finding[]}
 */
function checkNodesAreSteps(roadmap) {
  const stepIssues = new Set(roadmap.steps.map((step) => step.issue));
  return roadmap.nodeIssues
    .filter((issue) => !stepIssues.has(issue))
    .map((issue) =>
      phaseError(`diagram node #${issue} is not a step in this phase`),
    );
}

/**
 * A dependency graph that cannot be ordered has no working sequence, whoever
 * does the ordering. Soft edges are excluded: they state a sequencing
 * preference rather than a constraint, so a soft back-edge is legitimate.
 *
 * @param {import("./parse-roadmap.mjs").Roadmap} roadmap
 * @returns {Finding[]}
 */
function checkAcyclic(roadmap) {
  const successors = new Map(roadmap.steps.map((step) => [step.issue, []]));
  for (const edge of hardEdges(roadmap))
    successors.get(edge.from)?.push(edge.to);

  const findings = [];
  const visitState = new Map();

  const walk = (issue, path) => {
    if (visitState.get(issue) === "open") {
      const cycle = [...path.slice(path.indexOf(issue)), issue];
      findings.push(
        phaseError(
          `hard dependencies cycle: ${cycle.map((step) => `#${step}`).join(" → ")}`,
        ),
      );
      return;
    }
    if (visitState.get(issue) === "closed") return;
    visitState.set(issue, "open");
    for (const next of successors.get(issue) ?? [])
      walk(next, [...path, issue]);
    visitState.set(issue, "closed");
  };

  for (const step of roadmap.steps) walk(step.issue, []);
  return findings;
}

/**
 * The diagram is the dependency authority; the bullet explains the reasoning.
 * Checking both directions is what keeps the explanation honest — a bullet can
 * drift from the diagram by claiming an edge that is not drawn, or by omitting
 * one that is.
 *
 * Warning rather than error, because only one side of the comparison parses
 * strictly.
 *
 * @param {import("./parse-roadmap.mjs").RoadmapStep} step
 * @param {import("./parse-roadmap.mjs").Roadmap} roadmap
 * @returns {Finding[]}
 */
function checkDependencyClaim(step, roadmap) {
  const drawn = new Set(
    hardEdges(roadmap)
      .filter((edge) => edge.to === step.issue)
      .map((edge) => edge.from),
  );

  if (step.hardDependency === null) {
    return [...drawn].map((from) =>
      warning(
        step,
        `has a solid edge from #${from} but declares no **Hard dependency:** bullet`,
      ),
    );
  }

  const declared = new Set(step.hardDependency.dependsOn);
  return [
    ...[...declared]
      .filter((from) => !drawn.has(from))
      .map((from) =>
        warning(
          step,
          `declares a hard dependency on #${from} with no solid edge in the diagram`,
        ),
      ),
    ...[...drawn]
      .filter((from) => !declared.has(from))
      .map((from) =>
        warning(
          step,
          `has a solid edge from #${from} that its **Hard dependency:** bullet omits`,
        ),
      ),
  ];
}

/**
 * Deliberately one-directional. The tracks and batches sections are prose, so
 * this asks only whether a step is named there — never who a track's members
 * are, which no rule reads reliably across both live documents.
 *
 * A step is looked up by whichever identity its own heading uses, so an
 * ordinal-shaped step is not accepted merely because its issue number happens
 * to appear in the prose.
 *
 * @param {import("./parse-roadmap.mjs").RoadmapStep} step
 * @param {import("./parse-roadmap.mjs").Roadmap} roadmap
 * @returns {Finding[]}
 */
function checkStepIsNamedInProse(step, roadmap) {
  const key = step.ordinal ?? step.issue;
  return [
    ...(collectStepMentions(roadmap.tracksText).has(key)
      ? []
      : [warning(step, "is named in no parallel track")]),
    ...(collectStepMentions(roadmap.batchesText).has(key)
      ? []
      : [
          warning(
            step,
            "is named in no release batch or independently-releasable list",
          ),
        ]),
  ];
}

/**
 * @param {import("./parse-roadmap.mjs").Roadmap} roadmap
 * @returns {import("./parse-roadmap.mjs").RoadmapEdge[]}
 */
function hardEdges(roadmap) {
  return roadmap.edges.filter((edge) => edge.kind === "hard");
}

/**
 * @param {import("./parse-roadmap.mjs").RoadmapStep} step
 * @param {string} message
 * @returns {Finding}
 */
function error(step, message) {
  return { severity: "error", stepIssue: step.issue, message };
}

/**
 * @param {import("./parse-roadmap.mjs").RoadmapStep} step
 * @param {string} message
 * @returns {Finding}
 */
function warning(step, message) {
  return { severity: "warning", stepIssue: step.issue, message };
}

/**
 * @param {string} message
 * @returns {Finding}
 */
function phaseError(message) {
  return { severity: "error", stepIssue: null, message };
}
