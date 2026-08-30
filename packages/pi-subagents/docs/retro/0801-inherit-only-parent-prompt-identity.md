---
issue: 801
issue_title: "duplicate available_skills section in subagent's prompt"
---

# Retro: #801 — duplicate available_skills section in subagent's prompt

## Stage: Planning (2026-08-30T19:00:47Z)

### Session summary

Diagnosed the reported duplicate `<available_skills>` catalogue as a boundary flaw in prompt inheritance: `buildAgentPrompt` embeds the parent's fully assembled system prompt verbatim, including the layers Pi resolves per session, and the child's own session rebuilds them.
Settled on truncating the inherited prompt at the first per-session layer — so a child inherits only Pi's identity region — rather than excising the catalogue and footer while keeping the parent's extension-appended tail.
Wrote `docs/plans/0801-inherit-only-parent-prompt-identity.md` (four TDD steps: one Tidy-First fixture preparation, one `fix:`, two `docs:`) and filed [#846] against `@gotgenes/pi-nocd`.

### Observations

- **The report understated itself.**
  The title names `available_skills`, but the pasted prompt duplicates the `Current working directory:` footer at the same two positions.
  Reading the paste rather than the title is what turned this from a one-appendage patch into the principled rule.
- **A third-party issue, and the gate earned its keep.**
  `SeniorPlayer` is not the gh CLI user, so the direction gate was mandatory.
  It bounced twice — first for an unexplained caching argument, then for undefined terms (`prefill`) — and both bounces produced corrections rather than restatements.
- **Two of my own claims were wrong and the operator's questions caught them.**
  I listed `excludedExtensionPackages` ([#696]) as a case where a child's skill set differs from its parent's; it is not — `package-exclusions.ts` sets only `extensions: []` and its docstring says skills, prompts, and themes are untouched.
  I also asserted extensions re-append in children without verifying it, then traced the chain properly (`bindExtensions` at `create-subagent-session.ts:245`, `session.prompt()` at `subagent-session.ts:123,147`, unconditional `emitBeforeAgentStart` at `agent-session.js:914`).
  The verified claim is about the mechanism; the third-party appender population stays unenumerable, and that is the plan's accepted residual.
- **The caching provenance mattered and was recoverable.**
  The operator remembered a user harmed by a prompt-caching regression but not the issue.
  It is [#180] (with follow-up [#400]), reporter `@jeffutter`, running a local model on a weak iGPU: 8,333 shared tokens ≈ 40 s of prefill.
  Quantifying against his own measured rate is what made the choice decidable — the duplicated catalogue never cost him prefill time (it sat inside his cached prefix), it cost context length, and truncation costs him nothing at all where excision would have cost ~0.3 s per spawn.
- **[#640]'s carve-out fell out on its own.**
  Its equal-cwd exception existed solely to preserve the byte-identical prefix.
  The catalogue sits ahead of the footer, so once the catalogue is cut the footer is already past the divergence point and the argument is void.
  That is a case of a prior decision's rationale expiring silently — the ADR exists so the next session does not re-derive it from a plan.
- **`@gotgenes/pi-anthropic-auth` was checked and is unaffected.**
  Both of its span anchors (`PI_DEFAULT_PROMPT_PREFIX`, `PI_DEFAULT_PROMPT_TERMINATOR`) are lines of Pi's built-in preamble, inside the region truncation preserves.
  Its own constant docstring states the assumption the change satisfies.
- **`pi-permission-system` is a pure beneficiary.**
  `skill-prompt-sanitizer.ts` parses every catalogue in a prompt and currently double-counts the duplicated entries into `visibleEntries`.
  No change owed to it, but worth knowing the multi-section support was not built for this and stays useful.
- **Scope decisions.**
  The operator chose truncation over excision on an accuracy-first rationale, chose three documentation artifacts (a `configuration.md` section, a README extension-author warning, and ADR 0006), and chose to file the `pi-nocd` drift as [#846] rather than widen the plan across two independently released packages.
  `roadmap-fit` exited at Step 1 for [#846] — `pi-nocd` has no architecture doc and therefore no open phase.

#### Deferred tidyings

- `packages/pi-subagents/test/session/prompts.test.ts` — the roughly fifteen other tests each hand-build an `AgentConfig` object literal (`"appender"`, `"clone"`, `"standalone"`, `"ordered"`, `"no-parent"`); the assessor rejected deduplicating them as scope creep since this change touches none of them.

[#180]: https://github.com/gotgenes/pi-packages/issues/180
[#400]: https://github.com/gotgenes/pi-packages/issues/400
[#640]: https://github.com/gotgenes/pi-packages/issues/640
[#696]: https://github.com/gotgenes/pi-packages/issues/696
[#846]: https://github.com/gotgenes/pi-packages/issues/846
