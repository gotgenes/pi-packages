# Changelog

## [1.0.2](https://github.com/gotgenes/pi-packages/compare/pi-session-tools-v1.0.1...pi-session-tools-v1.0.2) (2026-06-03)


### Documentation

* standardize and correct package READMEs ([4c270ad](https://github.com/gotgenes/pi-packages/commit/4c270adac97ca816fa1889a879d1d4fe19cdd464))

## [1.0.1](https://github.com/gotgenes/pi-packages/compare/pi-session-tools-v1.0.0...pi-session-tools-v1.0.1) (2026-05-28)


### Documentation

* **retro:** add retro notes for issue [#251](https://github.com/gotgenes/pi-packages/issues/251) ([7b2c6a6](https://github.com/gotgenes/pi-packages/commit/7b2c6a613ff28c3d26b82cf035960380edd37c17))

## [1.0.0](https://github.com/gotgenes/pi-packages/compare/pi-session-tools-v0.4.0...pi-session-tools-v1.0.0) (2026-05-28)


### ⚠ BREAKING CHANGES

* both tools now return structured transcript text instead of raw JSON. Tool result bodies, thinking content, and image data are omitted. The session file on disk is available for consumers that need raw entries.

### Features

* add formatTranscript with basic message formatting ([#251](https://github.com/gotgenes/pi-packages/issues/251)) ([f9a7dee](https://github.com/gotgenes/pi-packages/commit/f9a7dee2d5ff37fc2a7533489172c94adab777d0))
* add metadata entry formatting to transcript ([#251](https://github.com/gotgenes/pi-packages/issues/251)) ([49ffac9](https://github.com/gotgenes/pi-packages/commit/49ffac9795da86211adfdb1cb0cb9eb23339d23f))
* add tool call summaries and tool result folding ([#251](https://github.com/gotgenes/pi-packages/issues/251)) ([ddcc645](https://github.com/gotgenes/pi-packages/commit/ddcc6455f4ae3b027401cd9d54ef9d70fc42be00))
* wire transcript formatter into read_session and read_parent_session ([#251](https://github.com/gotgenes/pi-packages/issues/251)) ([1c09452](https://github.com/gotgenes/pi-packages/commit/1c09452d996f6c38fe3c862402fc3ef9695ff9a5))


### Documentation

* document read_session and read_parent_session transcript format in README ([#251](https://github.com/gotgenes/pi-packages/issues/251)) ([53be9c6](https://github.com/gotgenes/pi-packages/commit/53be9c6a473a84402dbfbdd93dbbe787e94733a5))
* plan transcript-formatted output for session tools ([#251](https://github.com/gotgenes/pi-packages/issues/251)) ([f34dc19](https://github.com/gotgenes/pi-packages/commit/f34dc191bb5ee48e03d64265d91f0a241c8b8176))
* **retro:** add planning stage notes for issue [#251](https://github.com/gotgenes/pi-packages/issues/251) ([9db6d0a](https://github.com/gotgenes/pi-packages/commit/9db6d0a57ca99aaa12b709e5a716c92016a91f70))
* **retro:** add TDD stage notes for issue [#251](https://github.com/gotgenes/pi-packages/issues/251) ([80fda15](https://github.com/gotgenes/pi-packages/commit/80fda154867b9ab4e9aed80121c4c8e1b3e9b748))

## [0.4.0](https://github.com/gotgenes/pi-packages/compare/pi-session-tools-v0.3.0...pi-session-tools-v0.4.0) (2026-05-25)


### Features

* add deriveParentSessionFile utility ([95413a4](https://github.com/gotgenes/pi-packages/commit/95413a468ac8f4d1d7b7d9bebe204853fd67197c))
* add read_parent_session tool for parent session access ([d5ac58e](https://github.com/gotgenes/pi-packages/commit/d5ac58eceac0644694cef37facfd7c3486baabf1))
* add read_session tool for session introspection ([cfb47e0](https://github.com/gotgenes/pi-packages/commit/cfb47e0c782ca8cb1ad92dab46960ee475658c70))


### Bug Fixes

* add path aliases to pi-session-tools tsconfig for test imports ([8655a58](https://github.com/gotgenes/pi-packages/commit/8655a58ba97a82360b3e0d21b9c0e7294e45129b))

## [0.3.0](https://github.com/gotgenes/pi-packages/compare/pi-session-tools-v0.2.0...pi-session-tools-v0.3.0) (2026-05-24)


### Features

* add eslint config with type-aware rules and import enforcement ([4fb3cc6](https://github.com/gotgenes/pi-packages/commit/4fb3cc678da10d350b85c464318476ba9ae99dca))

## [0.2.0](https://github.com/gotgenes/pi-packages/compare/pi-session-tools-v0.1.0...pi-session-tools-v0.2.0) (2026-05-23)


### Features

* add pi-session-tools extension for programmatic session naming ([2c66604](https://github.com/gotgenes/pi-packages/commit/2c66604938ed2b1d4650d6277c15b7ad7f962db1))


### Miscellaneous Chores

* add LICENSE, CHANGELOG, AGENTS stub, and publish script entry for pi-session-tools ([6ab16b6](https://github.com/gotgenes/pi-packages/commit/6ab16b60ece64aada98a2da6c311dc575a72adaa))
* prepare pi-session-tools for npm publishing ([393d3c0](https://github.com/gotgenes/pi-packages/commit/393d3c06f0c9a0fe69334d1d773301a706c697dc))

## Changelog
