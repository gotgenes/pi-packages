# Changelog

## [1.1.1](https://github.com/gotgenes/pi-packages/compare/pi-session-tools-v1.1.0...pi-session-tools-v1.1.1) (2026-07-06)


### Bug Fixes

* **pi-session-tools:** count only effective model changes in summary ([#546](https://github.com/gotgenes/pi-packages/issues/546)) ([1afe175](https://github.com/gotgenes/pi-packages/commit/1afe1753c53c5bea5fc62341094fec8b6632950b))
* **pi-session-tools:** suppress phantom model-change lines in transcript ([#546](https://github.com/gotgenes/pi-packages/issues/546)) ([7b4f1be](https://github.com/gotgenes/pi-packages/commit/7b4f1bedf2fd29b21e054bc3b0a35370620a1493))


### Documentation

* **pi-session-tools:** note phantom model-change suppression ([#546](https://github.com/gotgenes/pi-packages/issues/546)) ([f8775e1](https://github.com/gotgenes/pi-packages/commit/f8775e1bbb1fce4cf8e4943ffba02bc165b1750b))

## [1.1.0](https://github.com/gotgenes/pi-packages/compare/pi-session-tools-v1.0.3...pi-session-tools-v1.1.0) (2026-06-16)


### Features

* **pi-session-tools:** add session entry summary helper ([#411](https://github.com/gotgenes/pi-packages/issues/411)) ([4dbae15](https://github.com/gotgenes/pi-packages/commit/4dbae159a5e38d3e5efdd110692537852691b526))
* **pi-session-tools:** attach summary details to session-read results ([#411](https://github.com/gotgenes/pi-packages/issues/411)) ([4fbec4e](https://github.com/gotgenes/pi-packages/commit/4fbec4ec1eee1829f226b764badd1883e81e3c0a))
* **pi-session-tools:** render session-read output compactly with Ctrl-O expansion ([#411](https://github.com/gotgenes/pi-packages/issues/411)) ([9292ec1](https://github.com/gotgenes/pi-packages/commit/9292ec1e5d08cf466e387ea48a75aaf3d2cc4169))


### Documentation

* **pi-session-tools:** note compact TUI rendering for session-read tools ([#411](https://github.com/gotgenes/pi-packages/issues/411)) ([621d54b](https://github.com/gotgenes/pi-packages/commit/621d54b6bbd5a7bb0d03fb578a11a706dc4ffc06))

## [1.0.3](https://github.com/gotgenes/pi-packages/compare/pi-session-tools-v1.0.2...pi-session-tools-v1.0.3) (2026-06-12)


### Miscellaneous Chores

* **deps:** bump Pi SDK to 0.79.1 ([#370](https://github.com/gotgenes/pi-packages/issues/370)) ([704f3b3](https://github.com/gotgenes/pi-packages/commit/704f3b3457ceb12b9df9efffe7a56812a5667d5d))

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
