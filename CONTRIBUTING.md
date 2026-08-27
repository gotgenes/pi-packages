# Contributing

Thanks for your interest in these packages.
Contributions are welcome, and the path that reliably ships starts with an issue.

## Start with an issue

File a [bug report or feature request](https://github.com/gotgenes/pi-packages/issues/new/choose) describing the problem, the use case behind it, and the pain it causes.
Describing the problem matters more than proposing a solution, because the problem is what any design gets judged against.
The templates ask for the package, the version, and a reproduction; filling those in fully is usually all that is needed.

## Check the package's scope first

Every package README has a `## Scope and non-goals` section stating what that package is for, what it deliberately will not do, and where an adjacent request belongs.
Reading it before filing saves you writing up a request that is already out of scope, and it often points at the package that does own the capability.
The READMEs are linked from the [package table](./README.md#packages).

## Pull requests

Pull requests are considered case by case, after the underlying issue has been discussed.
Discussing the problem first is what makes a contribution likely to land: a pull request opened before that discussion often needs substantial rework against conventions it could not have known about.

An accepted contribution may land as a reimplementation rather than a merge of your branch, so that the change fits the package's existing design and test structure.
If so, the resulting commits carry `Co-authored-by:` for you, and the pull request is closed with a comment linking them.

## Conventions a change is held to

[`AGENTS.md`](./AGENTS.md) is the full reference; these are the ones a change meets first.
Prerequisites, setup, and the commands themselves are in the README's [Development](./README.md#development) section.

| Convention            | What it means                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Conventional Commits  | `type(scope): subject`, with a breaking change written `feat(pkg)!:` — the `!` after the scope. A `commit-msg` hook checks the header. |
| Tests first           | A bug fix ships a test that fails without the fix and passes with it.                                                                  |
| Green checks          | `pnpm run check`, `pnpm run lint`, and `pnpm run test` all pass.                                                                       |
| pnpm only             | Never `npm` or `npx`. Node 22 or newer, pnpm 11.                                                                                       |
| One sentence per line | Markdown is written one sentence to a line, enforced by `rumdl`.                                                                       |

## Credit

When your issue or pull request leads to a change, the resulting commits carry a `Co-authored-by:` trailer with your name and email, and the issue or pull request is closed with a comment naming you and linking the implementing commits.
That holds whether the change was merged from your branch or rebuilt from it.
