---
issue: 639
issue_title: "pi-permission-system: decide the permission policy model — capabilities, config shape, prior art (ADR 0009)"
---

# Retro: #639 — decide the permission policy model (ADR 0009)

## Stage: Planning (2026-02-14T00:00:00Z)

### Session summary

This session began as `/plan-issue` for [#609] (third-party, `hcrosse`: govern bash output redirects separately from the command) and deliberately widened.
Successive `ask_user` gates moved the operator from a wrapper-style `ask` floor, through path-surface routing, through a `path_read`/`path_write` capability-facet design, to the decision that the permission policy model itself deserves a deliberative ADR with nothing locked down — including the current config format.
Filed [#639] as the dedicated ADR issue (the [#581]/[#591] precedent), committed plan `docs/plans/0639-permission-policy-model-adr.md`, and left [#609] open to be re-planned after the ADR lands.

### Observations

- Key technical findings from [#609] exploration, needed by the eventual implementation: `BashProgram.commands()` strips redirects from command text; `collectRedirectTokens` gathers targets but they are shape-filtered like any token, so a bare in-cwd target (`> out.txt`) is not a rule candidate today; tree-sitter `file_redirect` nodes expose the operator as an anonymous child (`>`, `>>`, `&>`, `>&`) plus an optional `file_descriptor`, and a `>&`-to-`number` form (`2>&1`) is an fd-duplication, not a file write; `<> rw.txt` parses with an `ERROR` node.
- Operator's decision criteria, stated verbatim: clarity, simplicity ("straightforward, avoiding complex calculus of interactions between rules, and ambiguity"), user-first.
  The "calculus of interactions" phrase puts the most-restrictive multi-surface lattice itself on the table — the plan's option O6 (single ordered rule list) exists for that reason.
- Leanings recorded but explicitly reopened by the operator: `path_read`/`path_write` naming over `fs.*`; shipped `ask` default for redirect writes (breaking, `feat!:`); the effect-centered sketch (structural proof + command-effects knowledge base + explicit unknowns) as one candidate, not the target.
- Nesting facets under `path` was analyzed and found grammatically ambiguous (`path: { "read": "allow" }` already means a file literally named `read`; `denyWithReason` object values collide with a map-valued discriminator) — the analysis should ride into the ADR.
- Prior-art naming survey done in-session (Node `--allow-fs-read`/`--allow-fs-write`, Landlock `ACCESS_FS_*`, Seatbelt `file-read*`, Deno, WASI, systemd); the full survey with citations is Build Order step 1.
- Process note: the operator answered only part of some `ask_user` gates and asked follow-up questions in the notes — treating each partial answer as a redirection (not re-asking the same question) kept the conversation productive.
- The `/build-plan` session must run survey → `ask_user` decision gates → prose, in that order; the [#581] revert (transcription instead of deliberation) is the named failure mode.

## Stage: Planning — refresh (2026-08-22T05:35:27Z)

### Session summary

Re-planned [#639] against current `main` and found the committed plan (`3a113c11`, 2026-07-23) stale rather than stale-in-detail: the ADR slot it reserved was taken the next day by the bash path projection contract, and four ADRs have landed since.
Refreshed `docs/plans/0639-permission-policy-model-adr.md` in place as ADR **0013**, retitled the issue to match, widened the option space from O1–O6 to O1–O8 with the two contributed proposals, split the policy-source channel question into its own ADR issue ([#799]), and recorded a measured baseline of the redirect projection so [#609]'s re-plan inherits facts rather than prose.

### Observations

- Measured at planning time with a disposable vitest spike over `BashProgram.parse` (deleted after): a bare **nonexistent** redirect destination (`> out.txt`) reaches neither path surface, while `> existing.txt`, `> /tmp/out.txt`, and `> sub/new.txt` all do.
  The six-row table is in the plan's Background and is re-run as Build Order step 1.
- That measurement contradicts ADR 0009, which lists a redirect target among the projection's **guarantees** (with `> out.txt` as its own example) and asserts redirect targets are unaffected by the nonexistent-bare-write-target residual.
  Collection is real (`collectRedirectTokens`); classification then drops the token.
  By ADR 0009's own triage rule this is inside the contract — a defect, same shape as [#694]'s `$HOME` half and [#741]'s hosted substitutions.
  Operator's gate: leave the fix to [#609]'s re-plan (redirects touched once) rather than filing it separately, so the plan's job is to make the inheritance reliable.
- Two third-party inputs the original plan predates, both explicitly routed to [#639] by the operator: [#785] (closed duplicate of [#609]) contributed a concrete `redirect` surface with AST write-provenance — now option O7 — and independently found the bare-nonexistent gap; [#686] (open, PR offered) contributed sandbox delegation with a nested `bash: { read, write, network }` shape — now option O8.
- [#686] collides with a declared boundary (architecture.md's "Sandboxing or containment — this decides and records, it does not isolate", sourced to `troubleshooting.md` §Threat Model).
  Operator's gate put it in the option space as a full candidate the ADR decides, so the boundary is itself under review; the plan records that both documents must end up agreeing, since the table cites the other.
- The channel half of architecture.md's open-question paragraph was never in this plan's scope but was assigned to [#639] by that prose.
  Filed [#799] for it; it blocks [#675], [#692] (for [#691]), and [#638], and consumes this ADR's shape constraints, so it plans after ADR 0013 lands.
  `roadmap-fit` exited at step 1 — the package has no open improvement phase.
- Refreshing in place rather than opening a new plan number was deliberate: same issue, same stage, never executed.
  The alternative would have orphaned a committed plan whose Background is still 80% correct.

[#581]: https://github.com/gotgenes/pi-packages/issues/581
[#591]: https://github.com/gotgenes/pi-packages/issues/591
[#609]: https://github.com/gotgenes/pi-packages/issues/609
[#638]: https://github.com/gotgenes/pi-packages/issues/638
[#639]: https://github.com/gotgenes/pi-packages/issues/639
[#675]: https://github.com/gotgenes/pi-packages/issues/675
[#686]: https://github.com/gotgenes/pi-packages/issues/686
[#691]: https://github.com/gotgenes/pi-packages/issues/691
[#692]: https://github.com/gotgenes/pi-packages/issues/692
[#694]: https://github.com/gotgenes/pi-packages/issues/694
[#741]: https://github.com/gotgenes/pi-packages/issues/741
[#785]: https://github.com/gotgenes/pi-packages/issues/785
[#799]: https://github.com/gotgenes/pi-packages/issues/799

## Stage: Implementation — Build (2026-08-23T04:16:23Z)

### Session summary

Executed all six Build Order steps and landed ADR 0013, `docs/decisions/0013-permission-policy-model.md`, plus its reconciliation across `architecture.md`, `troubleshooting.md`, and `README.md`.
The deliberation ran survey → gates → prose as the plan required, over eight `ask_user` rounds, and the operator's pushback reversed the ADR's central thesis midway.
Four commits: the ADR, the reconciliation, an exclusion-scope fix found by the pre-completion reviewer, and these notes.

### Observations

- **The thesis inverted mid-session, on measurement.**
  The plan framed the ADR around [#609]'s restriction of redirect writes.
  Measuring the local review log showed the missing axis costs far more in prompts it cannot *avoid*: of 846 `external_directory` asks, 82.4% were reads.
  The ADR's decision 1 now states that direction exists so a user can safely allow the common case, and names one defect behind eight open issues ([#706], [#680], [#620], [#698], [#472], [#604], [#603], [#686]).
- **The operator caught a recency-bias error in my own aggregate, not in their recollection.**
  I led with "61% of all prompts", which was May-weighted: 488 of 846 external asks came from one month, and the share has since fallen to 25% because sibling repositories became packages in this monorepo.
  The durable fact is the read share (83% / 89% / 85% / 67% across four months), stable against two different dominant causes.
  Lesson: bucket a log aggregate by time before quoting it as a rate.
- **Two `ask_user` gates were answered with questions rather than options, and both improved the outcome.**
  "Pause on `ask_user`, ask me about my own pain points" produced the thesis inversion.
  "What makes external paths so special?
  They could be expressed as the path surface" produced decision 5 — `external_directory` is a relational scope rule whose reference point moves, which is why no glob can express it, and which converts the documented "a `path` allow cannot suppress an `external_directory` ask" gotcha from an exception into a consequence.
- **I was wrong about the nesting ambiguity and the operator was right to push.**
  The documented collision applies to nested facets (`path: { read: … }`), not to a flat key with a separator.
  Verified against `config-schema.ts`: `permission` is an open `z.record` and nothing splits a surface name.
  The operator then rejected the dotted spelling on better grounds than I had offered — `external_directory` already establishes underscore as this config's separator, and `"path.read"` beside a valid `"path": {…}` object reads as descent.
  Settled on `path_read` / `path_write` / `external_directory_read` / `external_directory_write`.
- **Prior art reframed the option space.**
  OpenCode v2 has already adopted the ordered `{action, resource, effect}` list that was option O6, and it does *not* fix [#609] — its `shell` resource is the raw command string.
  It also kept `external_directory` as a separate composing decision, independently reaching this package's two-layer structure.
  Landlock states the most-restrictive-across-layers rule verbatim, so the lattice survived criterion 2 on evidence rather than inertia.
- **[#686] was adopted rather than declined, and the boundary moved.**
  "This decides and records, it does not isolate" became "this decides and records; a sandbox contains", with a bidirectional `PolicyScope` seam on `PermissionsService` per ADR 0012.
  The reciprocal input is what claims the prompt relief, and it is admissible only because it is falsifiable — a `read` grant is verified by attempting a write and requiring the failure.
- **`delete` was gated in and then deferred.**
  The operator chose read/write/delete at gate 2, then chose read/write only at gate 8 once it was clear nothing could populate `delete` for a bash command under decision 7's routing.
  Recorded as a known gap with a reason rather than shipped as an unread config key.
- **Reviewer verdict: WARN, then PASS after the fix.**
  The WARN was the one item I flagged as least-confident when dispatching, and it was correct: ADR 0007 §5's envelope tests exact string membership against the gate surface, so decision 4's expansion would have silently stopped excluding a link's `allow` on a path write.
  Fixed in `3baeb5ce` by scoping the exclusion to a surface *family* and requiring the code conversion in the same commit as the new surface names.
  Naming the low-confidence item in the dispatch prompt is what got it checked hardest — worth repeating.
- **Deviation from the plan:** `README.md` was listed as not-edited on the grounds that it describes current behavior.
  Its non-goals section is a charter and named [#639] as the open channel decision, so it would have shipped a stale pointer.
  Recorded in `8a899da1`'s commit body.
- **An `Edit` call tripped the `external_directory` gate** by dropping the `pi-packages/packages/` prefix from an otherwise-correct absolute path — the exact failure mode AGENTS.md prescribes repo-relative paths to avoid.

[#472]: https://github.com/gotgenes/pi-packages/issues/472
[#603]: https://github.com/gotgenes/pi-packages/issues/603
[#604]: https://github.com/gotgenes/pi-packages/issues/604
[#620]: https://github.com/gotgenes/pi-packages/issues/620
[#680]: https://github.com/gotgenes/pi-packages/issues/680
[#698]: https://github.com/gotgenes/pi-packages/issues/698
[#706]: https://github.com/gotgenes/pi-packages/issues/706

## Stage: Pressure test — NOT SHIPPED (2026-08-23T16:30:18Z)

### Session summary

The operator asked for an adversarial review before shipping.
A fresh-context reviewer on `anthropic/claude-fable-5` returned **do not ship as written**, and the dispatcher verified the blocking findings independently.
ADR 0013 is committed on `main` but **must not be shipped or cited until amended** — full report in `0639-pressure-test.md`.

### State on pause

Committed and correct: the ADR's decisions on spelling (`path_read` / `path_write`), sugar expansion, the relational-boundary framing, composition, and the sandbox tier.
Committed and **wrong**: every measurement in the ADR's "Measured" sections, and the relief claims that rest on them.

Open decisions blocking a ship, both requiring the operator:

1. **F4 — the unknown-direction rule.**
   Which surface does an access consult when direction cannot be proven?
   This is 67.5% of external asks and the ADR never states it.
   A gate was drafted with three options (consult both under most-restrictive; consult write; consult read) and was not answered before the pause.
2. **F5 — intra-surface merge order** between sugar-expanded entries and explicit directional keys.

### Observations

- **The measurement bug that started it.**
  The review log has two schemas; entries from 2026-08-17 carry `surface`/`matchedPattern` and no `message`, and every measurement this session keyed on `message`.
  That silently dropped 72 `external_directory` asks, all in the most recent month — which manufactured the "external pressure fell to 25%" narrative and its monorepo-consolidation explanation.
  Corrected, the external share is stable at 72–80% across all four months.
  Lesson: check a log's schema for version drift before aggregating it, and commit the instrument with the number.
- **I compounded the bug by arguing from it.**
  Mid-session I told the operator their recollection tracked reality better than my aggregate, on the strength of the artifact.
  The opposite was true.
  A derived narrative delivered confidently is worse than no narrative; the correction should have been triggered by the implausibility of a 73% → 25% single-month swing.
- **The headline came from the mechanism the ADR rejects.**
  Decision 7 refuses a read-only allowlist because it fails open, and 82.4% was produced by exactly such a table counting `git`, `node`, `sed`, `xargs` as reads.
  Strict re-run: 29.6% read, 17.8% write, **52.6% unprovable**.
  Reads still beat writes ~63:37 among classifiable asks, so decision 1's direction holds and its magnitude does not.
- **The relief story has no working mechanism at any stage.**
  Step 1 relieves 236 of 918 external asks (20.6% of all human asks) because only read-*tool* direction is knowable from the actor; 620 (67.5%) are bash.
  Decision 7 routes those to the judge chain, but decision 4's family exclusion caps a link's `allow` on exactly those surfaces — and [#620], the issue decision 7 depends on, exists to *relax* that exclusion.
  **Decisions 4 and 7 contradict each other**, which no reviewer caught until the adversarial pass.
- **The earlier `pre-completion-reviewer` PASS did not catch any of this.**
  It verified internal consistency, conventions, and cross-references — all real — but took the ADR's own measurements as premises.
  An adversarial reviewer given the raw log instead of the conclusions found four blocking defects in one pass.
  Naming my own weakest claims in the dispatch prompt is what made it productive, and it is the same move that surfaced the ADR 0007 finding earlier.
- **One false positive, still useful.**
  The reviewer judged the OpenCode citation unreproducible; it had checked the v1 docs, while the ADR's claims come from `opencode.ai/v2/docs/permissions` and are verbatim there.
  The defect it exposes is real: the ADR cites no URL, so a reader lands on v1 and concludes the record is wrong — exactly what happened.
- **Process note for the next session.**
  The plan's Build Order never required the unknown-direction rule to be decided, so eight `ask_user` gates settled spelling and posture while the model's central semantic rule went unasked.
  A deliberative-ADR plan should enumerate the rules the model must define, not only the parameters the issue raised.
