---
issue: 789
issue_title: "pi-permission-system: consolidate the subagent adapter convention and loading-asymmetry docs (ADR 0012 decisions 5–6)"
---

# Retro: #789 — Consolidate the subagent adapter convention and loading-asymmetry docs

## Stage: Planning (2026-08-21T19:15:22Z)

### Session summary

Planned the consolidation of [ADR 0012] decisions 5 and 6 into the shipped docs as a cross-package plan at `docs/plans/0789-subagent-adapter-convention-docs.md`.
Investigation found that the issue's fourth scope bullet (rewriting `cross-extension-api.md` for the keyed channel) already landed with `8ed137c6` (#699) and `bc31193a` (#787), leaving only its subagent subsection in scope, and that decision 5's stated out-of-process obligation does not work — so the plan folds in a one-cycle `fix:` before any doc states it.
Three follow-up issues were filed for the exclusion hazards surfaced along the way: [#791], [#792], [#793].

### Observations

- **The ADR's contract was not honored by the code.**
  `PI_SUBAGENT_PARENT_SESSION` is in `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES` but not `SUBAGENT_ENV_HINT_KEYS`, so a spawner following decision 5 literally is undetected, takes the no-UI/not-subagent arm of `selectAuthorizer`, and is blocked by `DenyingAuthorizer` without forwarding.
  The existing round-trip tests encode the gap in their own arrangement — `test/composition-root.test.ts:428` stubs `PI_SUBAGENT_CHILD` *and* the parent-session var, with a comment explaining why both are needed.
  That comment is the strongest evidence in the plan and it was written by a prior session that did not notice what it implied.
- **The chosen fix composes rather than duplicates.**
  Adding the literal string to a second array was the obvious one-liner; composing `SUBAGENT_ENV_HINT_KEYS` from the third-party inventory plus the parent-session candidates encodes the reason ("a process that names a parent session is a child") and prevents the next candidate from reintroducing the gap.
- **The operator reopened decision 6's framing at the gate**, asking for something more seamless for the end user than a documented hazard.
  That produced the sharpening that matters: excluding a package also removes its tools from children, so a single package providing both a tool and its extractor leaves no gap — the hazard requires a *split* between a tool provider and an extractor provider.
  A general warning became a condition an operator can check.
- **Two more severe misconfigurations surfaced while enumerating scenarios**, neither previously tracked: an `excludedExtensionPackages` entry that matches no configured package source is silently inert ([#791]), and excluding `@gotgenes/pi-permission-system` itself leaves in-process children with no `tool_call` gate at all ([#792]).
  Both are reachable with one line of JSON and nothing reports either.
- **Alternatives rejected:** a separate `docs/subagent-adapter-convention.md` (ADR 0012 names `subagent-integration.md` as the canonical home); rewriting [ADR-0002]'s body lines 43/95 (an accepted record is not a status board — an appended amendment follows its own #696 precedent); repointing the two source module headers and pi-subagents' README/comparison doc (excluded at the gate).
- **Release framing:** neither package has an open improvement phase, so `roadmap-fit` exits at step 1 for all three filed issues and the plan ships independently.
  Both packages' `docs/decisions` and `docs/architecture` are `exclude-paths` entries, so only `subagent-integration.md`, `cross-extension-api.md`, the README row, and pi-subagents' `configuration.md` drive releases.

[ADR 0012]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0012-cross-node-extension-contract.md
[ADR-0002]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/decisions/0002-extensions-on-a-minimal-core.md
[#791]: https://github.com/gotgenes/pi-packages/issues/791
[#792]: https://github.com/gotgenes/pi-packages/issues/792
[#793]: https://github.com/gotgenes/pi-packages/issues/793
