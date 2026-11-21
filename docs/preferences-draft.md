# Operator preferences (draft)

A working record of how the operator wants software built in this repository, taken from an interview on 2026-11-21.
It is a draft for the operator to edit.
Each preference is a choice among defensible alternatives, which is why it has to be written down: a model knows every option and cannot know which one was picked.

A line marked as placed has a copy in the file named beside it, and that copy is what agents read.
Change both together.

## Preferences

| Preference                                                                                                                                                             | Lives in      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| The schools are _Clean Code_, _Working Effectively with Legacy Code_, _Extreme Programming Explained_, and Gary Bernhardt's functional core, imperative shell.         | `code-design` |
| Decisions live in pure functions over values, and I/O and sequencing live in a thin shell that receives its dependencies.                                              | `code-design` |
| Tell a collaborator what to do, and do not ask it for data to decide on its behalf.                                                                                    | `code-design` |
| A class when the code commands a dependency that has its own state and behavior, and a function when everything is a value and nothing is commanded.                   | `code-design` |
| Factory functions that return closures are generally avoided.                                                                                                          | `code-design` |
| Nearly every test is a unit test, and acceptance tests are a thin cap.                                                                                                 | `testing`     |
| Work outside-in from the outermost behavior the change affects, and go back out when an inner discovery revises an outer interface.                                    | `testing`     |
| A collaborator that acts is a role: mock the interface you wish it had, and assert what it was told.                                                                   | `testing`     |
| A thing that is data is a value: compute it with a pure function, assert on the result, and never mock it.                                                             | `testing`     |
| Per-branch detail belongs in value tests, and a role gets only the interaction tests that prove delivery.                                                              | `testing`     |
| A collaborator that turns out only to compute an answer becomes a pure function.                                                                                       | `testing`     |
| Values that matter to a test are written in the test as literals, and shared builders are for wiring collaborators.                                                    | `testing`     |
| A fixture that is intricate to assemble is a design signal before it is a reason for a builder.                                                                        | `testing`     |
| Existing code is not precedent: when a practice and the surrounding code disagree, the practice wins.                                                                  | `code-design` |
| Code the change touches is converted as part of the change, with its behavior pinned first and the conversion landed as separate commits ahead of the behavior change. | `code-design` |
| A touched file and its own test file are the limit of what an agent converts without asking.                                                                           | `code-design` |
| A conversion that reaches further, such as a call site in another file, is welcome but raised with the operator first.                                                 | `code-design` |

## Not placed yet

- **A plan fixes the outermost behavior and sketches the rest.**
  The operator works from a rough sketch and a clear idea of the behavior a user should see, and the details emerge as the work moves inward and back out.
  The detailed plan `/plan-issue` asks for is an accommodation to agents, not a preference.
  Its home is `.pi/prompts/plan-issue.md`, which currently instructs the opposite, so placing it means redesigning that template's plan format.
- **No module in this repository is an endorsed example.**
  The operator's reference is `gotgenes/getignore`: a pure core over values, a thin shell, a type for the thing with state, and doubles only at the I/O edge.
  It has no example of a role discovered by mocking, so that practice has no example anywhere yet.

## Held with reservations

- **Literal values in tests.**
  It is the operator's general preference, and they are torn where a fixture is intricate to assemble.
  It is placed as a default with the design-signal reading, not as a hard rule.

## How a change in tidy scope reaches the operator

- At plan time the `tidy-first-assessor` forecasts the preparatory commits from the files the plan expects to touch.
- During implementation the agent converts a file it arrives at, inside the limit above, without a second assessment.
- Two things send the work back to the operator: a discovery that changes the outermost behavior the plan fixed, and a conversion that would leave the limit.

## Candidates from session transcripts

Pending.
A pass over the operator's past messages is looking for steers the interview did not cover.
Nothing from it is a preference until the operator confirms it.
