---
name: reproduction
description: |
  Load before building a reproduction, spike, or probe whose result becomes design input:
  organic data over hand fixtures, control placement, trials against stochastic or cached sources.
---

# Reproducing a defect

Load this skill before building a repro, spike, or probe for a bug report — before its result is treated as a diagnosis.

Every quality gate this repo has validates internal consistency: tests, `check`, `lint`, `fallow dead-code`, the tidy-first assessor, the pre-completion reviewer.
None of them inspect whether the premise is true.
A false diagnosis therefore passes all of them and ships, so the provenance of the evidence is the only thing standing between a plausible story and a wrong release.
The worked example is `pi-anthropic-auth` issue #65 — six rounds of increasingly rigorous measurement on a hand-built fixture, a plan, six TDD commits, a release, and an upstream bug report, all wrong.

## Build it from real artifacts

A fixture you constructed from your own model of the bug can only confirm that model.
It is not a reproduction, however carefully it imitates the real input.
Rigor applied to the wrong object stays wrong: restoring verbatim prompts, adding controls, and replicating trials all make a synthetic fixture more convincing without making it representative.

Take the input from something that already exists:

- A real session's `message` entries from a `.jsonl` under `~/.pi/agent/sessions/`, read with `read_session_file`.
- The live review log (`~/.pi/agent/extensions/pi-permission-system/logs/*.jsonl`), which turns an estimated blast radius into a measured one (Refs #694, #727).
- Real config on disk — `.pi/settings.json`, a package's own `config.json` — rather than an object literal describing what one would contain.
- The upstream function itself, called from `../pi` or the pinned dependency, rather than a hand-written imitation of its output.

A probe that selects its input through the code under test's own filter inherits that filter's blind spot: #924's spike read argument words through `ARG_NODE_TYPES` and so never saw the bare `$opt` a sound design had to catch.
Enumerate the input independently of the code the probe is meant to judge.

When no real artifact is reachable, say so: label the evidence synthetic and unconfirmed, and carry that label into the plan's Design Overview.
A named limit is a finding; an unnamed one becomes a premise.

## Reproduce the effect, not an intermediate

A report names an effect someone observed: a prompt, a decision, an output.
Probe that effect through the path that produces it; an intermediate signal (a parse error, a classifier verdict) that matches does not confirm it, and one that differs does not refute it.
For a permission ask, drive the gate's decision (`resolveBashAdvisoryCheck` shares the gate's `resolveBashCommandCheck`), not the parser.

## A prototype's measurement expires when the implementation diverges

A number measured against a prototype covers only the mechanisms the prototype had.
Re-measure against the real pre- and post-change code whenever the implementation later gained one it lacked — the stale number still reads true, so nothing surfaces the expiry (Refs #923).
Diff the full input→output mapping, not a count of changed inputs: a count cannot see one input leaving the set as another enters.

## Read the report for what contradicts you

The reporter's own repro is evidence, and its most valuable content is whatever does not fit your hypothesis.
Evidence skimmed twice as "a side case" is usually evidence discounted for being disconfirming.
Re-read the thread after forming a diagnosis, looking specifically for the detail that would falsify it.

## Place the control on the far side of the system under test

A control proves nothing about a variable that was removed before it ran.
When the repro path runs through one of this repo's own extensions, that extension sits between the probe and the behavior — and a control that only shows "the behavior still occurs" cannot detect that our own code stripped the factor being tested.

In practice: `pi --no-extensions -e packages/<pkg>` loads only the copy under test, while a bare `pi` launched from this repo also loads everything in the root `.pi/settings.json` and is never a clean control.
For a library-level probe, call the upstream function directly instead of the wrapper when the question is about upstream's behavior rather than ours.
In a monorepo a probe also answers only for the package it ran in: `packages/*/biome.json`, per-package `eslint` overrides, and per-package `vitest.config.*` each make one package's result unrepresentative.
Before generalizing a probe to `packages/*`, re-run it under a package with no local override — #966's plan recorded "Biome ignores this path" from a package whose own config disables the formatter.
State which side of the extension each row of the results table was measured on.

## A stochastic or cached source needs trials and a defeated cache

An LLM call, a provider-side classifier, an on-disk index, and a timing measurement are all sources where one observation is not a result.
Byte-identical trials against a cached source return one verdict repeatedly, which reads as perfect determinism and silently collapses n to 1.

- Run n >= 5 independent trials per condition and report rates, not verdicts.
- Defeat the cache: insert a per-trial nonce into an LLM payload, clear an on-disk index between runs, or state explicitly that the cache was warm.
- Vary one factor per run, and keep the rest byte-identical.

Two contradictory "5/5 vs 0/5" results in opposite directions are the signature of a cached source, not of a strong effect.

## Prefer the self-inflicted explanation

"The vendor changed it," "upstream regressed," and "it stopped reproducing" are plausible, are often citable, and require nothing of us — which is exactly why they deserve more suspicion than a self-inflicted cause, not less.
Before attributing a non-reproduction to the other side, check what changed on ours: a fix landed earlier in the same session, a stale in-process extension, a warm cache, an edited config.

## Escalate on rounds, not on errors

The internal escalation heuristic watches for an error repeating.
A probe loop never fires it, because every round "succeeds" — it just refines the fixture.
When a second or third round of probing goes into improving the same artifact rather than changing what is being tested, the artifact is the suspect.
Dispatch a fresh-context subagent (see the `delegation` skill) and ask it one question: is this input representative of what the real system produces?
A session that built the fixture has already inherited the hypothesis and is the least likely reader to catch it.

## A probe that escalates privilege needs a go-ahead

Before running `sudo` (or any privileged or destructive binary) live as a probe, name the commands to the operator and wait for approval.
Prefer a form that cannot execute: a usage error, `--list`, or `man`, never an operand that names a real path.

## What to write down

The plan's Design Overview states how the repro was produced, not just what it showed:

- Where the input came from, and whether it is real or synthetic.
- Which code path executed it, and on which side of our own extensions.
- n per condition, and what defeated the cache.
- What the control was, and what it ruled out.

The `pre-completion-reviewer`'s `2d. Evidence provenance` check reads exactly this.
A plan that says "measured" without saying "measured against what" is the finding it reports.
