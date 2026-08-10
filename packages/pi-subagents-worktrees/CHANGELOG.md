# Changelog

## [0.3.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-worktrees-v0.2.4...pi-subagents-worktrees-v0.3.0) (2026-08-10)


### Features

* **pi-subagents-worktrees:** add /subagents-worktrees to inspect and remove preserved worktrees ([#714](https://github.com/gotgenes/pi-packages/issues/714)) ([9e101e0](https://github.com/gotgenes/pi-packages/commit/9e101e0b634641cf916423c7b9d131ff8ee1ae3b))
* **pi-subagents-worktrees:** add a registry of live worktree paths ([#714](https://github.com/gotgenes/pi-packages/issues/714)) ([06afe43](https://github.com/gotgenes/pi-packages/commit/06afe43107105e7e9917f4eb291ea8716b3cc1a9))
* **pi-subagents-worktrees:** detect preserved rescue worktrees ([#714](https://github.com/gotgenes/pi-packages/issues/714)) ([4fe0acd](https://github.com/gotgenes/pi-packages/commit/4fe0acdc8aff9fd801381e6ba9c01dc828c68c57))
* **pi-subagents-worktrees:** track live worktrees while children run ([#714](https://github.com/gotgenes/pi-packages/issues/714)) ([a270e8f](https://github.com/gotgenes/pi-packages/commit/a270e8fecb4d754744cf49f565bd0a5c70f0dbb3))
* **pi-subagents-worktrees:** warn at session start about preserved rescue worktrees ([#714](https://github.com/gotgenes/pi-packages/issues/714)) ([a081cbf](https://github.com/gotgenes/pi-packages/commit/a081cbf89ff1d8153c58dbe4f5bb199d3d26560f))


### Documentation

* **pi-subagents-worktrees:** document preserved-worktree recovery ([#714](https://github.com/gotgenes/pi-packages/issues/714)) ([cd98283](https://github.com/gotgenes/pi-packages/commit/cd98283f375ee7dea80ddd038cd33f8a068f2b69))

## [0.2.4](https://github.com/gotgenes/pi-packages/compare/pi-subagents-worktrees-v0.2.3...pi-subagents-worktrees-v0.2.4) (2026-08-10)


### Bug Fixes

* **pi-subagents-worktrees:** preserve the worktree when cleanup fails ([#704](https://github.com/gotgenes/pi-packages/issues/704)) ([4a3f8e2](https://github.com/gotgenes/pi-packages/commit/4a3f8e205e62db4bd7b664507f72a81f68a9029e))
* **pi-subagents-worktrees:** retry the rescue commit with --no-verify ([#704](https://github.com/gotgenes/pi-packages/issues/704)) ([b9d17cb](https://github.com/gotgenes/pi-packages/commit/b9d17cbc1dc9917e3ad4129d7f21f1799f366b78))


### Documentation

* **pi-subagents-worktrees:** document rescue-commit retry and worktree preservation ([#704](https://github.com/gotgenes/pi-packages/issues/704)) ([60ec850](https://github.com/gotgenes/pi-packages/commit/60ec8503ae8f71dee346b5d5238d7f05c7a8fe29))

## [0.2.3](https://github.com/gotgenes/pi-packages/compare/pi-subagents-worktrees-v0.2.2...pi-subagents-worktrees-v0.2.3) (2026-06-12)


### Miscellaneous Chores

* **deps:** bump @gotgenes/pi-subagents to 15 in worktrees ([#370](https://github.com/gotgenes/pi-packages/issues/370)) ([c27de8d](https://github.com/gotgenes/pi-packages/commit/c27de8d2bd0edd65f6020bd114589b898e6704f3))

## [0.2.2](https://github.com/gotgenes/pi-packages/compare/pi-subagents-worktrees-v0.2.1...pi-subagents-worktrees-v0.2.2) (2026-06-03)


### Documentation

* standardize and correct package READMEs ([4c270ad](https://github.com/gotgenes/pi-packages/commit/4c270adac97ca816fa1889a879d1d4fe19cdd464))

## [0.2.1](https://github.com/gotgenes/pi-packages/compare/pi-subagents-worktrees-v0.2.0...pi-subagents-worktrees-v0.2.1) (2026-06-01)


### Documentation

* use ADR-NNNN with links docs-wide ([c6b6431](https://github.com/gotgenes/pi-packages/commit/c6b6431c004f324931f23be46cf2e47e8fdac919))

## [0.2.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-worktrees-v0.1.0...pi-subagents-worktrees-v0.2.0) (2026-05-29)


### Features

* replace indexed-access aliases with named imports from pi-subagents ([#272](https://github.com/gotgenes/pi-packages/issues/272)) ([757ecf6](https://github.com/gotgenes/pi-packages/commit/757ecf6baa8633dd552bd0fd0becfe8cb088364c))

## [0.1.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-worktrees-v0.0.1...pi-subagents-worktrees-v0.1.0) (2026-05-29)


### Features

* add worktreeAgents config loader ([ec563a8](https://github.com/gotgenes/pi-packages/commit/ec563a807f276de4a25cb2ad6bcc9a76ebe92ed7))
* implement git worktree WorkspaceProvider ([0e87505](https://github.com/gotgenes/pi-packages/commit/0e87505aa52fb4c4cfb3fcd52b0c80f1f6f6e5a0))
* register worktree provider at extension init ([18d0db4](https://github.com/gotgenes/pi-packages/commit/18d0db420e60840d935f73ddc1612d4941152cbc))
* scaffold pi-subagents-worktrees with git worktree plumbing ([9a7dcfc](https://github.com/gotgenes/pi-packages/commit/9a7dcfc526124f21267c1dc5a3d55703485f3b69))


### Bug Fixes

* **pi-subagents-worktrees:** remove unused devDependency (dead-code gate) ([7e7afad](https://github.com/gotgenes/pi-packages/commit/7e7afadd48e55b07028755753d38843287535af7))
