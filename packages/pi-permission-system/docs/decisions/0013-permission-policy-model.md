---
status: accepted
date: 2026-08-22
---

# 0013 — The permission policy model: capability as an axis

## Status

Accepted.
This decision settles the shape of the deterministic policy model: whether access capability (reading versus writing a path) becomes first-class, how it is spelled in config, what composes with what, and where the enforcement boundary of this package lies.
It composes with `docs/decisions/0009-bash-path-projection-completeness-contract.md`, whose layering asymmetry it preserves unamended, and with `docs/decisions/0007-model-judge-authorizer-chain-adr.md`, to which it routes every judgment the deterministic layer cannot prove and whose delegation exclusions it restates as surface families (§4) so they survive the new key names unamended.
It decides the *shape* of policy only; which channels policy may enter through is decided separately by [#799].
Nothing changes in code with this record; the decisions here are implemented by downstream issues, staged below.

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

The motivating framing of [#609] is restriction.
The measured prompt population says the model's missing axis costs far more in prompts it cannot *avoid* than in writes it cannot govern.

Over 1141 human-facing `permission_request.waiting` entries in the local review log, test fixtures excluded:

| Cause                | Share       |
| -------------------- | ----------- |
| `external_directory` | 846 (74.1%) |
| bash command rule    | 107 (9.4%)  |
| tool or other        | 90 (7.9%)   |
| bash wrapper floor   | 70 (6.1%)   |
| `path` surface       | 28 (2.5%)   |

Classifying the `external_directory` bucket by direction, using a ~40-word command table that left 1.8% unclassified:

| Direction                                | Share of 846 |
| ---------------------------------------- | ------------ |
| read — bash with read-only command words | 484 (57.2%)  |
| read — read-only tool                    | 213 (25.2%)  |
| write — bash redirect or mutating word   | 83 (9.8%)    |
| write — mutating tool                    | 51 (6.0%)    |
| unknown                                  | 15 (1.8%)    |

Broken down by month, to test whether this is an artifact of recent behavior:

| Month   | Asks | External | Ext share | Read share of classified | Wrapper floor |
| ------- | ---- | -------- | --------- | ------------------------ | ------------- |
| 2026-05 | 630  | 488      | 77%       | 83%                      | 1             |
| 2026-06 | 201  | 201      | 100%      | 89%                      | 0             |
| 2026-07 | 164  | 120      | 73%       | 85%                      | 44            |
| 2026-08 | 146  | 37       | 25%       | 67%                      | 25            |

Three readings, and the third is the durable one.

The `external_directory` **share** is not stable: 488 of the 846 come from May, and it has since fallen to 25%.
The cause is visible in the May samples (`cd ~/development/pi/pi-github-tools`, `find ~/development/pi/pi-autoformat …`): those were sibling repositories then and are packages inside this monorepo now, so formerly-external paths became in-tree.
Boundary pressure is a function of repository layout, and no aggregate over it should be quoted as a stable rate.

The wrapper-floor population is **new mechanism, not changed behavior** — the indirection floor ([#490], [#575]) shipped in July, which is why the column is empty before it.
Sampled, those floored commands are pure reads: `xargs grep -l …`, `xargs wc -l`, `xargs dirname`, `find … -exec wc -l {} +`.

The **read share is stable**: 83%, 89%, 85%, 67% across four months, against two different dominant causes.
That is the fact this record is built on.
The overwhelming majority of what the boundary stops is reading, and the model has no way to say so.

### Prior art

Surveyed for policy axis, key naming, composition, default stance, unknown-handling, and escalation UX.

| System      | Axis                            | Read/write spelling                                                       | Composition                                                                   |
| ----------- | ------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| OpenCode v2 | action + resource, ordered list | `read` / `edit` (edit covers write and patch)                             | last matching rule wins; most-restrictive across an operation's resources     |
| Claude Code | tool + specifier                | `Read(…)` / `Edit(…)`                                                     | deny, then ask, then allow; first match in that order; specificity irrelevant |
| Codex CLI   | sandbox mode + approval policy  | `read-only` / `workspace-write`                                           | two orthogonal dials                                                          |
| Deno        | capability                      | `--allow-read` / `--allow-write`                                          | `--deny-*` unconditionally beats `--allow-*`                                  |
| Node        | capability                      | `--allow-fs-read` / `--allow-fs-write`, scopes `'fs.read'` / `'fs.write'` | additive allow-list; no deny                                                  |
| Landlock    | right set on an object          | `LANDLOCK_ACCESS_FS_READ_FILE` / `WRITE_FILE`                             | union within a layer, intersection across stacked layers                      |
| Seatbelt    | operation + filter              | `file-read*` / `file-write*`                                              | not verified against a primary Apple source                                   |
| WASI        | rights on a handle              | `rights.fd_read` / `rights.fd_write`                                      | monotonic attenuation by construction                                         |
| systemd     | object with a mode              | `ReadOnlyPaths=` / `ReadWritePaths=`                                      | deeper path overrides the enclosing directive                                 |
| nono        | path grant with a direction     | `--read` / `--write` / `--allow`                                          | profile composition; `network.block` ratchets                                 |

Four findings bear directly on the decisions below.

**Read and write as literal words is the near-universal spelling.**
No surveyed system uses an alternative vocabulary.

**Most-restrictive composition across independent policy layers is precedented, not exotic.**
Landlock states it exactly: a sandboxed thread may access a path only if *all* enforced layers grant it.
OpenCode v2 independently applies the same rule across the resources of one operation — deny if any resolves to deny, else ask if any resolves to ask.

**The origin project has already adopted the ordered-list model, and it does not solve this problem.**
OpenCode v2 replaced its actor-keyed object with an ordered array of `{action, resource, effect}` rules.
Its `shell` action's resource is "the complete raw shell command string," so it can no more govern `> out.txt` than this package can.
It also keeps `external_directory` as a separate action decided *before* the tool's own decision — the same two-layer structure this package arrived at independently.

**The two closest peers pair a decision layer with an OS sandbox as complementary tiers, and one of them ships the translation.**
Claude Code: "Filesystem restrictions in the sandbox combine the `sandbox.filesystem` settings with Read and Edit deny rules; both are merged into the final sandbox boundary," and with `autoAllowBashIfSandboxed` at its default the sandbox boundary "substitutes for that whole-tool prompt" while explicit denies and content-scoped asks still fire.

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
The measured read share is the warrant: the model's inability to distinguish a read from a write is why a user who wants to permit reading outside the working tree must also permit writing there, and therefore permits neither.

[#609]'s restriction of redirect writes is a consequence of the same axis, not its motivation.

This also names one defect behind eight open issues.
[#706], [#680], [#620], [#698], [#472], [#604], [#603], and [#686] are eight mechanisms aimed at one gap: the model cannot express *this is only a read, so it is fine*.

### 2. The vocabulary is read and write

Two capabilities ship: read and write.

`delete` was considered and deferred.
It is a real distinction — the unrecoverable effect is not the recoverable one, and Landlock separates `REMOVE_FILE` and `REMOVE_DIR` from `WRITE_FILE` — but a bash delete is knowable only from command knowledge, which decision 7 routes to the judge chain.
Declaring a config key nothing can populate would be a maintenance trap of exactly the kind this package refuses.
`delete` is recorded here as a recognized future refinement of `write`, addable without restructuring the axis.

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

One consequence of the expansion is security-relevant, and is decided here rather than left to be discovered during implementation.
ADR 0007 §5's bounded-delegation envelope caps an authorizer link's `allow` on the `external_directory` and `path` surfaces, and it is enforced by exact string membership — `DELEGATION_EXCLUDED_SURFACES` holds those two literal names and is tested against the gate-authoritative `accessIntent.surface`.
After expansion the gate surface an authorizer sees is a directional name, so a literal-membership test would stop matching and a link's `allow` on a path write would pass the envelope unchecked.

**The exclusion is therefore over a surface *family*, not a literal name.**
`path` names the family `path`, `path_read`, `path_write`; `external_directory` names its own.
Every member is excluded, and a capability added to a family later is excluded by default, because the family is the unit rather than the enumeration.

This does not amend ADR 0007.
Its envelope covers exactly what it always covered; stating the rule this way is what keeps that true once a surface name can carry a suffix.

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

### 6. Composition is unchanged

Last-matching-pattern wins within a surface; most-restrictive wins across surfaces.

Criterion 2 put the lattice itself on the table and it survives, on evidence rather than inertia.
Landlock states this exact rule for stacked layers, and OpenCode v2 applies it across an operation's resources.
The alternatives are worse: Claude Code's flat deny-then-ask-then-allow ordering cannot express "allow this command but not its writes" without a second axis anyway, and its own documented precedence and observed behavior disagree in practice.
A single flat ordered list would dissolve decision 5's distinction, letting a permissive pattern rule loosen the boundary — which is what makes a boundary a boundary.

The perceived complexity of the lattice was never its arity.
It was that one of its layers was undeclared as a different kind of rule, which decision 5 fixes.

### 7. Writes are proven structurally; reads are judged by the chain

The deterministic layer classifies a bash path operand as a **write** only where the syntax proves it: an output redirect destination (`>`, `>>`, `>|`, `&>`), distinguished from an input redirect (`<`, `<<`, `<<<`) and from file-descriptor duplication (`2>&1`), which is not a file write at all.

The deterministic layer does **not** classify reads.
It has no command-effects knowledge base, and it acquires no read-only command allowlist.

The asymmetry is the reason, and it is ADR 0009's:

- A **write** table fails closed.
  A mutator it misses falls through to unproven, which still asks.
- A **read-only** table fails open.
  A command it wrongly believes harmless is allowed to write outside the tree.

ADR 0009 already rejected per-command argument tables as a deterministic-layer mechanism and routed per-command judgment to the model-judge chain, on the asymmetry that over-suppression is unrecoverable while over-surfacing is recoverable.
That routing stands unamended.
Where a read classification would retire a prompt, the chain ([#620], [#698]) supplies it with the full command in view, or decision 8 removes the need for it.

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

The seam is bidirectional, because the export alone delivers enforcement and no prompt relief.
The reciprocal is a declaration that a scope is already enforced, which lets the package skip prompts for accesses the kernel has constrained — Claude Code's `autoAllowBashIfSandboxed`, arrived at from the same reasoning.
It dissolves decision 7's fail-open problem outright: nothing need *prove* that `xargs grep` only reads, because the root it can reach is mounted read-only.

Three constraints bound that declaration, and all three are required:

1. **It is verified, not trusted.**
   A `read` grant is checked by attempting a write into it and requiring the failure.
   A claim that fails verification is discarded.
   The claim is about the filesystem, so it is falsifiable cheaply — this is the only reason accepting it is admissible at all.
2. **It suppresses `ask` and never `deny`.**
   Explicit denies and content-scoped asks still fire, as they do under Claude Code's substitution.
3. **It originates outside the agent's reach.**
   A launcher establishes it before the session starts; nothing emitted during a session may assert it.

Issue [#686]'s proposed nested `bash: { read, write, network }` config shape is not adopted — decision 3 settles spelling — and neither is per-bash-call invocation of an external binary, which would take a hard dependency on a pre-1.0 tool, a platform matrix, and per-call latency for a boundary better established once at launch.
`network` is out of scope for this record: this package has no network surface today, and adding one is not a policy-shape question.

### 9. What any policy source must satisfy

Supplied as input to [#799], which decides the channel set.

- **Flat `(surface, pattern)` pairs are the universal vocabulary.**
  Every channel already speaks them and this record adds none.
  A source that expresses policy differently must normalize to them before composition.
- **Sugar expands at load, before composition.**
  Decision 4's expansion is a property of loading, not of any one file format, so every source is normalized identically and no source can introduce a surface the others cannot express.
- **A persisted rule is written in a directional key or a sugar key, never a third form.**
  A source that writes rules back (as [#691] and [#692] propose) emits the same vocabulary a human would author.
- **Direction does not create a new precedence tier.** `path_read` and `path_write` are surfaces; they merge across scopes by the existing global → project → agent order and compose by decision 6.

## Consequences

- A user can permit reading outside the working tree without permitting writing there, which is the measured majority of what the boundary currently stops.
- Existing configs are unaffected on upgrade.
  Decision 4 makes the axis non-breaking by construction, so no migration tooling is required.
- [#609] and [#785] are answerable: a redirect destination is provably a write and is governed by `path_write` and `external_directory_write`.
- One breaking change remains, and it is the projection fix rather than the axis.
  A bare nonexistent redirect destination escapes every surface today; once projected, a user with an explicit `path` rule sees a new prompt.
  This ships following ADR 0009's own [#645] precedent, with a `BREAKING CHANGE:` footer and a migration note.
  Users with no explicit `path` rules are unaffected, because ADR 0009's unmatched-promotion guard leaves them unrestricted.
- ADR 0009's guarantee wording is inaccurate as written and is corrected alongside that fix, not by this record.
- The architecture doc's sandboxing boundary row and `docs/troubleshooting.md` §Threat Model both change, together, per decision 8.
- Two config keys and their schema, examples, and documentation follow from decision 3; `PATH_SURFACES` gains both, and `DELEGATION_EXCLUDED_SURFACES` becomes a family test rather than a literal set (decision 4).
- ADR 0007's envelope keeps its exact current scope, which is only true because decision 4 restates the exclusion as a family.
  A literal-membership test surviving the new key names would have silently let an authorizer link grant a path write.
- The judge chain becomes load-bearing for read classification rather than optional. [#620] is no longer a speculative slice; it is where decision 7 sends the work it declines to do deterministically.
- `delete` is a known gap, deliberately unshipped, with a recorded reason.

## Alternatives considered

### Effects primary with a command-effects knowledge base (rejected at decision 1)

Effects as the spine, classified by a curated table consolidating `PATTERN_FIRST_COMMANDS`, the wrapper sets, and `SAFE_SYSTEM_PATHS`.
Rejected: it overturns ADR 0009's rejection of per-command tables without a bound, and decision 7's asymmetry shows the table that would deliver the measured prompt relief is the fail-open one.

### A curated read-only command set in the deterministic layer (rejected at decision 7)

The ~40 words that classified 98.2% of the measured traffic, declared as a closed set.
Rejected: it is cheap and fast and it fails open, which is the single property ADR 0009 refuses.
Decision 8 obtains the same relief from enforcement rather than from belief.

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
`nono run -- pi` already works today and remains the supported way to obtain containment; decision 8 makes the package's own policy usable as its input.

## Staging

1. **The direction axis.**
   `path_read`, `path_write`, `external_directory_read`, `external_directory_write`, decision 4's sugar expansion, schema, examples, and docs.
   Ships the measured prompt relief and gives the rest somewhere to land.
   This step must also convert ADR 0007 §5's delegation exclusion from literal-name membership to family membership, per decision 4, in the same commit as the new surface names — a directional key reaching an authorizer ahead of that conversion is a silent widening of the envelope.
2. **[#609] and [#785].**
   Redirect operator classification, unconditional projection of output-redirect destinations including bare nonexistent ones, and ADR 0009's wording correction.
   Carries the breaking-change footer.
3. **The sandbox seam.** `getPolicyScope()` first, then the verified enforced-scope declaration.

Issue [#799] decides the channel set and consumes decision 9.
Issue [#620] carries the read-classification work decision 7 routes to the chain.

[#301]: https://github.com/gotgenes/pi-packages/issues/301
[#472]: https://github.com/gotgenes/pi-packages/issues/472
[#490]: https://github.com/gotgenes/pi-packages/issues/490
[#575]: https://github.com/gotgenes/pi-packages/issues/575
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
