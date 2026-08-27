/**
 * A filesystem effect an access can have.
 *
 * ADR 0013 §2 reserves a third value, `delete`, as strictly stronger than
 * `write`; it is not shipped, so nothing can name it in a config or a proof.
 */
export type Effect = "read" | "write";

/**
 * An effect attribution, including the fail-closed base case.
 *
 * `unproven` is not a third effect — it is the absence of a proof, and ADR
 * 0013 §10 makes it consult both directional surfaces, most-restrictive.
 */
export type AttributedEffect = Effect | "unproven";

/**
 * What established an attribution — the blame fact ADR 0013 §7 asks the review
 * log to record.
 *
 * `retracted` is distinct from `unproven` on purpose: "nobody claimed anything
 * about `pnpm`" and "`find` is a core reader but `-delete` withdrew the claim"
 * are different diagnoses, and only the second names a line to read.
 */
export type EffectSource = "syntax" | "core" | "retracted" | "unproven";

/** A path token's attributed effect, paired with what established it. */
export interface TokenEffect {
  readonly effect: AttributedEffect;
  readonly source: EffectSource;
}

/** The fail-closed base case: no proof, and nothing to blame for its absence. */
export const UNPROVEN_EFFECT: TokenEffect = {
  effect: "unproven",
  source: "unproven",
};

/**
 * Combine two attributions of the same resolved path.
 *
 * Agreement keeps the effect, and prefers whichever source has something to
 * blame — a `retracted` attribution survives a merge with a bare unproven
 * whichever order the two tokens were collected in. Order-independence
 * matters because collection order is an accident of the command's shape, and
 * the blame line is the only reason the source is recorded at all.
 *
 * Disagreement falls to {@link UNPROVEN_EFFECT}, because proven-both and
 * unproven-at-all consult the same two surfaces — ADR 0013's 2026-08-25
 * amendment reads them as one mechanism, not two — which is what makes the
 * fold honest rather than lossy.
 */
export function mergeTokenEffects(a: TokenEffect, b: TokenEffect): TokenEffect {
  if (a.effect !== b.effect) return UNPROVEN_EFFECT;
  return a.source === "unproven" ? b : a;
}
