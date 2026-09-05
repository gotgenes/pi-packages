---
status: accepted
date: 2026-07-25
---

# 0010 — Permission logs are mode-restricted and key-name redacted, not secret-detected

## Status

Accepted.
This decision states what the permission logs protect against and what they do not, so a report of the shape "the log contains a secret" can be triaged against a written contract rather than re-argued.

## Context

The permission review log is enabled by default and records every gate decision.
Two of its fields carry payload rather than metadata: `command`, the complete bash command string, and `toolInputPreview`, a serialized JSON preview of a non-bash tool's input bounded at 1000 characters.
The debug stream carries the same payload again when `debugLog` is on.

[#647], a third-party report, observed that these values are persisted without redaction and that the files are appended without an explicit mode, so their permissions follow the process umask.
Both observations were accurate.
Measured on the reporter-equivalent installation, the review log was 6.7 MB across 8380 lines with mode 0644 — world-readable — and the logs directory 0755.

The report proposed two remedies: redact common secret forms before persistence, and create the files owner-only.
These address different adversaries, and conflating them is what makes the issue recur.

| Adversary                                    | Closed by owner-only modes                                                                                                                                    | Closed by redaction                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Another local user on a shared host          | Yes, completely                                                                                                                                               | Redundant                                                     |
| A backup or cloud-sync agent copying `~/.pi` | No — it runs as the user                                                                                                                                      | Yes                                                           |
| The user pasting a log excerpt into an issue | No                                                                                                                                                            | Partially                                                     |
| The agent reading its own log                | Already closed — the logs directory is outside the session cwd, so the `external_directory` gate prompts, and `isPiInfrastructureRead` does not auto-allow it | Only relevant where the operator has allowed `~/.pi/**` reads |

## Decision

### Owner-only modes, unconditionally

Both JSONL logs are created `0600` and the logs directory `0700`; permission-forwarding request and response files and their directories likewise.
Because a `mode` option applies only when the call creates the path, each log is additionally `chmod`-ed once per session on first write — an installation predating this change would otherwise keep its world-readable log indefinitely.

`mkdirSync`'s `recursive` mode applies to every directory it creates, so a fresh install also gets an owner-only extension config directory.
Directories that already exist are never modified, so an operator's chosen layout above the logs directory is untouched.

### Key-name redaction, not value-shape detection

A value bound to a key named `authorization`, `token`, `secret`, `password`, `passwd`, `credential`, `cookie`, `api_key`, or `private_key` (case-insensitive, separator-tolerant) is masked with `[redacted]` before serialization.

The technique is deliberately **structural rather than predictive**: a value is masked because of the name it is bound to, never because of what it looks like.

This is applied at two points, and the second is not redundant:

1. `writeLine` in `src/logging/logging.ts` — the single point where either stream reaches disk, covering any call site that logs a nested object.
2. `serializeRedactedToolInputPreview`, reached from `formatGenericToolInputForLog` — because `getToolInputPreviewForLog` flattens the tool input to a string *before* the details record reaches the writer, so by point 1 its keys no longer exist to match.

Point 2 is what closes the reporter's literal repro.

### The prompt is never redacted

`formatToolInputForPrompt` and the forwarding request/response files stay unredacted.
The user must see the real input to make a permission decision, and the forwarding files exist so the parent can render that prompt.
Masking either would blind the approver — a permission regression dressed as a security fix.

## Alternatives considered

### Value-shape secret detection — declined

A provider-prefix list (`sk-`, `ghp_`, `AKIA`, `xox`, `Bearer`, PEM markers) or an entropy heuristic.

Declined on measured evidence.
Probing the live 6.7 MB review log for exactly those shapes:

| Probe                                                        | Hits | What they were                                                                                                                                                                           |
| ------------------------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sk-`                                                        | 403  | 356 the tail of `task-approval`, 275 of `task-user`, 146 of `task-no-ui` — all substrings of `task-*`. The 4 genuine `sk-ant-oat…` shapes sat inside a grep pattern the agent had typed. |
| `xox`                                                        | 2    | Inside the tool-use id `toolu_01VdGtvuHfmxox86kCCkY3`.                                                                                                                                   |
| `API_KEY`                                                    | 8    | The literal env-var **name** `ANTHROPIC_API_KEY`; no value.                                                                                                                              |
| `Bearer `, `ghp_`, `github_pat_`, `AKIA`, `AIza`, `password` | 0    | —                                                                                                                                                                                        |

Anchoring the patterns would fix those particular false positives, but the corpus contained **zero true positives**, so the list would be pure maintenance burden.
More decisively, its failure boundary is unstatable: a redactor that silently misses a key is worse than a documented warning, because it invites treating the log as safe to share.

This is the same reasoning already recorded for [#599] and `docs/decisions/0007-model-judge-authorizer-chain-adr.md`, where a hard-coded secret denylist was declined because the codebase has no formal secrets model.
Secret *detection* is a product category (gitleaks, trufflehog, detect-secrets) with hundreds of continuously-maintained rules; the logging ecosystem's own answer — pino's `redact`, Winston's formats, Serilog's destructuring policies — is uniformly declarative key-path masking, not detection.

### Grammar-anchored bash redaction — declined for now, the option a future report reopens

The package already parses every bash command into a tree-sitter AST and already walks `variable_assignment` nodes to strip env prefixes ([#481]) and embedded option values ([#645]).
Masking the value side of an assignment whose name is sensitive, and the argument following `--token`/`--password`, would extend coverage to `FOO_TOKEN=abc deploy` with near-zero false positives, because it operates on parse nodes rather than on a guess about what a string looks like.

Not taken here: it is materially more work than the key-name pass, and no reported case yet demands it.
It is recorded as the concrete next step should a report show a secret reaching the log through a command string.

### Making raw payload logging opt-in — declined

Flipping `permissionReviewLog` to `false`, or gating `command`/`toolInputPreview` behind a new `logToolInput` flag.

Declined as a breaking change that trades away the package's stated priority that block/ask/allow decisions stay reviewable by default.
`matchedPattern` without `command` makes "what exactly did the agent run at 14:32" unanswerable, which is the main reason to read this log.

### A downstream redactor registry — declined

A `PermissionsService.registerLogRedactor(name, redact)` mirroring `ToolInputFormatterRegistry` / `ToolAccessExtractorRegistry` / `AuthorizerRegistry`.

Structurally cheap and low-novelty, but it would ship with zero consumers, which is precisely the maintenance trap the package's own guidance warns against.
Revisit if a concrete downstream asks.

## Consequences

- The stated boundary, which every user-facing mention repeats verbatim: **a value bound to a sensitive key name is masked; a secret embedded in a bash command string is not.**
- A key legitimately named `token` carrying a non-secret now reads `[redacted]` in the log.
  Accepted: the key set is narrow, and every structured field the gate logs (`toolName`, `action`, `reason`, `matchedPattern`, `origin`, `resolution`) falls outside it.
- The change is POSIX-effective only.
  On Windows `chmod` toggles only the read-only bit and the `mode` options are ignored, so the files there are governed by NTFS ACL inheritance.
  The `chmod` failure is swallowed rather than warned about, because a warning every session on Windows would be noise.
- A custom formatter registered through `ToolInputFormatterRegistry` returns an opaque string for a path-bearing tool, which this change cannot mask.
  A registrant emitting credentials into a log preview is responsible for its own output.
- Because a hardening failure never throws, no new failure mode reaches the fail-closed tool-call boundary.

[#481]: https://github.com/gotgenes/pi-packages/issues/481
[#599]: https://github.com/gotgenes/pi-packages/issues/599
[#645]: https://github.com/gotgenes/pi-packages/issues/645
[#647]: https://github.com/gotgenes/pi-packages/issues/647
