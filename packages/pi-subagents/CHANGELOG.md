# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [7.2.1](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v7.2.0...pi-subagents-v7.2.1) (2026-05-25)


### Documentation

* mark Layer 2 done and update health metrics in architecture doc ([ad00426](https://github.com/gotgenes/pi-packages/commit/ad00426f0f29ceff0915033419fdc2f1b53755b0))
* plan align tool interfaces for structural typing ([#194](https://github.com/gotgenes/pi-packages/issues/194)) ([36e56b0](https://github.com/gotgenes/pi-packages/commit/36e56b08351893e3c2d63569e7cfa140c172e20b))
* **retro:** add planning stage notes for issue [#194](https://github.com/gotgenes/pi-packages/issues/194) ([63a5763](https://github.com/gotgenes/pi-packages/commit/63a5763ed2bf4c2a6e2e9a19fdcdce71a2a9905a))
* **retro:** add retro notes for issue [#193](https://github.com/gotgenes/pi-packages/issues/193) ([8987f90](https://github.com/gotgenes/pi-packages/commit/8987f907e00bb70429782c947a2afbdb1db5faa9))
* **retro:** add TDD stage notes for issue [#194](https://github.com/gotgenes/pi-packages/issues/194) ([f692323](https://github.com/gotgenes/pi-packages/commit/f69232395882c07d6d95273e08021b94800f0e43))

## [7.2.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v7.1.0...pi-subagents-v7.2.0) (2026-05-25)


### Features

* SubagentRuntime stores typed SessionContext and owns context queries ([#193](https://github.com/gotgenes/pi-packages/issues/193)) ([4ca5319](https://github.com/gotgenes/pi-packages/commit/4ca531934e36c37c7cbc8fef8314a483e7dec479))


### Documentation

* mark Phase 11 Layer 1 complete, update metrics ([#193](https://github.com/gotgenes/pi-packages/issues/193)) ([32233ed](https://github.com/gotgenes/pi-packages/commit/32233ed89f27dca854ce858978c3acc029b1e801))
* plan SubagentRuntime owns context queries ([#193](https://github.com/gotgenes/pi-packages/issues/193)) ([6ea475a](https://github.com/gotgenes/pi-packages/commit/6ea475af94f8456c1d665adcd007dd2833ab7a4b))
* **retro:** add planning stage notes for issue [#193](https://github.com/gotgenes/pi-packages/issues/193) ([7da6d5a](https://github.com/gotgenes/pi-packages/commit/7da6d5abac82bdea0cbdbc8677dda04d38a7887d))
* **retro:** add retro notes for issue [#192](https://github.com/gotgenes/pi-packages/issues/192) ([1223de4](https://github.com/gotgenes/pi-packages/commit/1223de4a68d4514eb504c5c95d64fb35500d286b))
* **retro:** add TDD stage notes for issue [#193](https://github.com/gotgenes/pi-packages/issues/193) ([3950b81](https://github.com/gotgenes/pi-packages/commit/3950b81228a3db57eb4c24236fa7d75c638a335a))

## [7.1.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v7.0.0...pi-subagents-v7.1.0) (2026-05-24)


### Features

* **pi-subagents:** define SessionContext narrow interface ([#192](https://github.com/gotgenes/pi-packages/issues/192)) ([a043d4d](https://github.com/gotgenes/pi-packages/commit/a043d4d970a8aacc084a125d9a07b860a7fb6e9b))


### Documentation

* **pi-subagents:** archive Phase 10, propose Phase 11 roadmap ([d474eef](https://github.com/gotgenes/pi-packages/commit/d474eef98c1a39757d933da291725ff126f1b8ac))
* **pi-subagents:** revise Phase 11 roadmap — layered class conversion ([35d1083](https://github.com/gotgenes/pi-packages/commit/35d1083445aece783e344c37fc949395e190f9e5))
* plan SessionContext narrow interface ([#192](https://github.com/gotgenes/pi-packages/issues/192)) ([95cb16e](https://github.com/gotgenes/pi-packages/commit/95cb16e46aa630ecc34f423aaaa4ff02845ed5b5))
* **retro:** add planning stage notes for issue [#192](https://github.com/gotgenes/pi-packages/issues/192) ([31fd729](https://github.com/gotgenes/pi-packages/commit/31fd7290985b0ef1d240cd5afd5e0e0e7eec9131))
* **retro:** add retro notes for issue [#185](https://github.com/gotgenes/pi-packages/issues/185) ([66e49cf](https://github.com/gotgenes/pi-packages/commit/66e49cfb4129b9bba3b78e0850402bc61d99dda8))
* **retro:** add TDD stage notes for issue [#192](https://github.com/gotgenes/pi-packages/issues/192) ([6cf3f95](https://github.com/gotgenes/pi-packages/commit/6cf3f95f6c39f3f81c1d335348d5abd74d948ff3))

## [7.0.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.19.1...pi-subagents-v7.0.0) (2026-05-24)


### ⚠ BREAKING CHANGES

* `src/session/memory.ts` and all persistent agent memory functionality (MEMORY.md, agent-memory directories) are removed from pi-subagents. This is scope reduction — agent spawning, execution, and result retrieval remain.
* `MemoryScope` is no longer exported from the package. The `memory` field is removed from `AgentConfig`. Custom agent .md files with a `memory:` frontmatter key will have it silently ignored.
* The `memory` field in agent configuration no longer has any effect. Memory block injection, memory tool augmentation, and the `AssemblerIO.buildMemoryBlock` / `buildReadOnlyMemoryBlock` collaborators are removed from the session assembler.

### Features

* delete memory module ([78ace55](https://github.com/gotgenes/pi-packages/commit/78ace558b1988bce8e002b28fe3152c5de708b84))
* remove memory from session assembly and config layers ([6ebeb91](https://github.com/gotgenes/pi-packages/commit/6ebeb91f28c56c1d21fc4e1a7b6bededa8eba025))
* remove MemoryScope type and memory config field ([d6e3bcb](https://github.com/gotgenes/pi-packages/commit/d6e3bcbb58902133a3704d89d88b548f8f2a4769))


### Documentation

* plan remove persistent agent memory ([#185](https://github.com/gotgenes/pi-packages/issues/185)) ([0f6b3ad](https://github.com/gotgenes/pi-packages/commit/0f6b3adb6c35c3879c5d1e176e1c6d9da36a5cf1))
* **retro:** add planning stage notes for issue [#185](https://github.com/gotgenes/pi-packages/issues/185) ([58dcfbc](https://github.com/gotgenes/pi-packages/commit/58dcfbc3124ec7695048ad3df8fc6f397a883d1a))
* **retro:** add retro notes for issue [#188](https://github.com/gotgenes/pi-packages/issues/188) ([8eeaf6b](https://github.com/gotgenes/pi-packages/commit/8eeaf6b52f7b40a2126f3ffa3ca01a8e3b84f338))
* **retro:** add TDD stage notes for issue [#185](https://github.com/gotgenes/pi-packages/issues/185) ([8e75b18](https://github.com/gotgenes/pi-packages/commit/8e75b18b2c87b47f1a29df9d2c544a8ad2023f9f))
* update architecture after memory removal ([52716d5](https://github.com/gotgenes/pi-packages/commit/52716d5f89b729ce183d4a450d8539e6cabdbadc))

## [6.19.1](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.19.0...pi-subagents-v6.19.1) (2026-05-24)


### Documentation

* plan replace any casts with SDK types ([#188](https://github.com/gotgenes/pi-packages/issues/188)) ([96207da](https://github.com/gotgenes/pi-packages/commit/96207dacf0035db11605d55a61132cf43f7c3b40))
* **retro:** add planning stage notes for issue [#188](https://github.com/gotgenes/pi-packages/issues/188) ([6e38b12](https://github.com/gotgenes/pi-packages/commit/6e38b128a5bbaad3ca81b31adbf390482081a41e))
* **retro:** add retro notes for issue [#172](https://github.com/gotgenes/pi-packages/issues/172) ([270c00a](https://github.com/gotgenes/pi-packages/commit/270c00a5f84bf454352443a6c57a6076803090c6))
* **retro:** add TDD stage notes for issue [#188](https://github.com/gotgenes/pi-packages/issues/188) ([8a5f51a](https://github.com/gotgenes/pi-packages/commit/8a5f51a2fd02a143e85f176417b31af4a11b34f4))

## [6.19.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.18.8...pi-subagents-v6.19.0) (2026-05-24)


### Features

* extract shared content-item parsing into session/content-items ([5ed0d1c](https://github.com/gotgenes/pi-packages/commit/5ed0d1c6291d9044e1ab85c637b1e5f0051789f3))
* extract shared content-item parsing into session/content-items ([413fda0](https://github.com/gotgenes/pi-packages/commit/413fda0cc8bb496a79285d0ec97c97d9b0b6cc6d))


### Documentation

* mark step 9 (extract turn-formatting) done in architecture ([04a0b55](https://github.com/gotgenes/pi-packages/commit/04a0b554b8848adc0f43b8939fa866086282a6af))
* plan extract shared turn-formatting logic ([#172](https://github.com/gotgenes/pi-packages/issues/172)) ([818affe](https://github.com/gotgenes/pi-packages/commit/818affe22457cfbc1cabc5d4e7477e9391b3ed46))
* **retro:** add planning stage notes for issue [#172](https://github.com/gotgenes/pi-packages/issues/172) ([809b4cf](https://github.com/gotgenes/pi-packages/commit/809b4cf4dd9f59f1c57eb0776835af88e0cef8f4))
* **retro:** add retro notes for issue [#171](https://github.com/gotgenes/pi-packages/issues/171) ([2b50b37](https://github.com/gotgenes/pi-packages/commit/2b50b374f9d99305144bc6227eb48e3a9d68efb3))

## [6.18.8](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.18.7...pi-subagents-v6.18.8) (2026-05-24)


### Documentation

* plan reduce renderResult complexity ([#171](https://github.com/gotgenes/pi-packages/issues/171)) ([340c410](https://github.com/gotgenes/pi-packages/commit/340c4107a8b4b39c39a3bf9d04b83b445db5982d))
* **retro:** add planning stage notes for issue [#171](https://github.com/gotgenes/pi-packages/issues/171) ([509300b](https://github.com/gotgenes/pi-packages/commit/509300bb6de499ed7f7272a0336945674f1e4df3))
* **retro:** add retro note for issue [#171](https://github.com/gotgenes/pi-packages/issues/171) ([f8e53f1](https://github.com/gotgenes/pi-packages/commit/f8e53f11ef69fe90df2c84156846811d997d5fcd))
* **retro:** add retro notes for issue [#170](https://github.com/gotgenes/pi-packages/issues/170) ([da2a6a7](https://github.com/gotgenes/pi-packages/commit/da2a6a7e9855b1e79d7d9d3a096b0e4788bce42d))
* **retro:** add TDD stage notes for issue [#171](https://github.com/gotgenes/pi-packages/issues/171) ([0621901](https://github.com/gotgenes/pi-packages/commit/0621901b6a7b33951e96bd1814448dacf72400fb))
* update architecture and skill for result-renderer ([#171](https://github.com/gotgenes/pi-packages/issues/171)) ([1510dc7](https://github.com/gotgenes/pi-packages/commit/1510dc77f1adafab9793cc067a91ec9b9e1cf6c3))
* update architecture for result-renderer extraction ([#171](https://github.com/gotgenes/pi-packages/issues/171)) ([1183522](https://github.com/gotgenes/pi-packages/commit/11835223615fdcf4bdbe34d367278d7ed240c901))

## [6.18.7](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.18.6...pi-subagents-v6.18.7) (2026-05-24)


### Documentation

* plan reduce buildContentLines complexity ([#170](https://github.com/gotgenes/pi-packages/issues/170)) ([9912d16](https://github.com/gotgenes/pi-packages/commit/9912d16a375aef3fcf39148f0fc6e0c7ca761f31))
* **retro:** add planning stage notes for issue [#170](https://github.com/gotgenes/pi-packages/issues/170) ([3ed1b75](https://github.com/gotgenes/pi-packages/commit/3ed1b7570af3e6569015570c657dc7ea1fe583f4))
* **retro:** add retro notes for issue [#169](https://github.com/gotgenes/pi-packages/issues/169) ([419c451](https://github.com/gotgenes/pi-packages/commit/419c451f285564f98a0ba11dddb215f38ad541c3))
* **retro:** add TDD stage notes for issue [#170](https://github.com/gotgenes/pi-packages/issues/170) ([75b3253](https://github.com/gotgenes/pi-packages/commit/75b325393be083eca02cf1db3a872a504ba03e53))
* update architecture for message-formatters extraction ([#170](https://github.com/gotgenes/pi-packages/issues/170)) ([1005354](https://github.com/gotgenes/pi-packages/commit/1005354d6faf632ff617acdc679660cffd3afbe2))

## [6.18.6](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.18.5...pi-subagents-v6.18.6) (2026-05-24)


### Documentation

* plan extract RunContext from RunOptions ([#169](https://github.com/gotgenes/pi-packages/issues/169)) ([ca12b2e](https://github.com/gotgenes/pi-packages/commit/ca12b2ebd116cb50c6e12d2d3fe3a87ff997d6d6))
* **retro:** add planning stage notes for issue [#169](https://github.com/gotgenes/pi-packages/issues/169) ([05b0176](https://github.com/gotgenes/pi-packages/commit/05b01764a4aaa885efca9d061abf6bacb384057c))
* **retro:** add retro notes for issue [#168](https://github.com/gotgenes/pi-packages/issues/168) ([dfe46ed](https://github.com/gotgenes/pi-packages/commit/dfe46ed5b5ee62371912dbbc6227443adee8e67b))
* **retro:** add TDD stage notes for issue [#169](https://github.com/gotgenes/pi-packages/issues/169) ([84c0d8d](https://github.com/gotgenes/pi-packages/commit/84c0d8d5ef0a94750c470e3f10b3ab589caac794))
* update architecture doc for RunContext extraction ([#169](https://github.com/gotgenes/pi-packages/issues/169)) ([ea49fe1](https://github.com/gotgenes/pi-packages/commit/ea49fe1b9c316e6541814de821738d6d121c4d13))
* update RunOptions field references in comments ([#169](https://github.com/gotgenes/pi-packages/issues/169)) ([fd9c3ed](https://github.com/gotgenes/pi-packages/commit/fd9c3ed0e0b01c45136c8f34d8f31a89564e8061))

## [6.18.5](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.18.4...pi-subagents-v6.18.5) (2026-05-24)


### Documentation

* mark ToolFilterConfig extraction done in architecture doc ([#168](https://github.com/gotgenes/pi-packages/issues/168)) ([686c33e](https://github.com/gotgenes/pi-packages/commit/686c33ed107e1ec1ec56c73441b1551bf59bff3f))
* plan extract ToolFilterConfig from SessionConfig ([#168](https://github.com/gotgenes/pi-packages/issues/168)) ([beaaeb4](https://github.com/gotgenes/pi-packages/commit/beaaeb41588bb93739b5ba6959c12202efbe7862))
* **retro:** add planning stage notes for issue [#168](https://github.com/gotgenes/pi-packages/issues/168) ([7086139](https://github.com/gotgenes/pi-packages/commit/70861390a6190653d499c720fc298972e03967aa))
* **retro:** add retro notes for issue [#167](https://github.com/gotgenes/pi-packages/issues/167) ([cc96edd](https://github.com/gotgenes/pi-packages/commit/cc96edd20994a48ee2f824ea9136fa0da83e4c23))
* **retro:** add TDD stage notes for issue [#168](https://github.com/gotgenes/pi-packages/issues/168) ([8a14bf7](https://github.com/gotgenes/pi-packages/commit/8a14bf766e9c38c89f31468293fdafa8c79d32ea))
* update architecture to reflect current layout and RunnerIO split ([#167](https://github.com/gotgenes/pi-packages/issues/167)) ([d4a98aa](https://github.com/gotgenes/pi-packages/commit/d4a98aaa1600c24c28dd1005e381588990ab74fd))

## [6.18.4](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.18.3...pi-subagents-v6.18.4) (2026-05-24)


### Documentation

* mark RunnerIO split done in architecture ([#167](https://github.com/gotgenes/pi-packages/issues/167)) ([824fd72](https://github.com/gotgenes/pi-packages/commit/824fd726361f62b6696dcc62de3b0bbb9cf45711))
* plan narrow RunnerIO into EnvironmentIO + SessionFactoryIO ([#167](https://github.com/gotgenes/pi-packages/issues/167)) ([8110fec](https://github.com/gotgenes/pi-packages/commit/8110fec44dfaf08bd93d9cbc59ad04c6cba62a84))
* **retro:** add planning stage notes for issue [#167](https://github.com/gotgenes/pi-packages/issues/167) ([1aceff7](https://github.com/gotgenes/pi-packages/commit/1aceff77c8177093c60b90b87a3f991cb0186602))
* **retro:** add retro notes for issue [#180](https://github.com/gotgenes/pi-packages/issues/180) ([1fcd0ac](https://github.com/gotgenes/pi-packages/commit/1fcd0ace6fd7f5ec90a8d44423b276eb351875af))
* **retro:** add TDD stage notes for issue [#167](https://github.com/gotgenes/pi-packages/issues/167) ([870c767](https://github.com/gotgenes/pi-packages/commit/870c7670fdab831d408232c126312d0b5010d6f4))

## [6.18.3](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.18.2...pi-subagents-v6.18.3) (2026-05-24)


### Performance Improvements

* reorder append-mode prompt for KV cache reuse ([#180](https://github.com/gotgenes/pi-packages/issues/180)) ([5f688bd](https://github.com/gotgenes/pi-packages/commit/5f688bd1d008e20987d28626c5f5d0df0f66b854))


### Documentation

* plan reorder append-mode prompt for KV cache reuse ([#180](https://github.com/gotgenes/pi-packages/issues/180)) ([bb0ddec](https://github.com/gotgenes/pi-packages/commit/bb0ddec8a7beb37baace5698e4fa4d09e61497d6))
* **retro:** add planning stage notes for issue [#180](https://github.com/gotgenes/pi-packages/issues/180) ([3413158](https://github.com/gotgenes/pi-packages/commit/341315898baa09652df18731ad318c89861ec62c))
* **retro:** add retro notes for issue [#166](https://github.com/gotgenes/pi-packages/issues/166) ([fae30ce](https://github.com/gotgenes/pi-packages/commit/fae30cec3dd99bbac490a2764a8340aa12fc171c))
* **retro:** add TDD stage notes for issue [#180](https://github.com/gotgenes/pi-packages/issues/180) ([1560f2d](https://github.com/gotgenes/pi-packages/commit/1560f2d6f7029cbbe0cc7b1efe1aba2a243e8357))

## [6.18.2](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.18.1...pi-subagents-v6.18.2) (2026-05-24)


### Documentation

* plan extract ParentSessionInfo from AgentSpawnConfig ([#166](https://github.com/gotgenes/pi-packages/issues/166)) ([aff7b35](https://github.com/gotgenes/pi-packages/commit/aff7b35c98503fbb3da6a287631a2aa5c4d498fd))
* **retro:** add planning stage notes for issue [#166](https://github.com/gotgenes/pi-packages/issues/166) ([6138473](https://github.com/gotgenes/pi-packages/commit/613847313d56a9df8b479726d831679391bd0c1a))
* **retro:** add retro notes for issue [#165](https://github.com/gotgenes/pi-packages/issues/165) ([2a3e70d](https://github.com/gotgenes/pi-packages/commit/2a3e70dc6b903b4c053e7f6ebc09169bc3e34bf6))
* **retro:** add TDD stage notes for issue [#166](https://github.com/gotgenes/pi-packages/issues/166) ([2696da5](https://github.com/gotgenes/pi-packages/commit/2696da599de72f1a881577a4de8fedc57472a695))
* update architecture doc — AgentSpawnConfig step 3 complete ([125450b](https://github.com/gotgenes/pi-packages/commit/125450ba9ea5753b4cad07ed4d1675dcdbc7e319))

## [6.18.1](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.18.0...pi-subagents-v6.18.1) (2026-05-24)


### Documentation

* plan decompose ResolvedSpawnConfig ([#165](https://github.com/gotgenes/pi-packages/issues/165)) ([1b14d56](https://github.com/gotgenes/pi-packages/commit/1b14d56aaada427a7344ec22adb4bbf8d7ce0bf7))
* **retro:** add planning stage notes for issue [#165](https://github.com/gotgenes/pi-packages/issues/165) ([8e0476a](https://github.com/gotgenes/pi-packages/commit/8e0476afa991953884455c7dd09c7ffb742cb329))
* **retro:** add TDD stage notes for issue [#165](https://github.com/gotgenes/pi-packages/issues/165) ([68248e5](https://github.com/gotgenes/pi-packages/commit/68248e572d38ad6e0cdb61bdd22f2b46193eaac6))

## [6.18.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.17.2...pi-subagents-v6.18.0) (2026-05-24)


### Features

* add eslint config with type-aware rules and import enforcement ([4fb3cc6](https://github.com/gotgenes/pi-packages/commit/4fb3cc678da10d350b85c464318476ba9ae99dca))


### Bug Fixes

* **pi-subagents:** add missing "type": "module" to package.json ([8cfd07d](https://github.com/gotgenes/pi-packages/commit/8cfd07dfbfd44f52dc43ac7ae67d5824304825ae))


### Documentation

* **retro:** add retro notes for issue [#164](https://github.com/gotgenes/pi-packages/issues/164) ([d8e2861](https://github.com/gotgenes/pi-packages/commit/d8e28615d6adabc86415f4d41ffd1bd90184fd0f))

## [6.17.2](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.17.1...pi-subagents-v6.17.2) (2026-05-23)


### Bug Fixes

* add package.json imports field for #src/#test path aliases ([#157](https://github.com/gotgenes/pi-packages/issues/157)) ([75b4598](https://github.com/gotgenes/pi-packages/commit/75b45980810583452f7741678359c004900c8bd0))


### Documentation

* plan reorganize pi-subagents source into domain directories ([#164](https://github.com/gotgenes/pi-packages/issues/164)) ([40d1214](https://github.com/gotgenes/pi-packages/commit/40d1214ea806215a5a5cda092bf24de3ebb0a195))
* **retro:** add planning stage notes for issue [#164](https://github.com/gotgenes/pi-packages/issues/164) ([947ec91](https://github.com/gotgenes/pi-packages/commit/947ec91f86de214a637e9d76348c32cb8a743dc4))
* **retro:** add TDD stage notes for issue [#164](https://github.com/gotgenes/pi-packages/issues/164) ([3f075cd](https://github.com/gotgenes/pi-packages/commit/3f075cd01c8517e6322a98bf7c51831fce861ce2))
* update architecture doc to reflect domain directory restructuring ([#164](https://github.com/gotgenes/pi-packages/issues/164)) ([a8c912d](https://github.com/gotgenes/pi-packages/commit/a8c912d065e6b3627ea617fadbaa95a470dfe1d5))

## [6.17.1](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.17.0...pi-subagents-v6.17.1) (2026-05-23)


### Documentation

* **pi-subagents:** add issue numbers to Phase 10 roadmap ([d6cc622](https://github.com/gotgenes/pi-packages/commit/d6cc62275bb2bdd9dbe9b2516bac03bdadd280d6))
* **pi-subagents:** hyperlink Phase 10 issue references in architecture doc ([1e2e488](https://github.com/gotgenes/pi-packages/commit/1e2e4888779496d9988036c9cbde6b728cc91a98))
* **pi-subagents:** restructure architecture doc with domain model and diagrams ([3dcf468](https://github.com/gotgenes/pi-packages/commit/3dcf4686c636e90da6337ad5502f91450597a700))
* **retro:** add retro notes for issue [#147](https://github.com/gotgenes/pi-packages/issues/147) ([0488655](https://github.com/gotgenes/pi-packages/commit/0488655729eff841809993f34238a688ff46acda))
* **retro:** add retro notes for issue [#147](https://github.com/gotgenes/pi-packages/issues/147) ([e6b2810](https://github.com/gotgenes/pi-packages/commit/e6b2810431f8baef79412fec9aa6b8aa194ff257))
* **retro:** replace retro deterministic step with sync-with-remote ([#147](https://github.com/gotgenes/pi-packages/issues/147)) ([9e9b365](https://github.com/gotgenes/pi-packages/commit/9e9b365ca3481f42ecf97c92fd4e44a4491b7573))

## [6.17.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.16.3...pi-subagents-v6.17.0) (2026-05-23)


### Features

* inject wrapText into ConversationViewer (Phase 9, Step O) ([#147](https://github.com/gotgenes/pi-packages/issues/147)) ([2522d5b](https://github.com/gotgenes/pi-packages/commit/2522d5b82f2a29b9011f31d49f82b5f914f12f99))


### Documentation

* mark Step O complete in architecture doc ([#147](https://github.com/gotgenes/pi-packages/issues/147)) ([c4a6ee5](https://github.com/gotgenes/pi-packages/commit/c4a6ee5217692fc67b9a9e5b6c8586376e9e7e02))
* plan inject wrapText into ConversationViewer ([#147](https://github.com/gotgenes/pi-packages/issues/147)) ([fe4dceb](https://github.com/gotgenes/pi-packages/commit/fe4dcebda894b0d641820e55d41e48e4a0c67c3d))
* **retro:** add planning stage notes for issue [#147](https://github.com/gotgenes/pi-packages/issues/147) ([dce5db2](https://github.com/gotgenes/pi-packages/commit/dce5db2fc2ce2fd530bbfacd61ec40e771005768))
* **retro:** add TDD stage notes for issue [#147](https://github.com/gotgenes/pi-packages/issues/147) ([2db1238](https://github.com/gotgenes/pi-packages/commit/2db123874d1730ac8811d44731a8f7cb052ee043))

## [6.16.3](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.16.2...pi-subagents-v6.16.3) (2026-05-23)


### Documentation

* **retro:** add retro notes for issue [#146](https://github.com/gotgenes/pi-packages/issues/146) ([720fcb0](https://github.com/gotgenes/pi-packages/commit/720fcb07937fc62a1811e59448343d3dfbc1ab14))

## [6.16.2](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.16.1...pi-subagents-v6.16.2) (2026-05-23)


### Documentation

* fix plan for narrow UI context ([#146](https://github.com/gotgenes/pi-packages/issues/146)) ([3d5b591](https://github.com/gotgenes/pi-packages/commit/3d5b591c0668ffcd9f66a6fc9a2c5d57236865af))
* mark Step N complete in architecture doc ([#146](https://github.com/gotgenes/pi-packages/issues/146)) ([9948869](https://github.com/gotgenes/pi-packages/commit/9948869b849817dac6f221f1e90db5e47fd12d31))
* plan narrow UI context for menu handlers ([#146](https://github.com/gotgenes/pi-packages/issues/146)) ([88318b4](https://github.com/gotgenes/pi-packages/commit/88318b4550fe95fc70b1a9ee1e904c608a2189a3))
* **retro:** add retro notes for issue [#148](https://github.com/gotgenes/pi-packages/issues/148) ([982fe51](https://github.com/gotgenes/pi-packages/commit/982fe51d7e27b7a127605710ced709bbd6291a0f))

## [6.16.1](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.16.0...pi-subagents-v6.16.1) (2026-05-23)


### Bug Fixes

* **pi-subagents:** theme parentheses and separator in formatSessionTokens ([33b67f6](https://github.com/gotgenes/pi-packages/commit/33b67f63915563c41605addb885af52b47844e96))


### Documentation

* plan split AgentWidget rendering from lifecycle ([#148](https://github.com/gotgenes/pi-packages/issues/148)) ([24c11d5](https://github.com/gotgenes/pi-packages/commit/24c11d51f2b6c9d2712815fbe46ede72084ffcbb))
* **retro:** add retro notes for issue [#144](https://github.com/gotgenes/pi-packages/issues/144) ([f3cdfd4](https://github.com/gotgenes/pi-packages/commit/f3cdfd46fe223d6cecb5dad0d739f053e7468433))
* update architecture for widget rendering extraction ([#148](https://github.com/gotgenes/pi-packages/issues/148)) ([450707e](https://github.com/gotgenes/pi-packages/commit/450707e1d0f41ae78f1a655ab350fd8f4fd64125))

## [6.16.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.15.0...pi-subagents-v6.16.0) (2026-05-23)


### Features

* add session and outputFile convenience getters to AgentRecord ([#144](https://github.com/gotgenes/pi-packages/issues/144)) ([b451894](https://github.com/gotgenes/pi-packages/commit/b451894d101b43be9115dcf6d45725a09da81df8))


### Documentation

* mark Step L complete, remove resolved smells from architecture doc ([#144](https://github.com/gotgenes/pi-packages/issues/144)) ([36ab7a5](https://github.com/gotgenes/pi-packages/commit/36ab7a51d0320666b71d6c9e20c3bbf63b7c43c5))
* plan consolidate observation model ([#144](https://github.com/gotgenes/pi-packages/issues/144)) ([9aa2c85](https://github.com/gotgenes/pi-packages/commit/9aa2c8508079c6ae847662631afd223e8966e12e))
* **retro:** add retro notes for issue [#145](https://github.com/gotgenes/pi-packages/issues/145) ([2d23081](https://github.com/gotgenes/pi-packages/commit/2d230817d53357a62eb752b56f8b1c8ce4af718c))

## [6.15.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.14.1...pi-subagents-v6.15.0) (2026-05-23)


### Features

* extract resolveSpawnConfig pure function ([#145](https://github.com/gotgenes/pi-packages/issues/145)) ([e89724a](https://github.com/gotgenes/pi-packages/commit/e89724a87480713529160d0fa23975becbcfe162))


### Documentation

* plan decompose execute and push ctx to boundary ([#145](https://github.com/gotgenes/pi-packages/issues/145)) ([aae7d7b](https://github.com/gotgenes/pi-packages/commit/aae7d7b4e04ab0dddedd2a0f9f2b806719956ced))
* update architecture doc for completed Step M ([#145](https://github.com/gotgenes/pi-packages/issues/145)) ([33ec0c7](https://github.com/gotgenes/pi-packages/commit/33ec0c73479076c180381dcc1cb4106ba635f33f))
* update plan with injected collaborators for ctx elimination ([#145](https://github.com/gotgenes/pi-packages/issues/145)) ([76bb57b](https://github.com/gotgenes/pi-packages/commit/76bb57b4b5190078ded8685907f0878640031e13))

## [6.14.1](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.14.0...pi-subagents-v6.14.1) (2026-05-23)


### Bug Fixes

* resolve fallow dead-code warnings ([2113f6b](https://github.com/gotgenes/pi-packages/commit/2113f6bc49812ce32ac68d0e2dd88e0a60b4474a))


### Documentation

* **retro:** add retro notes for issue [#152](https://github.com/gotgenes/pi-packages/issues/152) ([7337bc1](https://github.com/gotgenes/pi-packages/commit/7337bc175528b4fb99dbc765eb06f0bcf2accec1))

## [6.14.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.13.1...pi-subagents-v6.14.0) (2026-05-23)


### Features

* add promptSnippet to Agent, get_subagent_result, and steer_subagent ([#152](https://github.com/gotgenes/pi-packages/issues/152)) ([3ccbe14](https://github.com/gotgenes/pi-packages/commit/3ccbe140b05ab038c3c50ff1fdbe314d721c7b60))


### Documentation

* plan add promptSnippet to subagent tools ([#152](https://github.com/gotgenes/pi-packages/issues/152)) ([f8fd56d](https://github.com/gotgenes/pi-packages/commit/f8fd56dff3d6a824f36c198d9a9d1b50a0bf740a))

## [6.13.1](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.13.0...pi-subagents-v6.13.1) (2026-05-23)


### Documentation

* **pi-subagents:** add dependency bag convention to Phase 9 ([72436cd](https://github.com/gotgenes/pi-packages/commit/72436cd51d7a3058de6bb17673f3552fd4e61340))
* **pi-subagents:** add issue references to Phase 9 steps ([43e9b9c](https://github.com/gotgenes/pi-packages/commit/43e9b9c2f2d816f0802783752ce0bcc8022d4a33))
* **pi-subagents:** add Phase 9 roadmap to architecture.md ([6fb1ad8](https://github.com/gotgenes/pi-packages/commit/6fb1ad892df3e85cca35361a0995adcdf3b0569b))
* **pi-subagents:** convert dependency graphs to Mermaid diagrams ([d2571e8](https://github.com/gotgenes/pi-packages/commit/d2571e8558faf2c6728068bfafbbf24beb812f7c))
* **pi-subagents:** refine Step M to include execute decomposition ([262f570](https://github.com/gotgenes/pi-packages/commit/262f5708d54bb6aa30ccd405bed1e89bfd5ea999))
* **pi-subagents:** remove progress markers from architecture.md ([aca298b](https://github.com/gotgenes/pi-packages/commit/aca298ba7e1da44c48dc442b2602a4202d4943a3))
* **retro:** add retro notes for issue [#136](https://github.com/gotgenes/pi-packages/issues/136) ([20384ac](https://github.com/gotgenes/pi-packages/commit/20384ac2040ae4334565f303f327bb007d9b4501))

## [6.13.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.12.1...pi-subagents-v6.13.0) (2026-05-23)


### Features

* add AgentFileOps interface and FsAgentFileOps ([#136](https://github.com/gotgenes/pi-packages/issues/136)) ([9625de6](https://github.com/gotgenes/pi-packages/commit/9625de60ace3cf58ad59c2d533f18fd7cdb8bba9))


### Documentation

* plan agent-menu decomposition ([#136](https://github.com/gotgenes/pi-packages/issues/136)) ([41ca6a6](https://github.com/gotgenes/pi-packages/commit/41ca6a6612cbc167a5b3d336ffb94d3f9666868f))
* **retro:** add retro notes for issue [#135](https://github.com/gotgenes/pi-packages/issues/135) ([83e255b](https://github.com/gotgenes/pi-packages/commit/83e255b4a5e6a56a287c933e4a5fa0b28121529e))
* update architecture for agent-menu decomposition ([#136](https://github.com/gotgenes/pi-packages/issues/136)) ([dba90e8](https://github.com/gotgenes/pi-packages/commit/dba90e86693e3480004a7c305d5082cb5a930d3f))

## [6.12.1](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.12.0...pi-subagents-v6.12.1) (2026-05-22)


### Documentation

* mark Step J done, add ui/display.ts to module listing ([#135](https://github.com/gotgenes/pi-packages/issues/135)) ([37ced45](https://github.com/gotgenes/pi-packages/commit/37ced45e1a0287aa78e588cb8bc7905c0f969637))
* plan display helper extraction from agent-widget ([#135](https://github.com/gotgenes/pi-packages/issues/135)) ([9e65e7d](https://github.com/gotgenes/pi-packages/commit/9e65e7d93bf47d4c4582d367d2f31a2386a5cc8c))
* **retro:** add retro notes for issue [#134](https://github.com/gotgenes/pi-packages/issues/134) ([775ce99](https://github.com/gotgenes/pi-packages/commit/775ce99710153d4ebcf40f773eae21553c7f8a82))

## [6.12.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.11.0...pi-subagents-v6.12.0) (2026-05-22)


### Features

* narrow runtime widget field to WidgetLike interface ([#134](https://github.com/gotgenes/pi-packages/issues/134)) ([afa70ab](https://github.com/gotgenes/pi-packages/commit/afa70ab430109248a8f61ccd182b0f3acd1fa7e1))
* use SDK types in CreateSessionOptions ([#134](https://github.com/gotgenes/pi-packages/issues/134)) ([c2452af](https://github.com/gotgenes/pi-packages/commit/c2452af0ee3d47d778878443a634ca787f8d0bfb))


### Bug Fixes

* replace message-shape as-any casts with type guards ([#134](https://github.com/gotgenes/pi-packages/issues/134)) ([d7ad65a](https://github.com/gotgenes/pi-packages/commit/d7ad65a61267790ae1ae8414b0c2aa9ebc8ad59c))


### Documentation

* plan as-any cast reduction in test suite ([#134](https://github.com/gotgenes/pi-packages/issues/134)) ([f7cb1aa](https://github.com/gotgenes/pi-packages/commit/f7cb1aac0963021ae0545b73c88f950a7adb5fd2))
* **retro:** add retro notes for issue [#133](https://github.com/gotgenes/pi-packages/issues/133) ([be32640](https://github.com/gotgenes/pi-packages/commit/be32640048943059a98fc79797a35dfefd70fc34))
* update architecture doc for Step I completion ([#134](https://github.com/gotgenes/pi-packages/issues/134)) ([fd4aca7](https://github.com/gotgenes/pi-packages/commit/fd4aca79c74da2b8c4e3c58e2376e0612941d7d9))

## [6.11.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.10.0...pi-subagents-v6.11.0) (2026-05-22)


### Features

* inject SDK boundary into agent-runner via RunnerIO ([#133](https://github.com/gotgenes/pi-packages/issues/133)) ([a9f6a9e](https://github.com/gotgenes/pi-packages/commit/a9f6a9e8c71e307b71600409e865fb539312f539))


### Documentation

* plan SDK boundary injection into agent-runner ([#133](https://github.com/gotgenes/pi-packages/issues/133)) ([1706ebc](https://github.com/gotgenes/pi-packages/commit/1706ebcc1452c6798dafb733ec8c68e6ee9e8512))
* **retro:** add retro notes for issue [#132](https://github.com/gotgenes/pi-packages/issues/132) ([d0af140](https://github.com/gotgenes/pi-packages/commit/d0af1409ddc18099dfdda94ab37af2b99bc46c3c))
* update architecture doc for Step H completion ([#133](https://github.com/gotgenes/pi-packages/issues/133)) ([f6b1258](https://github.com/gotgenes/pi-packages/commit/f6b1258f50a038df18ca1f33e3681c7bc258f4fc))

## [6.10.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.9.4...pi-subagents-v6.10.0) (2026-05-22)


### Features

* inject IO collaborators into assembleSessionConfig ([#132](https://github.com/gotgenes/pi-packages/issues/132)) ([74d3dbf](https://github.com/gotgenes/pi-packages/commit/74d3dbf5e67cf28f75683e55240719ad2be86490))


### Documentation

* mark Step G complete in Phase 8 roadmap ([#132](https://github.com/gotgenes/pi-packages/issues/132)) ([95512bd](https://github.com/gotgenes/pi-packages/commit/95512bdec3757d5955d13e22261a90da41cea40e))
* plan IO collaborator injection into assembleSessionConfig ([#132](https://github.com/gotgenes/pi-packages/issues/132)) ([23c3b62](https://github.com/gotgenes/pi-packages/commit/23c3b624e8c0afb8fda72c1b5fba86cb165f78dd))
* **retro:** add retro notes for issue [#131](https://github.com/gotgenes/pi-packages/issues/131) ([b91cee9](https://github.com/gotgenes/pi-packages/commit/b91cee9ef69f8b1ab41be986663bad22e77a8c67))

## [6.9.4](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.9.3...pi-subagents-v6.9.4) (2026-05-22)


### Documentation

* plan consolidate shared test fixtures ([#131](https://github.com/gotgenes/pi-packages/issues/131)) ([2fe1e65](https://github.com/gotgenes/pi-packages/commit/2fe1e65024743384981c057b405f97f9c76f9b05))

## [6.9.3](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.9.2...pi-subagents-v6.9.3) (2026-05-22)


### Documentation

* add issue numbers to Phase 8 roadmap steps ([77fee40](https://github.com/gotgenes/pi-packages/commit/77fee402ebc445171f3768f2eea1bba242ce9723))
* add Phase 8 roadmap — testability, display extraction, menu decomposition ([37a0520](https://github.com/gotgenes/pi-packages/commit/37a0520e32a93f4c9bffd5a728882c68e9811024))
* clean up architecture.md progress tracking ([e006032](https://github.com/gotgenes/pi-packages/commit/e00603209b9c21cb1bef41c34eeb71c1cc338117))
* **retro:** add retro notes for issue [#116](https://github.com/gotgenes/pi-packages/issues/116) ([701dca8](https://github.com/gotgenes/pi-packages/commit/701dca8075221aa4c36e19e2d54d43c74863ea57))

## [6.9.2](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.9.1...pi-subagents-v6.9.2) (2026-05-22)


### Documentation

* mark E2 type housekeeping done in architecture ([#116](https://github.com/gotgenes/pi-packages/issues/116)) ([89f18a8](https://github.com/gotgenes/pi-packages/commit/89f18a82fac39b4a62be8e440355b859afaa6d2f))
* plan type housekeeping and small structural cleanups ([#116](https://github.com/gotgenes/pi-packages/issues/116)) ([e1cbd26](https://github.com/gotgenes/pi-packages/commit/e1cbd269961a1bff3b11e2e916733a79c39a087d))
* **retro:** add retro notes for issue [#115](https://github.com/gotgenes/pi-packages/issues/115) ([05b8809](https://github.com/gotgenes/pi-packages/commit/05b88093f7b70ea886b6c7cb5f0cc96161a95df6))

## [6.9.1](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.9.0...pi-subagents-v6.9.1) (2026-05-22)


### Documentation

* plan decompose agent-tool.ts into foreground/background modules ([#115](https://github.com/gotgenes/pi-packages/issues/115)) ([4b9aefb](https://github.com/gotgenes/pi-packages/commit/4b9aefb18fe0431a033d90f10bcbe7d37c53a6b8))
* **retro:** add retro notes for issue [#114](https://github.com/gotgenes/pi-packages/issues/114) ([e6095e7](https://github.com/gotgenes/pi-packages/commit/e6095e7465f482ac18756305b9740f1101dbd41a))
* update architecture for E1 agent-tool decomposition ([#115](https://github.com/gotgenes/pi-packages/issues/115)) ([8bccf0a](https://github.com/gotgenes/pi-packages/commit/8bccf0ab90787d906c82c5a362c0763d3b7bd2f5))

## [6.9.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.8.3...pi-subagents-v6.9.0) (2026-05-22)


### Features

* add onAgentCreated to AgentManagerObserver ([e2f1c12](https://github.com/gotgenes/pi-packages/commit/e2f1c1273ce560231cc98ef3c7e214efd2c20f47))


### Documentation

* mark D2 done, update field counts in architecture.md ([#114](https://github.com/gotgenes/pi-packages/issues/114)) ([702caf4](https://github.com/gotgenes/pi-packages/commit/702caf4187bfa015b0d80361b06b6360fddc31b1))
* plan narrow AgentToolDeps and AgentMenuDeps ([#114](https://github.com/gotgenes/pi-packages/issues/114)) ([0f7e953](https://github.com/gotgenes/pi-packages/commit/0f7e95362043109c4113cfe3f7b848e296f118c9))
* **retro:** add retro notes for issue [#113](https://github.com/gotgenes/pi-packages/issues/113) ([6b3c280](https://github.com/gotgenes/pi-packages/commit/6b3c2800e6d7728b8b620172e4acb1068b65e6c4))

## [6.8.3](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.8.2...pi-subagents-v6.8.3) (2026-05-22)


### Documentation

* mark Step D1 complete in architecture.md ([#113](https://github.com/gotgenes/pi-packages/issues/113)) ([b42de23](https://github.com/gotgenes/pi-packages/commit/b42de238710931348336d6e7fd81bb000a0ab584))
* plan disambiguate SpawnOptions (public vs internal) ([#113](https://github.com/gotgenes/pi-packages/issues/113)) ([2f3cebc](https://github.com/gotgenes/pi-packages/commit/2f3cebc6623e0ba20c73145d8e7c6b9ffae6f875))
* **retro:** add retro notes for issue [#112](https://github.com/gotgenes/pi-packages/issues/112) ([2a59ed4](https://github.com/gotgenes/pi-packages/commit/2a59ed4e4f5462cdbf8df96e4b675a9c5ec6eb9d))

## [6.8.2](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.8.1...pi-subagents-v6.8.2) (2026-05-22)


### Documentation

* mark Step C complete in architecture.md ([#112](https://github.com/gotgenes/pi-packages/issues/112)) ([9f6e783](https://github.com/gotgenes/pi-packages/commit/9f6e783ab4ddcabdc24224e02aa631b93b0fb6d4))
* plan replace AgentManager callbacks with observer interface ([#112](https://github.com/gotgenes/pi-packages/issues/112)) ([b32dde1](https://github.com/gotgenes/pi-packages/commit/b32dde1e473611b2734a287e88c8d155642405a7))
* **retro:** add retro notes for issue [#123](https://github.com/gotgenes/pi-packages/issues/123) ([e9333ee](https://github.com/gotgenes/pi-packages/commit/e9333ee2af70e821ba1bace63bdbd7befa72ce84))

## [6.8.1](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.8.0...pi-subagents-v6.8.1) (2026-05-21)


### Documentation

* plan remove vi.fn() cast smell from test helpers ([#123](https://github.com/gotgenes/pi-packages/issues/123)) ([d0e33b3](https://github.com/gotgenes/pi-packages/commit/d0e33b39cf419bb03a2d69c39992600752ce8517))
* **retro:** add retro notes for issue [#111](https://github.com/gotgenes/pi-packages/issues/111) ([37eea32](https://github.com/gotgenes/pi-packages/commit/37eea32b32135b792c6c94933267c3e5a5f2cd7b))

## [6.8.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.7.0...pi-subagents-v6.8.0) (2026-05-21)


### Features

* add ExecutionState interface ([#111](https://github.com/gotgenes/pi-packages/issues/111)) ([4f33e09](https://github.com/gotgenes/pi-packages/commit/4f33e09b8578509985308b225111cfdfce22bb06))
* add NotificationState class ([#111](https://github.com/gotgenes/pi-packages/issues/111)) ([cbee34d](https://github.com/gotgenes/pi-packages/commit/cbee34d1944e411dd8593ac0cfbaa3fa66982d00))
* add WorktreeState class ([#111](https://github.com/gotgenes/pi-packages/issues/111)) ([eddb0c8](https://github.com/gotgenes/pi-packages/commit/eddb0c84311d420f3b50c2861f7585cfd8d1037f))


### Documentation

* plan AgentRecord lifecycle state split ([#111](https://github.com/gotgenes/pi-packages/issues/111)) ([c271d89](https://github.com/gotgenes/pi-packages/commit/c271d8931729e620e46f05e82cdca8276dbd0a6d))
* **retro:** add retro notes for issue [#110](https://github.com/gotgenes/pi-packages/issues/110) ([4a48c65](https://github.com/gotgenes/pi-packages/commit/4a48c655752902f86b864f224e209831f73e241d))
* update architecture doc for AgentRecord lifecycle split ([#111](https://github.com/gotgenes/pi-packages/issues/111)) ([b0d8967](https://github.com/gotgenes/pi-packages/commit/b0d8967601eb7aca41cf59ce7f40f399ccc51fec))

## [6.7.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.6.0...pi-subagents-v6.7.0) (2026-05-21)


### Features

* add AgentActivityTracker class ([#110](https://github.com/gotgenes/pi-packages/issues/110)) ([151308a](https://github.com/gotgenes/pi-packages/commit/151308ad3da569d72e40495bece502281dc302a8))


### Documentation

* plan AgentActivityTracker class ([#110](https://github.com/gotgenes/pi-packages/issues/110)) ([8f5e56b](https://github.com/gotgenes/pi-packages/commit/8f5e56ba0a29730e060bac4658bb4953ce36d4a9))
* **retro:** add retro notes for issue [#118](https://github.com/gotgenes/pi-packages/issues/118) ([1959e52](https://github.com/gotgenes/pi-packages/commit/1959e52d8b150bbc90da72edd93dc6f2ec315e22))
* update architecture doc — mark A3 done, fix Map type ([#110](https://github.com/gotgenes/pi-packages/issues/110)) ([463e997](https://github.com/gotgenes/pi-packages/commit/463e9974db21df17f4b2578825f3c67bc1e90b29))

## [6.6.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.5.0...pi-subagents-v6.6.0) (2026-05-21)


### Features

* accept onMaxConcurrentChanged callback in SettingsManager constructor ([a6829ba](https://github.com/gotgenes/pi-packages/commit/a6829ba528caa7d106139de5217eddc89a18cf83))
* add SettingsManager.applyDefaultMaxTurns and applyGraceTurns methods ([02f8c65](https://github.com/gotgenes/pi-packages/commit/02f8c65297b80aaf1231960bf4b2ed2bdb13eeb4))
* add SettingsManager.applyMaxConcurrent method ([ad9de8a](https://github.com/gotgenes/pi-packages/commit/ad9de8a2553233bb34e7e07f9745f6e778ae1564))


### Documentation

* mark A2b SettingsManager apply methods done in architecture ([#118](https://github.com/gotgenes/pi-packages/issues/118)) ([dafd480](https://github.com/gotgenes/pi-packages/commit/dafd4800b4b3a0cb5935ffd8f20c0a257b7c8be5))
* plan SettingsManager apply methods ([#118](https://github.com/gotgenes/pi-packages/issues/118)) ([51e14ac](https://github.com/gotgenes/pi-packages/commit/51e14aceaf4e30591ca993a06b459e9e1ae8f031))
* **retro:** add retro notes for issue [#109](https://github.com/gotgenes/pi-packages/issues/109) ([22e0ccb](https://github.com/gotgenes/pi-packages/commit/22e0ccb0a32d54472b0cece5c27d1cf80a2afe14))

## [6.5.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.4.0...pi-subagents-v6.5.0) (2026-05-21)


### Features

* add SettingsManager class with get/set normalization ([a21aa28](https://github.com/gotgenes/pi-packages/commit/a21aa28bc4b30b4c17ebfb88c939eba01756f39f))
* SettingsManager load, save, snapshot, and lifecycle events ([c3ece9f](https://github.com/gotgenes/pi-packages/commit/c3ece9f8429919da5a8397691b66020941555b37))


### Documentation

* add A2b SettingsManager apply methods step ([#118](https://github.com/gotgenes/pi-packages/issues/118)) to architecture roadmap ([43a462a](https://github.com/gotgenes/pi-packages/commit/43a462a7b8e4ee4db2ca8eaa4d85e7e0d5ee4024))
* plan extract SettingsManager class ([#109](https://github.com/gotgenes/pi-packages/issues/109)) ([88cece7](https://github.com/gotgenes/pi-packages/commit/88cece74c3ff6726f37827aff7ac337fc720f642))
* **retro:** add retro notes for issue [#108](https://github.com/gotgenes/pi-packages/issues/108) ([55b1877](https://github.com/gotgenes/pi-packages/commit/55b187736f05aba381f5aa2554e451433e005c4d))
* update architecture doc — mark A2 SettingsManager complete ([#109](https://github.com/gotgenes/pi-packages/issues/109)) ([856baa6](https://github.com/gotgenes/pi-packages/commit/856baa64b65098193c3d9228d5a4c7af8f207c72))

## [6.4.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.3.1...pi-subagents-v6.4.0) (2026-05-21)


### Features

* **pi-subagents:** add AgentTypeRegistry class ([#108](https://github.com/gotgenes/pi-packages/issues/108)) ([e34ad07](https://github.com/gotgenes/pi-packages/commit/e34ad071726d2ba6066721c69e72abed46905f23))


### Documentation

* **pi-subagents:** add issue numbers to encapsulation roadmap ([ddb189e](https://github.com/gotgenes/pi-packages/commit/ddb189e4b379d709a3489c1912fd829a35891c5c))
* **pi-subagents:** add Phase 7 encapsulation roadmap to architecture doc ([e0c0953](https://github.com/gotgenes/pi-packages/commit/e0c09532c65ff64cf3cee428f68b0c1edc30441f))
* **pi-subagents:** update architecture.md to reflect current state ([56c322f](https://github.com/gotgenes/pi-packages/commit/56c322f5d205b8f5787186d8979e34e2c2338d25))
* plan AgentTypeRegistry extraction ([#108](https://github.com/gotgenes/pi-packages/issues/108)) ([ffe8702](https://github.com/gotgenes/pi-packages/commit/ffe87029783885d944892c951dda8c374805bc19))
* update architecture and skill docs for AgentTypeRegistry ([#108](https://github.com/gotgenes/pi-packages/issues/108)) ([3e756dd](https://github.com/gotgenes/pi-packages/commit/3e756dd69c78ce26de552fb259d751f5750255f5))

## [6.3.1](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.3.0...pi-subagents-v6.3.1) (2026-05-21)


### Documentation

* **retro:** add retro notes for issue [#100](https://github.com/gotgenes/pi-packages/issues/100) ([eef09ad](https://github.com/gotgenes/pi-packages/commit/eef09ad78c2ff6bf8b12b8937165bb72931ee869))

## [6.3.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.2.0...pi-subagents-v6.3.0) (2026-05-21)


### Features

* add record observer for direct session subscription ([#100](https://github.com/gotgenes/pi-packages/issues/100)) ([3776345](https://github.com/gotgenes/pi-packages/commit/37763454609d38d55c85f89bb051b8c592d425bf))
* add UI observer for direct session subscription ([#100](https://github.com/gotgenes/pi-packages/issues/100)) ([5b35e80](https://github.com/gotgenes/pi-packages/commit/5b35e80e784d96883ee44bf5e890284efa1047ef))


### Documentation

* plan callback-threading replacement with session subscription ([#100](https://github.com/gotgenes/pi-packages/issues/100)) ([7a8e262](https://github.com/gotgenes/pi-packages/commit/7a8e262ebaf99cba017aac00691cc3614ef8c80a))
* **retro:** add retro notes for issue [#99](https://github.com/gotgenes/pi-packages/issues/99) ([b596d0c](https://github.com/gotgenes/pi-packages/commit/b596d0c34862542d0ebb9fae67dd90e9fc660a8b))

## [6.2.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.1.0...pi-subagents-v6.2.0) (2026-05-21)


### Features

* add ParentSnapshot type and builder ([#99](https://github.com/gotgenes/pi-packages/issues/99)) ([ee24eb9](https://github.com/gotgenes/pi-packages/commit/ee24eb907eba9f6f917bc166c912e5482eff5bd5))


### Documentation

* **pi-subagents:** cross-reference issues in architecture decomposition plan ([2242e45](https://github.com/gotgenes/pi-packages/commit/2242e457b7e1bf8cb44e9a1df6fb4d2fd1ba1116))
* plan replace live ctx capture with ParentSnapshot ([#99](https://github.com/gotgenes/pi-packages/issues/99)) ([b6b63f8](https://github.com/gotgenes/pi-packages/commit/b6b63f8677231617a00cb1e3d1227667cbae7ecd))
* **retro:** add retro notes for issue [#98](https://github.com/gotgenes/pi-packages/issues/98) ([ef52aaa](https://github.com/gotgenes/pi-packages/commit/ef52aaa4d8b690b309f2129ff34f90c44368cc57))

## [6.1.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.0.1...pi-subagents-v6.1.0) (2026-05-20)


### Features

* create AgentRecord class with transition methods ([#98](https://github.com/gotgenes/pi-packages/issues/98)) ([e5b2170](https://github.com/gotgenes/pi-packages/commit/e5b21704de2d693e4feff8b0c0f80a4f6e3fdabd))


### Documentation

* plan AgentRecord state machine extraction ([#98](https://github.com/gotgenes/pi-packages/issues/98)) ([5ca6613](https://github.com/gotgenes/pi-packages/commit/5ca6613ba8e73e042c7f06e2f303ad573048138e))
* **retro:** add retro notes for issue [#102](https://github.com/gotgenes/pi-packages/issues/102) ([594a61a](https://github.com/gotgenes/pi-packages/commit/594a61a59f04aafba06ab8649c183b5003e95822))

## [6.0.1](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v6.0.0...pi-subagents-v6.0.1) (2026-05-20)


### Documentation

* full refresh of architecture.md — reflect completed decomposition ([a8187ce](https://github.com/gotgenes/pi-packages/commit/a8187ce839b465529191b53bbb19fd39d5c71e69))
* **pi-subagents:** set new architectural target for AgentManager decomposition ([83288da](https://github.com/gotgenes/pi-packages/commit/83288daf3dc6dce7bcad81799a4f6e9f300553c0))
* plan consolidate test AgentRecord factory ([#102](https://github.com/gotgenes/pi-packages/issues/102)) ([22a3213](https://github.com/gotgenes/pi-packages/commit/22a3213bb55d15871d3582e89d1336fcd9e8fa36))
* **retro:** add retro notes for issue [#61](https://github.com/gotgenes/pi-packages/issues/61) ([7053be7](https://github.com/gotgenes/pi-packages/commit/7053be7bec86a0c160cb602528d1c59e370ba33d))

## [6.0.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v5.8.2...pi-subagents-v6.0.0) (2026-05-20)


### ⚠ BREAKING CHANGES

* Subagent transcripts are now written in Pi's official JSONL session format via SessionManager.create() instead of the bespoke flat format. The output-file.ts module and its encodeCwd/createOutputFilePath/ writeInitialEntry/streamToOutputFile exports are removed. Transcript file paths change from /tmp/pi-subagents-<uid>/... to the Pi sessions directory.

### Features

* add deriveSubagentSessionDir for session directory derivation ([#61](https://github.com/gotgenes/pi-packages/issues/61)) ([8442379](https://github.com/gotgenes/pi-packages/commit/8442379ae4433ba1428d703a24bef7b57c8624f2))
* remove bespoke output-file transcript format ([#61](https://github.com/gotgenes/pi-packages/issues/61)) ([1aab916](https://github.com/gotgenes/pi-packages/commit/1aab9166fc52e4f04e1d0a369788bf5c4a3da7c7))
* thread parent session info through spawn and run options ([#61](https://github.com/gotgenes/pi-packages/issues/61)) ([6f0d537](https://github.com/gotgenes/pi-packages/commit/6f0d537d745df63be43eb14de92caf42e65ab347))
* use persisted SessionManager for subagent sessions ([#61](https://github.com/gotgenes/pi-packages/issues/61)) ([ffafa69](https://github.com/gotgenes/pi-packages/commit/ffafa69d96068f881ec97e4f924245a308e542ba))
* wire session file path through agent-tool, remove output-file streaming ([#61](https://github.com/gotgenes/pi-packages/issues/61)) ([97acf0a](https://github.com/gotgenes/pi-packages/commit/97acf0a63cbe21e0954e79cd7db71e5632084454))


### Bug Fixes

* use cwd in session-dir fallback path to namespace by project ([#61](https://github.com/gotgenes/pi-packages/issues/61)) ([0394420](https://github.com/gotgenes/pi-packages/commit/0394420237b9d23b35fe6c4e65b03fc267beaa0c))


### Documentation

* plan session format transcript migration ([#61](https://github.com/gotgenes/pi-packages/issues/61)) ([68238c1](https://github.com/gotgenes/pi-packages/commit/68238c1c90c375c8469929399f18d0566e97a32c))
* **retro:** add retro notes for issue [#77](https://github.com/gotgenes/pi-packages/issues/77) ([004c99c](https://github.com/gotgenes/pi-packages/commit/004c99c4fba6b515360bb453eedbeb1218cebbc2))
* update architecture and package skill for session format migration ([#61](https://github.com/gotgenes/pi-packages/issues/61)) ([eef5e16](https://github.com/gotgenes/pi-packages/commit/eef5e16ad90118092badcbe2594c89c399919c15))

## [5.8.2](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v5.8.1...pi-subagents-v5.8.2) (2026-05-20)


### Documentation

* plan inject projectAgentsDir into AgentMenuDeps ([#77](https://github.com/gotgenes/pi-packages/issues/77)) ([d8cf039](https://github.com/gotgenes/pi-packages/commit/d8cf03944d0abc6230541d67655d89582665a615))
* **retro:** add retro notes for issue [#66](https://github.com/gotgenes/pi-packages/issues/66) ([ce0f04a](https://github.com/gotgenes/pi-packages/commit/ce0f04a3d84523a4c2e8b7bc998b5bec0f16970f))

## [5.8.1](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v5.8.0...pi-subagents-v5.8.1) (2026-05-20)


### Documentation

* plan replace as-any casts with SDK types ([#66](https://github.com/gotgenes/pi-packages/issues/66)) ([a8728bf](https://github.com/gotgenes/pi-packages/commit/a8728bf695a11f649fb908a6a31a55842b76ce32))
* **retro:** add retro notes for issue [#70](https://github.com/gotgenes/pi-packages/issues/70) ([0668956](https://github.com/gotgenes/pi-packages/commit/0668956e99383df7a62fddde57dd4182bf491a5e))
* **retro:** record architecture update for [#70](https://github.com/gotgenes/pi-packages/issues/70) ([49d4fae](https://github.com/gotgenes/pi-packages/commit/49d4faee4ee711e385dbf59334b0b737897d26a6))
* update architecture roadmap with [#87](https://github.com/gotgenes/pi-packages/issues/87), [#70](https://github.com/gotgenes/pi-packages/issues/70) status ([97a2da1](https://github.com/gotgenes/pi-packages/commit/97a2da11cbd73c9f84eb2158e2437cbe8c749208))

## [5.8.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v5.7.0...pi-subagents-v5.8.0) (2026-05-20)


### Features

* add SessionLifecycleHandler ([d8d95fa](https://github.com/gotgenes/pi-packages/commit/d8d95fa92561e0068444c3c925f21b50825a741c))
* add ToolStartHandler ([c293e41](https://github.com/gotgenes/pi-packages/commit/c293e41e25d9742f807f85d0efe0a0e5605b29a6))


### Documentation

* **retro:** add retro notes for issue [#87](https://github.com/gotgenes/pi-packages/issues/87) ([1701fe4](https://github.com/gotgenes/pi-packages/commit/1701fe41d582d7180b2622c2e03db954e8d2c2af))

## [5.7.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v5.6.0...pi-subagents-v5.7.0) (2026-05-20)


### Features

* add session-context methods to SubagentRuntime ([3bbc6af](https://github.com/gotgenes/pi-packages/commit/3bbc6af5c3d9e6faef2112f6c92f991c4b27e38d))
* add widget delegation methods to SubagentRuntime ([36350f4](https://github.com/gotgenes/pi-packages/commit/36350f413f44f432b14b0a42e27df2c8f5444a08))


### Documentation

* add [#87](https://github.com/gotgenes/pi-packages/issues/87) to architecture roadmap and fix package scope hallucinations ([ddee1a0](https://github.com/gotgenes/pi-packages/commit/ddee1a011acc3e20d17d2bdf46cc4603604c092d))
* plan evolving SubagentRuntime from data bag to object with methods ([#87](https://github.com/gotgenes/pi-packages/issues/87)) ([4f2f16a](https://github.com/gotgenes/pi-packages/commit/4f2f16a8eea67e4959a754d172a9238b4b8662b1))
* plan extract event handlers from index.ts ([#70](https://github.com/gotgenes/pi-packages/issues/70)) ([5fc115f](https://github.com/gotgenes/pi-packages/commit/5fc115f61bc52c5c88630ea7c869e1e34bde0130))
* **retro:** add retro notes for issue [#72](https://github.com/gotgenes/pi-packages/issues/72) ([5b53189](https://github.com/gotgenes/pi-packages/commit/5b53189d6242b6f2262b9e7cd2d9dbdbe2a28c60))
* update architecture roadmap with [#72](https://github.com/gotgenes/pi-packages/issues/72), [#76](https://github.com/gotgenes/pi-packages/issues/76), [#80](https://github.com/gotgenes/pi-packages/issues/80), [#84](https://github.com/gotgenes/pi-packages/issues/84) status ([176cb68](https://github.com/gotgenes/pi-packages/commit/176cb682001b21b7c223656b353b8cf2af412b0c))

## [5.6.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v5.5.0...pi-subagents-v5.6.0) (2026-05-20)


### Features

* convert AgentManager to options-bag constructor with DI ([1292cec](https://github.com/gotgenes/pi-packages/commit/1292cec60c24d8e657985c53b9b3413089c2a79d))
* define AgentRunner interface in agent-runner.ts ([6a3c85a](https://github.com/gotgenes/pi-packages/commit/6a3c85a445daf0e4e8c01620eb6ae1a8237f1766))


### Documentation

* mark [#84](https://github.com/gotgenes/pi-packages/issues/84) as done in plan ([#72](https://github.com/gotgenes/pi-packages/issues/72)) ([5cfa1ec](https://github.com/gotgenes/pi-packages/commit/5cfa1ecf080f95fbd6b4aec05b27cc9672f60267))
* **retro:** add retro notes for issue [#84](https://github.com/gotgenes/pi-packages/issues/84) ([99d9016](https://github.com/gotgenes/pi-packages/commit/99d90161df5fe9d302514e33c2d2d9fbfb248f25))

## [5.5.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v5.4.1...pi-subagents-v5.5.0) (2026-05-20)


### Features

* extract WorktreeManager interface and GitWorktreeManager class ([#84](https://github.com/gotgenes/pi-packages/issues/84)) ([23efb99](https://github.com/gotgenes/pi-packages/commit/23efb99e0d5e6bf6a65b758020e00af69fe84f6e))


### Documentation

* plan dependency-inject AgentManager's collaborators ([#72](https://github.com/gotgenes/pi-packages/issues/72)) ([a99374a](https://github.com/gotgenes/pi-packages/commit/a99374aa2b11defd301be97f64b9bdba2a618712))
* plan extract GitWorktreeManager class ([#84](https://github.com/gotgenes/pi-packages/issues/84)) ([47d9d93](https://github.com/gotgenes/pi-packages/commit/47d9d9368fc2f4762bf31e312ebd84e4332ca4c4))
* **retro:** add retro notes for issue [#76](https://github.com/gotgenes/pi-packages/issues/76) ([ceef7e0](https://github.com/gotgenes/pi-packages/commit/ceef7e05c8753bbbb6558ca507924b5562cc9c52))
* update plan to reference [#84](https://github.com/gotgenes/pi-packages/issues/84) as prerequisite ([#72](https://github.com/gotgenes/pi-packages/issues/72)) ([d8ad3f5](https://github.com/gotgenes/pi-packages/commit/d8ad3f544929c569789d63fcf140bd300d5ef389))

## [5.4.1](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v5.4.0...pi-subagents-v5.4.1) (2026-05-20)


### Documentation

* plan inject cwd into AgentManager constructor ([#76](https://github.com/gotgenes/pi-packages/issues/76)) ([7d3d50a](https://github.com/gotgenes/pi-packages/commit/7d3d50a7b7b96ef15cf5ffd7f609ed0baa46d6b9))
* **retro:** add retro notes for issue [#80](https://github.com/gotgenes/pi-packages/issues/80) ([ac38a72](https://github.com/gotgenes/pi-packages/commit/ac38a7209788c7725c7307491a18fb5a8e83962d))

## [5.4.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v5.3.0...pi-subagents-v5.4.0) (2026-05-20)


### Features

* add resolveAgentConfig with guaranteed-non-null fallback chain ([6b676a0](https://github.com/gotgenes/pi-packages/commit/6b676a0b59ebc3598d366cb5db600a8177b301e6))


### Documentation

* plan consolidate getConfig/getAgentConfig into resolveAgentConfig ([#80](https://github.com/gotgenes/pi-packages/issues/80)) ([1c14b47](https://github.com/gotgenes/pi-packages/commit/1c14b4760fa67dff5dbf17306d04bbe992b38bce))
* **retro:** add retro notes for issue [#71](https://github.com/gotgenes/pi-packages/issues/71) ([a70e52f](https://github.com/gotgenes/pi-packages/commit/a70e52f840cf3b2f65689987dcb7316e32dc12ff))

## [5.3.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v5.2.0...pi-subagents-v5.3.0) (2026-05-19)


### Features

* add assembleSessionConfig in session-config.ts ([ee8076d](https://github.com/gotgenes/pi-packages/commit/ee8076dc2292ec957b64894af3fcd22567f23be5))


### Documentation

* add [#80](https://github.com/gotgenes/pi-packages/issues/80) to architecture roadmap, mark [#69](https://github.com/gotgenes/pi-packages/issues/69) and [#71](https://github.com/gotgenes/pi-packages/issues/71) done ([5744e28](https://github.com/gotgenes/pi-packages/commit/5744e28ac993454f8cb33afb18e5247569f9f971))
* plan session-config assembler extraction ([#71](https://github.com/gotgenes/pi-packages/issues/71)) ([5d2cd4f](https://github.com/gotgenes/pi-packages/commit/5d2cd4f8de214a03a11688b56221679591aedafd))
* **retro:** add retro notes for issue [#69](https://github.com/gotgenes/pi-packages/issues/69) ([18cbbdb](https://github.com/gotgenes/pi-packages/commit/18cbbdb627f2ae63f8109c1f5597c31265738415))

## [5.2.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v5.1.0...pi-subagents-v5.2.0) (2026-05-19)


### Features

* add SubagentRuntime interface and factory ([b316c12](https://github.com/gotgenes/pi-packages/commit/b316c1222cecf34d1149fa2a847a1c11883164c1))
* thread defaultMaxTurns and graceTurns through RunOptions ([db9f1ac](https://github.com/gotgenes/pi-packages/commit/db9f1ac7c47b7b42559ddf659f86c02f78a82d23))


### Bug Fixes

* remove pi-subagents/README.md from rumdl exclude and fix 131 lint issues ([50f334c](https://github.com/gotgenes/pi-packages/commit/50f334c83edf08ee2cb413b1e6520f6c5a26cd41))


### Documentation

* enforce one-sentence-per-line across all markdown files ([a533869](https://github.com/gotgenes/pi-packages/commit/a533869e09ea33a2da8c4ac022d9be4674be4b18))
* one sentence per line throughout architecture.md; add Issue-prefix and sentence rules to markdown-conventions ([f274ea8](https://github.com/gotgenes/pi-packages/commit/f274ea8003e23c3ad37516422d052f7c815da638))
* **pi-subagents:** add structural refactoring roadmap with issue sequencing ([a820538](https://github.com/gotgenes/pi-packages/commit/a8205382624acbd26721594630d25976373fc617))
* plan SubagentRuntime to eliminate module-scope mutable state ([#69](https://github.com/gotgenes/pi-packages/issues/69)) ([fa5eee4](https://github.com/gotgenes/pi-packages/commit/fa5eee4434724fd47dc384092787b50ea9859f4d))
* **retro:** add follow-up retro notes for issue [#57](https://github.com/gotgenes/pi-packages/issues/57) ([629e11f](https://github.com/gotgenes/pi-packages/commit/629e11f2eaed1294fa756ad3e54fe692428e1c0e))
* **retro:** add retro notes for issue [#57](https://github.com/gotgenes/pi-packages/issues/57) ([1701841](https://github.com/gotgenes/pi-packages/commit/1701841f387b3418286f670ae0eb10613b5f2b4b))

## [5.1.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v5.0.0...pi-subagents-v5.1.0) (2026-05-19)


### Features

* add debugLog utility gated on PI_SUBAGENTS_DEBUG ([#57](https://github.com/gotgenes/pi-packages/issues/57)) ([2b8874a](https://github.com/gotgenes/pi-packages/commit/2b8874aeaa28bc09550dd0f8977b7b57d996b254))
* thread debugLog into agent-manager and notification catch blocks ([#57](https://github.com/gotgenes/pi-packages/issues/57)) ([07943a3](https://github.com/gotgenes/pi-packages/commit/07943a341fbe0a0a35f25af3f4b15bc28cdee7a2))
* thread debugLog into custom-agents and memory catch blocks ([#57](https://github.com/gotgenes/pi-packages/issues/57)) ([e239925](https://github.com/gotgenes/pi-packages/commit/e2399253410dc644b38269b52de6e6a4bfa75d3a))
* thread debugLog into env catch blocks ([#57](https://github.com/gotgenes/pi-packages/issues/57)) ([f5ff82f](https://github.com/gotgenes/pi-packages/commit/f5ff82f0c06be3c1dfe5d5ec0ff3621105b55ad0))
* thread debugLog into output-file catch block ([#57](https://github.com/gotgenes/pi-packages/issues/57)) ([a72b11b](https://github.com/gotgenes/pi-packages/commit/a72b11bc1f36bf256f520b9f13e546295fc6cb64))
* thread debugLog into skill-loader catch block ([#57](https://github.com/gotgenes/pi-packages/issues/57)) ([b57231c](https://github.com/gotgenes/pi-packages/commit/b57231cc5de56a834c34f9e171b909d03939505c))
* thread debugLog into worktree catch blocks ([#57](https://github.com/gotgenes/pi-packages/issues/57)) ([049f489](https://github.com/gotgenes/pi-packages/commit/049f4891ab5b09c9d1a301f7d8af797cb165cb4c))


### Documentation

* plan structured debug logging for silenced catch blocks ([#57](https://github.com/gotgenes/pi-packages/issues/57)) ([28e403e](https://github.com/gotgenes/pi-packages/commit/28e403ea2605405da1a57871af946ee2971ee289))

## [5.0.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v4.1.1...pi-subagents-v5.0.0) (2026-05-19)


### ⚠ BREAKING CHANGES

* All @earendil-works/pi-* peerDependencies and devDependencies now require >=0.75.0, aligning with Pi's Node 22 minimum.
* Minimum supported Node.js version is now >=22, aligning with Pi v0.75.0. tsconfig target raised from ES2023 to ES2024.
    - ES2024 APIs (Promise.withResolvers, Object.groupBy, Map.groupBy, Array.fromAsync) are now allowed.
    - @types/node catalog aligned to ^22.15.3.
    - pi-autoformat now declares engines.node for consistency.

### Features

* raise minimum Node.js version to 22 and bump tsconfig target to ES2024 ([98a5b01](https://github.com/gotgenes/pi-packages/commit/98a5b01ca20aa1feed14a60bfa7bb9e082c9914b))
* raise minimum Pi dependency to v0.75.0 ([1068329](https://github.com/gotgenes/pi-packages/commit/10683290d2a789880848bf7eb093d4307b6eff40))


### Documentation

* **retro:** add retro notes for issue [#54](https://github.com/gotgenes/pi-packages/issues/54) ([d753eb3](https://github.com/gotgenes/pi-packages/commit/d753eb3f836a28f089197a45dd582dc4be88872d))

## [4.1.1](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v4.1.0...pi-subagents-v4.1.1) (2026-05-18)


### Documentation

* plan decompose index.ts into tool + menu modules ([#54](https://github.com/gotgenes/pi-packages/issues/54)) ([7adf954](https://github.com/gotgenes/pi-packages/commit/7adf954f37800ace0bcc9d5eb65045e2e133e4f2))
* **retro:** add retro notes for issue [#53](https://github.com/gotgenes/pi-packages/issues/53) ([f8ca910](https://github.com/gotgenes/pi-packages/commit/f8ca9101576eaad8639d1bb2579f0e631a075038))

## [4.1.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v4.0.0...pi-subagents-v4.1.0) (2026-05-18)


### Features

* add resolveInvocationModel to model-resolver ([462b519](https://github.com/gotgenes/pi-packages/commit/462b5194fdfdf86d8d2d166a99472c651e00b76b))


### Bug Fixes

* remove quotes from rumdl glob patterns in lint:md script ([a8a0c62](https://github.com/gotgenes/pi-packages/commit/a8a0c62feb2fc45cf68cd7d777259dc159de671b))


### Documentation

* plan extract model resolution from Agent.execute ([#53](https://github.com/gotgenes/pi-packages/issues/53)) ([4c07a47](https://github.com/gotgenes/pi-packages/commit/4c07a474f9f25043a2fa3a4f2829e97eb9bb7666))
* **retro:** add retro notes for issue [#48](https://github.com/gotgenes/pi-packages/issues/48) ([f244c04](https://github.com/gotgenes/pi-packages/commit/f244c04c64f768e724e89d77962f2fb63715b998))

## [4.0.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v3.0.0...pi-subagents-v4.0.0) (2026-05-17)


### ⚠ BREAKING CHANGES

* The untyped globalThis[Symbol.for("pi-subagents:manager")] accessor is removed. Use getSubagentsService() from the package's public exports instead.
* The public API surface is now exported from src/service.ts. The old untyped Symbol.for("pi-subagents:manager") global will be removed in a subsequent commit.

### Features

* add SubagentRecord serializer ([d7afb45](https://github.com/gotgenes/pi-packages/commit/d7afb4569c9e28ce5d4bf7fb1ac560b0bcbb7c90))
* add SubagentsService types and accessor functions ([468623c](https://github.com/gotgenes/pi-packages/commit/468623c936f45cc30d3c5dde134cc2d21da4a0c4))
* expose public service entry point via package exports ([0dbeaaf](https://github.com/gotgenes/pi-packages/commit/0dbeaaf39c79717df8cabf59e8ba53652f9bc7af))
* implement getRecord and listAgents on SubagentsService adapter ([a6da473](https://github.com/gotgenes/pi-packages/commit/a6da47393f6faa3fef93bd065c1ad1a0613d1636))
* implement spawn with model resolution on SubagentsService adapter ([fd70d82](https://github.com/gotgenes/pi-packages/commit/fd70d828905bc3415fa8b8aebfe4c2a5355209cb))
* implement steer, abort, waitForAll, hasRunning on adapter ([00f0b99](https://github.com/gotgenes/pi-packages/commit/00f0b99ea978625798ba67a40b375e42006d33e4))
* publish SubagentsService at extension init, remove old untyped global ([6047e2b](https://github.com/gotgenes/pi-packages/commit/6047e2bbbaf87b5e28325b084b09daf2b0c9b6b9))


### Documentation

* plan SubagentsService implementation ([#48](https://github.com/gotgenes/pi-packages/issues/48)) ([6bd2af8](https://github.com/gotgenes/pi-packages/commit/6bd2af862fb7e7f429617c154391c800b50c5d86))
* **retro:** add retro notes for issue [#49](https://github.com/gotgenes/pi-packages/issues/49) ([69a5bfc](https://github.com/gotgenes/pi-packages/commit/69a5bfc94edfc445d46fb495449649998614f86d))

## [3.0.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v2.0.0...pi-subagents-v3.0.0) (2026-05-17)


### ⚠ BREAKING CHANGES

* The JoinMode type and defaultJoinMode setting are removed from the public settings interface.
* The join-mode setting (smart/async/group) is removed. Background agents always notify individually on completion.
* The subagents:ready event is no longer emitted. Extensions should use the typed SubagentsAPI ([#48](https://github.com/gotgenes/pi-packages/issues/48)) instead of event-based RPC discovery.
* The subagents:rpc:ping, subagents:rpc:spawn, and subagents:rpc:stop event channels are no longer registered. Use the typed SubagentsAPI via Symbol.for() instead.

### Features

* remove group-join and cross-extension-rpc source ([b7d7f21](https://github.com/gotgenes/pi-packages/commit/b7d7f21af265e2ff95f0534f5c0b51f71b8f1e7f))
* remove group-join wiring from index.ts ([4e2dc7f](https://github.com/gotgenes/pi-packages/commit/4e2dc7f8a98e441308f229745dfc42d09784d786))
* remove join-mode types and settings ([1d98793](https://github.com/gotgenes/pi-packages/commit/1d98793eb85aa3d9815274aa443c34bb4434b6f9))
* remove RPC wiring from index.ts ([3a960af](https://github.com/gotgenes/pi-packages/commit/3a960af8f6bb83219497d6229d12c6859cf3eb71))


### Documentation

* plan removal of group-join, output-file, and ad-hoc RPC ([#49](https://github.com/gotgenes/pi-packages/issues/49)) ([853a97f](https://github.com/gotgenes/pi-packages/commit/853a97f1c47051868b2ffddd7d5509f765a80d07))
* remove group-join and RPC from README and AGENTS ([9f65f7a](https://github.com/gotgenes/pi-packages/commit/9f65f7a21611af8dead00a5fb34d7d10f3d6ab43))

## [2.0.0](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v1.0.2...pi-subagents-v2.0.0) (2026-05-17)


### ⚠ BREAKING CHANGES

* the `schedule` parameter is removed from the Agent tool. The `subagents:scheduled` and `subagents:scheduler_ready` events are no longer emitted. The `/agents → Settings → Scheduling` toggle is removed.
* the `schedule` parameter is removed from the Agent tool and the `subagents:scheduled` / `subagents:scheduler_ready` events are no longer emitted. System cron (or launchd) invoking `pi` directly is the recommended replacement for recurring/delayed agent tasks.

### Features

* remove scheduled subagents source and tests ([860a03f](https://github.com/gotgenes/pi-packages/commit/860a03f08a6dbd418b437a72c2fd05ea416abacb))
* remove scheduler wiring, types, and settings ([d5184e8](https://github.com/gotgenes/pi-packages/commit/d5184e88b181e60809b7fecc6a0971a18723bb9d))


### Documentation

* correct Module-Level Changes table in plan [#52](https://github.com/gotgenes/pi-packages/issues/52) (AGENTS.md → SKILL.md) ([93337e2](https://github.com/gotgenes/pi-packages/commit/93337e2a6b0424dc64e0adaf7a5c6ae6913c5991))
* plan remove in-process scheduled subagents ([#52](https://github.com/gotgenes/pi-packages/issues/52)) ([bc548a4](https://github.com/gotgenes/pi-packages/commit/bc548a4dc6be4c5f810e9e33abcc76bc0d84f0da))
* remove scheduling from README, architecture doc, and skill ([b2f16f2](https://github.com/gotgenes/pi-packages/commit/b2f16f2a53674a6a2675024dfc038c4243edd299))
* **retro:** add retro notes for issue [#51](https://github.com/gotgenes/pi-packages/issues/51) ([0f741de](https://github.com/gotgenes/pi-packages/commit/0f741dedbe4a8e26fd1e39098fb153e4511082b9))

## [1.0.2](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v1.0.1...pi-subagents-v1.0.2) (2026-05-17)


### Documentation

* plan update ADR 0001 to reflect hard-fork decision ([#51](https://github.com/gotgenes/pi-packages/issues/51)) ([bd4899a](https://github.com/gotgenes/pi-packages/commit/bd4899a0d7e72c43b80c3c07c07ccc32dc0df8ed))
* update ADR 0001 to reflect hard-fork decision ([#51](https://github.com/gotgenes/pi-packages/issues/51)) ([387e0ad](https://github.com/gotgenes/pi-packages/commit/387e0ad06ec1cf015c1d3d1d9852a1be015fc283))

## [1.0.1](https://github.com/gotgenes/pi-packages/compare/pi-subagents-v1.0.0...pi-subagents-v1.0.1) (2026-05-17)


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

## [1.0.0](https://github.com/gotgenes/pi-subagents/compare/v0.7.2...v1.0.0) (2026-05-12)


### ⚠ BREAKING CHANGES

* Peer dependencies now require @earendil-works/pi-* (>=0.74.0) instead of the deprecated @mariozechner/pi-* scope.

### Features

* **prompts:** inject &lt;active_agent name="..."/&gt; tag for permission resolution ([99873ee](https://github.com/gotgenes/pi-subagents/commit/99873eec57550d0d32c7751f34aa7d25587b6afd))


### Bug Fixes

* **agent-runner:** re-filter active tools after bindExtensions so extension tools land in child ([97e0ad1](https://github.com/gotgenes/pi-subagents/commit/97e0ad139884eaa006caa0e39f9d2273ffff592f))


### Documentation

* add ADR 0001 documenting Patch 1 and upstream-PR deferrals ([ca711bc](https://github.com/gotgenes/pi-subagents/commit/ca711bc19c8946b52855c3548bd81c4fa8cf3491))


### Miscellaneous Chores

* add prek hooks, markdownlint config, AGENTS.md, and docs scaffold ([ae509c7](https://github.com/gotgenes/pi-subagents/commit/ae509c7c8194ba83fbb148f3da7f845466185563))
* rename to @gotgenes/pi-subagents, peer-dep rename, pi-agent-core fix, switch to pnpm ([e1ae8c4](https://github.com/gotgenes/pi-subagents/commit/e1ae8c4d4b470d8e3fea0233c05d57c10b073bd7))

## [Unreleased]

## [0.7.2] - 2026-05-12

> **Heads-up — behavior changes in skill preloading:**
> - **`.txt` and extensionless flat skill files are no longer loaded.** Only `<name>.md` flat files and `<name>/SKILL.md` directory skills resolve now. Rename any `<name>.txt` or extensionless skill files to `<name>.md`.

### Added
- **Pi-standard `<name>/SKILL.md` directory layout** is now discovered alongside flat `<name>.md` files. Top-level and nested matches both resolve via BFS — for skill `foo`, the loader checks `<root>/foo/SKILL.md`, then recursively descends looking for `*/.../foo/SKILL.md`. Recursion skips dotfile directories and `node_modules`; a directory that itself contains `SKILL.md` is treated as a single skill (Pi's "skills don't nest" rule).
- **Five discovery roots**, checked in precedence order:
  - `<cwd>/.pi/skills/` (project, Pi)
  - `<cwd>/.agents/skills/` (project, [Agent Skills spec](https://agentskills.io/integrate-skills))
  - `$PI_CODING_AGENT_DIR/skills/` — default `~/.pi/agent/skills/` (user, Pi)
  - `~/.agents/skills/` (user, Agent Skills spec)
  - `~/.pi/skills/` (legacy global, kept for backward compatibility)
- **Symlink rejection broadened** to the new layouts: symlinked skill roots, nested skill directories, and `SKILL.md` files inside otherwise-real directories are all rejected (intentional deviation from Pi, which follows symlinks).
- **Deterministic traversal order** — entries are sorted byte-order so collisions resolve identically across filesystems. Pi's iteration order is `readdirSync`-dependent.
- **Resolved spawn args are now shown in the dedicated conversation viewer** ([#62](https://github.com/tintinweb/pi-subagents/issues/62)). Open `/subagent` → Running Agents → select an agent: a second header row displays the effective invocation — model override (when different from parent), `thinking: <level>`, `isolated`, `worktree`, `inherit context`, `background`, and `max turns: N`. Tags appear when the resolved value is notable (e.g. `isolated: true`), not just when the caller explicitly set it; `max turns` is the one exception and shows only when explicitly configured. Lets you verify the parent agent honored your spawn instructions without scrolling back through the chat. Snapshot stored on the new `AgentRecord.invocation` field. The same tag set is also surfaced on the `Agent` tool-call result render (which previously showed a narrower subset).
- **`Shift+↑` / `Shift+↓` scroll a full page in the conversation viewer** — same behavior as `PgUp` / `PgDn`. Note: some terminal emulators intercept Shift+arrows for text selection or tab switching, in which case `PgUp`/`PgDn` remain available.

### Changed
- **`.txt` and extensionless flat skill files are no longer loaded.** Pi only supports `.md`; we now match. **Migration:** rename any `<name>.txt` / `<name>` skill files to `<name>.md`.
- **Conversation viewer no longer fills the full screen.** The overlay is now capped at 70% of terminal height (90% width unchanged), and the viewer's internal viewport mirrors that cap so the footer/scroll indicator can't be clipped.

## [0.7.1] - 2026-05-07

> **Heads-up — behavior change:**
> - `isolation: "worktree"` now fails loud (returns an error) instead of silently falling back to the main tree. Affects users running pi in a non-git directory or a fresh repo with no commits.

### Changed
- **`isolation: "worktree"` now fails loud instead of silently falling back.** Previously when `createWorktree` returned undefined (not a git repo, no commits yet, or `git worktree add` failed), the agent ran in the main `cwd` with a `[WARNING: ...]` block prepended to its prompt — visible only to the LLM, never surfaced to the caller. Now the failure throws a structured error that propagates back to the `Agent` tool response; no agent record is created. Failed scheduled fires are recorded as `lastStatus: "error"` with the reason in the `subagents:scheduled` error event. Queued background spawns whose worktree creation fails when they dequeue are marked terminal-error and don't block the rest of the queue.

### Fixed

- **Headless `pi --print` runs no longer hang or crash after background
subagents complete.** Cleanup timers no longer keep the process alive, and
stale completion notifications are treated as best-effort shutdown side
effects.

## [0.7.0] - 2026-05-04

> **Heads-up — behavior changes:**
> - `subagents:completed`/`failed` event `tokens.total` now excludes `cacheRead` (previously double-counted across turns) — see Fixed [#38].
> - Cron `?` is now a wildcard (same as `*`), not "current time value" — affects Quartz-style expressions only.

### Changed
- **`@mariozechner/pi-{ai,coding-agent,tui}` moved to `peerDependencies` (`>=0.70.5`).** Avoids duplicate framework instances when the host loads this extension.
- **`@sinclair/typebox` pinned from `latest` to `^0.34.49`** so installs are reproducible.
- **`croner` bumped 8 → 10.** Heads-up: in cron strings, `?` now means wildcard (same as `*`) instead of "current time value" — affects Quartz-style expressions only.

### Added
- **Master switch for scheduling** — new `schedulingEnabled` setting (default `true`) under `/agents → Settings → Scheduling`. When set to `false`: the `schedule` parameter and its guideline are stripped from the `Agent` tool spec at registration (zero LLM-context cost), the scheduler does not bind to the session, the `/agents → Scheduled jobs` menu entry is hidden, and any in-flight scheduler is stopped immediately. The schema-level removal applies on next pi session; the runtime kill (menu, fire path) takes effect immediately. Persisted at `<cwd>/.pi/subagents.json`.
- **Schedule subagent spawns** — the `Agent` tool now accepts an optional `schedule` parameter. When set, the spawn registers a job that fires later instead of running immediately. Three formats: 6-field cron (`"0 0 9 * * 1"` — 9am every Monday), interval (`"5m"`, `"1h"`), or one-shot (`"+10m"` or ISO timestamp). Returns the job ID. Schedules are session-scoped — they reset on `/new`, restore on `/resume` (mirrors the persistence model of pi-chonky-tasks). Storage at `<cwd>/.pi/subagent-schedules/<sessionId>.json`, with PID-based file locking + atomic temp+rename for concurrent-instance safety. **Result delivery is identical to today's background-spawn completions**: when the scheduled agent finishes, the existing `subagent-notification` followUp path emits the result to the conversation — no new delivery code, no new message types. **Concurrency**: scheduled fires bypass `maxConcurrent` so a 5-minute interval can't be deferred behind 4 long-running manual agents. **Management**: `/agents` → "Scheduled jobs" lists active jobs and lets you cancel any one of them. Creation is via the `Agent` tool only — no parallel manual-create wizard in this iteration. **Events**: `subagents:scheduled` ({ type: "added" | "removed" | "updated" | "fired" | "error", … }) and `subagents:scheduler_ready` for cross-extension consumers. **Restrictions**: `schedule` is incompatible with `inherit_context` (no parent at fire time) and `resume` (schedules create fresh agents); forces `run_in_background: true`. Scheduler engine mirrors `pi-cron-schedule` (`croner` for cron, `setInterval`/`setTimeout` for interval/once); past one-shot timestamps and invalid cron expressions are caught at create time.
- **Context-window utilization indicator in the subagent overlay** — token count is now followed by a colored `(NN%)` showing how full the subagent's context is right now (`estimateContextTokens(messages) / model.contextWindow * 100`, sourced from upstream `contextUsage.percent`). Threshold colors: <70% dim, 70–85% warning, ≥85% error. Gracefully omitted when the model has no `contextWindow` declared, or right after compaction before the next assistant turn (`tokens` is `null` in that window). The same annotation slot also surfaces a compaction count `↻N` when the agent has compacted at least once — e.g. `12.3k token (84% · ↻3)` (percent + compactions joined with `·`), `12.3k token (↻1)` (compactions only, immediately post-compaction while percent is still null). The compaction glyph stays dim regardless; the percent's threshold color carries the urgency signal. Two live overlays get the annotations (running stats line; inspect-overlay header); post-completion notifications and result/event payloads only get the count (the indicator is no longer actionable once the agent is done).
- **Token usage and context% exposed to the parent agent** at every interaction surface — `get_subagent_result` adds `Context: NN%` to its stats line; `steer_subagent` returns a `Current state: 12.3k token · 5 tool uses · context 72% full` line so the steering agent knows whether it has room before sending more context; `task-notification` XML adds `<context_percent>NN</context_percent>` (omitted when null). All plain-text, no ANSI codes — designed for LLM consumption, not human display.
- **New `subagents:compacted` lifecycle event** fires when a subagent's session successfully compacts. Payload: `{ id, type, description, reason: "manual" | "threshold" | "overflow", tokensBefore, compactionCount }` — `tokensBefore` is upstream's pre-compaction context size estimate; `compactionCount` is the running total for this agent (also persisted on `AgentRecord.compactionCount` and surfaced in `get_subagent_result` / `steer_subagent` / `task-notification` when > 0). Aborted compactions don't fire. Routed through a new manager-level `onCompact` constructor callback, matching the existing `onStart` / `onComplete` pattern.

### Fixed
- **Subagent token count was inflated 5–15× and reset mid-run** ([#38](https://github.com/tintinweb/pi-subagents/issues/38)). Two distinct bugs in the same field. (1) Upstream `getSessionStats().tokens.total` sums per-turn `cacheRead` across every assistant message — but each turn's `cacheRead` is the *cumulative* cached prefix re-read on that one API call, so summing N turns counts the prefix N times (quadratic inflation, very visible on long sessions). (2) Even with that fixed, anything derived from `session.state.messages` resets at compaction because upstream replaces the array via `this.agent.state.messages = sessionContext.messages`. Fix replaces all six display readers with a lifetime accumulator (`AgentRecord.lifetimeUsage` and `AgentActivity.lifetimeUsage` — `{ input, output, cacheWrite }`) fed by a new `onAssistantUsage` callback dispatched from `message_end` events in both `runAgent` and `resumeAgent`. The accumulator is independent of `state.messages` mutation, so it survives compaction; total = input + output + cacheWrite by construction (cacheRead deliberately excluded — same prefix-double-counting reason). The `subagents:completed`/`failed` event payload's `tokens` field is now also lifetime-accumulated for `input`, `output`, and `total` together (was: `total` lifetime, `input`/`output` session-derived → inconsistent after compaction).
- **ESC during a foreground `Agent` call now actually stops the subagent** ([#44](https://github.com/tintinweb/pi-subagents/pull/44) — thanks [@Zeng-Zer](https://github.com/Zeng-Zer)). Pi's interrupt path is `esc → agent.abort()` on the parent → `AbortSignal` delivered to every tool's `execute(toolCallId, params, signal, …)`, but the `Agent` tool dropped that signal on the floor: subagents ran on their own independent `AbortController` inside `AgentManager`, so the parent abort was invisible and the subagent kept running until natural completion or `max_turns`. Fix threads `signal` through `Agent.execute` → `manager.spawnAndWait()` → `SpawnOptions.signal`, and `AgentManager.startAgent()` now attaches an `{ once: true }` `"abort"` listener that calls `this.abort(id)` (which sets `status: "stopped"` and aborts the child controller). The listener is detached in both `.then` and `.catch` to avoid leaking on natural settle. **Scope:** foreground only — background agents intentionally outlive the parent tool call, so their spawn deliberately does not forward `signal`. Resume path (`AgentManager.resume()`) has the same blind spot and is tracked as a follow-up.

## [0.6.3] - 2026-04-28

### Fixed
- **`run_in_background: true` (and `inherit_context`, `isolated`) silently ignored on default agents** ([#37](https://github.com/tintinweb/pi-subagents/issues/37) — thanks [@kylesnowschwartz](https://github.com/kylesnowschwartz) for the diagnosis). The three built-in defaults (`general-purpose`, `Explore`, `Plan`) baked `runInBackground: false`, `inheritContext: false`, and `isolated: false` into their configs. `resolveAgentInvocationConfig` uses `agentConfig?.field ?? params.field ?? false`, and `??` only falls through on `null`/`undefined` — so an explicit `false` from the agent config silently won over the caller's `true`. Calling `Agent({ subagent_type: "general-purpose", run_in_background: true })` returned the result inline instead of backgrounding, blocking the parent UI for the agent's full runtime. Fix drops the three lines from each default (and from the unreachable defensive fallback in `agent-runner.ts`) — the type already declared each as `field?: boolean` with JSDoc *"undefined = caller decides"*, so the runtime now matches the documented contract. **Behavior:** custom agents that explicitly set these fields in frontmatter still lock as before (the v0.5.1 "frontmatter is authoritative" guarantee is preserved); the fix only stops *defaults* from spuriously claiming an opinion on callsite-strategy fields they don't actually have. The unreachable fallback now spreads `DEFAULT_AGENTS.get("general-purpose")` instead of duplicating the config inline, so future drift is impossible.

## [0.6.2] - 2026-04-28

### Fixed
- **`Agent` tool fails on Windows with `ENOENT` creating output directory** ([#27](https://github.com/tintinweb/pi-subagents/issues/27) — thanks [@sixnathan](https://github.com/sixnathan) for the diagnosis). The cwd-encoding regex in `output-file.ts` only handled POSIX `/` separators, so on Windows `cwd = "C:\\Users\\foo\\project"` survived unchanged and `path.join(tmpRoot, encoded, …)` produced an invalid nested-absolute path. Now extracts a small `encodeCwd()` helper that handles both `/` and `\\` separators, strips the Windows drive-letter prefix, and preserves UNC server/share segments. The `chmodSync(root, 0o700)` call is also wrapped in a try/catch that swallows errors only on Windows (where chmod is a no-op and can throw on some filesystems); on Unix the error still propagates so umask-defeating `0o700` enforcement is preserved.

## [0.6.1] - 2026-04-25

### Added
- **Persistent `/agents` → Settings** ([#24](https://github.com/tintinweb/pi-subagents/issues/24)) — the four runtime tuning values (`maxConcurrent`, `defaultMaxTurns`, `graceTurns`, `defaultJoinMode`) now survive pi restarts via a two-file dual-scope model mirroring pi's own `SettingsManager`. Global `~/.pi/agent/subagents.json` provides machine-wide defaults (edit by hand; the menu never writes here); project `<cwd>/.pi/subagents.json` holds per-project overrides (written by `/agents` → Settings). Load merges both with project winning on conflicts. Invalid fields are silently dropped per field; malformed JSON emits a warning to stderr and falls back to defaults so startup always proceeds; write failures downgrade the settings toast to a warning with `(session only; failed to persist)` so changes aren't silently reverted on next restart.
- **New lifecycle events** — `subagents:settings_loaded` (emitted once at extension init with the merged settings) and `subagents:settings_changed` (emitted on each `/agents` → Settings mutation with the new snapshot and a `persisted: boolean` flag so listeners can react to write failures).

### Fixed
- **`AGENTS.md` / `CLAUDE.md` / `APPEND_SYSTEM.md` no longer leak into sub-agent prompts** ([#26](https://github.com/tintinweb/pi-subagents/pull/26) — thanks [@mikeyobrien](https://github.com/mikeyobrien) for the diagnosis). Upstream `buildSystemPrompt()` re-appends `contextFiles` and `appendSystemPrompt` *after* our `systemPromptOverride` runs, which silently defeated `prompt_mode: replace` and `isolated: true` — parent project context (e.g. autoresearch-mode blocks) was bleeding into fresh `Explore` / custom sub-agents regardless of frontmatter. Fix uses upstream's `noContextFiles: true` flag (skips the load entirely, introduced in pi 0.68) plus `appendSystemPromptOverride: () => []` (no flag equivalent for append sources). **Behavior change:** subagents no longer implicitly inherit parent `AGENTS.md`/`CLAUDE.md`/`APPEND_SYSTEM.md`. To get parent project context into a subagent, use `prompt_mode: append` (parent's already-built system prompt flows in via `systemPromptOverride`), or `inherit_context: true` (parent conversation), or inline the content into the agent's own frontmatter.
- **Custom agent discovery respects `PI_CODING_AGENT_DIR`** ([#35](https://github.com/tintinweb/pi-subagents/pull/35), closes [#23](https://github.com/tintinweb/pi-subagents/issues/23) — thanks [@Amolith](https://github.com/Amolith) for the diagnosis). Two remaining hardcoded `~/.pi/agent/agents/` paths in `custom-agents.ts` and `index.ts` bypassed the env var, so users who relocated their agent directory (e.g. via `PI_CODING_AGENT_DIR`) still had global agents loaded from the default location and help text referencing the wrong path. Both now use upstream `getAgentDir()`, consistent with `agent-runner.ts` and `settings.ts`; tilde expansion is handled by upstream.

## [0.6.0] - 2026-04-24

> **⚠️ Breaking: drops support for `pi` < 0.68.** The upstream `pi-coding-agent` package shipped breaking API changes in v0.68 (and further ones in v0.70). This release migrates to `^0.70.2` and is **not** backward-compatible with hosts on `pi` 0.62–0.67. Users on those versions must upgrade their `pi` installation (`npm install -g @mariozechner/pi-coding-agent@latest`) before updating this extension.

### Changed
- **Bumped peer `@mariozechner/pi-coding-agent` to `^0.70.2`** ([#28](https://github.com/tintinweb/pi-subagents/pull/28)) — crosses the v0.68 breaking-change line upstream. Specifically: tools are now passed as `string[]` (was `Tool[]`); `cwd`/`agentDir` are mandatory on `SettingsManager.create()` and `DefaultResourceLoader`; `session_switch` event renamed to `session_before_switch`; `ToolDefinition.params` widens to `unknown` under contextual typing, requiring `defineTool(...)`.
- **Tool registrations wrapped with `defineTool(...)`** — preserves `TParams` inference so `execute` handlers get properly-typed `params` instead of `unknown`. Applies to the `Agent`, `get_subagent_result`, and `steer_subagent` tools.

### Removed
- **Cwd-bound tool factory registry** — the internal `TOOL_FACTORIES` closure table and `create{Bash,Edit,Read,Write,Grep,Find,Ls}Tool` imports are gone. Exported helpers renamed: `getToolsForType(type, cwd)` → `getToolNamesForType(type)`, `getMemoryTools(cwd, set)` → `getMemoryToolNames(set)`, `getReadOnlyMemoryTools(cwd, set)` → `getReadOnlyMemoryToolNames(set)` — all returning `string[]` instead of `Tool[]`. The host binds cwd when resolving tool names, so the extension no longer instantiates tools directly.

### Fixed
- **Subagent `SettingsManager` read wrong project settings in worktree mode** ([#30](https://github.com/tintinweb/pi-subagents/pull/30)) — `SettingsManager.create()` was called without arguments, defaulting `cwd` to `process.cwd()`. When the subagent's effective cwd differed (worktree isolation or explicit `cwd` override), its settings manager read `.pi/settings.json` from the parent's cwd rather than its own, diverging from the loader and session manager. Now passes `effectiveCwd` and `agentDir` explicitly, keeping all three managers consistent.

## [0.5.2] - 2026-03-26

### Fixed
- **Extension `session_start` handlers now fire in subagent sessions** ([#20](https://github.com/tintinweb/pi-subagents/issues/20)) — `bindExtensions()` was never called on subagent sessions, so extensions that initialize state in `session_start` (e.g. loading credentials, setting up connections) silently failed at runtime. Tools appeared registered but were non-functional. Now calls `session.bindExtensions()` after tool filtering and before prompting, matching the lifecycle used by pi's interactive, print, and RPC modes. Also triggers `extendResourcesFromExtensions("startup")` so extension-provided skills and prompts are discovered.

## [0.5.1] - 2026-03-24

### Changed
- **Agent config is authoritative** — frontmatter values for `model`, `thinking`, `max_turns`, `inherit_context`, `run_in_background`, `isolated`, and `isolation` now take precedence over `Agent` tool-call parameters. Tool-call params only fill fields the agent config leaves unspecified.
- **`join_mode` is now a global setting only** — removed the per-call `join_mode` parameter from the `Agent` tool. Join behavior is configured via `/agents` → Settings → Join mode.
- **`max_turns: 0` means unlimited** — agent files can now explicitly set `max_turns: 0` to lock unlimited turns. Previously `0` was silently clamped to `1`.

### Fixed
- **Final subagent text preserved from non-streaming providers** — agents using providers that return the final message without streaming `text_delta` events no longer return empty results. Falls back to extracting text from the completed session history.
- **`effectiveMaxTurns` passed to spawn calls** — previously `params.max_turns` was passed raw to both foreground and background spawn, bypassing the agent config entirely.

## [0.5.0] - 2026-03-22

### Added
- **RPC stop handler** — new `subagents:rpc:stop` event bus RPC allows other extensions to stop running subagents by agent ID. Returns structured error ("Agent not found") on failure.
- **`abort` in `SpawnCapable` interface** — cross-extension RPC consumers can now stop agents, not just spawn them.
- **Live turn counter** — all agents now show a live turn count in the widget, inline result, and completion notification. With a turn limit: `⟳5≤30` (5 of 30 turns). Without: `⟳5`. Updates in real time as turns progress via `onTurnEnd` callback.
- **Biome linting** — added [Biome](https://biomejs.dev/) for correctness linting (unused imports, suspicious patterns). Style rules disabled. Run `npm run lint` to check, `npm run lint:fix` to auto-fix.
- **CI workflow** — GitHub Actions runs lint, typecheck, and tests on push to master and PRs.
- **Auto-trigger parent turn on background completion** — background agent completion notifications now use `triggerTurn: true`, automatically prompting the parent agent to process results instead of waiting for user input.

### Changed
- **Standardized RPC envelope** — cross-extension RPC handlers (`ping`, `spawn`, `stop`) now use a `handleRpc` wrapper that emits structured envelopes (`{ success: true, data }` / `{ success: false, error }`), matching pi-mono's `RpcResponse` convention.
- **Protocol versioning via ping** — ping reply now includes `{ version: PROTOCOL_VERSION }` (currently v2). Callers can detect version mismatches and warn users to update.
- **Default max turns is now unlimited** — subagents no longer have a 50-turn default cap. The default is unlimited (no turn limit), matching Claude Code's main loop behavior. Users can still set explicit limits per-agent via `max_turns` frontmatter or the Agent tool parameter, or globally via `/agents` → Settings (`0` = unlimited).
- **Stale dist in published package** — added `prepublishOnly` hook to build fresh `dist/` on every `npm publish`.

### Fixed
- **Tool name display** — `getAgentConversation` now reads `ToolCall.name` (the correct property) instead of `toolName`, resolving `[Tool: unknown]` in conversation viewer and verbose output.
- **Env test CI failure** — `detectEnv` test assumed a branch name exists, but CI checks out detached HEAD. Split into separate tests for repo detection and branch detection with a controlled temp repo.

## [0.4.9] - 2026-03-18

### Fixed
- **Conversation viewer crash in narrow terminals** ([#7](https://github.com/tintinweb/pi-subagents/issues/7)) — `buildContentLines()` in the live conversation viewer could return lines wider than the terminal when `wrapTextWithAnsi()` misjudged visible width on ANSI-heavy input (e.g. tool output with embedded escape codes, long URLs, wide tables). All content lines are now clamped with `truncateToWidth()` before returning. Same class of bug as the widget fix in v0.2.7, different component.

### Added
- **Conversation viewer width-safety tests** — 17 tests covering `render()` and `buildContentLines()` across varied content (plain text, ANSI codes, unicode, tables, long URLs, narrow terminals). Includes mock-based regression tests that simulate upstream `wrapTextWithAnsi` returning overwidth lines, ensuring the safety net catches them.

## [0.4.8] - 2026-03-18

### Added
- **Cross-extension RPC** — other pi extensions can spawn subagents via `pi.events` event bus (`subagents:rpc:ping`, `subagents:rpc:spawn`). Emits `subagents:ready` on load.
- **Session persistence for agent records** — completed agent records are persisted via `pi.appendEntry("subagents:record", ...)` for cross-extension history reconstruction.

### Fixed
- **Background agent notification race condition** — `pi.sendMessage()` is fire-and-forget, so completion notifications sent eagerly from `onComplete` could not be retracted when `get_subagent_result` was called in the same turn. Notifications are now held behind a 200ms cancellable timer; `get_subagent_result` cancels the pending timer before it fires, eliminating duplicate notifications. Group notifications also re-check `resultConsumed` at send time so consumed agents are filtered out.

## [0.4.7] - 2026-03-17

### Added
- **Custom notification renderer** — background agent completion notifications now render as styled, themed boxes instead of raw XML. Uses `pi.registerMessageRenderer()` with the `"subagent-notification"` custom message type. The LLM continues to receive `<task-notification>` XML via `content`; only the user-facing display changes.
- **Group notification rendering** — group completions render each agent as its own styled block (icon, description, stats, result preview) instead of showing only the first agent.
- **Output file streaming for background agents** — background agents now get the same output file transcript as foreground agents, with `onSessionCreated` wiring and proper cleanup on completion/error.
- `NotificationDetails` type in `types.ts` — structured details for the notification renderer, with optional `others` array for group notifications.
- `buildNotificationDetails()` helper — extracts renderer-facing details from an `AgentRecord`.

### Changed
- **Notification delivery** — `sendIndividualNudge` and group notification now use `pi.sendMessage()` (custom message) instead of `pi.sendUserMessage()` (plain text), enabling renderer-controlled display.
- **Steered status rendering** — steered agents show "completed (steered)" in the notification box instead of plain "completed".

### Fixed
- **Output file cleanup on completion** — `agent-manager.ts` now calls `record.outputCleanup()` in both the success and error paths of agent completion, ensuring the streaming subscription is flushed and released.

## [0.4.6] - 2026-03-16

### Fixed
- **Graceful shutdown aborts agents instead of blocking** — `session_shutdown` now calls `abortAll()` instead of `waitForAll()`, so the process exits immediately instead of hanging until all background agents complete. Agent results are undeliverable after shutdown anyway.

### Added
- `abortAll()` method on `AgentManager` — stops all queued and running agents at once, returning the count of affected agents.

## [0.4.5] - 2026-03-16

### Changed
- **Widget render-once pattern** — the widget callback is now registered once via `setWidget()` and subsequent updates use `requestRender()` instead of re-registering the entire widget on every `update()` call. Eliminates layout thrashing from repeated widget teardown/setup cycles.
- **Status bar dedup** — `setStatus()` is now only called when the status text actually changes, avoiding redundant TUI updates.
- **UICtx change detection** — `setUICtx()` detects context changes and forces widget re-registration, correctly handling session switches.

### Refactored
- Extracted `renderWidget()` private method — moves all widget content rendering out of the `update()` closure into a standalone method that reads live state on each call.
- `update()` is now a lightweight coordinator: counts agents, manages registration lifecycle, and triggers re-renders.

## [0.4.4] - 2026-03-16

### Fixed
- **Race condition in `get_subagent_result` with `wait: true`** — `resultConsumed` is now set before `await record.promise`, preventing a redundant follow-up notification. Previously the `onComplete` callback (attached at spawn time via `.then()`) always fired before the await resumed, seeing `resultConsumed` as false.
- **Stale agent records across sessions** — new `clearCompleted()` method removes all completed/stopped/errored agent records on `session_start` and `session_switch` events, so tasks from a prior session don't persist into a new one.
- **`steer_subagent` race on freshly launched agents** — steering an agent before its session initialized silently dropped the message. Now steers are queued on the record and flushed once `onSessionCreated` fires.

### Changed
- Extracted `removeRecord()` private helper in `AgentManager` — deduplicates dispose+delete logic between `cleanup()` and `clearCompleted()`.

### Added
- 8 new tests covering `resultConsumed` race condition and `clearCompleted` behavior (185 total).

## [0.4.3] - 2026-03-13

### Added
- **Persistent agent memory** — new `memory` frontmatter field with three scopes: `"user"` (global `~/.pi/`), `"project"` (per-project `.pi/`), `"local"` (gitignored `.pi/`). Agents with write/edit tools get full read-write memory; read-only agents get a read-only fallback that injects existing MEMORY.md content without granting write access or creating directories.
- **Git worktree isolation** — new `isolation: "worktree"` frontmatter field and Agent tool parameter. Creates a temporary `git worktree` so agents work on an isolated copy of the repo. On completion, changes are auto-committed to a `pi-agent-<id>` branch; clean worktrees are removed. Includes crash recovery via `pruneWorktrees()`.
- **Skill preloading** — `skills` frontmatter now accepts a comma-separated list of skill names (e.g. `skills: planning, review`). Reads from `.pi/skills/` (project) then `~/.pi/skills/` (global), tries `.md`/`.txt`/bare extensions. Content injected into the system prompt as `# Preloaded Skill: {name}`.
- **Tool denylist** — new `disallowed_tools` frontmatter field (e.g. `disallowed_tools: bash, write`). Blocks specified tools even if `builtinToolNames` or extensions would provide them. Enforced for both extension-enabled and extension-disabled agents.
- **Prompt extras system** — new `PromptExtras` interface in `prompts.ts`; `buildAgentPrompt()` accepts optional memory and skill blocks appended in both `replace` and `append` modes.
- `getMemoryTools()`, `getReadOnlyMemoryTools()` in `agent-types.ts`.
- `buildMemoryBlock()`, `buildReadOnlyMemoryBlock()`, `isSymlink()`, `safeReadFile()` in `memory.ts`.
- `preloadSkills()` in `skill-loader.ts`.
- `createWorktree()`, `cleanupWorktree()`, `pruneWorktrees()` in `worktree.ts`.
- `MemoryScope`, `IsolationMode` types; `memory`, `isolation`, `disallowedTools` fields on `AgentConfig`; `worktree`, `worktreeResult` fields on `AgentRecord`.
- 177 total tests across 8 test files (41 new tests).

### Fixed
- **Read-only agents no longer escalated to read-write** — enabling `memory` on a read-only agent (e.g. Explore) previously auto-added `write`/`edit` tools. Now the runner detects write capability and branches: read-write agents get full memory tools, read-only agents get read-only memory prompt with only the `read` tool added.
- **Denylist-aware memory detection** — write capability check now accounts for `disallowedTools`. An agent with `tools: write` + `disallowed_tools: write` correctly gets read-only memory instead of broken read-write instructions.
- **Worktree requires commits** — repos with no commits (empty HEAD) are now rejected early with a warning instead of failing silently at `git worktree add`.
- **Worktree failure warning** — when worktree creation fails, a warning is prepended to the agent's prompt instead of silently falling through to the main cwd.
- **No force-branch overwrite** — worktree cleanup appends a timestamp suffix on branch name conflict instead of using `git branch -f`.

### Security
- **Whitelist name validation** — agent/skill names must match `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`, max 128 chars. Rejects path traversal, leading dots, spaces, and special characters.
- **Symlink protection** — `safeReadFile()` and `isSymlink()` reject symlinks in memory directories, MEMORY.md files, and skill files, preventing arbitrary file reads.
- **Symlink-safe directory creation** — `ensureMemoryDir()` throws on symlinked directories.

### Changed
- `agent-runner.ts`: tool/extension/skill resolution moved before memory detection; `ctx.cwd` → `effectiveCwd` throughout.
- `custom-agents.ts`: extracted `parseCsvField()` helper; added `csvListOptional()` and `parseMemory()`.
- `skill-loader.ts`: uses `safeReadFile()` from `memory.ts` instead of raw `readFileSync`.
- Agent tool schema updated with `isolation` parameter and help text for `memory`, `isolation`, `disallowed_tools`, and skill list.

## [0.4.2] - 2026-03-12

### Added
- **Event bus** — agent lifecycle events emitted via `pi.events.emit()`, enabling other extensions to react to sub-agent activity:
  - `subagents:created` — background agent registered (includes `id`, `type`, `description`, `isBackground`)
  - `subagents:started` — agent transitions to running (includes queued→running)
  - `subagents:completed` — agent finished successfully (includes `durationMs`, `tokens`, `toolUses`, `result`)
  - `subagents:failed` — agent errored, stopped, or aborted (same payload as completed)
  - `subagents:steered` — steering message sent to a running agent
- `OnAgentStart` callback and `onStart` constructor parameter on `AgentManager`.
- **Cross-package manager** now also exposes `spawn()` and `getRecord()` via the `Symbol.for("pi-subagents:manager")` global.

## [0.4.1] - 2026-03-11

### Fixed
- **Graceful shutdown in headless mode** — the CLI now waits for all running and queued background agents to complete before exiting (`waitForAll` on `session_shutdown`). Previously, background agents could be silently killed mid-execution when the session ended. Only affects headless/non-interactive mode; interactive sessions already kept the process alive.

### Added
- `hasRunning()` / `waitForAll()` methods on `AgentManager`.
- **Cross-package manager access** — agent manager exposed via `Symbol.for("pi-subagents:manager")` on `globalThis` for other extensions to check status or await completion.

## [0.4.0] - 2026-03-11

### Added
- **XML-delimited prompt sections** — append-mode agents now wrap inherited content in `<inherited_system_prompt>`, `<sub_agent_context>`, and `<agent_instructions>` XML tags, giving the model explicit structure to distinguish inherited rules from sub-agent-specific instructions. Replace mode is unchanged.
- **Token count in agent results** — foreground agent results, background completion notifications, and `get_subagent_result` now include the token count alongside tool uses and duration (e.g. `Agent completed in 4.2s (12 tool uses, 33.8k token)`).
- **Widget overflow cap** — the running agents widget now caps at 12 lines. When exceeded, running agents are prioritized over finished ones and an overflow summary line shows hidden counts (e.g. `+3 more (1 running, 2 finished)`).

### Changed - **changing behavior**
- **General-purpose agent inherits parent prompt** — the default `general-purpose` agent now uses `promptMode: "append"` with an empty system prompt, making it a "parent twin" that inherits the full parent system prompt (including CLAUDE.md rules, project conventions, and safety guardrails). Previously it used a standalone prompt that duplicated a subset of the parent's rules. Explore and Plan are unchanged (standalone prompts). To customize: eject via `/agents` → select `general-purpose` → Eject, then edit the resulting `.md` file. Set `prompt_mode: replace` to go back to a standalone prompt, or keep `prompt_mode: append` and add extra instructions in the body.
- **Append-mode agents receive parent system prompt** — `buildAgentPrompt` now accepts the parent's system prompt and threads it into append-mode agents (env header + parent prompt + sub-agent context bridge + optional custom instructions). Replace-mode agents are unchanged.
- **Prompt pipeline simplified** — removed `systemPromptOverride`/`systemPromptAppend` from `SpawnOptions` and `RunOptions`. These were a separate code path where `index.ts` pre-resolved the prompt mode and passed raw strings into the runner, bypassing `buildAgentPrompt`. Now all prompt assembly flows through `buildAgentPrompt` using the agent's `promptMode` config — one code path, no special cases.

### Removed
- Deprecated backwards-compat aliases: `registerCustomAgents`, `getCustomAgentConfig`, `getCustomAgentNames` (use `registerAgents`, `getAgentConfig`, `getUserAgentNames`).
- `resolveCustomPrompt()` helper in index.ts — no longer needed now that prompt routing is config-driven.

## [0.3.1] - 2026-03-09

### Added
- **Live conversation viewer** — selecting a running (or completed) agent in `/agents` → "Running agents" now opens a scrollable overlay showing the agent's full conversation in real time. Auto-scrolls to follow new content; scroll up to pause, End to resume. Press Esc to close.

## [0.3.0] - 2026-03-08

### Added
- **Case-insensitive agent type lookup** — `"explore"`, `"EXPLORE"`, and `"Explore"` all resolve to the same agent. LLMs frequently lowercase type names; this prevents validation failures.
- **Unknown type fallback** — unrecognized agent types fall back to `general-purpose` with a note, instead of hard-rejecting. Matches Claude Code behavior.
- **Dynamic tool list for general-purpose** — `builtinToolNames` is now optional in `AgentConfig`. When omitted, the agent gets all tools from `TOOL_FACTORIES` at lookup time, so new tools added upstream are automatically available.
- **Agent source indicators in `/agents` menu** — `•` (project), `◦` (global), `✕` (disabled) with legend. Defaults are unmarked.
- **Disabled agents visible in UI** — disabled agents now show in the "Agent types" list (marked `✕`) with an Enable action, instead of being invisible.
- **Enable action** — re-enable a disabled agent from the `/agents` menu. Stub files are auto-cleaned.
- **Disable action for all agent types** — custom and ejected default agents can now be disabled from the UI, not just built-in defaults.
- `resolveType()` export — case-insensitive type name resolution for external use.
- `getAllTypes()` export — returns all agent names including disabled (for UI listing).
- `source` field on `AgentConfig` — tracks where an agent was loaded from (`"default"`, `"project"`, `"global"`).

### Fixed
- **Model resolver checks auth for exact matches** — `resolveModel("anthropic/claude-haiku-4-5-20251001")` now fails gracefully when no Anthropic API key is configured, instead of returning a model that errors at the API call. Explore silently falls back to the parent model on non-Anthropic setups.

### Changed
- **Unified agent registry** — built-in and custom agents now use the same `AgentConfig` type and a single registry. No more separate code paths for built-in vs custom agents.
- **Default agents are overridable** — creating a `.md` file with the same name as a default agent (e.g. `.pi/agents/Explore.md`) overrides it.
- **`/agents` menu** — "Agent types" list shows defaults and custom agents together with source indicators. Default agents get Eject/Disable actions; overridden defaults get Reset to default.
- **Eject action** — export a default agent's embedded config as a `.md` file to project or personal location for customization.
- **Model labels** — provider-agnostic: strips `provider/` prefix and `-YYYYMMDD` date suffix (e.g. `anthropic/claude-haiku-4-5-20251001` → `claude-haiku-4-5`). Works for any provider.
- **New frontmatter fields** — `display_name` (UI display name) and `enabled` (default: true; set to false to disable).
- **Menu navigation** — Esc in agent detail returns to agent list (not main menu).

### Removed
- **`statusline-setup` and `claude-code-guide` agents** — removed as built-in types (never spawned programmatically). Users can recreate them as custom agents if needed.
- `BuiltinSubagentType` union type, `SUBAGENT_TYPES` array, `DISPLAY_NAMES` map, `SubagentTypeConfig` interface — replaced by unified `AgentConfig`.
- `buildSystemPrompt()` switch statement — replaced by config-driven `buildAgentPrompt()`.
- `HAIKU_MODEL_IDS` fallback array — Explore's haiku default is now just the `model` field in its config.
- `BUILTIN_MODEL_LABELS` — model labels now derived from config.
- `ALL_TOOLS` hardcoded constant — general-purpose now derives tools dynamically.

### Added
- `src/default-agents.ts` — embedded default configs for general-purpose, Explore, and Plan.

## [0.2.7] - 2026-03-08

### Fixed
- **Widget crash in narrow terminals** — agent widget lines were not truncated to terminal width, causing `doRender` to throw when the tmux pane was narrower than the rendered content. All widget lines are now truncated using `truncateToWidth()` with the actual terminal column count.

## [0.2.6] - 2026-03-07

### Added
- **Background task join strategies** — smart grouping of background agent completion notifications
  - `smart` (default): 2+ background agents spawned in the same turn are auto-grouped into a single consolidated notification instead of individual nudges
  - `async`: each agent notifies individually on completion (previous behavior)
  - `group`: force grouping even for solo agents
  - 30s timeout after first completion delivers partial results; 15s straggler re-batch window for remaining agents
- **`join_mode` parameter** on the `Agent` tool — override join strategy per agent (`"async"` or `"group"`)
- **Join mode setting** in `/agents` → Settings — configure the default join mode at runtime
- New `src/group-join.ts` — `GroupJoinManager` class for batched completion notifications

### Changed
- `AgentRecord` now includes optional `groupId`, `joinMode`, and `resultConsumed` fields
- Background agent completion routing refactored: individual nudge logic extracted to `sendIndividualNudge()`, group delivery via `GroupJoinManager`

### Fixed
- **Debounce window race** — agents that complete during the 100ms batch debounce window are now deferred and retroactively fed into the group once it's registered, preventing split notifications (one individual + one partial group) and zombie groups
- **Solo agent swallowed notification** — if only one agent was spawned (no group formed) but it completed during the debounce window, its deferred notification is now sent when the batch finalizes
- **Duplicate notifications after polling** — calling `get_subagent_result` on a completed agent now marks its result as consumed, suppressing the subsequent completion notification (both individual and group)

## [0.2.5] - 2026-03-06

### Added
- **Interactive `/agents` menu** — single command replaces `/agent` and `/agents` with a full management wizard
  - Browse and manage running agents
  - Custom agents submenu — edit or delete existing agents
  - Create new custom agents via manual wizard or AI-generated (with comprehensive frontmatter documentation for the generator)
  - Settings: configure max concurrency, default max turns, and grace turns at runtime
  - Built-in agent types shown with model info (e.g. `Explore · haiku`)
  - Aligned formatting for agent lists
- **Configurable turn limits** — `defaultMaxTurns` and `graceTurns` are now runtime-adjustable via `/agents` → Settings
- Sub-menus return to main menu instead of exiting

### Removed
- `/agent <type> <prompt>` command (use `Agent` tool directly, or create custom agents via `/agents`)

## [0.2.4] - 2026-03-06

### Added
- **Global custom agents** — agents in `~/.pi/agent/agents/*.md` are now discovered automatically and available across all projects
- Two-tier discovery hierarchy: project-level (`.pi/agents/`) overrides global (`~/.pi/agent/agents/`)

## [0.2.3] - 2026-03-05

### Added
- Screenshot in README

## [0.2.2] - 2026-03-05

### Changed
- Renamed package to `@tintinweb/pi-subagents`
- Fuzzy model resolver now only matches models with auth configured (prevents selecting unconfigured providers)
- Custom agents hot-reload on each `Agent` tool call (no restart needed for new `.pi/agents/*.md` files)
- Updated pi dependencies to 0.56.1

### Refactored
- Extracted `createActivityTracker()` — eliminates duplicated tool activity wiring between foreground and background paths
- Extracted `safeFormatTokens()` — replaces 4 repeated try-catch blocks
- Extracted `buildDetails()` — consolidates AgentDetails construction
- Extracted `getStatusLabel()` / `getStatusNote()` — consolidates 3 duplicated status formatting chains
- Shared `extractText()` — consolidated duplicate from context.ts and agent-runner.ts
- Added `ERROR_STATUSES` constant in widget for consistent status checks
- `getDisplayName()` now delegates to `getConfig()` instead of separate lookups
- Removed unused `Tool` type export from agent-types

## [0.2.1] - 2026-03-05

### Added
- **Persistent above-editor widget** — tree view of all running/queued/finished agents with animated spinners and live stats
- **Concurrency queue** — configurable max concurrent background agents (default: 4), auto-drain
- **Queued agents** collapsed to single summary line in widget
- **Turn-based widget linger** — completed agents clear after 1 turn, errors/aborted linger for 2 extra turns
- **Colored status icons** — themed rendering via `setWidget` callback form (`✓` green, `✓` yellow, `✗` red, `■` dim)
- **Live response streaming** — `onTextDelta` shows truncated agent response text instead of static "thinking..."

### Changed
- Tool names match Claude Code: `Agent`, `get_subagent_result`, `steer_subagent`
- Labels use "Agent" / "Agents" (not "Subagent")
- Widget heading: `●` when active, `○` when only lingering finished agents
- Extracted all UI code to `src/ui/agent-widget.ts`

## [0.2.0] - 2026-03-05

### Added
- **Claude Code-style UI rendering** — `renderCall`/`renderResult`/`onUpdate` for live streaming progress
  - Live activity descriptions: "searching, reading 3 files…"
  - Token count display: "33.8k token"
  - Per-agent tool use counter
  - Expandable completed results (ctrl+o)
  - Distinct states: running, background, completed, error, aborted
- **Async environment detection** — replaced `execSync` with `pi.exec()` for non-blocking git/platform detection
- **Status bar integration** — running background agent count shown in pi's status bar
- **Fuzzy model selection** — `"haiku"`, `"sonnet"` resolve to best matching available model

### Changed
- Tool label changed from "Spawn Agent" to "Agent" (matches Claude Code style)
- `onToolUse` callback replaced with richer `onToolActivity` (includes tool name + start/end)
- `onSessionCreated` callback for accessing session stats (token counts)
- `env.ts` now requires `ExtensionAPI` parameter (async `pi.exec()` instead of `execSync`)

## [0.1.0] - 2026-03-05

Initial release.

### Added
- **Autonomous sub-agents** — spawn specialized agents via tool call, each running in an isolated pi session
- **Built-in agent types** — general-purpose, Explore (defaults to haiku), Plan, statusline-setup, claude-code-guide
- **Custom user-defined agents** — define agents in `.pi/agents/<name>.md` with YAML frontmatter + system prompt body
- **Frontmatter configuration** — tools, extensions, skills, model, thinking, max_turns, prompt_mode, inherit_context, run_in_background, isolated
- **Graceful max_turns** — steer message at limit, 5 grace turns, then hard abort
- **Background execution** — `run_in_background` with completion notifications
- **`get_subagent_result` tool** — check status, wait for completion, verbose conversation output
- **`steer_subagent` tool** — inject steering messages into running agents mid-execution
- **Agent resume** — continue a previous agent's session with a new prompt
- **Context inheritance** — fork the parent conversation into the sub-agent
- **Model override** — per-agent model selection
- **Thinking level** — per-agent extended thinking control
- **`/agent` and `/agents` commands**

[0.6.3]: https://github.com/tintinweb/pi-subagents/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/tintinweb/pi-subagents/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/tintinweb/pi-subagents/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/tintinweb/pi-subagents/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/tintinweb/pi-subagents/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/tintinweb/pi-subagents/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/tintinweb/pi-subagents/compare/v0.4.9...v0.5.0
[0.4.9]: https://github.com/tintinweb/pi-subagents/compare/v0.4.8...v0.4.9
[0.4.8]: https://github.com/tintinweb/pi-subagents/compare/v0.4.7...v0.4.8
[0.4.7]: https://github.com/tintinweb/pi-subagents/compare/v0.4.6...v0.4.7
[0.4.6]: https://github.com/tintinweb/pi-subagents/compare/v0.4.5...v0.4.6
[0.4.5]: https://github.com/tintinweb/pi-subagents/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/tintinweb/pi-subagents/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/tintinweb/pi-subagents/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/tintinweb/pi-subagents/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/tintinweb/pi-subagents/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/tintinweb/pi-subagents/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/tintinweb/pi-subagents/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/tintinweb/pi-subagents/compare/v0.2.7...v0.3.0
[0.2.7]: https://github.com/tintinweb/pi-subagents/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/tintinweb/pi-subagents/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/tintinweb/pi-subagents/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/tintinweb/pi-subagents/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/tintinweb/pi-subagents/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/tintinweb/pi-subagents/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/tintinweb/pi-subagents/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/tintinweb/pi-subagents/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/tintinweb/pi-subagents/releases/tag/v0.1.0
