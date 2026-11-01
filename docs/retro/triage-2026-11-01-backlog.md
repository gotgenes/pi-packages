---
issue_title: "Backlog triage: 2026-11-01"
---

# Retro: Backlog triage, 2026-11-01

The second retro written for a `/triage-backlog` run; `docs/retro/triage-2026-09-18-backlog.md` is the first, and this entry checks its follow-ups.

## Stage: Final Retrospective (2026-11-01T20:42:47Z)

### Session summary

Ran the tenth repo-wide backlog triage (111 open issues, 19 open PRs), producing `docs/triage/2026-11-01-backlog.md` (`ec3e536e`) with a new keystone, K7, over the session-grant scope of a multi-unit bash ask.
Applied labels to six issues, approved three fork CI runs after the escalation audit, measured #1070's claimed bypass through the real gate, and posted four of six drafted contributor comments after one `ask_user` gate that also settled every repeat deferral.

### Observations

#### What went well

- **A coverage check against the prior triage caught an item the prior run dropped.**
  One loop (`grep -q "#$n\b"` against `docs/triage/2026-10-18-backlog.md` for every open number) listed 17 items absent from the prior document; 16 were new, and #797 was not.
  The 2026-10-18 run had omitted #797 from every table, though #880 had already shipped its fix in 40.3.0, so its reporter had waited 57 days for an answer that existed.
  Nothing in the template asks for this check.
- **A third party's repro harness turned a stalled "verify" item into a measured answer in six calls.**
  #1096's body carries a fake-Pi driver for the `tool_call` gate; pointed at #1070's question, it showed the gate covers every `cp`/`tee` destination except a nonexistent bare one, which ADR 0009 already lists as an accepted residual.
  #1070 had sat at "verify" for 14 days waiting on the reporter.
- **The prior retro's scaling problem did not recur.**
  `gh issue list --json comments` already returns each comment's author and timestamp, so the last-maintainer-response age for all 50 third-party issues came from one `jq` expression; only PRs needed a per-item `gh pr view --json comments,reviews` loop (19 calls in one tool call).
  The `scripts/triage-pr-state.sh` follow-up the 2026-09-18 retro made conditional on a repeat is therefore not warranted.

#### What caused friction (agent side)

- `instruction-violation` (self-identified, before the commit) — `AGENTS.md` principle 4: the triage document's closing section stated "Twenty closes … nine of them date to 2026-09-15" from mental arithmetic.
  The lists it summarized hold 19 closes, 5 of them from 2026-09-15.
  Impact: one corrective edit; caught on re-read, not by any gate.
  This is the second triage retro in a row with an authored count wrong in a committed or nearly committed document (2026-09-18: #519's wait written as 110 days against 79).
- `other` (no rule where the template meets an archived roadmap) — The template keeps roadmap-sequenced items out of the list, but says nothing about items an **archived** phase deferred "to a later phase" when no phase is open.
  Twelve such items sat in the prior Deferred list for a second or later run; the session had to invent a "roadmap-owned" versus "repeat deferral" split before the operator could decide.
  The operator's answer (hand them to the package's next `/plan-improvements` sweep, and close ours that have no demand) is a general policy, not a one-off.
  Impact: the briefing grew a paragraph of framing; no rework.
- `missing-context` — Identifying repeat deferrals meant reading the 2026-10-02 and 2026-10-18 Deferred tables and intersecting them by eye.
  Impact: no error this run, but it is a count a command can produce, done by hand.
- `other` (unverifiable causal claim) — The document first said the four 2026-10-30 PRs ran CI on arrival "because" their author had an earlier PR, a cause the API cannot confirm; it also listed #1031 in two carried-forward rows.
  Impact: two corrective edits, both caught on re-read.
- `instruction-violation` (self-identified) — `markdown-conventions` warns that `pi-autoformat` joins a sentence opening with a lowercase package name onto the previous line; "pi-subagents finished Phase 23" was joined anyway.
  Impact: one edit.
- `missing-context` — The template's `date -u -d` one-liner is correct here (Homebrew coreutils' GNU `date` is first on `PATH`), but the session substituted BSD `date -j` on the assumption of macOS.
  Impact: one failed call and about 70 lines of error output.
- `instruction-violation` (self-identified, during this retro) — The `AGENTS.md` index says to load `git-workflow` before a `git commit` or a state-mutating `gh` command; the triage committed `ec3e536e`, labeled six issues, approved three runs, and posted four comments without loading it.
  Impact: none found on review; every SHA the comments cite came from `git log` output, which is the skill's main hazard for a triage.
- `rabbit-hole` (short) — Finding the first release carrying `commandEffects` took five calls (turns 71–75): `--grep="#880"` and `-S commandEffects` both surfaced refactor commits before a `feat` filter found `e5f06885`.
  Impact: five calls; under the escalation threshold.

#### What caused friction (user side)

- The approved closes are now unexecuted for a fifth run, and this run's decisions added nine, so 19 closes are pending.
  The template forbids closing, and no other workflow picks them up, so each run re-records the same list and its prose drifts (see the count error above).
  Opportunity: either an execution path inside triage, gated by `ask_user`, or a standing close pass between runs.
- Two of six drafted comments (PR #1084's CI failure, #708's holding reply) were declined without a reason.
  Opportunity: a word on why (wrong timing, wrong content, belongs to `/pr-review`) would let the next run carry the item correctly instead of re-drafting the same reply.

### Diagnostic details

- **Model-performance correlation** — every turn ran on `anthropic/claude-opus-5-5` (unfiltered `read_session`, 116 assistant turns before the retro); no subagent was dispatched.
  The judgment work (keystone detection, scope verdicts, the #1070 probe design, six contributor drafts) fits the model; the mechanical work (ages, PR state) ran as loops inside single tool calls, so it cost turns rather than a model mismatch.
- **Escalation-delay tracking** — the longest same-question sequence was the five-call release lookup above; no sequence crossed five.
- **Unused-tool detection** — `colgrep` was never used, correctly: every lookup was an exact symbol (`PATTERN_FIRST_COMMANDS`, `withAskingUnits`, `MSYS_DRIVE_MOUNT_PATTERN`).
- **Feedback-loop gap analysis** — `rumdl check`, `invisible-characters.mjs`, and `unicode-escapes.mjs` ran after the first write and after every edit; the authored-count error is the class no gate sees.

### Follow-ups from the 2026-09-18 retro

- `scripts/triage-pr-state.sh` — condition not met; see the scaling note above.
- The pi-permission-system non-goal for host-specific input formats — landed (*Supporting a non-Pi host* is now in the README's non-goals).

### Changes made

All in `.pi/prompts/triage-backlog.md`, each approved through `ask_user`:

1. Step 1 § Repeat deferrals — while a package has no open phase, an item an archived phase deferred "to a later phase" goes to the package's next `/plan-improvements` sweep and leaves Deferred; repeat deferrals are found by intersecting the last two triages' Deferred sections.
2. Step 2 — list every open number the prior triage never names, and classify a dropped item this run (the #797 catch).
3. Step 2 — the last maintainer response comes from one `jq` expression over the issue list's `comments` field; PRs read `comments` and `reviews`.
4. Mutations — a new **Close approved items** mutation: an operator-approved close (this run or recorded by a prior triage) is executed once its reply is posted, confirmed in the run's one `ask_user` call; "Never merge or close" became "Never merge", and Step 6's scope-decline sentence now defers to the operator's approval.
5. Output — recompute every count the prose states with a command before committing.
