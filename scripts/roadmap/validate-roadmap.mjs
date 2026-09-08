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

/**
 * @typedef {object} Finding
 * @property {"error"|"warning"} severity
 * @property {number|null} stepIssue the step the finding is about, or null for a phase-wide one
 * @property {string} message
 */

/**
 * @param {import("./parse-roadmap.mjs").Roadmap} roadmap
 * @returns {Finding[]}
 */
export function validateRoadmap(roadmap) {
  return roadmap.steps.flatMap((step) => checkScores(step));
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
 * @param {import("./parse-roadmap.mjs").RoadmapStep} step
 * @param {string} message
 * @returns {Finding}
 */
function error(step, message) {
  return { severity: "error", stepIssue: step.issue, message };
}
