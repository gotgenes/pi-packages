---
status: accepted
date: 2026-08-22
amended: 2026-08-25
---

# 0013 — The permission policy model: capability as an axis

## Status

Accepted, as amended 2026-08-25.

This decision settles the shape of the deterministic policy model: whether access capability (reading versus writing a path) becomes first-class, how it is spelled in config, what composes with what, and where the enforcement boundary of this package lies.
It composes with `docs/decisions/0009-bash-path-projection-completeness-contract.md`, whose layering asymmetry it preserves and whose per-command-table rejection it deliberately re-scopes (§7), and with `docs/decisions/0007-model-judge-authorizer-chain-adr.md`, to which it routes judgment the deterministic layer cannot supply and whose delegation exclusions it restates as surface families (§4) so they survive the new key names unamended.
It decides the *shape* of policy only; which channels policy may enter through is decided separately by [#799].
Nothing changes in code with this record; the decisions here are implemented by downstream issues, staged below.

### Amendment, 2026-08-23

The original record failed an adversarial pre-ship review (`docs/retro/0639-pressure-test.md`): its measurement tables dropped the log's newer schema (F1), its headline direction split came from an uncommitted fail-open instrument (F2), its relief claims were not deliverable by any staged mechanism (F3), its central semantic rule for unproven direction was never decided (F4), its sugar merge order was ambiguous (F5), and its probe and coverage claims overstated (F6, F7).
This amendment corrects the evidence (recency-weighted, instrument committed), decides the missing rules (§10), revises decision 7 (structural effects with an audited core and user declarations), adds the evaluation model (§10) and wrapper transparency (§11), and rewrites the consequences to what the staged mechanisms measurably deliver.

One meta-decision is recorded with it: **this record, like every ADR here, is revisable on new information.**
Its measurements are dated, its instrument is committed alongside the data, and a future re-run that falsifies a table falsifies the analysis built on it.

### Amendment, 2026-08-25 — tool-identity effect attribution

Staging step 1 ([#806]) landed the axis, and implementing it settled one rule the record left to be derived: **how a tool access establishes its direction.**
It is recorded here so steps 2 ([#807]) and 3 ([#803]) do not re-derive it.

A tool's *identity* is a structural effect proof in the sense of §7 — the narrowest and least contestable one available, since it needs no command knowledge at all.
A gate therefore names the narrowest surface the tool name proves:

| Access                           | Proven effects | Surface named    |
| -------------------------------- | -------------- | ---------------- |
| `read`, `grep`, `find`, `ls`     | read           | `<family>_read`  |
| `write`                          | write          | `<family>_write` |
| `edit`                           | read + write   | `<family>`       |
| An MCP tool or extension tool    | unknown        | `<family>`       |
| A bash path token (until [#807]) | unknown        | `<family>`       |

The bare family name carries both meanings at once, and that conflation is intentional: proven-both and unproven-at-all consult the same two surfaces and take the more restrictive answer. §10's fail-closed base case and §2's honest `["read", "write"]` effect set are therefore the same mechanism, not two.

Two consequences of that reading, both settled by the implementation:

1. The **two directions are independent bits, not tiers** — for a tool access as for a bash one.
   An `allow` on `path_write` grants no read, and a `deny` on `path_read` floors no write.
   The capability-chain alternative (write implies read; a read deny floors write) is intuitive but reintroduces exactly the cross-surface interaction §4 exists to prevent, needs a new precedence rule for a `path_write: allow` written after a `path_read: deny`, and grants read implicitly wherever write is granted — which is the exfiltration surface the axis exists to let an operator withhold.
   The intuition it serves is discharged in documentation instead: the useful grants are `*_read: allow` and the bare sugar key, while `*_write` earns its keep as a restriction.
2. The **family fold is a read-side operation, not a gate-side one.**
   Expansion (§4) leaves no rule on a bare surface, so a family name is answerable only because the resolver folds it over its members.
   That fold belongs at the single resolution entry point every reader shares — the gates, the cross-extension policy query, and the recorded-authority view a serving node resolves a **forwarded child request** against.
   A gate-side fold would leave that last reader resolving an emptied surface, and a parent's recorded `path` deny would stop hard-denying a child's request and escalate it to an approvable prompt instead.
   The fold returns the losing member's own result, which is the blame fact §10 wants, delivered rather than re-derived.

## Context

### The reported gap

Issue [#609] asks that an allowed bash command not implicitly carry the right to write files through `>` or `>>`.
Issue [#785], filed independently and closed as its duplicate, reached the same conclusion from a fuller diagnosis and added the observation that a bare destination which does not yet exist escapes every surface.

Both are correct, and both are symptoms rather than the defect.
Access direction is not a first-class fact anywhere in the model: the cross-cutting `path` surface is direction-blind, the `external_directory` boundary is direction-blind, and a bash path token has no read/write identity at all.

### What the model expresses today

Every gated action has three independent facts — an actor (which tool or channel), an object (which path, command, or name), and a capability (read, write, execute, cross the boundary).
The flat permission map expresses the first two and conflates the third with the first:

| Key                                   | Axis expressed           | Note                                 |
| ------------------------------------- | ------------------------ | ------------------------------------ |
| `read`, `grep`, `find`, `ls`          | actor, implying read     | path-matched                         |
| `write`, `edit`                       | actor, implying write    | two keys, one capability             |
| `bash`                                | actor, implying exec     | command patterns                     |
| `mcp`, `skill`, `special`, tool names | actor                    |                                      |
| `path`                                | object, capability-blind | any access, any direction, any actor |
| `external_directory`                  | boundary                 | outside-cwd guard                    |
| `*`                                   | universal fallback       |                                      |

Capability is therefore only expressible where a tool happens to be named for it.
It is inexpressible for `path`, for `external_directory`, and for every operand of every bash command.

### Measured: what the projection does with a redirect

Measured against the shipped projection at the time of this record, with a working directory containing `existing.txt`:

| Command                         | `path` rule candidates       | `external_directory`         |
| ------------------------------- | ---------------------------- | ---------------------------- |
| `cat /etc/hosts > out.txt`      | `/etc/hosts`                 | `/etc/hosts`                 |
| `cat /etc/hosts > existing.txt` | `/etc/hosts`, `existing.txt` | `/etc/hosts`                 |
| `cat /etc/hosts > /tmp/out.txt` | `/etc/hosts`, `/tmp/out.txt` | `/etc/hosts`, `/tmp/out.txt` |
| `cat < existing.txt`            | `existing.txt`               | —                            |
| `echo hi > sub/new.txt`         | `sub/new.txt`                | —                            |

Two facts follow.
A redirect destination is projected when its shape qualifies or when it already exists, and dropped when it is bare and does not yet exist — the ordinary case for a creating redirect.
Where it *is* projected it lands on the direction-blind `path` surface, indistinguishable from `cat < existing.txt`, so an allow granted for reading also authorizes overwriting.

The first fact contradicts ADR 0009, which lists "a redirect target (`> out.txt`, `2>/tmp/log`)" among the projection's guarantees and asserts that redirect targets are unaffected by its nonexistent-bare-write-target residual.
Collection is real; classification then drops the token.
By ADR 0009's own triage rule this lands **inside** the contract — a guarantee met inconsistently across positions, the same shape as [#694] and [#741] — so it is a defect, and its wording is corrected alongside the fix under [#609].

### Measured: what asks are actually for

All figures below are measured over the local review log's `permission_request.waiting` entries, test fixtures excluded, both log schemas included (the original record dropped the `surface`-keyed schema introduced 2026-08-17 — pressure-test finding F1).
The instrument is committed in the appendix of `docs/retro/0639-pressure-test.md`; the band classifier is a prototype approximating the parser-based implementation, so band boundaries carry a few points of noise.
The evidence is one operator, one monorepo, four months, under an evolving policy, with survivorship bias (what was already allowed never appears); it warrants direction, not universality.
Later months reflect the current mechanism set and are weighted accordingly; earlier months reflect a different repository layout and fewer relief mechanisms.

Corrected totals: 1146 human-facing asks (2026-05 through 2026-08), of which 918 (80.1%) are external-directory asks — a share stable at 72–80% across all four months (the original record's "fallen to 25%" was the F1 schema artifact).

The residual is decomposed into bands by what can relieve each:

| Band | What it is                                                     | Relieved by                                      |
| ---- | -------------------------------------------------------------- | ------------------------------------------------ |
| A    | reads with actor-known direction (`read`/`grep`/`ls` tools)    | the directional keys (§1, §3)                    |
| B    | bash provably read-only at command position                    | the effect classifier (§7) + a directional grant |
| C    | bash genuinely unknowable (`pnpm`, `node`, `pi`, interpreters) | standing grants now; the sandbox tier (§8) later |
| D    | writes (tools and provable bash writes)                        | asks unless the user grants write — by design    |
| —    | non-external asks (bash rules, wrapper floor, tools)           | out of this axis's scope                         |

| Month   | Asks | External | A   | B   | C   | D   | Non-ext | A+B share |
| ------- | ---- | -------- | --- | --- | --- | --- | ------- | --------- |
| 2026-05 | 630  | 488      | 119 | 156 | 121 | 92  | 142     | 44%       |
| 2026-06 | 201  | 201      | 53  | 49  | 72  | 27  | 0       | 51%       |
| 2026-07 | 164  | 120      | 36  | 29  | 30  | 25  | 44      | 40%       |
| 2026-08 | 151  | 109      | 28  | 29  | 22  | 30  | 42      | 38%       |

Four readings, all load-bearing.

**The absolute volume collapsed 4× (630 → 151 asks/month) before this record changes anything.**
Session-approval rules (975 auto-approvals in August alone), the wrapper indirection floor ([#490], [#575]), the authorizer chain (51 `authorizer_chain_resolved` and 21 `model_judge.decision` events in August — asks a human never saw), and the monorepo consolidation already absorbed most of the historical pain.
The problem this record addresses is a residual of roughly 150 asks/month, not a standing crisis.

**The band structure is stable across four different eras of the system.**
A+B holds at 38–51% while volume fell 4× and the dominant mechanisms changed twice.
Among direction-classifiable external asks, reads outnumber writes roughly 63:37.
That stability — not any one month's aggregate — is the warrant for decision 1.

**The wrapper floor is now a first-order prompt cause.**
Floored prompts were 0% before the floor shipped and 27–28% of *all* prompts in July and August; 40–55% of them have a pure-reader inner command (`grep`, `wc`, `cat`).
Newer models compose command lines (`xargs`, `find -exec`) far more than the floor's design era assumed.
Decision 11 addresses this.

**External asks concentrate on a handful of roots.**
`~/development/pi` alone accounts for 39% of external asks; with `~/.pi/agent`, `/opt/homebrew`, and `/tmp` scratch paths, three or four standing grant lines cover roughly 55% of the external population.
Relief by consent granularity is real and available today (see Consequences).

**Cause-joint relief accounting** (a prompt is relieved only when *all* its causes are — the F3 lesson): under the staged mechanisms of this record (directional keys + effect classifier + wrapper transparency) *and* read grants covering the asked roots, 51% of current-month prompts are relieved (July 83/164, August 77/151; August splits 57 via grant+classifier, 20 via wrapper transparency).
The caveat: the log records each ask's first-firing cause, so this figure assumes the read grants cover the roots involved; it is an estimate of the mechanism ceiling, not a promise independent of config.

### Prior art

Surveyed for policy axis, key naming, composition, default stance, unknown-handling, and escalation UX.

| System      | Axis                            | Read/write spelling                                                       | Composition                                                                   |
| ----------- | ------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| OpenCode v2 | action + resource, ordered list | `read` / `edit` (edit covers write and patch)                             | last matching rule wins; most-restrictive across an operation's resources     |
| Claude Code | tool + specifier                | `Read(…)` / `Edit(…)`                                                     | deny, then ask, then allow; first match in that order; specificity irrelevant |
| Codex CLI   | sandbox mode + approval policy  | `read-only` / `workspace-write`; parsed-argv safe-command classifier      | most-restrictive rule decision (`forbidden > prompt > allow`)                 |
| Deno        | capability                      | `--allow-read` / `--allow-write`                                          | `--deny-*` unconditionally beats `--allow-*`                                  |
| Node        | capability                      | `--allow-fs-read` / `--allow-fs-write`, scopes `'fs.read'` / `'fs.write'` | additive allow-list; no deny                                                  |
| Landlock    | right set on an object          | `LANDLOCK_ACCESS_FS_READ_FILE` / `WRITE_FILE`                             | union within a layer, intersection across stacked layers                      |
| Seatbelt    | operation + filter              | `file-read*` / `file-write*`                                              | not verified against a primary Apple source                                   |
| WASI        | rights on a handle              | `rights.fd_read` / `rights.fd_write`                                      | monotonic attenuation by construction                                         |
| systemd     | object with a mode              | `ReadOnlyPaths=` / `ReadWritePaths=`                                      | deeper path overrides the enclosing directive                                 |
| nono        | path grant with a direction     | `--read` / `--write` / `--allow`                                          | profile composition; `network.block` ratchets                                 |
| PaSh        | per-command effect annotations  | structured inputs/outputs per invocation shape                            | unannotated commands are barriers (fail closed)                               |

Citations: the OpenCode claims come from `https://opencode.ai/v2/docs/permissions` (the v1 page at `/docs/permissions` documents the older actor-keyed object and does not reproduce them — cite the v2 URL or the record looks wrong, which is exactly what happened in review).
The Claude Code quotes and the claim that `nono run -- pi` works today were not verified against primary sources and carry that flag, as Seatbelt already did.

Six findings bear directly on the decisions below.

**Read and write as literal words is the near-universal spelling.**
No surveyed system uses an alternative vocabulary.

**Most-restrictive composition across independent policy layers is precedented, not exotic.**
Landlock states it exactly: a sandboxed thread may access a path only if *all* enforced layers grant it.
OpenCode v2 independently applies the same rule across the resources of one operation.

**The origin project has already adopted the ordered-list model, and it does not solve this problem.**
OpenCode v2's `shell` action's resource is "the complete raw shell command string," so it can no more govern `> out.txt` than this package could, and its string patterns carry the imprecision this record retires (§10).

**Codex CLI ships the segment-fold classifier this record adopts** ([`is_safe_command.rs`](https://github.com/openai/codex/blob/main/codex-rs/shell-command/src/command_safety/is_safe_command.rs)): a `bash -lc` script is auto-approvable only when it "consists solely of one or more plain commands … combined with a conservative allow-list of shell operators" — the all-units-known-safe rule, fail closed on everything else.
Its Smart approvals propose a `prefix_rule` during escalation — the same ergonomic loop decision 7's declarations anticipate.
It also ships the cautionary tale: its classifier keys on basename only, so a path-qualified `./sed` rides the trust of a bare word ([openai/codex#28732](https://github.com/openai/codex/issues/28732)); decision 10's leaf rule requires bare command words for exactly this reason.

**PaSh maintains the full per-command effects knowledge base** ([annotations](https://binpa.sh/annotations/), [paper](https://arxiv.org/abs/2007.09436)) — structured annotations describing each command's interaction with files and state, grounded in a study of coreutils, with unannotated commands as fail-closed barriers.
It is the strongest evidence for decision 7's split: a rich annotation library is a project's core asset to maintain, and PaSh is in that business so this package does not have to be.

**The two closest peers pair a decision layer with an OS sandbox as complementary tiers.**
Claude Code reports merging deny rules into the sandbox boundary with `autoAllowBashIfSandboxed` substituting for whole-tool prompts (unverified, above); Codex CLI pairs its approval policy with a sandbox mode as two orthogonal dials.

The evaluation model in §10 also has named theory: the bottom-up verdict is a synthesized attribute (Knuth, 1968), the fold over ordered verdict domains is abstract interpretation over a product lattice (Cousot), and the formal-semantics literature ([Smoosh, POPL 2020](https://cs.pomona.edu/~michael/papers/popl2020_smoosh.pdf)) documents why the model stays syntactic: full shell semantics is mutually recursive through word expansion and command substitution, so a static layer that pretends to evaluate them fails open.
[ABASH](https://dl.acm.org/doi/10.1145/1255329.1255347) is precedent that unsound-but-useful static bash analysis is a respectable position when it fails closed.

### Objectives

Stated by the operator as the criteria this record is judged against:

1. Clarity — a user can predict what a config does by reading it.
2. Simplicity — avoid a complex calculus of interactions between rules.
3. No ambiguity — no config text with two plausible readings.
4. User-first — authoring, prompt-reading, and approval ergonomics outrank internal elegance.
5. Retained — determinism, least privilege, fail-closed unknowns.

## Decision

### 1. Capability is an axis, and its purpose is to permit

Access capability becomes a first-class fact, expressed as a capability layer beside the existing keys rather than replacing them.
Actor keys (`read`, `edit`, `bash`, tool names) remain and continue to refine.

The purpose of the axis is stated deliberately, because it determines every default below.
Direction exists **so that a user can safely allow the common case**, not primarily so that writes can be restricted.
The stable read-majority among classifiable asks is the warrant: the model's inability to distinguish a read from a write is why a user who wants to permit reading outside the working tree must also permit writing there, and therefore permits neither.

[#609]'s restriction of redirect writes is a consequence of the same axis, not its motivation.

This also names one defect behind eight open issues.
[#706], [#680], [#620], [#698], [#472], [#604], [#603], and [#686] are eight mechanisms aimed at one gap: the model cannot express *this is only a read, so it is fine*.

### 2. The vocabulary is effects, and an effect value is a set

Two effects ship: `read` and `write`.
A command or invocation's declared value is an **effect set** — exhaustive over its filesystem effects — with a scalar as sugar for the singleton:

- `"read"` ≡ `["read"]` — matching invocations read and do nothing else; this is what relieves, because it excludes write.
- `[]` — no filesystem effects at all (`true`, `date`); strictly stronger than read.
- `["read", "write"]` — legal and honest (`cp` reads its source and writes its destination); behaviorally near the fail-closed default, its value is blame quality in prompts.

`delete` was considered and deferred.
It is a real distinction — the unrecoverable effect is not the recoverable one, and Landlock separates `REMOVE_FILE` and `REMOVE_DIR` from `WRITE_FILE` — but a bash delete is knowable only from command knowledge the deterministic layer refuses to hold beyond its audited core.
`delete` is recorded here as a reserved future member of the effect vocabulary, addable without restructuring the axis or the `commandEffects` shape (§7).

### 3. The spelling is flat, underscore-suffixed keys

`path_read`, `path_write`, `external_directory_read`, `external_directory_write`.

Flat, because every policy channel in this package already speaks flat `(surface, pattern)` pairs: session-approval rules, the forwarded-request wire, `PermissionsService` queries, agent frontmatter, the review log, and the ask prompt.
A nested config shape would be flattened before any of them saw it, so nesting would buy authoring ergonomics at the cost of users authoring one spelling and reading another in every prompt, log line, and persisted approval.
It would additionally require reserving `read` and `write` as keys inside path-family objects, since `path: { read: "allow" }` is today a valid rule matching a file literally named `read`.

Underscore rather than a dot, because `external_directory` already establishes underscore as this config's surface-name separator, and because a `"path_read"` key sitting beside a valid `"path": { … }` object cannot be misread as descent into it.
Node's `'fs.read'` is an API argument with no sibling object; this key is not.

### 4. Bare `path` and `external_directory` are load-time sugar

Bare `path` is not a fourth surface.
It expands at load time into the directional keys:

```jsonc
// written
{ "permission": { "path": { "*": "ask", "~/.ssh/*": "deny" } } }

// after expansion
{ "permission": {
    "path_read":  { "*": "ask", "~/.ssh/*": "deny" },
    "path_write": { "*": "ask", "~/.ssh/*": "deny" }
} }
```

`external_directory` expands the same way.

This is the decision that keeps criterion 2 satisfied.
There is exactly one axis with two values and **no new cross-surface interaction to reason about** — had bare `path` remained a surface, a user would have to reason about `path` composing with `path_write`, which is the calculus this record exists to avoid.

It is also what makes the axis **non-breaking by construction**: every existing config expands to its current meaning exactly, so no migration is required and no prompting changes on upgrade.
A user opts into direction by writing the narrower key:

```jsonc
{ "permission": {
    "external_directory": { "*": "ask" },
    "external_directory_read": { "*": "allow" }
} }
```

Bare `path` remains valid and idiomatic indefinitely.
It is the right spelling whenever direction does not matter, which is most of the time.

**The intra-surface merge order is normative** (amendment; pressure-test F5): sugar-expanded entries are inserted first, and explicit directional entries append after them, regardless of the keys' textual order in the file.
For an identical pattern appearing in both, the explicit directional entry wins.
A config and its key-order-swapped twin therefore mean the same thing — the example above reads read-allowed, write-asks whichever line comes first.

One consequence of the expansion is security-relevant, and is decided here rather than left to be discovered during implementation.
ADR 0007 §5's bounded-delegation envelope caps an authorizer link's `allow` on the `external_directory` and `path` surfaces, and it is enforced by exact string membership — `DELEGATION_EXCLUDED_SURFACES` holds those two literal names and is tested against the gate-authoritative `accessIntent.surface`.
After expansion the gate surface an authorizer sees is a directional name, so a literal-membership test would stop matching and a link's `allow` on a path write would pass the envelope unchecked.

**The exclusion is therefore over a surface *family*, not a literal name.**
`path` names the family `path`, `path_read`, `path_write`; `external_directory` names its own.
A capability suffix added to a family later is a member of that family by construction.

This is a **name-resolution rule, not a scope freeze** (amendment; pressure-test F9c).
It states how a family name resolves to members once surfaces can carry suffixes; it does not freeze the envelope's *current* whole-`path` exclusion, which is [#599]'s deliberately conservative stopgap that [#620] is chartered to relax toward secret-shaped-paths-only.
When [#620] relaxes what the envelope excludes, the family rule keeps resolving whatever the relaxed exclusion names.

### 5. `external_directory` is a relational scope rule, and stays distinct

`external_directory` is not a pattern surface that happens to be about the outside.
It is the only rule in the model whose **reference point moves**: it fires on a path's relation to the session working directory, not on the path's spelling.
No glob can express it, because glob patterns have neither negation nor a session-relative anchor.

Naming this is not pedantry; it discharges a documented gotcha.
The rule that a `path` allow cannot suppress an `external_directory: ask` has been taught as an exception to be memorized.
It is not an exception.
The boundary answers *is this in scope at all*, and the pattern surfaces answer *is this particular access permitted*.
Those are different questions, and most-restrictive composition between them is the correct consequence of that difference rather than an arbitrary precedence rule.

The boundary is therefore kept distinct from `path`, and it gains direction, which is where the measured read share pays.
OpenCode v2 preserved the same separation independently.

The everyday consequence, stated so nobody has to derive it: **granting an external root takes one line in one surface.**
`external_directory_read: { "~/dev/*": "allow" }` needs no parallel `path_read` entry — the `path` family only speaks when one of its own patterns matches, and its idiomatic use is carving denials (`~/.ssh/*`), not boundary grants.
A single `*` already crosses directory boundaries here; `**` is not a distinct globstar in this matcher, so the doubled form is redundant rather than more powerful.

### 6. Composition is unchanged

Last-matching-pattern wins within a surface; most-restrictive wins across surfaces.

Criterion 2 put the lattice itself on the table and it survives, on evidence rather than inertia.
Landlock states this exact rule for stacked layers, and OpenCode v2 applies it across an operation's resources.
The alternatives are worse: Claude Code's flat deny-then-ask-then-allow ordering cannot express "allow this command but not its writes" without a second axis anyway, and its own documented precedence and observed behavior are reported to disagree in practice.
A single flat ordered list would dissolve decision 5's distinction, letting a permissive pattern rule loosen the boundary — which is what makes a boundary a boundary.

The perceived complexity of the lattice was never its arity.
It was that one of its layers was undeclared as a different kind of rule, which decision 5 fixes.

Which directional surface an access consults is decided per path token by the evaluation model's base case (§10): a token with a proven effect consults that effect's surfaces; a token whose effect cannot be proven consults **both**, most-restrictive.

### 7. Effects are proven structurally or declared — the package's own beliefs stay small and audited

The deterministic layer establishes a bash path operand's effect from three sources, in decreasing order of authority:

**Syntax.**
An output redirect destination (`>`, `>>`, `>|`, `&>`) is a write; an input redirect (`<`, `<<`, `<<<`) is a read; file-descriptor duplication (`2>&1`) is not a file access at all.
Syntax proofs are absolute and cannot be retracted by any declaration.

**The built-in pure-reader core.**
A small, frozen, package-audited set of command words that are read-only *for any arguments, in any implementation*.
The admission criteria are strict: implementation-independent read-only-ness (GNU and BSD alike — dialect variance is a disqualifier or a guard, never an assumption), no option that redirects output to a file, effects stable under argument content.
Words with option-dependent effects (`sed`, `sort`) are excluded or internally guarded (`find` is admitted with a retraction guard on `-exec`/`-execdir`/`-ok`/`-okdir`/`-delete`).
Head words are matched as bare basenames only — a path-qualified `./grep` is not core (the Codex lesson, [openai/codex#28732]).
The core is always active and not user-removable; a user who distrusts `cat` is served by the ask-everything fallback, not by removal machinery.

**User declarations: `commandEffects`.**
A top-level config key (beside `piInfrastructureReadPaths`, this config's existing user-extensible trust declaration) in which the user declares the effects of their own tools.
Its shape is structured command description, not patterns — commands have structure (command, subcommands, options), and the config speaks it:

```jsonc
"commandEffects": {
  "sed":  { "effects": "read", "unlessOption": ["-i", "--in-place"] },
  "sort": { "effects": "read", "unlessOption": ["-o", "--output"] },
  "curl": { "effects": [],     "unlessOption": ["-o", "-O", "--output"] },
  "git": {
    "subcommands": {
      "diff": "read",
      "log":  "read",
      "remote": { "subcommands": { "show": "read" } }
    }
  },
  "chezmoi": { "subcommands": { "status": "read", "diff": "read" } }
}
```

```typescript
type Effect = "read" | "write"; // "delete" reserved (§2)
interface CommandEffectsEntry {
  effects?: Effect | readonly Effect[];
  unlessOption?: readonly string[];
  subcommands?: Record<string, CommandEffectsEntry | Effect | readonly Effect[]>;
}
```

The rules of the shape:

- **Keys are exact command basenames; subcommand words are exact.**
  There is no pattern grammar, no wildcard, and therefore no overlap or specificity calculus — a command unit's head word resolves to at most one entry, and subcommand descent refines within it.
  Positional facts (which command, which subcommand) live in the structure; position-free facts (options) live in guards.
- **A guard retracts, it does not substitute.**
  `unlessOption` lists option stems whose observation anywhere in the unit withdraws the declaration; the unit falls back to fail-closed unknown, which consults both directional surfaces — behaviorally the read-write consultation, with a better blame line ("declaration retracted by `-i`").
  Stem matching is fail-closed over option forms: attached values (`-i.bak`, `--in-place=old`), clustered shorts, and dialect spellings all retract, and guards list the union of GNU and BSD spellings because over-retraction costs one ask while under-retraction misses a write.
- **Undeclared is unknown.**
  An entry with only `subcommands` says nothing about undeclared subcommands; a command with no entry says nothing at all.
  Fail-closed by omission, everywhere.
- **Declarations narrow uncertainty toward fewer effects; everything else is already the default.**
  The enforcement-relevant use is `"read"` and `[]`.
  A `write` declaration is nearly redundant with fail-closed and earns only prompt honesty.
- **Merge follows `shellTools`**: shallow-merge by command key across scopes, so a project entry overrides a colliding command but never drops the global long tail (the recorded `shellTools` rationale — a dropped entry is a silent enforcement regression — transfers verbatim).
- **Channels: user config scopes only** (global, project).
  Agent frontmatter may not declare effects; whether that channel opens is [#799]'s question, and a subagent declaring its own tools read-only would be self-granted relief.
- **Provenance is logged.**
  The review log records which source classified a unit — syntax, core, or a config entry and its scope — so a surprising allow is auditable to the line that produced it.

**What this deliberately re-scopes, and why it is not the rejected alternative.**
ADR 0009 rejected per-command tables as a deterministic-layer mechanism, and the original version of this record extended that to refusing all read classification.
The rejection stands for what it actually covered: a **package-maintained, fail-open** command-effects base as the model's spine, growing under user pressure.
The amended mechanism is different in both properties: the package's own beliefs are a tiny audited core whose admission bar is structural (argument-independence), and everything else is the **user's declaration** — a consent claim, morally identical to an allow rule, finer-grained than the standing root grants this record already documents as acceptable, maintained by the person whose tools they are.
PaSh is the named evidence of what maintaining the full annotation library costs a project; this package declines that business by construction, because the core cannot grow under pressure — the long tail has somewhere else to live.

**The chain's role narrows from load-bearing to judgment.**
The original record routed all read classification to the authorizer chain ([#620], [#698]).
The chain remains the right home for what genuinely needs judgment — opaque invocations, interpreters, one-off scripts — and the August data shows it working (51 chain-resolved asks).
But structural facts are cheaper than judgment: the classifier answers the provable slice at zero tokens, and [#620] is no longer the only path to read relief.

This is what [#609] needs and no more: a redirect destination is provably a write, so `path_write` and `external_directory_write` govern it.

### 8. The sandbox is a complementary tier, and the seam is bidirectional

Issue [#686] proposes replacing AST path parsing with an OS capability sandbox.
It is adopted as a **complementary tier**, not a replacement, and not as a per-bash-call dependency.

The boundary recorded in `docs/architecture/architecture.md` is revised.
It previously read that this package decides and records but does not isolate.
It now reads: **this package does not implement isolation, and it exports its scope decisions to something that does.**

The division is by question type:

| Question                                                 | Answered by                                | Frequency       |
| -------------------------------------------------------- | ------------------------------------------ | --------------- |
| Is this path in scope, and in which direction?           | a scope declaration, enforced by a sandbox | once, at launch |
| Is *this specific* action on an in-scope path permitted? | this package's rules and prompts           | per action      |

The composed policy already contains the first answer for every path — the working directory is read-write, `piInfrastructureReadPaths` are read-only, `external_directory_read` and `external_directory_write` rules name readable and writable roots, and `path` denies carve exclusions.
That set is exported through a `PermissionsService` method, read via the session-keyed locator per ADR 0012:

```typescript
interface ScopeGrant {
  readonly path: string;
  readonly access: "read" | "write" | "read-write";
}
interface PolicyScope {
  readonly grants: readonly ScopeGrant[];
  readonly exclusions: readonly string[];
}
```

A launcher renders that into whatever profile its sandbox uses.
This package learns no sandbox's vocabulary, which is what keeps the revised boundary honest.
The seam's consumer is committed: [#802] builds the minimal launcher (a `nono`-based wrapper deriving its profile from the composed policy), which retires the vacant-seam objection from review (F8b).

The seam is bidirectional, because the export alone delivers enforcement and no prompt relief.
The reciprocal is a declaration that a scope is already enforced, which lets the package skip prompts for accesses the kernel has constrained — Claude Code's reported `autoAllowBashIfSandboxed`, arrived at from the same reasoning.
For band C — interpreters no classifier can ever prove — this is the only belief-free relief: nothing need *prove* that `pnpm test` only reads, because the root it can reach is mounted read-only.

Three constraints bound that declaration, and all three are required:

1. **It is spot-checked and operator-trusted** (amendment; pressure-test F6 — the original "verified, not trusted" overclaimed).
   A write probe into a claimed read-only grant checks one path at one moment and must discriminate errno (`EACCES`/`EPERM` from enforcement; `ENOENT` is a vacuous pass, not a pass); it proves a denial happened, not that the declared scope is uniformly enforced, and the read half of the claim rests on trusting the launcher's declaration.
   The probe's exact locations, required errno set, and cleanup are implementation contract for the declaration slice of [#802]'s successor, not settled here.
2. **It suppresses `ask` and never `deny`.**
   Explicit denies and content-scoped asks still fire.
3. **It originates outside the agent's reach.**
   A launcher establishes it before the session starts; nothing emitted during a session may assert it.

Issue [#686]'s proposed nested `bash: { read, write, network }` config shape is not adopted — decision 3 settles spelling — and neither is per-bash-call invocation of an external binary, which would take a hard dependency on a pre-1.0 tool, a platform matrix, and per-call latency for a boundary better established once at launch.
`network` is out of scope for this record: this package has no network surface today, and adding one is not a policy-shape question.

### 9. What any policy source must satisfy

Supplied as input to [#799], which decides the channel set.

- **Flat `(surface, pattern)` pairs are the universal vocabulary for permission rules.**
  Every channel already speaks them and this record adds none.
  A source that expresses policy differently must normalize to them before composition.
- **Sugar expands at load, before composition**, in decision 4's normative order, so every source is normalized identically and no source can introduce a surface the others cannot express.
- **A persisted rule is written in a directional key or a sugar key, never a third form.**
  A source that writes rules back (as [#691] and [#692] propose) emits the same vocabulary a human would author.
- **Direction does not create a new precedence tier.** `path_read` and `path_write` are surfaces; they merge across scopes by the existing global → project → agent order and compose by decision 6.
- **`commandEffects` is classification vocabulary, not a permission rule**, and travels separately: user config scopes only (§7), shallow-merged by command key, never grantable by an agent-controlled channel until [#799] decides otherwise.

### 10. Bash evaluation is a recursive verdict fold, and structured command description is its config language

Every node of the bash parse tree receives a verdict, computed bottom-up.
A verdict carries two ordered values — a permission state (`deny > ask > allow`) and an effect judgment (`write > unknown > read`, ordered by restrictiveness of consultation) — plus **blame**: which descendants forced the value.

- **Leaf rules** (simple commands): permission from the bash-surface rule for the unit; effects from §7's three sources.
- **Combinators**, one per node type:
  - *Pipeline and list* (`|`, `&&`, `||`, `;`): most-restrictive of children, in both values.
  - *Redirect*: attaches to its own node, marking that node's destination token; it never contaminates siblings.
  - *Wrapper* (`xargs`, `find -exec`, `sudo`, `env`, `time`): evaluate the executed inner unit and apply §11; opaque payloads (`bash -c`, `eval`) floor, always.
  - *Subshell, substitution, heredoc-hosted command*: child verdicts propagate up — the [#306] and [#741] cases are combinator clauses, not patches.
  - *Any unhandled node type*: fail closed (`ask`, `unknown`).
    A new syntax form is unsafe until someone writes its combinator.
- **Effects attach per path token, not per command.**
  Each projected path inherits the effect of the node that owns it: in `cat ~/a | tee ~/b`, `~/a` is a read and `~/b` is a write, in the same command.
  The **base case** (amendment; pressure-test F4): a path token whose effect cannot be proven consults *both* directional surfaces, most-restrictive.
  Consult-read was rejected outright — `rm` is unknown, not proven-write, so a fail-open unknown rule is precisely how `rm -rf` would ride a read allow.
- **Escalation is blame propagation.**
  A root `ask` names the subtree that forced it, so the prompt states *why* ("`xargs rm` is an unclassifiable wrapper"; "`~/b` is a write destination and `external_directory_write` asks"), and the session-approval suggestion targets the blamed unit or path rather than the whole command.
- **Matching is structural, never textual.**
  Command identity is the parsed unit's basename and subcommand spine (resolved through the arity table, so `git -C ~/other diff` *is* `git diff`); options are membership observations.
  String-wildcard patterns are a legacy input format: the `bash` surface's migration to structured rules, with load-time normalization of existing patterns, is committed as [#804].

The model is implemented in staged slices (see Staging), not a rewrite: the parse, the unit enumeration, the most-restrictive fold ([#301]), and the position-aware collectors already exist; the tree structure, per-token effects, and blame are what is added.

Theory and precedent: the verdict is a synthesized attribute (Knuth); the fold is abstract interpretation over a product lattice (Cousot); Codex CLI ships the all-units-known-safe special case in production; Smoosh documents why the model must stay syntactic; ABASH precedents fail-closed unsound-but-useful bash analysis.

### 11. Wrapper transparency: argument-independence defeats the floor's reason

The indirection floor ([#490]) exists because a wrapper hides the command that should be gated.
For one class the hiding is immaterial: a wrapper whose executed inner command is in the pure-reader core is read-only **whatever its argument feed contains**, because argument-independence is the core's admission bar.
The unknowability the floor guards against is unknowability of *scope*; scope remains the projection's and the path surfaces' job, for wrapped and unwrapped commands alike.

Therefore:

- A wrapper unit whose `executedUnitOf` head is a bare-basename core word, with no real output redirect on the unit, **inherits the inner command's verdict** — it classifies read and resolves by the inner unit's own rules instead of the synthetic floor `ask`.
- Everything else keeps the floor untouched: interpreters, opaque payloads, mutators, and any wrapper whose inner command is unresolvable (`executedUnitOf` fails to `null`, and that discipline is retained).
- **v1 exemption is on the built-in core only.**
  User `commandEffects` declarations participate in effect classification but do not lift the floor: the core's argument-independence is package-audited, a user's claim about a wrapped command is not, and a wrong claim behind a wrapper fails open.
  Widening to user declarations requires evidence, not symmetry.

The measured warrant: floored prompts are 27–28% of all prompts in the two most recent months, 40–55% of them with pure-reader inner commands — the single largest deterministic relief available in this record.
Implementation is [#803].

## Consequences

- **What ships relieves a measured 51% of current prompts, and the accounting is per band.**
  Band A (tool reads, ~19% of current asks) is relieved by the directional keys alone.
  Band B (provable bash reads, ~19%) needs the §7 classifier and a directional read grant.
  The floored pure-reader prompts (~13%) need §11.
  These figures are cause-joint (a prompt is relieved only when all its causes are) and assume read grants covering the asked roots.
- **Band C — interpreters — is relieved by consent or enforcement, never by classification.**
  Today: standing root grants.
  The session-approval flow already grants per session; a persistent grant is one config line per root, and the measured concentration means three or four lines cover most of the population.
  A **read-write grant on a trusted root is acceptable, documented consent** — explicit, logged, revocable, and the operator's stated preference for their own sibling checkouts — with the plain-language consequence that it covers `rm -rf` there too.
  Later: the enforced-scope declaration (§8) relieves band C without belief, and [#802] is its first committed step.
- **What `path_write` does not govern**, stated so nobody discovers it in an incident (amendment; pressure-test F7): `rm`, `mv`, `cp`, `touch`, `mkdir`, `sed -i`, `tee`, `ln`, `chmod`, `dd of=`, `git commit` and friends, package installs, and any interpreter script.
  Those are unknown-effect commands: they consult both surfaces and ask unless granted or declared.
  `rm -rf` specifically is stopped by the fail-closed base case (§10), an explicit ask/deny, or the sandbox tier — never by `path_write` matching `rm`.
  Delete-shaped capability has a named owner: the reserved `delete` effect (§2), populated when command knowledge or enforcement can prove it.
- Existing configs are unaffected on upgrade; decision 4 makes the axis non-breaking by construction.
- [#609] and [#785] are answerable: a redirect destination is provably a write and is governed by `path_write` and `external_directory_write`.
- One breaking change remains, and it is the projection fix rather than the axis.
  A bare nonexistent redirect destination escapes every surface today; once projected, a user with an explicit `path` rule sees a new prompt.
  This ships following ADR 0009's own [#645] precedent, with a `BREAKING CHANGE:` footer and a migration note.
  Users with no explicit `path` rules are unaffected, because ADR 0009's unmatched-promotion guard leaves them unrestricted.
- ADR 0009's guarantee wording is inaccurate as written and is corrected alongside that fix, not by this record.
- The architecture doc's sandboxing boundary row and `docs/troubleshooting.md` §Threat Model both change, together, per decision 8.
- Two config keys and their schema, examples, and documentation follow from decision 3; `commandEffects` and its schema follow from §7; `PATH_SURFACES` gains the directional keys, and `DELEGATION_EXCLUDED_SURFACES` becomes a family test rather than a literal set (decision 4).
- ADR 0007's envelope keeps its current scope under the new key names, because decision 4's family rule is name resolution; [#620]'s charter to relax that scope is unaffected.
- The chain remains the home of judgment ([#620], [#698]) and stops being the only path to read relief (§7).
- The non-external residual (~28% of current asks: bash rules, tool rules, the non-exempt floor) is out of this axis's scope and is named here so the record does not imply otherwise.
- `delete` is a known gap, deliberately unshipped, with a recorded reason and a reserved seat.

## Alternatives considered

### Effects primary with a command-effects knowledge base (rejected at decision 1)

Effects as the spine, classified by a curated table consolidating `PATTERN_FIRST_COMMANDS`, the wrapper sets, and `SAFE_SYSTEM_PATHS`.
Rejected as the *spine*: it overturns ADR 0009's rejection of package-maintained per-command tables without a bound.
The amendment admits a bounded form — §7's audited core and user declarations — whose admission criteria and consent framing answer the objection; the spine remains actor and object.

### A curated read-only command set in the deterministic layer (original rejection superseded in part)

The original record rejected all deterministic read classification as fail-open.
Superseded by §7 as amended: the fail-open objection holds against a *large, package-maintained, belief-based* table, and does not hold against a small audited argument-independent core plus user consent declarations.
The measured cost of the original rejection — band B, roughly a fifth of current prompts, permanently unresolvable — was not visible until the corrected accounting.

### Consult-read for unproven effects (rejected at §10)

The fail-open reading of F4: an unproven access consults only the read surface.
Rejected: `rm`, `mv`, and `sed -i` are unproven, not proven-write, so this rule is precisely how a destructive command rides a read allow.

### Pattern-based `commandEffects` (rejected at §7)

Both string-wildcard and token-sequence pattern maps were designed in full before rejection.
Patterns are positional and options are position-free, so the load-bearing case (`sed` unless `-i`) is inexpressible without either zero-width wildcards or a cross-entry precedence calculus — a reopening of the F5 two-readings trap inside a new key.
Structured command description dissolves the pattern grammar, the overlap rule, and the specificity question simultaneously.

### A distinct `redirect` surface (rejected at decision 1)

Proposed in implementable detail by [#785].
Rejected: it names a surface after a *syntax* rather than an effect, which is the pattern-matching treadmill this package has been on since [#301].
A redirect is one way to write a file; the policy the user wants is about writing, not about `>`.

### Adopting OpenCode v2's ordered rule list (rejected at decision 6)

Rejected: it does not address the gap.
Its `shell` resource is the raw command string, so it cannot govern a redirect either, and adopting it would dissolve decision 5's boundary distinction while churning all four flat-pair channels.
Its genuinely good idea — one `edit` action covering edit, write, and patch — is a separate ergonomic change this record does not make.

### Flat deny-then-ask-then-allow ordering (rejected at decision 6)

Claude Code's model.
Rejected: it cannot express a per-capability exception without a second axis regardless, and its documented precedence and observed behavior are reported to disagree, which is criterion 3's failure mode in a shipped product.

### Nested facets under `path` (rejected at decision 3)

Rejected: it requires reserving `read` and `write` inside path-family objects, since `path: { read: "allow" }` is a valid pattern rule today, and it would have users author one spelling while every prompt, log line, and persisted approval shows another.

### Dotted keys, `path.read` (rejected at decision 3)

Rejected: sitting beside a valid `"path": { … }` object, a dotted sibling reads as descent into it, and it would mix two separator conventions inside a config whose existing surface name is `external_directory`.

### Retiring bare `path` (rejected at decision 4)

Rejected: it breaks every existing config for no behavioral gain, and bare `path` is the correct spelling whenever direction does not matter.

### Per-bash-call sandbox invocation (rejected at decision 8)

Issue [#686] as proposed.
Rejected: a hard dependency on a pre-1.0 external binary, a platform matrix including WSL2, and per-call latency, for a boundary that is better established once at launch.
An externally launched sandbox remains the supported containment route (unverified for `nono` specifically; see Prior art), and [#802] makes the package's own policy usable as its input.

## Staging

1. **The direction axis.**
   — landed ([#806]).
   `path_read`, `path_write`, `external_directory_read`, `external_directory_write`, decision 4's sugar expansion and normative merge order, schema, examples, and docs.
   Tool-identity direction attribution is recorded in the 2026-08-25 amendment above.
   Relieves band A (~19% of current prompts, cause-joint) and gives the rest somewhere to land.
   This step must also convert ADR 0007 §5's delegation exclusion from literal-name membership to family membership, per decision 4, in the same commit as the new surface names — a directional key reaching an authorizer ahead of that conversion is a silent widening of the envelope.
2. **Effect leaf rules.**
   Per-token effect attribution in the collectors, the built-in pure-reader core, and `commandEffects` with guards and the `shellTools`-style merge.
   Relieves band B given directional grants.
3. **Wrapper transparency** ([#803]).
   Relieves the floored pure-reader prompts (~13% of current volume).
4. **[#609] and [#785].**
   Redirect operator classification, unconditional projection of output-redirect destinations including bare nonexistent ones, and ADR 0009's wording correction.
   Carries the breaking-change footer.
5. **Blame threading.**
   Verdict blame into prompts and session-approval suggestions.
6. **The sandbox seam.**
   `getPolicyScope()`, then [#802]'s launcher, then the enforced-scope declaration under §8's constraints.
7. **Structured bash rules** ([#804]).
   The `bash` surface's migration to the §10 config language, with load-time normalization of legacy string patterns.

Issue [#799] decides the channel set and consumes decision 9.
Issue [#620] carries the judgment slice the chain retains under §7.

[#301]: https://github.com/gotgenes/pi-packages/issues/301
[#306]: https://github.com/gotgenes/pi-packages/issues/306
[#472]: https://github.com/gotgenes/pi-packages/issues/472
[#490]: https://github.com/gotgenes/pi-packages/issues/490
[#575]: https://github.com/gotgenes/pi-packages/issues/575
[#599]: https://github.com/gotgenes/pi-packages/issues/599
[#603]: https://github.com/gotgenes/pi-packages/issues/603
[#604]: https://github.com/gotgenes/pi-packages/issues/604
[#609]: https://github.com/gotgenes/pi-packages/issues/609
[#620]: https://github.com/gotgenes/pi-packages/issues/620
[#645]: https://github.com/gotgenes/pi-packages/issues/645
[#680]: https://github.com/gotgenes/pi-packages/issues/680
[#686]: https://github.com/gotgenes/pi-packages/issues/686
[#691]: https://github.com/gotgenes/pi-packages/issues/691
[#692]: https://github.com/gotgenes/pi-packages/issues/692
[#694]: https://github.com/gotgenes/pi-packages/issues/694
[#698]: https://github.com/gotgenes/pi-packages/issues/698
[#706]: https://github.com/gotgenes/pi-packages/issues/706
[#741]: https://github.com/gotgenes/pi-packages/issues/741
[#785]: https://github.com/gotgenes/pi-packages/issues/785
[#799]: https://github.com/gotgenes/pi-packages/issues/799
[#802]: https://github.com/gotgenes/pi-packages/issues/802
[#803]: https://github.com/gotgenes/pi-packages/issues/803
[#804]: https://github.com/gotgenes/pi-packages/issues/804
[#806]: https://github.com/gotgenes/pi-packages/issues/806
[#807]: https://github.com/gotgenes/pi-packages/issues/807
[openai/codex#28732]: https://github.com/openai/codex/issues/28732
