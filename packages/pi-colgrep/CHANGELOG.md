# Changelog

## [1.5.3](https://github.com/gotgenes/pi-packages/compare/pi-colgrep-v1.5.2...pi-colgrep-v1.5.3) (2026-08-19)


### Bug Fixes

* **pi-colgrep:** drop the redundant tool-name prefix from promptSnippet ([#778](https://github.com/gotgenes/pi-packages/issues/778)) ([9832a9f](https://github.com/gotgenes/pi-packages/commit/9832a9f8c4603dfc9c8c67a2a730e41924ca92c3))

## [1.5.2](https://github.com/gotgenes/pi-packages/compare/pi-colgrep-v1.5.1...pi-colgrep-v1.5.2) (2026-08-19)


### Documentation

* condense scope sections and move them below the usage material ([#775](https://github.com/gotgenes/pi-packages/issues/775)) ([99f5829](https://github.com/gotgenes/pi-packages/commit/99f58298962baac5bdfe5d3cc02dca0ca9b32395))
* **pi-colgrep:** document scope and non-goals ([#775](https://github.com/gotgenes/pi-packages/issues/775)) ([d036500](https://github.com/gotgenes/pi-packages/commit/d0365005f0d161b02c0d332756422f61c1fda27e))

## [1.5.1](https://github.com/gotgenes/pi-packages/compare/pi-colgrep-v1.5.0...pi-colgrep-v1.5.1) (2026-06-12)


### Miscellaneous Chores

* **deps:** bump Pi SDK to 0.79.1 ([#370](https://github.com/gotgenes/pi-packages/issues/370)) ([704f3b3](https://github.com/gotgenes/pi-packages/commit/704f3b3457ceb12b9df9efffe7a56812a5667d5d))
* **deps:** bump typebox to 1.2.8 ([#370](https://github.com/gotgenes/pi-packages/issues/370)) ([8066a85](https://github.com/gotgenes/pi-packages/commit/8066a8573eba31b35b03fc7fcd26ab1041cc75d2))

## [1.5.0](https://github.com/gotgenes/pi-packages/compare/pi-colgrep-v1.4.2...pi-colgrep-v1.5.0) (2026-06-12)


### Features

* add colgrep config loader with indexOnStartup ([#389](https://github.com/gotgenes/pi-packages/issues/389)) ([42681b3](https://github.com/gotgenes/pi-packages/commit/42681b37fd6ab3655b5131cd80ba7008618059ef))
* add colgrep index-existence probe ([#389](https://github.com/gotgenes/pi-packages/issues/389)) ([f2ac61a](https://github.com/gotgenes/pi-packages/commit/f2ac61a35d03f9e3ef50c3e2206aa1006a7083d2))
* coalesce concurrent reindex runs and track in-flight promise ([#389](https://github.com/gotgenes/pi-packages/issues/389)) ([9f4cea6](https://github.com/gotgenes/pi-packages/commit/9f4cea6f3370ab9ca73a05e85bb5b60ab9263d45))
* gate write/edit reindex on existing index with one-time skip warning ([#389](https://github.com/gotgenes/pi-packages/issues/389)) ([f5505ae](https://github.com/gotgenes/pi-packages/commit/f5505ae554589a600700028090e1a212fe12655a))
* run startup index in background, gated by indexOnStartup ([#389](https://github.com/gotgenes/pi-packages/issues/389)) ([a4738a8](https://github.com/gotgenes/pi-packages/commit/a4738a8fbcc2983dc27d4d62bdb08d83c7d720b0))


### Documentation

* document colgrep indexOnStartup configuration ([#389](https://github.com/gotgenes/pi-packages/issues/389)) ([cfc4e3e](https://github.com/gotgenes/pi-packages/commit/cfc4e3e0ba08bcb87f17697942396b57380e6712))

## [1.4.2](https://github.com/gotgenes/pi-packages/compare/pi-colgrep-v1.4.1...pi-colgrep-v1.4.2) (2026-06-03)


### Documentation

* standardize and correct package READMEs ([4c270ad](https://github.com/gotgenes/pi-packages/commit/4c270adac97ca816fa1889a879d1d4fe19cdd464))

## [1.4.1](https://github.com/gotgenes/pi-packages/compare/pi-colgrep-v1.4.0...pi-colgrep-v1.4.1) (2026-05-24)


### Documentation

* improve skill descriptions to signal decision-relevant content ([51f52ef](https://github.com/gotgenes/pi-packages/commit/51f52ef30ac47516325f1220167d0828639abb83))

## [1.4.0](https://github.com/gotgenes/pi-packages/compare/pi-colgrep-v1.3.2...pi-colgrep-v1.4.0) (2026-05-24)


### Features

* add eslint config with type-aware rules and import enforcement ([4fb3cc6](https://github.com/gotgenes/pi-packages/commit/4fb3cc678da10d350b85c464318476ba9ae99dca))

## [1.3.2](https://github.com/gotgenes/pi-packages/compare/pi-colgrep-v1.3.1...pi-colgrep-v1.3.2) (2026-05-23)


### Bug Fixes

* add package.json imports field for #src/#test path aliases ([#157](https://github.com/gotgenes/pi-packages/issues/157)) ([75b4598](https://github.com/gotgenes/pi-packages/commit/75b45980810583452f7741678359c004900c8bd0))

## [1.3.1](https://github.com/gotgenes/pi-packages/compare/pi-colgrep-v1.3.0...pi-colgrep-v1.3.1) (2026-05-23)


### Documentation

* **retro:** add retro notes for issue [#92](https://github.com/gotgenes/pi-packages/issues/92) ([721ee0e](https://github.com/gotgenes/pi-packages/commit/721ee0e1e632bace0b3c64e7832164e753cfb8af))
* **retro:** move promptGuidelines rule to code-design skill ([#92](https://github.com/gotgenes/pi-packages/issues/92)) ([e4e4676](https://github.com/gotgenes/pi-packages/commit/e4e46764fbbc7f37460af907393fd12d92ce2f47))

## [1.3.0](https://github.com/gotgenes/pi-packages/compare/pi-colgrep-v1.2.0...pi-colgrep-v1.3.0) (2026-05-23)


### Features

* add colgrep usage skill ([#92](https://github.com/gotgenes/pi-packages/issues/92)) ([5eacbe7](https://github.com/gotgenes/pi-packages/commit/5eacbe717ee66bba7484846b52df81b2f6d400b2))
* register colgrep skill and license in package.json ([#92](https://github.com/gotgenes/pi-packages/issues/92)) ([33a3c33](https://github.com/gotgenes/pi-packages/commit/33a3c338c1b75eee0337dbc2d171b1acd083451c))


### Bug Fixes

* self-identify colgrep in limit guideline ([#92](https://github.com/gotgenes/pi-packages/issues/92)) ([fa164a1](https://github.com/gotgenes/pi-packages/commit/fa164a19d22deb63f72d6c56f735fa6eb49e41f8))


### Documentation

* add next-plaid Apache-2.0 license ([#92](https://github.com/gotgenes/pi-packages/issues/92)) ([b51e007](https://github.com/gotgenes/pi-packages/commit/b51e0071200ebbb096c96eabdb10f409183aaa23))
* plan colgrep usage skill ([#92](https://github.com/gotgenes/pi-packages/issues/92)) ([bb518be](https://github.com/gotgenes/pi-packages/commit/bb518bec95ce4252cf43cf959e07fdf9c2f7620a))
* **retro:** add retro notes for issue [#91](https://github.com/gotgenes/pi-packages/issues/91) ([cac61f9](https://github.com/gotgenes/pi-packages/commit/cac61f9525b04644d2960a2e0c4c667250572283))

## [1.2.0](https://github.com/gotgenes/pi-packages/compare/pi-colgrep-v1.1.0...pi-colgrep-v1.2.0) (2026-05-23)


### Features

* add debounced reindex scheduling ([#91](https://github.com/gotgenes/pi-packages/issues/91)) ([f12bd7d](https://github.com/gotgenes/pi-packages/commit/f12bd7d2fb47b7dbe7edfbfa65705ebe727280cc))
* add reindexer shutdown ([#91](https://github.com/gotgenes/pi-packages/issues/91)) ([55db463](https://github.com/gotgenes/pi-packages/commit/55db4631386856e1bc791f6c01b3f03251f05c23))
* add reindexer with immediate execution ([#91](https://github.com/gotgenes/pi-packages/issues/91)) ([84356be](https://github.com/gotgenes/pi-packages/commit/84356befd9c146ca518919587a27361965671c5f))
* clean up reindexer on session shutdown ([#91](https://github.com/gotgenes/pi-packages/issues/91)) ([9a87869](https://github.com/gotgenes/pi-packages/commit/9a878697f352bf111ca6c1dc86ce99d6c3916eef))
* handle reindex errors gracefully ([#91](https://github.com/gotgenes/pi-packages/issues/91)) ([2ca14d5](https://github.com/gotgenes/pi-packages/commit/2ca14d544275cf16412435079206a0c9184bb266))
* queue reindex behind in-flight run ([#91](https://github.com/gotgenes/pi-packages/issues/91)) ([bb9ccbe](https://github.com/gotgenes/pi-packages/commit/bb9ccbe1eb56df768e547649a069ac3231835bfe))
* register /colgrep-reindex manual command ([#91](https://github.com/gotgenes/pi-packages/issues/91)) ([c591e80](https://github.com/gotgenes/pi-packages/commit/c591e8016ea9dac9db8d47e9fe51e01febc0c5b6))
* reindex on session start ([#91](https://github.com/gotgenes/pi-packages/issues/91)) ([d18cb8a](https://github.com/gotgenes/pi-packages/commit/d18cb8a1de49c7d92535a1b14d8d02cd6a7f93eb))
* schedule reindex on write/edit tool results ([#91](https://github.com/gotgenes/pi-packages/issues/91)) ([bb17ea0](https://github.com/gotgenes/pi-packages/commit/bb17ea0b6bb532f0d1a64e0e07a914f408482633))


### Documentation

* plan auto-reindex on session start and file mutations ([#91](https://github.com/gotgenes/pi-packages/issues/91)) ([291d55f](https://github.com/gotgenes/pi-packages/commit/291d55f2a03674c3d84ab2e59d053b72c1b2d9b6))

## [1.1.0](https://github.com/gotgenes/pi-packages/compare/pi-colgrep-v1.0.0...pi-colgrep-v1.1.0) (2026-05-23)


### Features

* add colgrep availability check ([#90](https://github.com/gotgenes/pi-packages/issues/90)) ([4bf9893](https://github.com/gotgenes/pi-packages/commit/4bf989340bfae97c1aa3bca7bd246768222a4fad))
* add colgrep CLI argument builder ([#90](https://github.com/gotgenes/pi-packages/issues/90)) ([80ba0db](https://github.com/gotgenes/pi-packages/commit/80ba0dba499b37116c98694ea0933b3a624cb85f))
* add colgrep result formatting ([#90](https://github.com/gotgenes/pi-packages/issues/90)) ([efad4e7](https://github.com/gotgenes/pi-packages/commit/efad4e778c06afadfeba0bb0e965bde9b0db247a))
* add colgrep search execution ([#90](https://github.com/gotgenes/pi-packages/issues/90)) ([d896766](https://github.com/gotgenes/pi-packages/commit/d8967660175c525e4234a2170d79fb853ecc6a1e))
* add exec type and tool-result helpers ([#90](https://github.com/gotgenes/pi-packages/issues/90)) ([3142a2b](https://github.com/gotgenes/pi-packages/commit/3142a2b2d0aa5577d3883f5d58bc7674711fe324))
* register colgrep search tool ([#90](https://github.com/gotgenes/pi-packages/issues/90)) ([0ad2bbd](https://github.com/gotgenes/pi-packages/commit/0ad2bbdc7a8926d461f5c8b37786e12940ae65f5))
* wire colgrep tool and availability check into extension ([#90](https://github.com/gotgenes/pi-packages/issues/90)) ([738bbdb](https://github.com/gotgenes/pi-packages/commit/738bbdb3208f6bc37e802725cea2093ed94f8e9c))


### Documentation

* plan colgrep search tool registration ([#90](https://github.com/gotgenes/pi-packages/issues/90)) ([30a723d](https://github.com/gotgenes/pi-packages/commit/30a723df4b31d3ceb3b609fe89562d0ba4e43f05))


### Miscellaneous Chores

* add vitest test infrastructure for pi-colgrep ([#90](https://github.com/gotgenes/pi-packages/issues/90)) ([eba526d](https://github.com/gotgenes/pi-packages/commit/eba526d7dc0f962ad06b9d733613fd0a3568465d))

## 1.0.0 (2026-05-23)


### Features

* scaffold @gotgenes/pi-colgrep package ([#89](https://github.com/gotgenes/pi-packages/issues/89)) ([7cc1b8e](https://github.com/gotgenes/pi-packages/commit/7cc1b8ef490645e64fad107ef1075a89d48ae9db))


### Documentation

* add initial-publish goal for Trusted Publishing setup ([#89](https://github.com/gotgenes/pi-packages/issues/89)) ([89aff36](https://github.com/gotgenes/pi-packages/commit/89aff3617d63a052a2b2bea3ce683166d2e284bd))
* plan scaffold @gotgenes/pi-colgrep package ([#89](https://github.com/gotgenes/pi-packages/issues/89)) ([24cde37](https://github.com/gotgenes/pi-packages/commit/24cde37c0410d7e4bb6dd35680d76ad2cafea703))

## Changelog
