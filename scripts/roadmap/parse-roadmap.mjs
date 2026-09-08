/**
 * Reading a package architecture document's live improvement roadmap into a
 * model the validator can check.
 *
 * The parser takes a string rather than a path, so every test is a fixture
 * literal and the filesystem stays in the command layer.
 *
 * A step is keyed by its GitHub issue number throughout, whichever identity the
 * document's headings use. That is the same re-keying the `✅` step-mark gate
 * took in #893: the heading and the diagram node both carry the issue number
 * under either shape, so downstream code never branches on the shape.
 */

import { parseStepReferenceRun } from "./step-references.mjs";

/**
 * @typedef {object} RoadmapStep
 * @property {number} issue the step's identity
 * @property {number|null} ordinal null under the issue-identity heading shape
 * @property {string} title
 * @property {{ impact: number, risk: number, priority: number }|null} scores
 * @property {string[]} releaseTags every `Release:` line in the block, so "exactly one" is checkable
 * @property {{ present: true, dependsOn: number[] }|null} hardDependency null when the bullet is absent
 */

/**
 * @typedef {object} RoadmapEdge
 * @property {number} from
 * @property {number} to
 * @property {"hard"|"soft"} kind
 */

/**
 * @typedef {object} Roadmap
 * @property {string} phaseTitle
 * @property {RoadmapStep[]} steps in section order, which is the working sequence
 * @property {RoadmapEdge[]} edges
 * @property {number[]} nodeIssues
 * @property {string} tracksText
 * @property {string} batchesText
 */

const ROADMAP_HEADING = /^## (Improvement roadmap.*)$/m;
const STEPS_HEADING = "\n### Steps";
const DIAGRAM_HEADING = "\n### Step dependency diagram";
const TRACKS_HEADING = "\n### Parallel tracks";
const BATCHES_HEADING = "\n### Release batches";

const ORDINAL_HEADING = /^(?:✅ )?Step (\d+): (.*?) \(\[#(\d+)\][^)]*\)$/;
const ISSUE_HEADING = /^(?:✅ )?\[#(\d+)\] (.*)$/;
const SCORES = /\*\*Impact (\d+) \/ Risk (\d+) \/ Priority (\d+)\.\*\*/;
const RELEASE_LINE = /^Release: (.*)$/gm;
const HARD_DEPENDENCY = /^- \*\*Hard dependency:\*\* (.*)$/m;
const MERMAID_FENCE = /```mermaid\n([\s\S]*?)```/;
const LABELLED_NODE = /\b(S\w+)\["([^"]*)"\]/g;
const EDGE = /\b(S\w+)(?:\["[^"]*"\])?\s*(-->|-\.[^>]*?->)\s*(S\w+)/g;

/**
 * Parse the live `## Improvement roadmap` section out of an architecture
 * document.
 *
 * @param {string} document
 * @returns {Roadmap|null} null when the document carries no roadmap section
 */
export function parseRoadmap(document) {
  const heading = ROADMAP_HEADING.exec(document);
  if (heading === null) return null;

  const section = sliceSection(document, heading.index);
  const stepsBody = sliceBetween(section, STEPS_HEADING, DIAGRAM_HEADING);
  const diagram = parseDiagram(section);

  return {
    phaseTitle: heading[1],
    steps: parseSteps(stepsBody),
    edges: diagram.edges,
    nodeIssues: diagram.nodeIssues,
    tracksText: sliceBetween(section, TRACKS_HEADING, BATCHES_HEADING),
    batchesText: sliceBetween(section, BATCHES_HEADING, null),
  };
}

/**
 * The roadmap section runs to the next `##` heading, which is `## Refactoring
 * history` in every architecture document that has one.
 *
 * @param {string} document
 * @param {number} start
 * @returns {string}
 */
function sliceSection(document, start) {
  const rest = document.slice(start);
  const nextTopLevel = rest.slice(1).search(/^## /m);
  return nextTopLevel === -1 ? rest : rest.slice(0, nextTopLevel + 1);
}

/**
 * @param {string} section
 * @param {string} from
 * @param {string|null} to
 * @returns {string}
 */
function sliceBetween(section, from, to) {
  const start = section.indexOf(from);
  if (start === -1) return "";
  const end = to === null ? -1 : section.indexOf(to, start);
  return end === -1 ? section.slice(start) : section.slice(start, end);
}

/**
 * Steps are taken from the `### Steps` subsection alone. The roadmap section
 * also holds `#### Open-issue sweep dispositions` and `#### Deferred tidyings
 * swept` above it, which a section-wide `####` scan would read as steps.
 *
 * @param {string} stepsBody
 * @returns {RoadmapStep[]}
 */
function parseSteps(stepsBody) {
  const steps = stepsBody
    .split(/^#### /m)
    .slice(1)
    .map(parseStep)
    .filter((step) => step !== null);
  const issueByOrdinal = new Map(
    steps
      .filter((step) => step.ordinal !== null)
      .map((step) => [step.ordinal, step.issue]),
  );
  const resolve = (reference) =>
    reference.kind === "issue"
      ? reference.n
      : (issueByOrdinal.get(reference.n) ?? reference.n);

  return steps.map((step) =>
    step.hardDependency === null
      ? step
      : {
          ...step,
          hardDependency: {
            present: true,
            dependsOn: step.hardDependency.dependsOn.map(resolve),
          },
        },
  );
}

/**
 * @param {string} block
 * @returns {RoadmapStep|null}
 */
function parseStep(block) {
  const [heading, ...rest] = block.split("\n");
  const identity = parseStepHeading(heading);
  if (identity === null) return null;

  const body = rest.join("\n");
  const scores = SCORES.exec(body);
  const dependency = HARD_DEPENDENCY.exec(body);

  return {
    ...identity,
    scores:
      scores === null
        ? null
        : {
            impact: Number(scores[1]),
            risk: Number(scores[2]),
            priority: Number(scores[3]),
          },
    releaseTags: [...body.matchAll(RELEASE_LINE)].map((match) =>
      match[1].trim(),
    ),
    hardDependency:
      dependency === null
        ? null
        : { present: true, dependsOn: parseStepReferenceRun(dependency[1]) },
  };
}

/**
 * @param {string} heading
 * @returns {{ issue: number, ordinal: number|null, title: string }|null}
 */
function parseStepHeading(heading) {
  const ordinal = ORDINAL_HEADING.exec(heading);
  if (ordinal !== null) {
    return {
      issue: Number(ordinal[3]),
      ordinal: Number(ordinal[1]),
      title: ordinal[2],
    };
  }
  const issue = ISSUE_HEADING.exec(heading);
  if (issue !== null)
    return { issue: Number(issue[1]), ordinal: null, title: issue[2] };
  return null;
}

/**
 * The node ID spells the ordinal under one heading shape and the issue under
 * the other, so the issue is read from the label, which carries it either way.
 * A solid arrow is a hard dependency; every dashed spelling is soft.
 *
 * @param {string} section
 * @returns {{ edges: RoadmapEdge[], nodeIssues: number[] }}
 */
function parseDiagram(section) {
  const fence = MERMAID_FENCE.exec(section);
  if (fence === null) return { edges: [], nodeIssues: [] };

  const issueByNode = new Map();
  for (const node of fence[1].matchAll(LABELLED_NODE)) {
    const issue = /#(\d+)/.exec(node[2]);
    if (issue !== null) issueByNode.set(node[1], Number(issue[1]));
  }

  const edges = [];
  for (const edge of fence[1].matchAll(EDGE)) {
    const from = issueByNode.get(edge[1]);
    const to = issueByNode.get(edge[3]);
    if (from === undefined || to === undefined) continue;
    edges.push({ from, to, kind: edge[2] === "-->" ? "hard" : "soft" });
  }

  return { edges, nodeIssues: [...issueByNode.values()] };
}
