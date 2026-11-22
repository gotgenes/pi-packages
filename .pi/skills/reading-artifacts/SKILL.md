---
name: reading-artifacts
description: |
  Load before citing a plan's Non-Goals, a roadmap `Outcome:`/`Cause:`, an ADR, a triage verdict,
  a PR's status, or a third-party report as evidence, and before pinning a dependency floor.
---

# Reading this repo's own artifacts

When mining history for a **durable** claim — a scope charter, a triage verdict, an ADR, a README boundary — this repo's artifacts answer narrower questions than they appear to.

Weight recent evidence more heavily than old: a newer measurement, steer, or decision outranks an older one it contradicts.

## Plans

A plan's `## Non-Goals` is scoped to that change, not to the package.
It answers "what is out of scope for this change", never "what is out of scope forever", and it mixes three unrelated claims under one heading: sequencing (not in this change), deferral (not until someone asks), and a real boundary (not ever, and here is why).
So **a plan Non-Goal is a lead, not a citation** — use it to find the ADR or numbered design principle, and cite that.

The same holds for a plan's enumerated **external** facts — a command's options, an API surface, a spec's values.
Verify each against the real surface (`man`, `--help`, the schema) before it lands in a security boundary; an omitted flag or a misclassified command ships as a fail-open.
Documentation answers whether a flag exists, not what a given binary does with it — run the tool when the answer gates a security boundary.

## Dependency floors

A dependency floor is a claim about **each** symbol the change uses, not about the release that introduced the feature.
`git tag --contains <sha>` answers which release carries one commit; sibling accessors can land in a later one.
Resolve every symbol against the candidate floor (`git show <tag>:<path> | grep <symbol>`) before pinning it.
Sampling one version without the symbol and one with it bounds an interval, not a boundary — name the later one only after checking every version between.
Enumerate them from the registry (`pnpm view <pkg> versions`), not from git tags — a version can be tagged and never published, so no operator can be on it.

## Pull requests and ADRs

Pull-request status is an **inverted** signal here, because the repo reimplements adopted third-party changes through its own TDD cycle rather than merging them.
Read the close comment, never the close status.
Read who closed it too: a PR its own author closed with no maintainer comment was withdrawn, not adopted.
An **open** PR is not a decline either: read its thread for what it is waiting on.
To survey activity on a topic, include pull requests: `gh issue list` never returns them, and `gh search issues` does only with `--include-prs`.

Check an ADR's frontmatter `status:` before citing it.

## Roadmap steps

A roadmap step's `Outcome:` line is written from the symptom at phase-planning time, before anyone traced the mechanism, so it can promise relief the change does not produce for the example it names.
Trace that example through the code before turning an `Outcome:` into a test.

A step's `**Cause:**` bullet is likewise the mechanism the discovery sweep saw, not a census of the ones present.
Trace the whole function before accepting it as the scope — the same lines can hold a second defect of the same shape.

## Third-party reports

A third-party report's root-cause narrative is the reporter's model of a system they do not maintain, so its claim about the *other* side is the one to check.
Read that project's source and the published tarball of the version they ran (`pnpm view <pkg> dist.tarball`), never the claim alone.
Ask separately whether the defect reaches us at all — a sibling `@gotgenes/*` extension may already mitigate it, which changes the priority and the owner but not the defect.
That same mitigation is what contaminates a repro run through our own extensions; load the `reproduction` skill before building one.

## History

Release-please and the machinery that worked around its API commit walk — `last-release-sha`, `separate-pull-requests`, `release_pr_merge`, `defaultMergeMethod` — are gone; when reading history (a retro, an older plan, a commit message), treat them as artifacts of that era, not as current mechanism.
