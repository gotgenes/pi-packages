---
issue: 639
issue_title: "pi-permission-system: decide the permission policy model — capabilities, config shape, prior art (ADR 0013)"
---

# ADR 0013 — permission policy model: capabilities, config shape, prior art

## Release Recommendation

**Release:** ship independently

This is a documentation-only decision record: it touches `docs/decisions/`, `docs/architecture/`, and `docs/troubleshooting.md`.
The first two are release-please `exclude-paths`, and a `docs:` commit is an unhidden changelog type, so at most it rides the next release rather than driving one — the same posture as the ADR 0007 plan ([#591]) and the ADR 0012 plan ([#786]).
The package carries no open improvement phase, so there is no release batch to sit mid-way through.
The decisions this ADR records are implemented later (starting with [#609]'s re-plan), and those changes release on their own merits.

## Problem Statement

Issue [#609] (third-party, filed by `hcrosse`) asks for output redirects to be governed separately from the command: an allowed bash command should not implicitly carry the right to write files through `>`/`>>`.
Planning it exposed a general gap: access direction/capability is not a first-class fact anywhere in the model — the cross-cutting `path` surface is direction-blind, and bash path tokens have no read/write identity at all.
The operator widened the question deliberately: rather than bolt on one key, decide the permission policy model itself, with nothing locked down going in — including the current config format.

The deliverable is ADR 0013, settled interactively during the build session.
The [#581] lesson applies in full: the deliberation is the deliverable; the ADR must record decisions actually made with the operator, not transcribe the sketches produced during planning.

The operator's decision criteria, stated verbatim in planning: clarity; simplicity ("straightforward, avoiding complex calculus of interactions between rules, and ambiguity"); designed for our users first.

### What changed since the first pass at this plan

This plan was first committed on 2026-07-23 (`3a113c11`) and was never executed.
Four things moved underneath it, and this revision folds them in.

The ADR slot it reserved was taken the next day.
`docs/decisions/0009-bash-path-projection-completeness-contract.md` landed 2026-07-24, followed by ADR 0010, ADR 0011, and ADR 0012.
The next free slot is **0013**; issue [#639]'s title was updated to match.

ADR 0009 became the governing record for the exact surface [#609] is about, and it must now be reconciled rather than ignored.

Two third-party contributions arrived and were routed here explicitly, each carrying an option the original option space did not contain: [#785] (closed as a duplicate of [#609]) and [#686] (open, with a PR offered).

The policy-source channel question was split off.
`docs/architecture/architecture.md` records both "which channels policy may enter through" and the capability-model question as open in [#639]; the operator's gate settled that this ADR decides the capability model and config shape only, carrying one section stating what constraints that shape imposes on any policy source, and that the channel set is decided by its own ADR — filed as [#799].

## Goals

- Author `docs/decisions/0013-permission-policy-model.md` deciding the future shape of the permission policy model, with every decision settled interactively during the `/build-plan` session.
- Survey prior art with citations before deciding — agent tools (OpenCode, Claude Code, Codex CLI) and capability systems (Deno permissions, Node's permission model, Linux Landlock, macOS Seatbelt, WASI preopens, systemd sandboxing, `nono`) — extracting each system's policy axis, naming, composition semantics, default stance, and unknown-handling.
- State the threat model explicitly in the ADR: a cooperative-but-fallible agent; attention routing, not containment; an OS sandbox as a candidate enforcement seam this design should be able to hand classifications to.
- Evaluate the full option space (O1–O8 in Design Overview) against the operator's criteria, recording rejected alternatives with reasons.
- Decide [#686] — whether delegating bash enforcement to an OS capability sandbox is adopted, and therefore whether the "this decides and records, it does not isolate" boundary stands, narrows, or is revised.
  The ADR's decision is the answer that closes or accepts that issue.
- Reconcile the decision with ADR 0009's bash path projection contract, which the model must compose with rather than contradict.
- State the constraints the settled shape imposes on any policy source, as the input [#799] consumes.
- Decide the staging: what [#609]'s implementation builds first, unblocking its re-plan.

## Non-Goals

- Implementing anything — no `src/`, `test/`, `schemas/`, `config/`, or `README.md` change; current behavior is untouched.
  Issue [#609] stays open and is re-planned after the ADR lands.
- Deciding which channels policy may enter through — split to [#799], which blocks [#675], [#692] (for [#691]), and [#638].
  This ADR supplies only the shape constraint that ADR consumes.
- Fixing the bare-nonexistent redirect-destination gap measured in Background, or correcting ADR 0009's guarantee wording that currently denies it.
  Both ride [#609]'s re-plan, so redirects are touched once; this plan's job is to record the measurement so that re-plan inherits it.
- Executing any config migration or renaming, even if the ADR decides one — implementation issues carry that work.
- Filing speculative follow-up issues for stages beyond [#609] (e.g. read-side wiring, a command-effects knowledge base, net-egress effects) — the ADR's staging section names them; filing happens during [#609]'s re-plan.
- Redesigning the live-authority layer (the ADR 0007 authorizer chain) or the cross-node contract (ADR 0012) — this ADR is about the deterministic policy model those layers consult, not about who holds live authority or how nodes reach each other.

## Background

### The current model, mapped

Every gated action has three independent facts: an actor (which tool/channel), an object (which path, command, server:tool, skill name), and a capability (read fs, write fs, execute, cross the cwd boundary).
Today's flat permission map expresses:

| Key today                             | Axis expressed                    | Notes                                            |
| ------------------------------------- | --------------------------------- | ------------------------------------------------ |
| `read`/`grep`/`find`/`ls`             | actor (implies capability: read)  | path-matched                                     |
| `write`/`edit`                        | actor (implies capability: write) | two keys, one capability; users must set both    |
| `bash`                                | actor (capability: exec)          | command patterns; decomposition + wrapper floors |
| `mcp`, `skill`, `special`, tool names | actor                             |                                                  |
| `path`                                | object, capability-blind          | any file access, any direction, any actor        |
| `external_directory`                  | boundary                          | outside-cwd guard, orthogonal to the above       |
| `*`                                   | universal fallback                |                                                  |

Composition is most-restrictive-wins across surfaces, last-match-wins within a surface.
OpenCode's model (the fork's origin) is actor-keyed with two guards; its only nod to direction is collapsing `edit`/`write`/`patch` into one `edit` key, and its bash gating is command-pattern only.

### Measured: what the bash path projection does with a redirect today

Run at planning time against the real projection (`BashProgram.parse` over a `PathNormalizer` rooted at a temp directory containing `existing.txt`), with the spike deleted afterward:

| Command                          | `path` rule candidates       | `external_directory`         |
| -------------------------------- | ---------------------------- | ---------------------------- |
| `cat /etc/hosts > out.txt`       | `/etc/hosts`                 | `/etc/hosts`                 |
| `cat /etc/hosts > existing.txt`  | `/etc/hosts`, `existing.txt` | `/etc/hosts`                 |
| `cat /etc/hosts >> existing.txt` | `/etc/hosts`, `existing.txt` | `/etc/hosts`                 |
| `cat /etc/hosts > /tmp/out.txt`  | `/etc/hosts`, `/tmp/out.txt` | `/etc/hosts`, `/tmp/out.txt` |
| `cat < existing.txt`             | `existing.txt`               | —                            |
| `echo hi > sub/new.txt`          | `sub/new.txt`                | —                            |

Two distinct facts fall out, and they are the ADR's concrete motivation.

The destination is projected when its shape qualifies (absolute, separator-bearing) or when it already exists via the [#645] probe, and dropped when it is bare and does not yet exist — the ordinary case for a creating redirect.
This contradicts ADR 0009, which lists "a **redirect target** (`> out.txt`, `2>/tmp/log`)" among the projection's guarantees and asserts under its nonexistent-bare-write-target residual that "redirect targets, the common creation path, are collected separately and unaffected."
Collection is real (`collectRedirectTokens`); classification then drops the token.
By ADR 0009's own triage rule this lands **inside** the contract — a guarantee met inconsistently across positions, the same shape as the [#694] `$HOME` half and the [#741] hosted-substitution gap — so it is a defect, not a residual.
Per Non-Goals it is fixed under [#609], together with the ADR 0009 wording correction; recording it here is what makes that inheritance reliable.

Where the destination *is* projected, it lands on the direction-blind `path` surface, indistinguishable from `cat < existing.txt`.
A `path` allow granted so an agent can read a file therefore also authorizes overwriting it.
That is [#609] in one line, and no key in the current model can express the difference.

### The engine seams that price the options

- `AccessIntent` (`tool` | `access-path`) carries a free-form `surface` string; the resolver and manager do not care what the keys mean.
  New surface keys are additive.
- Every policy channel speaks flat `(surface, pattern)` pairs: session-approval rules, the forwarded-intent wire ([#596]), the cross-extension `PermissionsService` queries, and per-agent frontmatter.
  A nested config shape would be flattened internally regardless; a format remodel churns all four channels.
- Since ADR 0012 the service is session-keyed and node-local, and `permissions:ready` carries `adjudicatesLocally`.
  A surface-key change is invisible to that contract — surfaces travel as strings — but a *shape* change that alters what a forwarded request carries is not, because ADR 0008 fixes a path-shaped ask's portable meaning at the child.
- The bounded-delegation envelope excludes authorizer `allow` on the `external_directory` and `path` surfaces by name (ADR 0007 §5).
  Any new capability surface must state where it sits relative to that exclusion, or a chain link silently gains a power the envelope was written to withhold.
- Redirect targets are collected by `collectRedirectTokens`, and `BashProgram.commands()` deliberately strips redirects from command text — 45% of real bash commands carry a redirect, so folding it back in would break exact-match rules wholesale.

### The evidence: capability keeps escaping pattern matching

The fork's history is a catalog of the same event — a capability escaping command-pattern rules through a syntactic synonym:

| Issue          | Escape channel                                                 |
| -------------- | -------------------------------------------------------------- |
| [#301]         | whole-string matching bypassed by chained commands             |
| [#306]         | command/process substitution executes unseen                   |
| [#393]         | `cd` folding; unknown bases must stay literal-only             |
| [#452]         | unparseable commands must fail closed                          |
| [#481]         | `bash -c`/`eval` opacity; env-var prefixes                     |
| [#490], [#575] | indirection wrappers (`sudo`, `env`, `xargs`, `find -exec`, …) |
| [#509]         | bare tokens invisible to shape classifiers                     |
| [#533]         | platform reinterprets the same token                           |
| [#574]         | other extensions re-expose bash under new names                |
| [#694]         | variable expansions the classifier read literally              |
| [#741]         | substitutions hosted in redirect targets and heredoc bodies    |
| [#742]         | commands inside control-flow bodies and declarations (open)    |
| [#609], [#785] | output redirects ride the command's allow                      |

The structural parts age well (`AccessPath` alias matching [#418], the boundary gate, fail-closed floors, determinism, and ADR 0009's completeness contract, which converted this recurrence into a triage rule); the command-spelling parts are a treadmill.
This evidence motivates the reframe the ADR must weigh: policy keyed by effects, with command patterns as evidence and refinement.

### The two contributed proposals

Both arrived after the first pass at this plan and are recorded here as inputs, not as decisions.

Issue [#785] (`pikujs`, closed as a duplicate of [#609]) proposed a distinct `redirect` permission surface, pattern-matched like `path`, with write provenance flagged on the AST (`>`, `>>`, `>|`, `&>`, `<>` are writes; `<`, `<<`, `<<<`, `>&` are not), destinations emitted unconditionally even when bare and nonexistent, write tokens fail-closed against the universal fallback, and `/dev/null`-style discards exempt at the gate.
The close comment recorded both that proposal and the bare-nonexistent-destination gap as input to [#639].
The measurement above independently confirms the gap.

Issue [#686] (open) proposes delegating bash enforcement to the [`nono`](https://nono.sh/) capability sandbox (Seatbelt on macOS, Landlock/seccomp on Linux, WSL2 on Windows), with a nested config shape:

```jsonc
{
  "permission": {
    "bash": {
      "read": { "*": "allow", "~/.ssh/*": "deny" },
      "write": { "*": "ask", "$WORKDIR/*": "allow" },
      "network": { "*": "deny", "*.github.com": "allow" }
    }
  }
}
```

It argues the AST projection cannot separate reads from writes, cannot see network access at all, and forces wrapper flooring that prompts on benign commands — and offers a PR.
It collides directly with a declared boundary: `docs/architecture/architecture.md`'s boundary table lists "Sandboxing or containment — this decides and records, it does not isolate," sourced to `docs/troubleshooting.md` §Threat Model ("This is a permission decision layer, not a sandbox").
The operator's gate placed [#686] in the option space as a full candidate the ADR decides, rather than citing the boundary at it — so the boundary itself is under review in this ADR, and whichever way it goes, both documents must end up agreeing with the ADR.

### Leanings from the planning conversation — explicitly not decisions

The operator unlocked everything ("none of the decisions we've explored today are locked-down"), so these are inputs to the deliberation, not settled outcomes:

- Naming leaning: `path_read`/`path_write` (path-family) over `fs.read`/`fs.write` — though the `fs` prefix is the cross-ecosystem convention (Node's `--allow-fs-read`/`--allow-fs-write`, Landlock `ACCESS_FS_*`, Seatbelt `file-read*`/`file-write*`), Deno-style bare `read`/`write` collides with our existing tool keys.
- Nesting (`path: { read: …, write: …, "*": … }`) was analyzed and found grammatically ambiguous: `path: { "read": "allow" }` is already a valid pattern rule matching a file literally named `read`, and the map-valued discriminator collides with `denyWithReason` object values.
  The analysis rides into the ADR; nesting remains evaluable as sugar over flat keys, and [#686]'s proposed shape nests one level deeper still (`bash.write.<pattern>`), which the same analysis must be applied to.
- An earlier gate (under the narrower flooring framing) chose a shipped default of `ask` for output-redirect writes (breaking, `feat!:`) — recorded as a leaning toward least-privilege defaults, explicitly reopened with everything else.
- The effect-centered sketch (effects primary; structural proof + a command-effects knowledge base + honest unknowns; `net` as a future effect; effect-level session approvals; sandbox-handoff seam) is one candidate among several, not the presumed target.

### Standing constraints

- Config files are the source of truth; no policy baked into code; a declared config field not read at runtime is a maintenance trap.
- Determinism: same policy + same input → same decision.
  ADR 0009 restates this over filesystem state as well (existence and symlink targets are decision input); ambient host state stays excluded per ADR 0003, with `HOME` and `PWD` as the two named, closed exceptions.
  Any option that reads more of the environment reopens that, and must say so.
- Least privilege and fail-closed stay non-negotiable; the composition semantics that deliver them are what the ADR may redesign.
- ADR 0009's layering principle — surface deterministically, discriminate with judgment, because over-suppression is unrecoverable and over-surfacing is recoverable — is the asymmetry any new model has to preserve or explicitly overturn.
- The architecture doc inline-copies the `rule.ts` types; this ADR changes no types, but any implementation that does must update that listing.
- ADR markdown follows the `markdown-conventions` skill (one-sentence-per-line, reference-style issue links, MD053 discipline).

## Design Overview

This plan deliberately does not settle the design.
It defines the decision framework the build session executes.

### Decision criteria

1. Clarity — a user can predict what a config does by reading it.
2. Simplicity — straightforward; avoid a complex calculus of interactions between rules.
   This criterion cuts at the multi-surface most-restrictive lattice itself, so composition semantics are on the table, not just key names.
3. No ambiguity — no config text with two plausible readings (the nesting analysis is the cautionary example).
4. User-first — ergonomics of authoring, reading prompts, and approving sessions outrank internal elegance.
5. Retained unless deliberately revisited: determinism, least privilege, fail-closed unknowns.

### Option space to evaluate

- O1 — status quo plus a targeted `path_write` key.
  Smallest change; fixes [#609]; direction stays a bolt-on.
- O2 — capability family as flat keys.
  `path_read`/`path_write` join `path` + `external_directory` as a capability/boundary layer; actor keys become refinement; most-restrictive lattice retained.
- O3 — nested facets under `path`.
  Grouping sugar; carries the documented grammar ambiguity; internally flattens to O2.
- O4 — effect-centered model.
  Effects primary (`fs read/write`, `exec`, later `net`), classified by structural proof, a curated command-effects knowledge base (consolidating `PATTERN_FIRST_COMMANDS`, the wrapper sets, `SAFE_SYSTEM_PATHS`), and an explicit unknown category the user must deliberately allow; flat keys; actor keys as refinement.
- O5 — full config remodel.
  A v2 format with capability domains primary and tools demoted; prices in a dual-format loader window and churn across all four flat-pair channels.
- O6 — single ordered rule list.
  A firewall-style model: one ordered list of typed rules (match on effect/path/command/tool → action), first- or last-match wins; trades the lattice's cross-surface calculus for explicit ordering.
  Included because criterion 2 questions the lattice; the ADR must evaluate whether ordering is simpler or merely different.
- O7 — a distinct `redirect` surface ([#785]).
  Direction becomes first-class only where it is structurally provable, leaving `path` untouched; narrower than O2 and already specified in implementable detail by a contributor.
  The ADR must weigh whether a surface named for a *syntax* rather than an effect repeats the pattern-matching treadmill under a new key.
- O8 — delegate enforcement to an OS capability sandbox ([#686]).
  Config becomes a sandbox-profile source; read/write/network separation and wrapper opacity are answered at the syscall boundary rather than by the AST.
  Prices in: a required external binary and its platform matrix, loss of the pre-execution prompt for anything the sandbox merely denies at runtime, determinism of the translation step, and the declared "not a sandbox" boundary.
  Not mutually exclusive with O2/O4 — the ADR should decide whether it is a replacement, a complementary enforcement tier, or declined.

### Prior-art survey scope

For each system, extract: policy axis (actor/capability/effect), key naming, composition and conflict semantics, default stance, unknown-handling, and prompt/escalation UX.

| System                | Why it matters                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------- |
| OpenCode              | the fork's origin; actor-keyed baseline                                                      |
| Claude Code           | agent-adjacent; `Tool(specifier)` allow/ask/deny lists + sandbox modes                       |
| Codex CLI             | agent-adjacent; approval modes paired with an OS sandbox                                     |
| Deno                  | cleanest capability flags (`--allow-read/--allow-write/--allow-net/--allow-run`)             |
| Node permission model | literally `--allow-fs-read`/`--allow-fs-write`                                               |
| Linux Landlock        | kernel fs capability rights (`ACCESS_FS_*`)                                                  |
| macOS Seatbelt        | operation-named profile rules (`file-read*`, `process-exec`)                                 |
| WASI                  | capability handles; preopened dirs; `path_open` rights                                       |
| systemd               | path-scoped mode lists (`ReadOnlyPaths=`, `ReadWritePaths=`)                                 |
| `nono`                | the concrete O8 candidate; its own policy vocabulary is what a translation step would target |

### Open parameters the build session settles interactively

1. Policy axis: actor-keyed (status quo), plus a capability layer, or effect-primary.
2. Composition semantics: retain the most-restrictive lattice, or simplify (O6-style ordering, or a narrower layer set).
3. Key naming and shape: `path_read`/`path_write` vs `fs`-prefixed vs nesting sugar vs a syntax-named `redirect` surface.
4. Unknown-effects stance: inert-when-absent vs an explicit unknown category in policy; and whether ADR 0009's surface-deterministically/discriminate-with-judgment asymmetry survives unchanged.
5. Defaults and breaking posture for redirect writes (leaning: shipped `ask` default, `feat!:` — reopened).
6. Whether the command-effects knowledge base becomes a named, curated asset (and when).
7. The [#686] verdict: sandbox delegation as replacement, complementary tier, or declined — and what happens to the "decides and records, does not isolate" boundary as a result.
8. The shape constraints any policy source must satisfy, written for [#799] to consume.
9. Staging: what [#609] implements first; which follow-ups the ADR names and where they get filed.

The gate protocol during `/build-plan`: complete the survey first, present findings and option evaluations, then run `ask_user` gates per parameter cluster before authoring a word of the ADR — decisions precede prose.

## Module-Level Changes

Documentation only.

- New: `packages/pi-permission-system/docs/decisions/0013-permission-policy-model.md` — the ADR: threat model, decision criteria, current-model inventory (including the measured projection table), prior-art survey with citations, options O1–O8 with rejected alternatives and reasons, the settled decisions (parameters 1–9), the shape constraints for [#799], staging, and consequences.
  The 0013 slot is next (0001–0012 taken); the file slug may sharpen at build time to reflect the settled decision, keeping the 0013 number.
- Changed: `packages/pi-permission-system/docs/architecture/architecture.md` — three specific edits plus a sweep.
  1. Line ~68's "not a boundary" paragraph currently assigns both the channel question and the capability question to [#639]; split it so the channel half points at [#799].
  2. Link ADR 0013 from the design-principles / boundary sections.
  3. If the [#686] verdict changes the sandboxing posture, update the boundary table row "Sandboxing or containment — this decides and records, it does not isolate" and its source column.
  Then grep the whole file for prose the settled decision contradicts (`most-restrictive`, `path` surface descriptions, `capability`, `sandbox`, aspirational policy prose) — the [#581] failure mode was un-reconciled prose surviving an internally consistent ADR.
- Changed (conditional): `packages/pi-permission-system/docs/troubleshooting.md` §Threat Model — it is the *source* the boundary table cites ("This is a permission decision layer, not a sandbox").
  If the ADR revises the sandboxing boundary, this must change in the same commit or the boundary table cites a contradiction.
  If the ADR reaffirms it, no edit.
- Not edited: `docs/architecture/history/*`, `docs/plans/*`, `docs/retro/*` — frozen point-in-time records; `README.md`, `docs/configuration.md`, `schemas/`, `config/` — they describe current behavior, which this ADR does not change; `.pi/skills/package-pi-permission-system/SKILL.md` — it documents current behavior and constraints, all still true, and the ADR changes no shipped mechanism.
- Not edited, deliberately: `docs/decisions/0009-bash-path-projection-completeness-contract.md`.
  Its guarantee wording is inaccurate (see Background), but correcting it belongs with the fix under [#609], not with a decision record about a different question.

Grep verification before the ADR is committed, since no symbol is added or removed and the ordinary `src/` grep finds nothing:

```bash
rg -n -i 'sandbox|containment' packages/pi-permission-system/docs packages/pi-permission-system/README.md
rg -n '#639' packages/pi-permission-system/docs .pi/skills
rg -n 'most-restrictive|capability' packages/pi-permission-system/docs/architecture/architecture.md
```

## Test Impact Analysis

Not applicable in the red→green sense — the deliverable is a decision record with no code.

The plan's own testable surface is the measurement in Background, which `/build-plan` re-runs rather than trusts.
The spike is a disposable vitest file constructing a `PathNormalizer` over a temp directory containing `existing.txt`, calling `BashProgram.parse(cmd, normalizer)`, and printing `pathRuleCandidates()` and `externalPaths()` for the six commands in the table.
Expected output is that table; the load-bearing row is `cat /etc/hosts > out.txt`, whose rule candidates must contain `/etc/hosts` and not `out.txt`.
If that row has changed by build time, the Background section and [#609]'s inheritance both need revising before the ADR is written.

Tests the settled design enables, recorded for [#609]'s re-plan to inherit: redirect-operator classification (output vs input vs fd-duplication, per [#785]'s operator split), unconditional projection of output-redirect destinations including bare nonexistent ones, capability-surface resolution and composition, the bounded-delegation envelope's treatment of any new capability surface, and — if the ADR adopts them — knowledge-base row lookups and unknown-category resolution.

## Invariants at risk

- The [#581] transcription failure.
  This planning conversation produced sketches and leanings; the ADR must not launder them into settled status.
  Mitigation is structural: the Build Order places the survey and the `ask_user` decision gates before ADR authoring, and the plan marks every leaning as reopened.
- ADR 0009's contract, and its own internal consistency.
  The new model must compose with the completeness contract and its layering asymmetry, or explicitly amend it.
  The measured `> out.txt` inconsistency is documented here precisely so the ADR does not build on the ADR-0009 text as if it described the code; the correction rides [#609].
- The boundary table's sourcing.
  Its "Sandboxing or containment" row cites `docs/troubleshooting.md` §Threat Model.
  A [#686] verdict that revises the boundary and edits only one of the two leaves a citation pointing at its own contradiction.
- ADR 0007 §5's delegation exclusions.
  They are stated as a list of surface names (`external_directory`, `path`).
  A settled model that renames or splits those surfaces silently changes what an authorizer link may `allow`; the ADR must state the mapping even though this change ships no code.
- Current-behavior docs stay true.
  `README.md` and `docs/configuration.md` describe shipped behavior; the ADR decides future direction and must not cause edits that make current-behavior docs describe unshipped design.

## Build Order

Documentation-only, so `/build-plan` (no red→green cycles).
Numbered `docs:` commits, each leaving the docs internally consistent.

1. Re-run the Background measurement.
   Recreate the disposable spike from Test Impact Analysis, confirm the six-row table still holds, and delete the spike.
   No commit.
2. Survey prior art.
   Research the ten systems in scope (web sources with citations; `fetch_content` for primary docs), producing per-system extractions of policy axis, naming, composition, defaults, unknown-handling, and prompt UX.
   `nono`'s policy vocabulary needs enough depth to price O8's translation step honestly.
   No commit — this is input to the deliberation.
3. Deliberate and settle.
   Present the survey findings and the O1–O8 evaluations against the criteria; run `ask_user` gates covering the nine open parameters (clustered: axis + composition; naming + shape; unknowns + defaults; sandbox verdict + boundary; knowledge base + policy-source constraints + staging).
   No commit — decisions precede prose.
4. Author ADR 0013.
   Write `docs/decisions/0013-permission-policy-model.md` recording the threat model, criteria, measured current behavior, survey, options with rejected alternatives, the settled decisions, the [#799] shape constraints, staging for [#609], and consequences.
   Verify with `pnpm exec rumdl check` on the new file.
   Commit: `docs(pi-permission-system): record ADR 0013 deciding the permission policy model (#639)`.
5. Reconcile the architecture doc and the threat model.
   Split the [#639]/[#799] open-question paragraph, link ADR 0013, apply the conditional boundary-table and `troubleshooting.md` edits together if the sandbox verdict requires them, and run the three greps from Module-Level Changes.
   Verify any touched Mermaid diagrams still render.
   Commit: `docs(pi-permission-system): reconcile architecture with ADR 0013 (#639)`.
6. Answer the contributed issues.
   Comment on [#686] with the ADR's verdict and close it if declined or superseded; comment on [#609] pointing at the ADR's staging section and the inherited measurement, leaving it open for re-planning.
   No commit.

## Risks and Mitigations

- Risk: transcription instead of deliberation (the [#581] revert).
  Mitigated: survey-then-gates-then-prose ordering in the Build Order; leanings explicitly marked reopened in Background.
- Risk: a shallow survey that just confirms the effect-model sketch.
  Mitigated: the per-system extraction template forces comparable facts (axis, composition, defaults, unknowns) rather than cherry-picked naming; O6 and O8 are in the option space specifically because they challenge the sketch's lattice and its AST-only enforcement premise.
- Risk: O8 is dismissed on the strength of the existing boundary rather than evaluated.
  Mitigated: the operator's gate placed it as a full candidate, the boundary is listed as itself under review, and the survey requires enough `nono` depth to price the translation step.
- Risk: the ADR over-commits implementation detail.
  Mitigated: the ADR settles model, semantics, naming, defaults, sandbox posture, and staging; schemas, migration mechanics, and knowledge-base contents belong to the implementation issues.
- Risk: scope creep into code, or into [#799]'s channel decision.
  Mitigated: Non-Goals fences this to `docs/` and to the shape question; [#609] and successors implement, [#799] decides channels.
- Risk: a breaking-default decision ships without migration discipline.
  Mitigated: if the settled decision is breaking, the ADR records the posture, and the implementing issue's plan carries the `feat!:`/`BREAKING CHANGE:` footer and a verified migration note — not this ADR.

## Open Questions

- The nine open parameters in Design Overview — deliberately open; they are the ADR's subject.
- Whether nesting sugar over flat keys is ever worth its grammar cost — evaluable in the ADR, decidable later without model change if deferred.
- Whether [#742] (commands inside control-flow bodies) is a projection defect to fix under ADR 0009's contract or evidence for the effect-centered reframe — noted in the escape catalog, triaged on its own issue, not decided here.
- The sequencing of [#799] against this ADR: it consumes this ADR's shape constraints, so it plans after ADR 0013 lands unless the operator unblocks [#675]/[#692] sooner.

[#301]: https://github.com/gotgenes/pi-packages/issues/301
[#306]: https://github.com/gotgenes/pi-packages/issues/306
[#393]: https://github.com/gotgenes/pi-packages/issues/393
[#418]: https://github.com/gotgenes/pi-packages/issues/418
[#452]: https://github.com/gotgenes/pi-packages/issues/452
[#481]: https://github.com/gotgenes/pi-packages/issues/481
[#490]: https://github.com/gotgenes/pi-packages/issues/490
[#509]: https://github.com/gotgenes/pi-packages/issues/509
[#533]: https://github.com/gotgenes/pi-packages/issues/533
[#574]: https://github.com/gotgenes/pi-packages/issues/574
[#575]: https://github.com/gotgenes/pi-packages/issues/575
[#581]: https://github.com/gotgenes/pi-packages/issues/581
[#591]: https://github.com/gotgenes/pi-packages/issues/591
[#596]: https://github.com/gotgenes/pi-packages/issues/596
[#609]: https://github.com/gotgenes/pi-packages/issues/609
[#638]: https://github.com/gotgenes/pi-packages/issues/638
[#639]: https://github.com/gotgenes/pi-packages/issues/639
[#645]: https://github.com/gotgenes/pi-packages/issues/645
[#675]: https://github.com/gotgenes/pi-packages/issues/675
[#686]: https://github.com/gotgenes/pi-packages/issues/686
[#691]: https://github.com/gotgenes/pi-packages/issues/691
[#692]: https://github.com/gotgenes/pi-packages/issues/692
[#694]: https://github.com/gotgenes/pi-packages/issues/694
[#741]: https://github.com/gotgenes/pi-packages/issues/741
[#742]: https://github.com/gotgenes/pi-packages/issues/742
[#785]: https://github.com/gotgenes/pi-packages/issues/785
[#786]: https://github.com/gotgenes/pi-packages/issues/786
[#799]: https://github.com/gotgenes/pi-packages/issues/799
