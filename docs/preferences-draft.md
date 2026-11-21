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

A pass over the operator's messages and gate answers from 2026-05-15 to 2026-11-21 read 2,590 entries and extracted 1,151 choices.
Of those, 775 fall into 142 recurring preferences, and the rest are one-off product or scheduling decisions.
Measured against `AGENTS.md`, the skills, the prompt templates, and the agent definitions, 56 of the 142 are stated, 53 are partly stated, and 33 are not found.
Session counts below exclude the interview itself.
Nothing here is a preference until the operator confirms it.

### Recurring and not in the docs

| Candidate                                                                                                         | Sessions |
| ----------------------------------------------------------------------------------------------------------------- | -------- |
| Packages share one configuration: compiler, lint, markdown, package fields, test layout.                          | 9        |
| Push back on the operator's choices and the agent's own, and pressure-test a proposal before trusting it.         | 8        |
| Construct an object complete and ready, with no getters, setters, or late wiring.                                 | 6        |
| Planning is not bound by an issue's scope or by earlier decisions, and the architectural target is defined first. | 6        |
| Do not rely on the prompt-template extension's own mechanisms.                                                    | 5        |
| Keep digging one more layer before committing to a plan.                                                          | 4        |
| Prefer stricter automated checks, because they give fast feedback.                                                | 4        |
| Keep GitHub issues in step with the plan when the plan changes.                                                   | 4        |
| Go through findings and decisions one at a time.                                                                  | 3        |
| When a bad pattern is named, fix every occurrence.                                                                | 3        |
| Keep or retire a process tool on evidence.                                                                        | 3        |
| Make new commits and do not amend.                                                                                | 2        |

### Recurring and only partly in the docs

| Candidate                                                                                             | Sessions | What the docs lack                                              |
| ----------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------- |
| Make the change easy first, at the scale of issues as well as commits.                                | 30       | filing the enabling work as its own issue and pausing this one  |
| Fold a small adjacent fix into the change, and file it only when it widens the scope a lot.           | 21       | the docs state only the filing half                             |
| When code is awkward, ask which collaborator is missing before extracting helpers or splitting files. | 12       | it is a checklist item, not a first question                    |
| Try the behavior live before shipping.                                                                | 11       | it is not the default                                           |
| Name things in plain domain words, and rename an ambiguous name instead of documenting it.            | 11       | domain vocabulary, and renaming over documenting                |
| Follow Pi's conventions and adopt its newer SDK mechanisms.                                           | 10       | the docs say to read Pi's source, not to prefer its conventions |
| Keep a package's core small and leave extras to downstream packages.                                  | 9        | the general rule                                                |
| Raise the Pi version floor when that simplifies the code.                                             | 9        | the preference for raising it                                   |
| Take a breaking change when it gives a clearer design, and handle migration second.                   | 8        | `AGENTS.md` leans the other way                                 |
| Fail loudly, and never drop or repair silently.                                                       | 8        | the general rule                                                |
| Treat a cast as a design smell.                                                                       | 7        | production casts                                                |
| Search for an existing issue before filing one.                                                       | 7        | a check at filing time                                          |
| Tell reporters what was confirmed, what was done, and what is limited.                                | 7        | the docs cover credit only                                      |
| Expose an extension seam instead of building a capability in.                                         | 7        | anything beyond event notification                              |
| Prefer explicit designs: structured results that callers consume.                                     | 6        | structured results                                              |
| Fix the design a lint finding points at instead of suppressing it.                                    | 6        | several documented workarounds suppress                         |
| Inherited features and config get no protection.                                                      | 6        | the principle                                                   |

### Disagreements to settle

- **Stateful classes or values.**
  Between late May and mid July the operator asked for classes that hold state and are told what to do, and ranked value objects below them.
  The interview puts decisions in pure functions over values.
  Both agree a stateful dependency is a class; they differ on whether data should carry behavior.
- **Sibling packages as the model.**
  Earlier steers treat an established sibling package as the pattern to follow, and `plan-issue.md` still tells agents to follow sibling conventions.
  The interview says existing code is not precedent.
- **Scope.**
  Earlier steers say planning is not bound by an issue's scope.
  `AGENTS.md` says to keep scope tight, and the interview sets a limit on what an agent converts unasked.
  One reading that reconciles them is that planning scope is open and implementation autonomy is bounded.
- **Amending commits.**
  The operator has said to stop amending, and `tdd-plan.md` tells the agent to amend an unpushed commit in three places.
- **Resolving conflicts.**
  The operator gave standing permission to resolve rebase conflicts in four sessions in September, and `sync-worktree.md` says not to auto-resolve.
- **Barrel files.**
  The operator wants a module's barrel used as its public API, and the `improvement-discovery` skill lists removing barrels as a remedy.
