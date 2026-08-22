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
