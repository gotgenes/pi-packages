---
status: accepted
date: 2026-07-24
---

# 0009 — The bash path projection is a completeness contract, not a best-effort heuristic

## Status

Accepted.
This decision states the contract the bash path projection upholds, and settles how a "the gate missed my path" report is triaged.
It is the framing for [#645], which closes two gaps the contract names as in-scope; it composes with `docs/decisions/0003-git-bash-posix-path-semantics.md` (win32 token shapes) and `docs/decisions/0007-model-judge-authorizer-chain-adr.md` (the judge that absorbs false positives).

## Context

The bash path gates decide which argument tokens of a shell command are filesystem operands, so the `path` and `external_directory` surfaces can rule on them.
This projection has been patched five times in response to individual bypass reports:

- [#494] / [#509] — bare filenames (`cat id_rsa`) bypass the `path` surface; fixed with rule-driven promotion, matching the **raw token** against specific non-`*` `path` rules.
- [#520] — win32 backslash-relative tokens (`dir\file`) are not recognized as path-shaped.
- [#533] — Git Bash/MSYS POSIX-absolute tokens resolve wrongly on win32.
- [#583] — a bare `/` (filesystem root) is rejected before the path surfaces.
- [#645] — a bare in-project **symlink** whose *target* is denied, and a path embedded in an option (`--file=/tmp/patterns`).

Each fix was correct in isolation, and each was followed by another report of the same shape.
That recurrence is the signal worth acting on: the reports are not independent bugs but repeated encounters with an unstated boundary.

The structural cause is that token classification was **binary** — a token is a path candidate or it is not — while the domain is **three-valued**:

- **Definitely a path** — the shape says so (leading `/`, `~/`, `..`, a separator, a drive letter).
- **Definitely not a path** — the shape rules it out (a flag, a URL, an env assignment, an `@scope` package, a regex).
- **Unknown** — a bare word (`status`, `id_rsa`, `outside-link`), which may name a file or may be a subcommand, branch, or search pattern.

Binary classification collapses *unknown* into *not a path*, and that collapse is silent and fail-open: an unknown token is dropped before any gate sees it, so a permissive bash rule (`cat *`) decides the call and the `path`/`external_directory` policy never runs.
[#509] addressed one slice of *unknown* by consulting the ruleset, which coupled the classifier to policy and still missed any token whose **resolved** identity — not its spelling — is what a rule names.
A symlink is exactly that case: `outside-link` matches no rule by name, and its target is never computed because promotion is decided before resolution.

## Decision

### The principle — candidacy from the filesystem, decision from policy

The projection resolves *unknown* with the filesystem rather than with the ruleset:

> A bare token is a path candidate **iff it names an existing filesystem entry**.
> A promoted candidate is then gated by explicit `path`/`external_directory` rules, or by resolving outside the working tree — never by the universal fallback.

Candidacy and decision are separate concerns with separate sources.
Candidacy asks "is this a file?"
and the filesystem answers authoritatively.
Decision asks "may it be touched?"
and the composed ruleset answers.
The classifier therefore needs no knowledge of policy, and policy needs no knowledge of token spelling.

The universal-fallback exclusion is what keeps this from becoming a prompt firehose, and it needs no new mechanism: `describeBashPathGate` already treats a check whose `matchedPattern` is `undefined` — only the synthesized universal default matched — as unrestricted ([#58]), and `permission-manager.ts` sets `matchedPattern` only for `config`/`session`-layer rules.
A promoted token that matches no explicit rule is therefore unrestricted for free.

### What the projection guarantees

A path reaches the `path` and `external_directory` surfaces when it appears as:

- A **shape-classified token** — absolute (`/x`), home-relative (`~/x`), parent-traversal (`../x`), separator-bearing (`a/b`), a Windows drive-letter path (`C:/x`, `D:\x`), or — under the win32 flavor — a backslash-relative token (`dir\file`, [#520]).
- A **redirect target** (`> out.txt`, `2>/tmp/log`).
- A **value embedded in a long option** (`--file=/tmp/patterns`), split at collection time and classified by the ordinary shape rules ([#645]).
- A **bare token naming an existing filesystem entry** — the existence probe ([#645]).
  Its canonical (symlink-resolved) form is what policy matches, so a symlink is gated by rules naming its target ([#493]).
- A **plain `$HOME` / `${HOME}` / `$PWD` / `${PWD}` reference**, resolved at token collection before classification ([#694]).
  `$HOME/x` is therefore gated exactly as `~/x` and as the literal absolute spelling, independent of whether the target exists; `$PWD/x` is gated exactly as `./x`.
- Any of the above resolved against the **effective working directory** after literal current-shell `cd` folding; a non-literal `cd` renders the base unknown and keeps tokens literal-only ([#393]).

These guarantees are **positional-invariant**: they hold for a command's own operands wherever that command appears.
A command nested in a substitution is itself gated ([#306]), so its operands are projected whether the substitution sits in argument position (`diff <(cat /etc/shadow)`), in a redirect destination (`echo hi > $(cat /etc/shadow)`), or in an interpolating heredoc body ([#741]).
This is a guarantee, not a residual — see the note under "Computed paths" below for the boundary it is easily confused with.

Opacity is handled separately and conservatively: a wrapper command that hides its payload (`bash -c`, `eval`, `sudo`, `xargs`, …) is floored from `allow` to `ask` rather than projected.

### What the projection deliberately omits

These are **accepted residuals**, not open bugs:

- **Nonexistent bare write targets** (`touch newfile`, `mv a newfile`) — the probe cannot see a file that does not exist yet.
  Redirect targets, the common creation path, are collected separately and unaffected.
- **Glued short-option values** (`-f/tmp/x`) — distinguishing a glued value from a cluster of boolean flags (`-rf`) requires per-command option knowledge.
- **Computed paths** other than the plain `HOME`/`PWD` references above — any other `$VAR`, a command substitution (`$(cmd)`), an operator-bearing expansion (`${HOME:-/tmp}`, `${#HOME}`), and a variable reached through an assignment (`CURRENT="$HOME"; ls "$CURRENT"`).
  The residual here is the **value the substitution evaluates to** — the filename `> $(cmd)` ultimately writes to is not knowable without running `cmd`.
  It is **not** the nested command's own literal operands, which the positional-invariance guarantee above covers.
  Reading this bullet as sanctioning the latter is what let [#741] persist.
  Where a computed value affects the working directory, the unknown-base machinery already degrades conservatively.
  Two ways to close the assignment case were considered and declined during [#694], measured over 2767 deduplicated real bash commands from the permission review log: same-program literal-assignment dataflow, which reaches **45 (1.6%)** of commands but adds stateful dataflow to the AST walk; and flooring any command carrying an unresolved-expansion path operand to `ask`, which would newly prompt on **194 (7.0%)** — the prompt-firehose outcome this ADR rejects for the bare-token case below.
- **Per-command argument semantics** — which positional argument of `grep`/`git`/`kubectl` is a file.
  `PATTERN_FIRST_COMMANDS` encodes a deliberately small exception for pattern-first commands; generalizing it means shipping and maintaining an option table per tool.

### The layering principle — surface deterministically, discriminate with judgment

The deterministic layer biases toward **surfacing**: when a token could be a real operand, it becomes an `ask` rather than a silent allow.
It does not try to decide whether an ask is *warranted* in context — that is the model-judge Authorizer chain's job ([#620], ADR 0007), which reviews a surfaced ask with the full command in view and can dismiss `git grep id_rsa` as a search pattern.

The asymmetry justifying this split: **over-suppression is unrecoverable, over-surfacing is recoverable.**
A path silently dropped is a bypass with no later opportunity to catch it; a path surfaced unnecessarily is a prompt a human or a judge link resolves.
So the deterministic layer never trades a missed operand for a quieter prompt, and per-command cleverness belongs above it, not inside it.

### Determinism and the filesystem

Filesystem state is part of the decision input: existence (this ADR) and symlink targets ([#493]).
The invariant is therefore stated over that input — *same policy + same filesystem state + same command → same decision* — not over the command alone.

This is not a new concession.
Canonicalization made resolution filesystem-dependent when it shipped, and it is the only sound treatment: a symlink's meaning simply is not a property of its name.
Ambient, non-filesystem host state (environment variables, which shell binary was resolved, `cygpath` output) remains excluded, per ADR 0003 — with two named, closed exceptions ([#694]):

- **`HOME`**, resolved via `os.homedir()`.
  This is not a widening: `expandHomePath` already resolved `~` and `$HOME` in config rule patterns, `piInfrastructureReadPaths`, and path policy literals, so the exception existed and only the bash projection disagreed with it.
- **`PWD`**, resolved to the projection's own effective base.
  It reads no environment at all, so it is strictly more deterministic than `HOME`.

The set is closed: adding a third name is an ADR amendment, not an implementation detail.
Every other variable keeps its literal text, so ADR 0003's rejection of `cygpath` shell-outs and MSYS environment detection stands untouched.

Empirically the probe is highly selective: over 2358 deduplicated real bash commands from the permission review log, 3535 bare tokens survived the rejection prelude and **118 (3.3%)** named an existing entry.
Cost is ~0.04 ms p95 per command, ~19% of the already-paid tree-sitter parse.

## Rejected alternatives

- **Promote every bare token to the `path` surface (literal read-tool parity).**
  Rejected: the universal fallback defaults to `ask`, so every bare argument of every command (`git status`, `npm run build`) would prompt.
  Parity with the read tool is the wrong target — a read-tool input is known to be a path, and a bash argument is not.
- **Keep rule-driven promotion and widen it** (match `*` patterns, or match canonical forms too).
  Rejected: it couples the classifier to the ruleset, makes candidacy depend on policy shape, and — matching spelling rather than identity — still cannot see that `outside-link` is `.some.secret`.
- **Floor to `ask` whenever a bare token cannot be proven safe.**
  Rejected: this defeats any `bash` allow rule under a restrictive path policy, which is the configuration users reach for precisely to reduce prompting.
- **Per-command argument tables.**
  Rejected as a deterministic-layer mechanism: unbounded maintenance surface, and it duplicates in brittle static data what the judge link ([#620]) does with the command in context.

## Consequences

- A "the bash gate missed my path" report is now triaged against this contract: it is either **inside** it (a bug — the projection failed a guarantee) or **outside** it (an accepted residual, or a judge-layer concern).
  This is the durable outcome; the recurrence in Context was a symptom of having no such test.
  [#694] is the first report triaged this way, and it split: its `$HOME`/`${HOME}` half was **inside** (the package resolved `$HOME` for patterns and path literals but not for bash tokens, so a guarantee was inconsistently met) and was fixed; its assignment-dataflow half was **outside** and was declined with the numbers above.
  A single report landing on both sides is the expected outcome of having the line drawn.
- [#741] is the second report triaged this way, and it landed **inside**: a substitution's operands were projected in argument position but not when the substitution sat in a redirect destination or an interpolating heredoc body, so a guarantee was met inconsistently across positions — the same shape as [#694]'s `$HOME` half.
  The fix names the hosting concept once (`EXECUTION_HOST_TYPES` in `access-intent/bash/nested-execution.ts`), shared by the command surface and the path surface so the two cannot drift on what counts as a nested execution.
  Measured over 2950 deduplicated real bash commands, **0** hosted a substitution in a redirect target and **0** carried an unquoted heredoc with one, so closing it produced no new prompting on realistic traffic.
- The [#509] promotion thread is deleted: `PathRuleTokenMatcher`, `PermissionManager.getPromotablePathTokenMatcher`, and the five-layer parameter thread from manager to resolver.
  The classifier is once again pure and policy-free.
- `PathNormalizer` gains `entryExists`, keeping the filesystem edge in the same object that owns canonicalization; the classifiers stay pure shape functions.
- Bare tokens naming existing files become gateable, so a config using `path`/`external_directory` denies now sees operands it previously missed — a breaking behavior change on upgrade ([#645]), remediated with `path`/`external_directory` allow patterns.
- Expansion resolution lives at token collection (`resolveNodeText` → `shell-variable-expansion.ts`), never in the classifiers.
  Teaching `classifyTokenAsPathCandidate` a `$HOME` prefix instead would have put the home-directory vocabulary in a second place and reproduced the drift that caused [#694]; resolving upstream keeps the classifiers pure shape functions that need no per-variable knowledge.
- The probe adds one `lstat` per prelude-surviving bare token with a known base.
  If a future workload makes that cost material, the fallback is to gate the probe on "any explicit `path`/`external_directory` restriction exists in config" — a pipeline-level consult that still keeps the classifier policy-free.

[#58]: https://github.com/gotgenes/pi-packages/issues/58
[#393]: https://github.com/gotgenes/pi-packages/issues/393
[#493]: https://github.com/gotgenes/pi-packages/issues/493
[#494]: https://github.com/gotgenes/pi-packages/issues/494
[#509]: https://github.com/gotgenes/pi-packages/issues/509
[#520]: https://github.com/gotgenes/pi-packages/issues/520
[#533]: https://github.com/gotgenes/pi-packages/issues/533
[#583]: https://github.com/gotgenes/pi-packages/issues/583
[#620]: https://github.com/gotgenes/pi-packages/issues/620
[#645]: https://github.com/gotgenes/pi-packages/issues/645
[#694]: https://github.com/gotgenes/pi-packages/issues/694
[#306]: https://github.com/gotgenes/pi-packages/issues/306
[#741]: https://github.com/gotgenes/pi-packages/issues/741
