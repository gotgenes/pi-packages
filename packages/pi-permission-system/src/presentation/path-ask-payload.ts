import type { PromptEvidence, PromptPayload } from "./prompt-payload";
import { localRequester } from "./prompt-payload";

/** A displayed external path paired with its resolved target, when distinct. */
export interface ExternalPathDisclosure {
  /** The path as displayed (typed for tools, lexical-absolute for bash). */
  path: string;
  /** The canonical symlink-resolved target; present only when it differs. */
  resolvedPath?: string;
}

/** The facts a path-shaped gate holds when it raises an ask. */
interface PathAskFacts {
  toolName: string;
  /** The path as the caller typed it — what the user recognizes. */
  pathValue: string;
  agentName: string | null;
  matchedPattern?: string;
  /**
   * The surface that decided — a directional member when the tool's identity
   * proved a direction, the bare family otherwise. Distinct from the payload
   * `kind`, which stays coarse so renderer dispatch is untouched.
   */
  surface: string;
}

/** A tool ask gated by an explicit `path`-family rule. */
export function buildPathAskPayload(facts: PathAskFacts): PromptPayload {
  return pathPayload("path", facts, []);
}

/** The facts the external-directory gate adds: the boundary and the alias. */
interface ExternalDirectoryAskFacts extends PathAskFacts {
  /** The canonical location, when it names somewhere other than the typed path. */
  resolvedPath?: string;
  /** The working directory the path escapes. */
  cwd: string;
}

/** A tool ask for a path outside the working directory. */
export function buildExternalDirectoryAskPayload(
  facts: ExternalDirectoryAskFacts,
): PromptPayload {
  return pathPayload("external_directory", facts, [
    ...resolvedAliasEvidence(facts.resolvedPath),
    workingDirectoryEvidence(facts.cwd),
  ]);
}

/** The facts the bash external-directory gate holds: one command, many paths. */
interface BashExternalDirectoryAskFacts {
  command: string;
  /** Every uncovered path the command references, with its canonical alias. */
  externalPaths: readonly ExternalPathDisclosure[];
  cwd: string;
  agentName: string | null;
  toolName: string;
  matchedPattern?: string;
  /**
   * The surface that decided — a directional member when the deciding path's
   * effect was proven, the bare family otherwise. Distinct from the payload
   * `kind`, which stays coarse so renderer dispatch is untouched.
   */
  surface: string;
}

/** A bash ask whose command references paths outside the working directory. */
export function buildBashExternalDirectoryAskPayload(
  facts: BashExternalDirectoryAskFacts,
): PromptPayload {
  return {
    kind: "bash_external_directory",
    request: {
      requester: localRequester(facts.agentName),
      surface: facts.surface,
      toolName: facts.toolName,
      invokedToolName: null,
      value: facts.command,
      matchedPattern: facts.matchedPattern ?? null,
      commandContext: null,
      executedUnit: null,
    },
    evidence: [
      workingDirectoryEvidence(facts.cwd),
      ...facts.externalPaths.map(externalPathEvidence),
    ],
    annotations: [],
  };
}

// ── Shared shape ────────────────────────────────────────────────────────────

/**
 * The payload common to the single-path asks: the typed path is the
 * decision-relevant value, and the gate surface distinguishes them.
 */
function pathPayload(
  kind: "path" | "external_directory",
  facts: PathAskFacts,
  evidence: PromptEvidence[],
): PromptPayload {
  return {
    kind,
    request: {
      requester: localRequester(facts.agentName),
      surface: facts.surface,
      toolName: facts.toolName,
      invokedToolName: null,
      value: facts.pathValue,
      matchedPattern: facts.matchedPattern ?? null,
      commandContext: null,
      executedUnit: null,
    },
    evidence,
    annotations: [],
  };
}

/**
 * The canonical location, as its own entry rather than folded into the value:
 * the user decides on the path they typed, and the alias is what that path
 * turns out to name.
 */
function resolvedAliasEvidence(resolvedPath?: string): PromptEvidence[] {
  return resolvedPath === undefined
    ? []
    : [{ label: "resolves to", text: resolvedPath, detail: null }];
}

function workingDirectoryEvidence(cwd: string): PromptEvidence {
  return { label: "working directory", text: cwd, detail: null };
}

/**
 * One escaping path. The canonical alias rides as the entry's `detail` so a
 * render cannot separate a path from what it resolves to.
 */
function externalPathEvidence({
  path,
  resolvedPath,
}: ExternalPathDisclosure): PromptEvidence {
  return { label: "external path", text: path, detail: resolvedPath ?? null };
}
