---
name: clarification-gates
description: |
  Load before calling `ask_user`: lead with substance, define terms, price options,
  name the shared premise, label every number measured or estimated.
---

# Clarification gates

Load this skill before putting a decision to the operator with `ask_user`.

## Substance first

Present the substance — concrete examples, before/after, trade-offs — in a message first, then call `ask_user` with options that reference it.
The substance is visible assistant text emitted before the `ask_user` call — a briefing composed only in reasoning never reaches the operator.
An option list is a set of choices, not a briefing; context crammed into option descriptions — or into `preview` panes — gets bounced.
In a bundled gate the substance requirement is per question, not per message — the least-supported question bounces the whole batch.
Define a gate's terms of art before its substance — a term the operator must decode is a question they cannot answer; a protocol or format named in an option (`osc9`, SSE) is one: say what it is and who renders it.
When a gate offers mechanisms for fixing a hazard, first name which component or config rule owns the lever and what happens today in each concrete configuration — a mechanism menu without that grounding gets bounced for it.
When the options act at different points of one flow, draw the flow with each option placed at the point it changes — a mechanism comparison in prose gets bounced for the diagram.
Hold each option's `description` to one line — a second line is substance, and substance goes in the message above.

## When the operator answers with a question

A question in place of a selection means the gate was premature — the options assumed context the operator does not hold: a mechanism, a prior decision, a hypothesis in play.
Answer it in a visible message and end the turn there — an answer composed only in reasoning never reaches the operator, and a follow-up `ask_user` in the same turn buries the question.
Ask again only once their reply stops asking.

## Sizing and pricing the options

When the decision settles a structure that will repeat across many files, settle its **size budget** in the same gate.
A placement or shape choice is only sound for a known size, so show a worked example of the largest instance.
When rejecting a candidate on cost, price its cheapest viable form first.
Label every number in an option as measured or estimated; measure when the command runs in under a minute.

## The option space

When every option shares a premise — the same object grown, the same representation assumed, the same vocabulary kept — name it and offer the option that removes it, or say why it is not viable.
When the change adopts a third-party artifact, that artifact's own decomposition — its config surface, its precedence order, its field set — is a premise like any other.
Derive the option space from the problem, then check the contribution against it.
Mark `recommended` on the option your own substance supports: when the evidence you presented shows a no-mechanism option meets the goal, recommending a mechanism requires naming the gap it closes.
An option that files on a third-party tracker names that tracker's issue template and any stated policy on AI-written submissions: read both (`gh api repos/<o>/<r>/contents/.github/ISSUE_TEMPLATE`, `CONTRIBUTING.md`) before the gate.
An option whose differentiator is a dependency's behavior is a claim about that dependency — read its compiled source before writing the option, never its type declaration or its name.
