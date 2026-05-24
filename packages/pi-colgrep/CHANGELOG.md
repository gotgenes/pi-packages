# Changelog

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
