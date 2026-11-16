/**
 * The zod source of truth for the model-judge extension config.
 *
 * The config carries the *model mechanism* half of ADR 0007's config split
 * (provider / model / instructions / patterns / timeout); the *chain policy*
 * half (`authorizerChain`, the delegation envelope) lives in
 * `@gotgenes/pi-permission-system`. This package reads only what it uses.
 */

import { z } from "zod";

/** Extension id — the `extensions/<id>/config.json` path segment. */
export const MODEL_JUDGE_EXTENSION_ID = "pi-permission-model-judge";

/** Canonical URL of the published config JSON Schema (the root `$id`). */
export const MODEL_JUDGE_SCHEMA_URL =
  "https://raw.githubusercontent.com/gotgenes/pi-packages/main/packages/pi-permission-model-judge/schemas/model-judge.schema.json";

/**
 * The most entries any config array accepts. zod checks `.max()` before it
 * walks the elements, so an oversized array costs one issue rather than one per
 * entry (CVE-2023-54404); an unbounded array has no such guard.
 */
const MAX_CONFIG_ARRAY_ITEMS = 1000;

/** Default per-review model-call budget, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Operator-owned config for the deny-first typo-path reviewer.
 *
 * An empty or absent `typoPatterns` makes the reviewer defer everything —
 * installing the package and naming it in `authorizerChain` without configuring
 * patterns is a safe no-op (nothing is auto-denied).
 */
export const modelJudgeConfigSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  instructions: z.string().min(1),
  typoPatterns: z
    .array(z.string().min(1))
    .max(MAX_CONFIG_ARRAY_ITEMS)
    .default([]),
  timeoutMs: z.number().int().positive().default(DEFAULT_TIMEOUT_MS),
});

export type ModelJudgeConfig = z.infer<typeof modelJudgeConfigSchema>;

/**
 * Derive the published JSON Schema (Draft 2020-12) from the zod source, so an
 * editor can validate `config.json` against `$schema`. Regenerate the committed
 * file via `pnpm run gen:schema`; a parity test fails on drift.
 */
export function buildModelJudgeJsonSchema(): Record<string, unknown> {
  // `io: "input"` treats defaulted fields (`typoPatterns`, `timeoutMs`) as
  // optional — the config file is the input, and zod fills omitted defaults.
  const { $schema, ...rest } = z.toJSONSchema(modelJudgeConfigSchema, {
    target: "draft-2020-12",
    io: "input",
  });
  return { $schema, $id: MODEL_JUDGE_SCHEMA_URL, ...rest };
}
