import {
  type EffectSource,
  RETRACTED_EFFECT,
  type TokenEffect,
  UNPROVEN_EFFECT,
} from "#src/access-intent/effect";
import type {
  DeclarationScope,
  DeclaredCommandEffects,
} from "#src/config/command-effects-config";
import type { CommandEffectsEntry } from "#src/config/config-schema";
import type { ArgWord } from "./node-text";
import { stemGuard } from "./option-guards";

// ── Public surface ─────────────────────────────────────────────────────────

/**
 * What a command establishes for the operand tokens it owns.
 *
 * `effect` routes each operand to a directional surface. `inert` is the
 * user's `effects: []`: the operands touch no file, so they are withdrawn from
 * the path surfaces altogether. Its `effect` is the fail-closed base case, so
 * a projection that ever forgot the withdrawal would consult both surfaces
 * rather than drop a path.
 */
export type OperandAttribution =
  | { readonly kind: "effect"; readonly effect: TokenEffect }
  | { readonly kind: "inert"; readonly effect: TokenEffect };

/**
 * The effect a user's `commandEffects` declaration establishes for a
 * command's operands (ADR 0013 §7).
 *
 * The head word must name a declared command exactly. A path-qualified head
 * (`./git`, `/usr/bin/git`) never does, because a declaration's key is a bare
 * basename by schema, so it names a program the user's declaration does not
 * describe.
 *
 * Descent is exact-word: the word after the command, or after a matched
 * subcommand, must be literal and equal a declared subcommand. Where an entry
 * declares subcommands and that word is computed or an option, the subcommand
 * that will run cannot be told, so the answer is unproven rather than the
 * entry's own effects (`git -C diff commit` must not read as `git diff`).
 *
 * Every `unlessOption` stem met on the way down guards the reached entry, and
 * a match anywhere in the unit withdraws the declaration: it retracts and
 * never substitutes. Undeclared is unknown.
 */
export function proveDeclaredEffect(
  declared: DeclaredCommandEffects,
  headWord: string,
  argWords: readonly ArgWord[],
): OperandAttribution {
  if (!Object.hasOwn(declared, headWord)) return UNPROVEN_ATTRIBUTION;
  const { scope, entry } = declared[headWord];
  const reached = descend(entry, argWords);
  if (reached?.entry.effects === undefined) return UNPROVEN_ATTRIBUTION;
  if (reached.guards.length > 0 && stemGuard(reached.guards)(argWords)) {
    return { kind: "effect", effect: RETRACTED_EFFECT };
  }
  return attributionOf(reached.entry.effects, DECLARED_SOURCES[scope]);
}

// ── Private helpers ────────────────────────────────────────────────────────

const UNPROVEN_ATTRIBUTION: OperandAttribution = {
  kind: "effect",
  effect: UNPROVEN_EFFECT,
};

const DECLARED_SOURCES: Readonly<Record<DeclarationScope, EffectSource>> = {
  global: "declared-global",
  project: "declared-project",
};

type DeclaredEffects = NonNullable<CommandEffectsEntry["effects"]>;
type SubcommandValue = NonNullable<CommandEffectsEntry["subcommands"]>[string];

/** The entry a descent reached, with every guard met on the way down. */
interface ReachedEntry {
  readonly entry: CommandEffectsEntry;
  readonly guards: readonly string[];
}

/**
 * Follow declared subcommands down the leading argument words, or answer
 * `undefined` when a word where a subcommand belongs cannot be read.
 */
function descend(
  root: CommandEffectsEntry,
  argWords: readonly ArgWord[],
): ReachedEntry | undefined {
  let entry = root;
  const guards = [...(root.unlessOption ?? [])];
  for (const word of argWords) {
    const { subcommands } = entry;
    if (subcommands === undefined) break;
    if (word.computed || word.value.startsWith("-")) return undefined;
    if (!Object.hasOwn(subcommands, word.value)) break;
    entry = asEntry(subcommands[word.value]);
    guards.push(...(entry.unlessOption ?? []));
  }
  return { entry, guards };
}

/** A shorthand subcommand value is its entry's effects. */
function asEntry(value: SubcommandValue): CommandEffectsEntry {
  if (typeof value === "string" || Array.isArray(value)) {
    return { effects: value };
  }
  return value;
}

function attributionOf(
  effects: DeclaredEffects,
  source: EffectSource,
): OperandAttribution {
  const declared = new Set(typeof effects === "string" ? [effects] : effects);
  const reads = declared.has("read");
  const writes = declared.has("write");
  if (!reads && !writes) {
    return { kind: "inert", effect: { effect: "unproven", source } };
  }
  if (reads && writes) {
    return { kind: "effect", effect: { effect: "unproven", source } };
  }
  return {
    kind: "effect",
    effect: { effect: reads ? "read" : "write", source },
  };
}
