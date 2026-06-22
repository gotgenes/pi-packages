# Changelog

## [5.1.6](https://github.com/gotgenes/pi-packages/compare/pi-autoformat-v5.1.5...pi-autoformat-v5.1.6) (2026-06-22)


### Documentation

* **pi-autoformat:** document treefmt for subdirectory-scoped formatters ([#459](https://github.com/gotgenes/pi-packages/issues/459)) ([5c35757](https://github.com/gotgenes/pi-packages/commit/5c35757636862594462ca274fee6fc7b6465865f))

## [5.1.5](https://github.com/gotgenes/pi-packages/compare/pi-autoformat-v5.1.4...pi-autoformat-v5.1.5) (2026-06-12)


### Miscellaneous Chores

* **deps:** bump Pi SDK to 0.79.1 ([#370](https://github.com/gotgenes/pi-packages/issues/370)) ([704f3b3](https://github.com/gotgenes/pi-packages/commit/704f3b3457ceb12b9df9efffe7a56812a5667d5d))

## [5.1.4](https://github.com/gotgenes/pi-packages/compare/pi-autoformat-v5.1.3...pi-autoformat-v5.1.4) (2026-06-03)


### Documentation

* standardize and correct package READMEs ([4c270ad](https://github.com/gotgenes/pi-packages/commit/4c270adac97ca816fa1889a879d1d4fe19cdd464))

## [5.1.3](https://github.com/gotgenes/pi-packages/compare/pi-autoformat-v5.1.2...pi-autoformat-v5.1.3) (2026-05-26)


### Bug Fixes

* resolve pre-existing lint errors in pi-autoformat and pi-permission-system ([68fd516](https://github.com/gotgenes/pi-packages/commit/68fd516e33ddbb9a5e37ef19e949ee9ecdc37252))

## [5.1.2](https://github.com/gotgenes/pi-packages/compare/pi-autoformat-v5.1.1...pi-autoformat-v5.1.2) (2026-05-25)


### Documentation

* **retro:** add retro notes for issue [#202](https://github.com/gotgenes/pi-packages/issues/202) ([50b3e16](https://github.com/gotgenes/pi-packages/commit/50b3e16bc81223a0a5beba3cd74c024ead8cd2e8))

## [5.1.1](https://github.com/gotgenes/pi-packages/compare/pi-autoformat-v5.1.0...pi-autoformat-v5.1.1) (2026-05-25)


### Bug Fixes

* use pi-autoformat tag in status key and status line ([#202](https://github.com/gotgenes/pi-packages/issues/202)) ([dd7ce59](https://github.com/gotgenes/pi-packages/commit/dd7ce59ceea8e44c286653df617173b9c61b9dc4))
* use pi-autoformat tag in steering message prefixes ([#202](https://github.com/gotgenes/pi-packages/issues/202)) ([fa1ab2d](https://github.com/gotgenes/pi-packages/commit/fa1ab2dd60591b4674a009e99413dd435a5a85d7))


### Documentation

* plan consistent pi-autoformat message tags ([#202](https://github.com/gotgenes/pi-packages/issues/202)) ([ef1d36f](https://github.com/gotgenes/pi-packages/commit/ef1d36f0678d083ec5a736bc8861ea36c2e483c2))
* **retro:** add planning stage notes for issue [#202](https://github.com/gotgenes/pi-packages/issues/202) ([fdbc65b](https://github.com/gotgenes/pi-packages/commit/fdbc65b98374986d645b27a75c872fb979d76272))
* **retro:** add TDD stage notes for issue [#202](https://github.com/gotgenes/pi-packages/issues/202) ([632cd50](https://github.com/gotgenes/pi-packages/commit/632cd5014368ed9f67321b5ac4f84cd24e8b43cb))

## [5.1.0](https://github.com/gotgenes/pi-packages/compare/pi-autoformat-v5.0.4...pi-autoformat-v5.1.0) (2026-05-24)


### Features

* add eslint config with type-aware rules and import enforcement ([4fb3cc6](https://github.com/gotgenes/pi-packages/commit/4fb3cc678da10d350b85c464318476ba9ae99dca))

## [5.0.4](https://github.com/gotgenes/pi-packages/compare/pi-autoformat-v5.0.3...pi-autoformat-v5.0.4) (2026-05-23)


### Bug Fixes

* add package.json imports field for #src/#test path aliases ([#157](https://github.com/gotgenes/pi-packages/issues/157)) ([75b4598](https://github.com/gotgenes/pi-packages/commit/75b45980810583452f7741678359c004900c8bd0))

## [5.0.3](https://github.com/gotgenes/pi-packages/compare/pi-autoformat-v5.0.2...pi-autoformat-v5.0.3) (2026-05-23)


### Bug Fixes

* resolve fallow dead-code warnings ([2113f6b](https://github.com/gotgenes/pi-packages/commit/2113f6bc49812ce32ac68d0e2dd88e0a60b4474a))

## [5.0.2](https://github.com/gotgenes/pi-packages/compare/pi-autoformat-v5.0.1...pi-autoformat-v5.0.2) (2026-05-19)


### Documentation

* enforce one-sentence-per-line across all markdown files ([a533869](https://github.com/gotgenes/pi-packages/commit/a533869e09ea33a2da8c4ac022d9be4674be4b18))

## [5.0.1](https://github.com/gotgenes/pi-packages/compare/pi-autoformat-v5.0.0...pi-autoformat-v5.0.1) (2026-05-19)


### Documentation

* **retro:** add retro notes for issue [#67](https://github.com/gotgenes/pi-packages/issues/67) ([5deac18](https://github.com/gotgenes/pi-packages/commit/5deac1868d9bb69b92c45d2b215e63b5960b3bd1))

## [5.0.0](https://github.com/gotgenes/pi-packages/compare/pi-autoformat-v4.0.6...pi-autoformat-v5.0.0) (2026-05-19)


### ⚠ BREAKING CHANGES

* All @earendil-works/pi-* peerDependencies and devDependencies now require >=0.75.0, aligning with Pi's Node 22 minimum.
* Minimum supported Node.js version is now >=22, aligning with Pi v0.75.0. tsconfig target raised from ES2023 to ES2024.
    - ES2024 APIs (Promise.withResolvers, Object.groupBy, Map.groupBy, Array.fromAsync) are now allowed.
    - @types/node catalog aligned to ^22.15.3.
    - pi-autoformat now declares engines.node for consistency.

### Features

* raise minimum Node.js version to 22 and bump tsconfig target to ES2024 ([98a5b01](https://github.com/gotgenes/pi-packages/commit/98a5b01ca20aa1feed14a60bfa7bb9e082c9914b))
* raise minimum Pi dependency to v0.75.0 ([1068329](https://github.com/gotgenes/pi-packages/commit/10683290d2a789880848bf7eb093d4307b6eff40))


### Bug Fixes

* increase acceptance test timeout to avoid CI flakiness ([#67](https://github.com/gotgenes/pi-packages/issues/67)) ([50c839c](https://github.com/gotgenes/pi-packages/commit/50c839cca0ebb751b00d15894869e289dc9aa9f9))
* unquote rumdl globs so shell expands them ([3b13a20](https://github.com/gotgenes/pi-packages/commit/3b13a20b2822db1e85a9d7546e0a21a63451d975))


### Documentation

* plan fix acceptance test timeout on slow CI runners ([#67](https://github.com/gotgenes/pi-packages/issues/67)) ([2e1ff0a](https://github.com/gotgenes/pi-packages/commit/2e1ff0a8471843e60ad84107757c56ecb8f205cb))

## [4.0.6](https://github.com/gotgenes/pi-packages/compare/pi-autoformat-v4.0.5...pi-autoformat-v4.0.6) (2026-05-17)


### Bug Fixes

* restore per-package lint:md and lint scripts ([0e42617](https://github.com/gotgenes/pi-packages/commit/0e42617c443a7f8695f33855fa17058fc1712f27))
* use root markdownlint config from all packages ([30192f8](https://github.com/gotgenes/pi-packages/commit/30192f8ccfc5c3c420f9f9b602df174baf263e92))


### Documentation

* add redirect AGENTS.md to each package subdirectory ([cbdcd29](https://github.com/gotgenes/pi-packages/commit/cbdcd297194c814f545ae93eaa7418e9337450d3))


### Miscellaneous Chores

* consolidate configs into monorepo root ([8583eaf](https://github.com/gotgenes/pi-packages/commit/8583eaf0764ac98def1987f20fafcc25e912b134))
* remove per-package pi-autoformat configs ([b2d405a](https://github.com/gotgenes/pi-packages/commit/b2d405a0a278341e4f6ff1c8b607533eaa4f021a))
* replace markdownlint-cli2 with rumdl ([d8dc789](https://github.com/gotgenes/pi-packages/commit/d8dc7897d854bf11396b85bc8c365e8e2ed7e66c))
* update package.json URLs to monorepo ([b92dbfa](https://github.com/gotgenes/pi-packages/commit/b92dbfaeaeb6cf2823272cb6fb6f206fb99a5009))

## [4.0.5](https://github.com/gotgenes/pi-autoformat/compare/v4.0.4...v4.0.5) (2026-05-15)


### Bug Fixes

* expand tilde in file paths before resolving against cwd ([2697ad3](https://github.com/gotgenes/pi-autoformat/commit/2697ad30a943760b581fcc545077c7d04d986351))


### Documentation

* add Configuration section to README ([f22f9c8](https://github.com/gotgenes/pi-autoformat/commit/f22f9c847f5db3bd64418d213fea1501e03fa9de))


### Miscellaneous Chores

* format .pi/settings.json ([a5daa84](https://github.com/gotgenes/pi-autoformat/commit/a5daa848d7ca374d6c57bed7492d8cf38ed77cd2))
* upgrade pnpm to 11.1.1 and update GitHub Actions ([79e5b78](https://github.com/gotgenes/pi-autoformat/commit/79e5b78839b56791fed99ed98720ced4ce9518e2))

## [4.0.4](https://github.com/gotgenes/pi-autoformat/compare/v4.0.3...v4.0.4) (2026-05-08)


### Miscellaneous Chores

* migrate to [@earendil-works](https://github.com/earendil-works) pi packages and upgrade pnpm to 11.0.8 ([519179d](https://github.com/gotgenes/pi-autoformat/commit/519179daa717faab632cbdc180bf368e9bf9b929))

## [4.0.3](https://github.com/gotgenes/pi-autoformat/compare/v4.0.2...v4.0.3) (2026-05-06)


### Bug Fixes

* add repository URL for OIDC provenance publishing ([4b5335e](https://github.com/gotgenes/pi-autoformat/commit/4b5335e2a7b39531af811a6756ef5656e64831ef))

## [4.0.2](https://github.com/gotgenes/pi-autoformat/compare/v4.0.1...v4.0.2) (2026-05-06)


### Miscellaneous Chores

* update dependencies ([8e59b6c](https://github.com/gotgenes/pi-autoformat/commit/8e59b6c186411b247b409dc823b21bb22a8e8c69))

## [4.0.1](https://github.com/gotgenes/pi-autoformat/compare/v4.0.0...v4.0.1) (2026-05-06)


### Documentation

* add logo to README ([8044f45](https://github.com/gotgenes/pi-autoformat/commit/8044f45b3a37b8684ea5d187afc67b0eaa27947f))

## [4.0.0](https://github.com/gotgenes/pi-autoformat/compare/v3.0.1...v4.0.0) (2026-05-03)


### ⚠ BREAKING CHANGES

* The agent_end follow-up turn mechanism has been removed. Formatting notifications are now delivered inline as steering messages between turns.
* notifyAgent is no longer accepted in the configuration schema. The extension now notifies via steering messages at turn end.
* notifyAgent config field has been removed. The extension now notifies via steering messages at turn end.

### Features

* add buildSteeringMessageContent helper ([#31](https://github.com/gotgenes/pi-autoformat/issues/31)) ([e0e7d86](https://github.com/gotgenes/pi-autoformat/commit/e0e7d867adea60727c21da9ebb57d819d8a2c5ba))
* add pi-extension-lifecycle skill with turn/tool model reference ([#31](https://github.com/gotgenes/pi-autoformat/issues/31)) ([a136bc6](https://github.com/gotgenes/pi-autoformat/commit/a136bc6a17b3cd68b57ef1524cb0773a09343703))
* detect content changes in flushPrompt ([#31](https://github.com/gotgenes/pi-autoformat/issues/31)) ([65c735d](https://github.com/gotgenes/pi-autoformat/commit/65c735dd86b0553d608f465b20c59e2c337b5a38))
* flush formatters at turn_end ([#31](https://github.com/gotgenes/pi-autoformat/issues/31)) ([6b27a78](https://github.com/gotgenes/pi-autoformat/commit/6b27a78048eb95d5f1d0e43d0def18961a4568c4))
* include failure details in steering notification ([#31](https://github.com/gotgenes/pi-autoformat/issues/31)) ([28109a6](https://github.com/gotgenes/pi-autoformat/commit/28109a6e54ee8c5ad6c36664079f7dba59e8a793))
* remove notifyAgent config field ([#31](https://github.com/gotgenes/pi-autoformat/issues/31)) ([d5b1d0c](https://github.com/gotgenes/pi-autoformat/commit/d5b1d0c1bdfdda5409c8b50d2d8d777c035a7680))
* remove notifyAgent from schema ([#31](https://github.com/gotgenes/pi-autoformat/issues/31)) ([c936148](https://github.com/gotgenes/pi-autoformat/commit/c93614868fd98a36f40fd6c443db761858162fae))
* replace agent_end follow-up with turn-end steering ([#31](https://github.com/gotgenes/pi-autoformat/issues/31)) ([8e2e7bb](https://github.com/gotgenes/pi-autoformat/commit/8e2e7bb8a21c8f217b0e8c341032820f968bcf36))
* send steering notification after turn-end formatting ([#31](https://github.com/gotgenes/pi-autoformat/issues/31)) ([aa18c6d](https://github.com/gotgenes/pi-autoformat/commit/aa18c6db604bc77d7b34a05601965dbd32bad92b))


### Bug Fixes

* markdownlint table separator spacing in plan and skill ([#31](https://github.com/gotgenes/pi-autoformat/issues/31)) ([84767fa](https://github.com/gotgenes/pi-autoformat/commit/84767fa8c9a8bb630339842cf3f067e8960619f4))


### Documentation

* add plan for pre-commit flush ([#31](https://github.com/gotgenes/pi-autoformat/issues/31)) ([2ffd469](https://github.com/gotgenes/pi-autoformat/commit/2ffd469c5d3c29bbe550fa4c449dc378c7548636))
* add table separator spacing rule to AGENTS.md ([b3076e8](https://github.com/gotgenes/pi-autoformat/commit/b3076e8f810d0f2c4f0c77ad519964b62faf3289))
* document turn-end formatting and steering notifications ([#31](https://github.com/gotgenes/pi-autoformat/issues/31)) ([2fc6bf5](https://github.com/gotgenes/pi-autoformat/commit/2fc6bf533adf4fe333febcef73f2f5e0db032658))
* plan turn-end flush with change detection ([#31](https://github.com/gotgenes/pi-autoformat/issues/31)) ([a4429a8](https://github.com/gotgenes/pi-autoformat/commit/a4429a8fa3e432e69e093aa030674207ac89d122))


### Miscellaneous Chores

* remove --fix flags from prek hooks ([a9664a2](https://github.com/gotgenes/pi-autoformat/commit/a9664a285473a7306e28a67f03ff517681a4c8ab))

## [3.0.1](https://github.com/gotgenes/pi-autoformat/compare/v3.0.0...v3.0.1) (2026-05-02)


### Bug Fixes

* remove default formatter chains to prevent unwanted formatting ([48f690e](https://github.com/gotgenes/pi-autoformat/commit/48f690e243fd41e789e8a6281d32067218a6ccb5))


### Documentation

* update README and configuration for no default chains ([6e7015b](https://github.com/gotgenes/pi-autoformat/commit/6e7015bf72cbf66b6dde164a7ed5e7d79be7544f))

## [3.0.0](https://github.com/gotgenes/pi-autoformat/compare/v2.4.2...v3.0.0) (2026-05-02)


### ⚠ BREAKING CHANGES

* Removed formatMode branching from the extension runtime. The tool_result handler no longer conditionally flushes. The agent_end handler always flushes. The session_shutdown handler no longer conditionally flushes. Tests for tool and session mode behaviors have been removed.
* The formatMode property has been removed from the JSON schema. Existing configs with formatMode will fail schema validation but the config loader still tolerates the key with a deprecation notice.
* The formatMode config field has been removed. The runtime always uses prompt-end formatting (the previous "prompt" behavior). The config loader tolerates the legacy key, emits a config issue, and discards the value.

### Features

* add buildNotifyMessageContent helper ([#27](https://github.com/gotgenes/pi-autoformat/issues/27)) ([74d8451](https://github.com/gotgenes/pi-autoformat/commit/74d845101a4ca9ea76b68c2b7db98c2786583737))
* add notifyAgent config field ([#27](https://github.com/gotgenes/pi-autoformat/issues/27)) ([f660c84](https://github.com/gotgenes/pi-autoformat/commit/f660c841ac54701c18aacae209e0a37b901a5cda))
* always use prompt-end formatting ([#27](https://github.com/gotgenes/pi-autoformat/issues/27)) ([991d0c8](https://github.com/gotgenes/pi-autoformat/commit/991d0c8de66575d96fdf7e5eca3a5b24e812e2dd))
* emit config issue for legacy formatMode key ([#27](https://github.com/gotgenes/pi-autoformat/issues/27)) ([98f51e9](https://github.com/gotgenes/pi-autoformat/commit/98f51e9d09c3551013212d3611f0741a66bf400d))
* include formatter failures in follow-up message ([#27](https://github.com/gotgenes/pi-autoformat/issues/27)) ([fe41c38](https://github.com/gotgenes/pi-autoformat/commit/fe41c38e4ea18c508b23564558cc1ef1c542368b))
* remove formatMode config field ([#27](https://github.com/gotgenes/pi-autoformat/issues/27)) ([d5b4484](https://github.com/gotgenes/pi-autoformat/commit/d5b4484c59d64f014440f8194795e129f8354f48))
* remove formatMode from config schema ([#27](https://github.com/gotgenes/pi-autoformat/issues/27)) ([bb970f1](https://github.com/gotgenes/pi-autoformat/commit/bb970f1e7c106c9d4eb5ba3a5b8da3be6488d455))
* send follow-up turn after formatting ([#27](https://github.com/gotgenes/pi-autoformat/issues/27)) ([ff4b6bd](https://github.com/gotgenes/pi-autoformat/commit/ff4b6bd37d23b5a57ec723fb135cb15e306bf469))


### Bug Fixes

* safety-net flush on session_shutdown and lint fixes ([#27](https://github.com/gotgenes/pi-autoformat/issues/27)) ([3f834f0](https://github.com/gotgenes/pi-autoformat/commit/3f834f0bd676e1da66f60583e3f05130d5a5039f))


### Documentation

* backport prompt template improvements from pi-permission-system ([59e35f3](https://github.com/gotgenes/pi-autoformat/commit/59e35f3d622dca89093f18eb330857b267cadba6))
* document notifyAgent and remove formatMode docs ([#27](https://github.com/gotgenes/pi-autoformat/issues/27)) ([d4b8f24](https://github.com/gotgenes/pi-autoformat/commit/d4b8f24c7c4f87f076878afc93d0b4b61117218c))
* plan format-before-exit follow-up turn ([#27](https://github.com/gotgenes/pi-autoformat/issues/27)) ([85eb70d](https://github.com/gotgenes/pi-autoformat/commit/85eb70ddd6d769437b1b81667a6cb72cb4a5be62))
* plan format-before-exit follow-up turn ([#27](https://github.com/gotgenes/pi-autoformat/issues/27)) ([626a8fd](https://github.com/gotgenes/pi-autoformat/commit/626a8fd563ce2454fcea28c49d4a880600ec03ab))

## [2.4.2](https://github.com/gotgenes/pi-autoformat/compare/v2.4.1...v2.4.2) (2026-05-02)


### Documentation

* drop stale v1 framing from configuration reference ([5e6d765](https://github.com/gotgenes/pi-autoformat/commit/5e6d765ac40a045fc6db18df2796a45f9cdc8c31))
* slim README and link to configuration reference ([a5bbec0](https://github.com/gotgenes/pi-autoformat/commit/a5bbec041b0be93a54e27cd04759b17a1bdbf724))

## [2.4.1](https://github.com/gotgenes/pi-autoformat/compare/v2.4.0...v2.4.1) (2026-05-02)


### Documentation

* **retro:** add retro notes for issue [#15](https://github.com/gotgenes/pi-autoformat/issues/15) ([314f89a](https://github.com/gotgenes/pi-autoformat/commit/314f89a1eaede591426b81d7ae37e187af9f644a))

## [2.4.0](https://github.com/gotgenes/pi-autoformat/compare/v2.3.2...v2.4.0) (2026-05-02)


### Features

* accept built-in names in chains validation ([e96d346](https://github.com/gotgenes/pi-autoformat/commit/e96d3461e2c3a27173046e30021ba55bb35a2e25))
* allow wildcard chain key in schema ([a11d4b3](https://github.com/gotgenes/pi-autoformat/commit/a11d4b3d225c077e6f4dbb209610bf4df3507605))
* build treefmt and treefmt-nix invocations ([cc1f32a](https://github.com/gotgenes/pi-autoformat/commit/cc1f32a26c5c3b237ad88172993539f67a699ed2))
* discover treefmt and treefmt-nix config roots ([53141d2](https://github.com/gotgenes/pi-autoformat/commit/53141d22e5b529eb2f62b652fbdafd93ebb56105))
* dispatch wildcard chain before per-extension chains ([07758b0](https://github.com/gotgenes/pi-autoformat/commit/07758b07fae49a99850184ce892281303b93f537))
* group files by wildcard chain first ([c15b4d2](https://github.com/gotgenes/pi-autoformat/commit/c15b4d2fff41ef40391cfef33ca0f44667e0c535))
* parse treefmt skip patterns ([973f7e4](https://github.com/gotgenes/pi-autoformat/commit/973f7e42984f7089a3be26e6ff135f93b65d8558))
* partition built-in batches by handled set ([08f8016](https://github.com/gotgenes/pi-autoformat/commit/08f8016adfc3f8db6e866cef16e9292f6f5487a7))
* prefer treefmt-nix over treefmt at same root ([c3625f3](https://github.com/gotgenes/pi-autoformat/commit/c3625f31fa4d4968ce203f95609481abe2db20bd))
* register treefmt and treefmt-nix as built-in formatters ([7e53dfb](https://github.com/gotgenes/pi-autoformat/commit/7e53dfb495c2faa2f2c63a728973929796c70f0e))


### Documentation

* document built-in treefmt and treefmt-nix support ([82d3511](https://github.com/gotgenes/pi-autoformat/commit/82d351141c39aa47f96f11059fd67d4589d2ad07))
* plan built-in treefmt and treefmt-nix support ([#15](https://github.com/gotgenes/pi-autoformat/issues/15)) ([2ce1706](https://github.com/gotgenes/pi-autoformat/commit/2ce17061ea36795ce0192f5302037a3e666b66b4))

## [2.3.2](https://github.com/gotgenes/pi-autoformat/compare/v2.3.1...v2.3.2) (2026-05-02)


### Documentation

* document acceptance-test layout and pi binary resolution ([38f95fe](https://github.com/gotgenes/pi-autoformat/commit/38f95fe63d1c633183adf145431ad097ec97a198))
* plan expanded acceptance test coverage ([#10](https://github.com/gotgenes/pi-autoformat/issues/10)) ([382fbfc](https://github.com/gotgenes/pi-autoformat/commit/382fbfc65d67d8c673f0d1db8a99b20619a18b46))
* resolve pi from node_modules in acceptance plan ([#10](https://github.com/gotgenes/pi-autoformat/issues/10)) ([e262805](https://github.com/gotgenes/pi-autoformat/commit/e2628057192eae06c44e22808e161b2da579b917))
* **retro:** add retro notes for issue [#22](https://github.com/gotgenes/pi-autoformat/issues/22) ([b0464d8](https://github.com/gotgenes/pi-autoformat/commit/b0464d8c653e6e697d3c7ba18a3135c1ad44e96f))

## [2.3.1](https://github.com/gotgenes/pi-autoformat/compare/v2.3.0...v2.3.1) (2026-05-02)


### Documentation

* plan adopting pi-coding-agent types ([#22](https://github.com/gotgenes/pi-autoformat/issues/22)) ([d06f43c](https://github.com/gotgenes/pi-autoformat/commit/d06f43cb216fb10a8c4ce2252dd55ded65ce5114))
* **retro:** add retro notes for issue [#2](https://github.com/gotgenes/pi-autoformat/issues/2) ([9e1ebd6](https://github.com/gotgenes/pi-autoformat/commit/9e1ebd680098d5588c382c6d37080defffb5b5b1))
* **retro:** revert pi-mono pointer in favor of issue [#22](https://github.com/gotgenes/pi-autoformat/issues/22) ([3289595](https://github.com/gotgenes/pi-autoformat/commit/32895952b2a65b14c5c191dc80a2eae2196a77c6))


### Miscellaneous Chores

* add pi-coding-agent for runtime types ([2d93a5e](https://github.com/gotgenes/pi-autoformat/commit/2d93a5e3cd56dac630f978618ff6c1d1cd3dd031))

## [2.3.0](https://github.com/gotgenes/pi-autoformat/compare/v2.2.0...v2.3.0) (2026-05-02)


### Features

* add formatter run output trimming helper ([4263a78](https://github.com/gotgenes/pi-autoformat/commit/4263a7822f969eb0a3633864c99b5573dcc2ea87))
* add formatterOutput config object with safe defaults ([c0a88e2](https://github.com/gotgenes/pi-autoformat/commit/c0a88e23a8cccc3cba2e70d6b44fafe80ad4facb))
* surface failed formatter output in reports ([768bf2a](https://github.com/gotgenes/pi-autoformat/commit/768bf2a3d0ac67f9ef4010de3347300be831ea22))
* surface formatterOutput in the JSON schema ([15cbfef](https://github.com/gotgenes/pi-autoformat/commit/15cbfefcc23c1462a6e62ad094da48c22287270c))


### Bug Fixes

* preserve theme this binding when coloring the status line ([6a6ec16](https://github.com/gotgenes/pi-autoformat/commit/6a6ec16bbb52b4a14c12a7e86d36d691a3c41eb2))


### Documentation

* apply autoformat to plan 0016 ([04677ee](https://github.com/gotgenes/pi-autoformat/commit/04677eee19698e0448776157c3ddcc77e2489793))
* document the formatterOutput failure reporting option ([6cb70c6](https://github.com/gotgenes/pi-autoformat/commit/6cb70c6d1b05914daf4aa46ae043149650ca1bfa))
* plan optional detailed formatter output on failure ([#2](https://github.com/gotgenes/pi-autoformat/issues/2)) ([a2d466e](https://github.com/gotgenes/pi-autoformat/commit/a2d466ebab41bcfaa4ef25e04794e42fb30b031a))
* **retro:** add retro notes for issue [#1](https://github.com/gotgenes/pi-autoformat/issues/1) ([031cde3](https://github.com/gotgenes/pi-autoformat/commit/031cde358312e93ee0fd1a75ed8a951539c15a65))


### Miscellaneous Chores

* update pi-autoformat config ([5759bf6](https://github.com/gotgenes/pi-autoformat/commit/5759bf6ff3c964bbaa9b183f7c1ae68940523c2a))

## [2.2.0](https://github.com/gotgenes/pi-autoformat/compare/v2.1.0...v2.2.0) (2026-05-02)


### Features

* add /retro slash command for end-of-flow retrospectives ([09a50ed](https://github.com/gotgenes/pi-autoformat/commit/09a50ed78b18ae48633759f75d423b03df118138))
* clear autoformat status on session lifecycle boundaries ([4834d45](https://github.com/gotgenes/pi-autoformat/commit/4834d452cb5cfd99f8988b40d9a05dbb8da1e720))
* keep failure notifications and add persistent failure status ([9ece2b8](https://github.com/gotgenes/pi-autoformat/commit/9ece2b8c64fa9730c91080bd190bdcfcbf87472b))
* render formatter success summaries in the footer status ([2a37b1b](https://github.com/gotgenes/pi-autoformat/commit/2a37b1bd5fb04c1f3dd2630daa139ca0c87425d2))
* respect hideSummariesInTui for footer status ([3cf8548](https://github.com/gotgenes/pi-autoformat/commit/3cf8548d7e63d6b0cd78f1e0c5953ec67624df10))


### Documentation

* add frontmatter convention to plans and retros ([2648129](https://github.com/gotgenes/pi-autoformat/commit/26481296025d41076761437b3e97d50789b2fa3e))
* describe footer-status formatter summaries ([1df2550](https://github.com/gotgenes/pi-autoformat/commit/1df2550720c368145e3e927f0cecc6782939555f))
* plan richer TUI formatter summaries via footer status ([#1](https://github.com/gotgenes/pi-autoformat/issues/1)) ([a50fba9](https://github.com/gotgenes/pi-autoformat/commit/a50fba9b707ce6831547411ddf539d872bfcc2a4))
* **retro:** add retro notes for issue [#13](https://github.com/gotgenes/pi-autoformat/issues/13) ([9591d5a](https://github.com/gotgenes/pi-autoformat/commit/9591d5a6df28262c2e40e1457c76504cc3e7315b))

## [2.1.0](https://github.com/gotgenes/pi-autoformat/compare/v2.0.0...v2.1.0) (2026-05-01)


### Features

* add PATH probe with per-flush cache ([aa97aa7](https://github.com/gotgenes/pi-autoformat/commit/aa97aa77a1a6070e13416290a56589fe4057f2d8))
* allow fallback chain steps in schema ([535190e](https://github.com/gotgenes/pi-autoformat/commit/535190e83681c3be80fafe2947edbca21be27360))
* dispatch fallback chain steps ([a263778](https://github.com/gotgenes/pi-autoformat/commit/a26377872eca7f0186aafa619a6fe3a6570298cf))
* resolve fallback chain steps ([6daed75](https://github.com/gotgenes/pi-autoformat/commit/6daed752eaca03c5f10885055c77f027121913a8))
* share PATH probe cache across flush ([8d0af4d](https://github.com/gotgenes/pi-autoformat/commit/8d0af4da40b16d542a374cad00cafe867d41fb5f))
* support fallback steps in chain grouping ([f07acc5](https://github.com/gotgenes/pi-autoformat/commit/f07acc5199795fa4f4779292179ca90d0c8da919))
* surface fallback context in flush reporting ([2159cfb](https://github.com/gotgenes/pi-autoformat/commit/2159cfbd6def3f418d14f244fc6fd8476210de66))
* surface unknown formatter names in chains as config issues ([f46f7af](https://github.com/gotgenes/pi-autoformat/commit/f46f7afa0c82188b7089841778beffeba225dca6))
* validate fallback chain steps in config loader ([ec52a14](https://github.com/gotgenes/pi-autoformat/commit/ec52a14574cfc3ef636b008423ad08c3b77cdaf2))


### Documentation

* document deprecation pattern for removed config fields ([988ae7b](https://github.com/gotgenes/pi-autoformat/commit/988ae7b0daed4f604354b9392bd7a89d0df36cc3))
* document fallback chain steps and project-config recommendation ([3bbc846](https://github.com/gotgenes/pi-autoformat/commit/3bbc846701a0e0551451e81eae4540cff3b36381))
* plan fallback chain step type ([#13](https://github.com/gotgenes/pi-autoformat/issues/13)) ([83df5ff](https://github.com/gotgenes/pi-autoformat/commit/83df5ff05587e686f9df41871f60de2057d5f79b))
* **prompts:** renumber ship-issue steps to 1-based indexing ([3f37ba6](https://github.com/gotgenes/pi-autoformat/commit/3f37ba6613aa67a496115bb366a497df3661b8f3))
* **prompts:** require clean git pull --ff-only before plan/tdd/ship ([22cfe92](https://github.com/gotgenes/pi-autoformat/commit/22cfe92a2cd6615951fc7ba027363c43a70dc177))

## [2.0.0](https://github.com/gotgenes/pi-autoformat/compare/v1.0.0...v2.0.0) (2026-05-01)


### ⚠ BREAKING CHANGES

* `formatterDefinition.extensions` is no longer declared in schemas/pi-autoformat.schema.json. Editor validators will flag stale `extensions` keys as unknown properties. The runtime loader still tolerates them with a deprecation notice.
* `FormatterDefinition.extensions` has been removed from the public TypeScript type and from built-in defaults. Code that reads or writes that field must be updated. On-disk configs are tolerated with a deprecation notice.

### Features

* drop extensions field from FormatterDefinition and loader ([3fd791e](https://github.com/gotgenes/pi-autoformat/commit/3fd791e9de7f44f863986ad55c3db94d964cdda4))
* drop extensions from pi-autoformat JSON schema ([018c1a7](https://github.com/gotgenes/pi-autoformat/commit/018c1a776dc7fe97b4957b06874ff3391c8b26ef))


### Documentation

* add issue-driven workflow prompt templates ([14295be](https://github.com/gotgenes/pi-autoformat/commit/14295be83f5953dbbc143d0a12440f759216c5f2))
* adopt one-sentence-per-line and code-fence language conventions ([544fc68](https://github.com/gotgenes/pi-autoformat/commit/544fc68ead478120948070d904ff9698a5aa1624))
* plan removing unused formatter extensions field ([#12](https://github.com/gotgenes/pi-autoformat/issues/12)) ([fe0b6bd](https://github.com/gotgenes/pi-autoformat/commit/fe0b6bdfbad38d48c163b4b714e1d48dcc249a29))
* reflow markdown to one sentence per line ([49bdefb](https://github.com/gotgenes/pi-autoformat/commit/49bdefb6ccd853e2422213854c460d405472fa7e))
* remove formatter extensions field and note deprecation ([ddc54cd](https://github.com/gotgenes/pi-autoformat/commit/ddc54cddfdbd90b8973b21631ce555a275b895b9))


### Miscellaneous Chores

* add npm keywords including pi-package for registry ([aee15c0](https://github.com/gotgenes/pi-autoformat/commit/aee15c092e3f399d174241ed55879bcb75818b49))

## [1.0.0](https://github.com/gotgenes/pi-autoformat/compare/v0.4.0...v1.0.0) (2026-05-01)


### ⚠ BREAKING CHANGES

* removes resolveFormatterChainForFile, executeFormatterChain, and FormatterExecutionResult. Default formatter commands no longer include $FILE; the schema rejects $FILE in formatter command arguments.
* failure summaries are now grouped per batch instead of per file (one line per failed batch listing the files it ran against).
* PromptAutoformatterResult now exposes groups[] instead of files[]; each group runs its chain once with all files appended.
* $FILE substitution is no longer supported. File paths are appended to the command automatically by the batch executor.

### Features

* add resolveChain for name-based formatter resolution ([b67dbc3](https://github.com/gotgenes/pi-autoformat/commit/b67dbc389441930b545275ee67d0f7aca601ca53))
* batch-dispatch chain steps via executeChainGroup ([83a6627](https://github.com/gotgenes/pi-autoformat/commit/83a6627433586dc46850a6bc81b809c55a4c7fc9))
* drop $FILE substitution and per-file dispatch path ([d26f825](https://github.com/gotgenes/pi-autoformat/commit/d26f825487e8fa3ced0498e23f64089abc9dee6d))
* group touched files by chain identity ([6a8832b](https://github.com/gotgenes/pi-autoformat/commit/6a8832b6e1c25518d558da295dba977ce086ae4d))
* reject $FILE in formatter commands ([3865b34](https://github.com/gotgenes/pi-autoformat/commit/3865b349b9ed9ef1dff1a66a3411511c4d82d4cf))
* report formatter results per batch ([d16d7b1](https://github.com/gotgenes/pi-autoformat/commit/d16d7b1694f566f2963af6d353b7ad4356305592))
* switch PromptAutoformatter to group-based batch dispatch ([42845ee](https://github.com/gotgenes/pi-autoformat/commit/42845eef246f7d7db2182c99596dd656e753f6de))


### Documentation

* document batch-by-default formatter dispatch ([1e363d2](https://github.com/gotgenes/pi-autoformat/commit/1e363d2755f67d766941ea5800196429cf2176dd))
* plan batch-by-default formatter dispatch ([#14](https://github.com/gotgenes/pi-autoformat/issues/14)) ([ce330cd](https://github.com/gotgenes/pi-autoformat/commit/ce330cd668edb33ffc9541ad1749c0af168498bd))

## [0.4.0](https://github.com/gotgenes/pi-autoformat/compare/v0.3.1...v0.4.0) (2026-05-01)


### Features

* **config:** add customMutationTools and eventBusMutationChannel schema ([f2a3ac4](https://github.com/gotgenes/pi-autoformat/commit/f2a3ac4b5579270a5938401b3e4b8418550fbe0a))
* extract touched paths from declared custom tool inputs ([665aaed](https://github.com/gotgenes/pi-autoformat/commit/665aaed00d322f40354cb2990e2bcb3ff89ed2c6))
* subscribe to EventBus channel for peer-emitted touched files ([8986535](https://github.com/gotgenes/pi-autoformat/commit/898653575f5b4a48b506af05b5c17e363c404555))
* wire customMutationTools into default autoformatter ([638f203](https://github.com/gotgenes/pi-autoformat/commit/638f2031ed556d369d223acdcb27006d8c649fa8))


### Documentation

* add plan for additional Pi mutation tools ([5c3fb35](https://github.com/gotgenes/pi-autoformat/commit/5c3fb35d30dd8a8a757d69533eb280a8d798ec89))
* capture design philosophy in AGENTS.md and README design goals ([e318d1b](https://github.com/gotgenes/pi-autoformat/commit/e318d1bd46b536f8b8d9adae435bf05ec864416a))
* document customMutationTools and eventBusMutationChannel ([5cc7c71](https://github.com/gotgenes/pi-autoformat/commit/5cc7c713a0cbad49a5b1f5ab83afbd272495483f))

## [0.3.1](https://github.com/gotgenes/pi-autoformat/compare/v0.3.0...v0.3.1) (2026-04-29)


### Bug Fixes

* do not bypass realpath escape check via lexical path in scope test ([89bbae5](https://github.com/gotgenes/pi-autoformat/commit/89bbae50597be7cf406ecb262c2bb71a7fe0e604))
* pass typecheck for AutoformatConfig and TestPi in tests ([f6e57b1](https://github.com/gotgenes/pi-autoformat/commit/f6e57b12fb7f7c070bb186b5c7369d0d6d5e94da))


### Documentation

* add status badges to README ([358ca02](https://github.com/gotgenes/pi-autoformat/commit/358ca02bfb43e8e64952d10c2d5784562c6e4e1b))
* bump pnpm badge to &gt;=10 to match packageManager ([175fd83](https://github.com/gotgenes/pi-autoformat/commit/175fd832d066c838a1a8721a8dc888dc0f3e99a3))

## [0.3.0](https://github.com/gotgenes/pi-autoformat/compare/v0.2.0...v0.3.0) (2026-04-29)


### Features

* add format scope filter with repo-root default and cwd fallback ([aa5449b](https://github.com/gotgenes/pi-autoformat/commit/aa5449b99a15ffa480e5fdd0140bedb08566bf31))
* detect file mutations from shell commands (opt-in) ([3d06d48](https://github.com/gotgenes/pi-autoformat/commit/3d06d48c96038463dfa46c85e1f6007668c5103e))


### Documentation

* add plan for shell-driven mutation coverage ([3784e7c](https://github.com/gotgenes/pi-autoformat/commit/3784e7cf8bc7c710865a60b99748aff227f686bb))

## [0.2.0](https://github.com/gotgenes/pi-autoformat/compare/v0.1.0...v0.2.0) (2026-04-29)


### Features

* add default formatter config with user overrides ([9d0d458](https://github.com/gotgenes/pi-autoformat/commit/9d0d4587a9ab8f3a4d1f9d717dc08eea69ee673e))
* add extension-owned config loader ([cca9655](https://github.com/gotgenes/pi-autoformat/commit/cca9655b9748de46952b1f6d3a161c2754128cef))
* add prompt-end autoformatter orchestration ([4bbacba](https://github.com/gotgenes/pi-autoformat/commit/4bbacbaaca298ab4ad35cd0508be5cd0be31a8b3))
* add touched-file queue with prompt-flush semantics ([b6cdec0](https://github.com/gotgenes/pi-autoformat/commit/b6cdec0d09a3c88dcf1ee896c9d808b2a2928e67))
* execute formatter chains sequentially with non-blocking failures ([869a8b9](https://github.com/gotgenes/pi-autoformat/commit/869a8b98442c6466ef36a226a7fa551d2f88098d))
* polish autoformat reporting ([f480c44](https://github.com/gotgenes/pi-autoformat/commit/f480c441e0cdb1a7f02db657c33f305a78c783bc))
* require explicit formatter chains ([2eda3a4](https://github.com/gotgenes/pi-autoformat/commit/2eda3a46d87426b1fa0d872ae16e1ae095cc3236))
* resolve formatter chains from config registry ([b28eeec](https://github.com/gotgenes/pi-autoformat/commit/b28eeec9bde6119df2fcb20479930e7ce976b2a7))
* wire autoformatting into pi lifecycle ([786f0f5](https://github.com/gotgenes/pi-autoformat/commit/786f0f55f9dc7d3902e559b56c52dfe5c3620147))


### Documentation

* add configuration schema and package docs ([032f3ad](https://github.com/gotgenes/pi-autoformat/commit/032f3adf4f5bb1d39814831dc72e2406b8e4244d))
* clarify formatter command resolution ([fb10662](https://github.com/gotgenes/pi-autoformat/commit/fb1066263dee5fbee534de0bf9644b383a3f605b))
* mark v1 plan complete ([b25e42e](https://github.com/gotgenes/pi-autoformat/commit/b25e42e88b5fce6e4a8f796673b4b002cfce506e))


### Miscellaneous Chores

* add prek and formatter configuration ([02eb50b](https://github.com/gotgenes/pi-autoformat/commit/02eb50b134a2a2a93f577088e9a5c33a4f86ad75))
* add project autoformat config ([d09ab48](https://github.com/gotgenes/pi-autoformat/commit/d09ab4866b10006318ba6370429160c6fe6e3c3c))
* initialize pnpm package metadata ([8644504](https://github.com/gotgenes/pi-autoformat/commit/86445046399a52e161a221f03ce57ad32eba2836))
* initialize repository plan and agent guidance ([548fa70](https://github.com/gotgenes/pi-autoformat/commit/548fa70aedfdacfce8e1225e682c1f6958b34770))
