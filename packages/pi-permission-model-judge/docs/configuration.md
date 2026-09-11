# Configuration

`@gotgenes/pi-permission-model-judge` reads one config file per scope, following the standard `@gotgenes/pi-*` convention.

- Global: `~/.pi/agent/extensions/pi-permission-model-judge/config.json` (respects `PI_CODING_AGENT_DIR`).
- Project: `<cwd>/.pi/extensions/pi-permission-model-judge/config.json`.

The project file overrides the global one field-by-field; array fields (`typoPatterns`) replace wholesale rather than merging.
Point your editor at the bundled [JSON Schema](../schemas/model-judge.schema.json) via `$schema` for completion and validation.

## Two config files, one link name

This extension owns only the *model mechanism*.
The *chain policy* — whether the link runs at all, and its order — lives in `@gotgenes/pi-permission-system`.
The two files are joined only by the link name `model-judge`:

```jsonc
// pi-permission-system config.json — the safety policy
{ "authorizerChain": ["model-judge"] }
```

```jsonc
// pi-permission-model-judge config.json — the model mechanism
{
  "provider": "anthropic",
  "model": "claude-haiku-4-5",
  "instructions": "…",
  "typoPatterns": ["…"]
}
```

The link decides nothing until you name it in `authorizerChain` (opt-in activation), and pi-permission-system caps any link's authority, so this extension can only ever deny or defer an `external_directory` ask — never widen access.

## Fields

| Field          | Type       | Default  | Description                                                                                      |
| -------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------ |
| `provider`     | `string`   | required | Model provider, resolved against Pi's model registry (must have credentials configured in Pi).   |
| `model`        | `string`   | required | Model id within that provider.                                                                   |
| `instructions` | `string`   | required | The model's system prompt: describe what a typo path is and the correct-location reason to give. |
| `typoPatterns` | `string[]` | `[]`     | Regular expressions matched against the candidate path; only a match reaches the model.          |
| `timeoutMs`    | `integer`  | `5000`   | Per-review model-call budget in milliseconds. A timeout defers.                                  |

### `provider` and `model`

The reviewer resolves `provider` / `model` against the session's model registry at review time.
If the model does not resolve (wrong id, no credentials), the reviewer records a `model-unresolved` decision entry and defers — it never blocks an ask because the judge is misconfigured.

### `instructions`

This is the model's system prompt.
Describe the typo shape you care about and instruct the model to give the wrong segment and the correct location, so the invoking agent can self-correct.
The reviewer forces the model to call a single `report_verdict` tool, so the verdict is read from structured tool-call arguments rather than parsed from free text — a `deny` verdict with a `reason` rejects the path, and anything else (including no tool call) defers.
The forcing value is chosen per provider API: Anthropic, Google, Bedrock, and Mistral spell it `any`, the OpenAI-family APIs spell it `required`, and an API the judge does not recognize gets `required`.
The entry's `api` and `toolChoice` fields record which was used.

### `typoPatterns`

Each string is compiled with `new RegExp(pattern)` (no flags) and tested against the candidate path.
The candidate path is a file tool's path argument (`read`/`edit`/`write`) or an external path referenced inside a `bash` command — both surfaces are matched the same way.
Only a path that matches at least one pattern is sent to the model — this is the cost gate that keeps the reviewer from calling the model on every ask.
An invalid regular expression is skipped and recorded in the debug log (`model_judge.invalid_patterns`).
An empty list (the default) matches nothing, so the reviewer defers everything.

Two typo shapes are worth featuring, each as its own pattern:

```json
"typoPatterns": [
  "([^/]+)/packages/\\1(/|$)",
  "development/pi/(?!pi-packages/)pi-[^/]+(/|$)"
]
```

The first catches a **doubled package segment** — a package name repeated around `packages/`, e.g. `pi-permission-system/packages/pi-permission-system/…`.
The `\1` backreference requires the segment before and after `packages/` to be identical, so it catches `<name>/packages/<name>` for every `<name>` while leaving a correct `packages/<name>/…` path untouched. (In JSON the backslash is doubled — `\\1` — so the parsed string is the regex `\1`.)

The second catches a **dropped repository prefix** — a path that jumps straight to a package directory (`development/pi/pi-permission-system/…`) instead of routing through the repo's `pi-packages/packages/` directory.
The negative lookahead `(?!pi-packages/)` exempts the correct `pi-packages` path, and `pi-[^/]+` requires a package segment after `pi-` so the sibling monorepo at `~/development/pi/pi` is left alone.

Both patterns anchor the segment with `(/|$)`, not a bare trailing `/`, so a path that *ends* at the offending segment (`…/pi-permission-system`) still matches.
Adjust the `development/pi/…` prefix to wherever your checkouts live.

### `timeoutMs`

The model call is aborted after this many milliseconds, and an aborted call defers.
Keep it short — the reviewer sits in front of an interactive prompt.

## Fail-safe behavior

Every uncertain outcome defers, which sends the ask to the normal permission prompt:

- no config, or an invalid config;
- a surface other than `external_directory`;
- a path matching no `typoPatterns`;
- an unresolved model, a timeout, an unparseable reply, or an unsure verdict.

Deferring never grants access — this extension emits no `allow` verdict.

## The decision trail

The reviewer records what it did to pi-permission-system's shared logs, keyed by `requestId` so an entry joins to the `permission_request.*` lines for the same ask.
This closes the observability gap that let an auth failure defer every path undetected: a silent defer is now a recorded defer with a reason.

The **review** log (`~/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl`, on by default via pi-permission-system's `permissionReviewLog`) carries one `model_judge.decision` entry per **pattern-matched** ask — the case that should reach the model:

| Field            | Meaning                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `requestId`      | The ask id, shared with the `permission_request.*` entries.                                                                  |
| `surface`        | Always `external_directory` (the only reviewed surface).                                                                     |
| `path`           | The candidate path reviewed.                                                                                                 |
| `matchedPattern` | The `typoPatterns` entry, as written, that matched.                                                                          |
| `modelCalled`    | `false` for a `model-unresolved` / `auth-failed` defer.                                                                      |
| `modelId`        | `<provider>/<model>`.                                                                                                        |
| `latencyMs`      | Model-call wall-clock in milliseconds, or `null` when no call was made.                                                      |
| `api`            | The provider API the call was addressed to, or `null` when no call was made.                                                 |
| `toolChoice`     | The forcing value sent (`any` or `required`, per API), or `null` when no call was made.                                      |
| `verdict`        | `"deny"` or `"defer"`.                                                                                                       |
| `deferReason`    | `null` on a deny, else `model-unresolved` / `auth-failed` / `no-tool-call` / `non-deny-verdict` / `timeout` / `call-failed`. |

The **debug** log (same directory, `pi-permission-system-debug.jsonl`, only when pi-permission-system's `debugLog` is on) carries the verbose and cheap-path detail: `model_judge.short_circuit` (a `no-path` or `pattern-miss` defer before the model stage), `model_judge.model_reply` (the verdict tool-call arguments as JSON, or the model's text when it emitted no tool call), and `model_judge.invalid_patterns` (skipped `typoPatterns`).
A non-`external_directory` ask is not logged at all.

To diagnose "the judge defers everything," read the review log for `model_judge.decision` entries and inspect `deferReason`: an empty result means no ask ever matched a pattern, `auth-failed` / `model-unresolved` means it is misconfigured, `non-deny-verdict` means the model saw the path and chose not to deny, and `no-tool-call` means the model replied without calling the verdict tool.
For a run of `no-tool-call` entries, check the same entry's `api` and `toolChoice`: the tool is forced per provider API, so a spelling that provider does not accept is discarded silently and the model answers in prose.
That is what made the judge inert on every OpenAI-compatible provider before the per-API mapping landed.
