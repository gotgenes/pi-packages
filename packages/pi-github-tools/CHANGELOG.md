# Changelog

## [4.1.5](https://github.com/gotgenes/pi-packages/compare/pi-github-tools-v4.1.4...pi-github-tools-v4.1.5) (2026-06-17)


### Documentation

* **pi-github-tools:** correct documented merge-method fallback to merge ([00eb826](https://github.com/gotgenes/pi-packages/commit/00eb82647bc51ba4b99b1a82e39760463ceb2b97))

## [4.1.4](https://github.com/gotgenes/pi-packages/compare/pi-github-tools-v4.1.3...pi-github-tools-v4.1.4) (2026-06-12)


### Miscellaneous Chores

* **deps:** bump Pi SDK to 0.79.1 ([#370](https://github.com/gotgenes/pi-packages/issues/370)) ([704f3b3](https://github.com/gotgenes/pi-packages/commit/704f3b3457ceb12b9df9efffe7a56812a5667d5d))
* **deps:** bump typebox to 1.2.8 ([#370](https://github.com/gotgenes/pi-packages/issues/370)) ([8066a85](https://github.com/gotgenes/pi-packages/commit/8066a8573eba31b35b03fc7fcd26ab1041cc75d2))

## [4.1.3](https://github.com/gotgenes/pi-packages/compare/pi-github-tools-v4.1.2...pi-github-tools-v4.1.3) (2026-06-12)


### Documentation

* **pi-github-tools:** correct config path in doc comment ([acc028f](https://github.com/gotgenes/pi-packages/commit/acc028f8c7392ea032cde5a9c65973d561d9e475))

## [4.1.2](https://github.com/gotgenes/pi-packages/compare/pi-github-tools-v4.1.1...pi-github-tools-v4.1.2) (2026-06-03)


### Documentation

* standardize and correct package READMEs ([4c270ad](https://github.com/gotgenes/pi-packages/commit/4c270adac97ca816fa1889a879d1d4fe19cdd464))

## [4.1.1](https://github.com/gotgenes/pi-packages/compare/pi-github-tools-v4.1.0...pi-github-tools-v4.1.1) (2026-05-26)


### Bug Fixes

* resolve pre-existing lint errors in pi-autoformat and pi-permission-system ([68fd516](https://github.com/gotgenes/pi-packages/commit/68fd516e33ddbb9a5e37ef19e949ee9ecdc37252))

## [4.1.0](https://github.com/gotgenes/pi-packages/compare/pi-github-tools-v4.0.4...pi-github-tools-v4.1.0) (2026-05-24)


### Features

* add eslint config with type-aware rules and import enforcement ([4fb3cc6](https://github.com/gotgenes/pi-packages/commit/4fb3cc678da10d350b85c464318476ba9ae99dca))

## [4.0.4](https://github.com/gotgenes/pi-packages/compare/pi-github-tools-v4.0.3...pi-github-tools-v4.0.4) (2026-05-23)


### Bug Fixes

* add package.json imports field for #src/#test path aliases ([#157](https://github.com/gotgenes/pi-packages/issues/157)) ([75b4598](https://github.com/gotgenes/pi-packages/commit/75b45980810583452f7741678359c004900c8bd0))

## [4.0.3](https://github.com/gotgenes/pi-packages/compare/pi-github-tools-v4.0.2...pi-github-tools-v4.0.3) (2026-05-23)


### Bug Fixes

* resolve fallow dead-code warnings ([2113f6b](https://github.com/gotgenes/pi-packages/commit/2113f6bc49812ce32ac68d0e2dd88e0a60b4474a))

## [4.0.2](https://github.com/gotgenes/pi-packages/compare/pi-github-tools-v4.0.1...pi-github-tools-v4.0.2) (2026-05-20)


### Miscellaneous Chores

* enforce MD029 ordered list numbering ([95f8574](https://github.com/gotgenes/pi-packages/commit/95f8574ea0309b9c519785442bc357ffde29ee4a))

## [4.0.1](https://github.com/gotgenes/pi-packages/compare/pi-github-tools-v4.0.0...pi-github-tools-v4.0.1) (2026-05-19)


### Documentation

* enforce one-sentence-per-line across all markdown files ([a533869](https://github.com/gotgenes/pi-packages/commit/a533869e09ea33a2da8c4ac022d9be4674be4b18))

## [4.0.0](https://github.com/gotgenes/pi-packages/compare/pi-github-tools-v3.0.1...pi-github-tools-v4.0.0) (2026-05-19)


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

* unquote rumdl globs so shell expands them ([3b13a20](https://github.com/gotgenes/pi-packages/commit/3b13a20b2822db1e85a9d7546e0a21a63451d975))

## [3.0.1](https://github.com/gotgenes/pi-packages/compare/pi-github-tools-v3.0.0...pi-github-tools-v3.0.1) (2026-05-17)


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

## [3.0.0](https://github.com/gotgenes/pi-github-tools/compare/v2.0.0...v3.0.0) (2026-05-15)


### ⚠ BREAKING CHANGES

* gh(), git(), and ghJson() signatures changed from (...args: string[]) to (args: string[], signal?: AbortSignal). All internal call sites updated.

### Features

* add abort-aware sleep() ([#5](https://github.com/gotgenes/pi-github-tools/issues/5)) ([becfbd8](https://github.com/gotgenes/pi-github-tools/commit/becfbd87bd2e55b43ad81ca7e2eb8892f6d8af52))
* forward AbortSignal from tool wrappers to lib functions ([#5](https://github.com/gotgenes/pi-github-tools/issues/5)) ([a2316d7](https://github.com/gotgenes/pi-github-tools/commit/a2316d7d4848c54cca9aa4c8893a2955bbd2e5eb))
* gh/git/ghJson accept AbortSignal via args array ([#5](https://github.com/gotgenes/pi-github-tools/issues/5)) ([cedc0bf](https://github.com/gotgenes/pi-github-tools/commit/cedc0bf464da8233289797ad39f3b0a314a8d939))
* thread AbortSignal through mergeReleasePR and closeIssue ([#5](https://github.com/gotgenes/pi-github-tools/issues/5)) ([ffcc075](https://github.com/gotgenes/pi-github-tools/commit/ffcc075c81d3d58db06313b01a564830e7e0014e))
* thread AbortSignal through polling functions ([#5](https://github.com/gotgenes/pi-github-tools/issues/5)) ([e72407d](https://github.com/gotgenes/pi-github-tools/commit/e72407dc9c4f6deb07677ddfec89363f6224b8c2))


### Bug Fixes

* clean up abort listener on normal sleep resolve and protect bare git/ghJson calls ([#5](https://github.com/gotgenes/pi-github-tools/issues/5)) ([71f3103](https://github.com/gotgenes/pi-github-tools/commit/71f3103f0937de972a1a63c35706bb75e8d0d1ea))


### Documentation

* plan thread AbortSignal through polling chains ([#5](https://github.com/gotgenes/pi-github-tools/issues/5)) ([d97dbeb](https://github.com/gotgenes/pi-github-tools/commit/d97dbebd996b110606a7b4e7488221ec5defb81f))


### Miscellaneous Chores

* add plan/build/tdd-issue prompts and code-style/testing/markdown/design-review skills ([2604865](https://github.com/gotgenes/pi-github-tools/commit/260486541337ae25b882ea82f6cb382841f8fa46))
* configure pi-autoformat commands to use pnpm, add markdownlint ([71ba7bb](https://github.com/gotgenes/pi-github-tools/commit/71ba7bb54e2e09755261ceaf79b845ae0c2c33a3))

## [2.0.0](https://github.com/gotgenes/pi-github-tools/compare/v1.0.2...v2.0.0) (2026-05-15)


### ⚠ BREAKING CHANGES

* config directory has changed from   ~/.pi/agent/extensions/@gotgenes/pi-github-tools/config.json to   ~/.pi/agent/extensions/pi-github-tools/config.json Move your existing config file to the new location.

### Bug Fixes

* revert package.json author change ([f3c8225](https://github.com/gotgenes/pi-github-tools/commit/f3c82252b6d871cc12d0f11ac40d35d6d812b6e4))
* use pi-github-tools (not scoped name) as config directory ([b850843](https://github.com/gotgenes/pi-github-tools/commit/b85084302aeec93a7082b2b34ad5335d17382dfe))


### Documentation

* add badges to README ([c8edf0d](https://github.com/gotgenes/pi-github-tools/commit/c8edf0d6549442bda4d23741471ba69a6e29baa9))
* add pnpm badge to README ([83cfa93](https://github.com/gotgenes/pi-github-tools/commit/83cfa930cd6534d31468895941a4a371d7a55c47))


### Miscellaneous Chores

* update license copyright to Christopher D. Lasher ([17decb7](https://github.com/gotgenes/pi-github-tools/commit/17decb7766c2f28c2cb7c72bcda7aa5b8f0258b8))

## [1.0.2](https://github.com/gotgenes/pi-github-tools/compare/v1.0.1...v1.0.2) (2026-05-15)


### Bug Fixes

* correct merge defaults and agentDir path ([ff1b1b5](https://github.com/gotgenes/pi-github-tools/commit/ff1b1b54640e4fe7449e73645a891f466bd2b9ed))
* fetch remote tags before polling in watchRelease ([00acae4](https://github.com/gotgenes/pi-github-tools/commit/00acae48c3080c8a9b3158af1315b14a2259185d))

## [1.0.1](https://github.com/gotgenes/pi-github-tools/compare/v1.0.0...v1.0.1) (2026-05-14)


### Bug Fixes

* use git for non-gh commands and add configurable merge method ([0eaecad](https://github.com/gotgenes/pi-github-tools/commit/0eaecadedfab661d27634506648603f61823f2b1))


### Miscellaneous Chores

* add pi-autoformat config for biome ([685f010](https://github.com/gotgenes/pi-github-tools/commit/685f0105d480de2a255fee2c5612db50f9fe563e))

## 1.0.0 (2026-05-14)


### Features

* add CI business logic (findRun, watchRun, listRuns) ([e74dea4](https://github.com/gotgenes/pi-github-tools/commit/e74dea41fcb39ab581b8464bb0ff53f61d93ef42))
* add CI helper functions (findRetryDelay, formatProgress) ([77906b0](https://github.com/gotgenes/pi-github-tools/commit/77906b02a0911c0b7dc2f16c5fec9e574579b07e))
* add GitHub helpers with auto repo detection ([e619711](https://github.com/gotgenes/pi-github-tools/commit/e61971105709452823b4013972ca89ade359237c))
* add issue close business logic ([4c0316b](https://github.com/gotgenes/pi-github-tools/commit/4c0316bc0c5d15110054a1812dbbb9cff7c4855e))
* add Pi progress adapter ([7f4cada](https://github.com/gotgenes/pi-github-tools/commit/7f4cada21e53fb9fb145088b5f4e8380a170c607))
* add process helpers (runCommand, sleep) ([23c9c21](https://github.com/gotgenes/pi-github-tools/commit/23c9c218f95ce58a8f19fc243821657a22aad3ac))
* add release business logic (findReleasePR, mergeReleasePR, watchRelease) ([36db89e](https://github.com/gotgenes/pi-github-tools/commit/36db89e7e05b7da41ece55cd1561dc5142df07b6))
* register all tools via Pi extension entry point ([8f8cc9d](https://github.com/gotgenes/pi-github-tools/commit/8f8cc9d9987957a6b1fcace05dac8d56b7140e57))


### Bug Fixes

* search release-please PRs by label instead of title ([7c45ea5](https://github.com/gotgenes/pi-github-tools/commit/7c45ea58ba23b0e54c6cbc225ff8e3bedf832e05))


### Documentation

* add README with tool reference and setup instructions ([7133ee8](https://github.com/gotgenes/pi-github-tools/commit/7133ee807ebf6aba6d213f8cc7624fb1e96c7e07))


### Miscellaneous Chores

* initialize pi-github-tools repo with project scaffolding ([bae3dcc](https://github.com/gotgenes/pi-github-tools/commit/bae3dcc217363d2ebbdf61b88b1db74ec3fb6816))
