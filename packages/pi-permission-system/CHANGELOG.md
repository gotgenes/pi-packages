# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [15.1.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v15.0.1...pi-permission-system-v15.1.0) (2026-06-20)


### Features

* **pi-permission-system:** trace tool-call decisions and emit a session summary ([#452](https://github.com/gotgenes/pi-packages/issues/452)) ([528e340](https://github.com/gotgenes/pi-packages/commit/528e340ae38a6b2f431dac1ab92642c1af72c0ac))
* **pi-permission-system:** warn when a permissive top-level "*" leaves bash ungated ([#452](https://github.com/gotgenes/pi-packages/issues/452)) ([8ef8d0f](https://github.com/gotgenes/pi-packages/commit/8ef8d0fdf39297817c57968f0e345d79c6369d3a))


### Bug Fixes

* **pi-permission-system:** prompt instead of allowing an unparseable bash command ([#452](https://github.com/gotgenes/pi-packages/issues/452)) ([538bac1](https://github.com/gotgenes/pi-packages/commit/538bac12e343d613f2e980dabb516a880b90f3fe))
* **pi-permission-system:** retry tree-sitter parser init instead of caching a rejected promise ([#452](https://github.com/gotgenes/pi-packages/issues/452)) ([468facd](https://github.com/gotgenes/pi-packages/commit/468facd50e9f9ee986121f76546c368851b14edb))


### Documentation

* **pi-permission-system:** document fail-closed gate behavior and bash fallback warning ([#452](https://github.com/gotgenes/pi-packages/issues/452)) ([fbb2844](https://github.com/gotgenes/pi-packages/commit/fbb28449afe9d92934769499d874c1cb93241c1b))

## [15.0.1](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v15.0.0...pi-permission-system-v15.0.1) (2026-06-20)


### Bug Fixes

* **permission-system:** bind session approval for current-directory files ([#438](https://github.com/gotgenes/pi-packages/issues/438)) ([083a8e8](https://github.com/gotgenes/pi-packages/commit/083a8e8d9c2a4f6c49af158677d8669b4f099d9f))

## [15.0.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v14.0.1...pi-permission-system-v15.0.0) (2026-06-20)


### ⚠ BREAKING CHANGES

* the wire system prompt now lists the active tools (narrowed to the permission-allowed set) in the `Available tools:` section. Previously the permission system removed that section entirely, so the model saw no tool listing. Sessions that relied on the empty-listing behavior will now see the narrowed listing.

### Bug Fixes

* narrow the Available tools section to the active set instead of stripping it ([#437](https://github.com/gotgenes/pi-packages/issues/437)) ([dc0b97d](https://github.com/gotgenes/pi-packages/commit/dc0b97d7571d6f3a5cf0b0e15172f0d2d92b050a))


### Documentation

* describe Available-tools narrowing and drop the prompt-cache module ([#437](https://github.com/gotgenes/pi-packages/issues/437)) ([4112057](https://github.com/gotgenes/pi-packages/commit/411205711c5574aebb7add9edf9e035d21614946))

## [14.0.1](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v14.0.0...pi-permission-system-v14.0.1) (2026-06-19)


### Bug Fixes

* **pi-permission-system:** strip shell comment lines from bash commands before matching ([d045591](https://github.com/gotgenes/pi-packages/commit/d0455915d6d4ce50534884639e516a9e1ef38976))

## [14.0.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v13.2.0...pi-permission-system-v14.0.0) (2026-06-17)


### ⚠ BREAKING CHANGES

* project agents' `permission:` frontmatter at `<cwd>/.pi/agents/<name>.md` is now read and enforced. Previously the wrong directory (`<cwd>/.pi/agent/agents`) was checked and the frontmatter was silently ignored, so a session may become more restrictive on upgrade.

### Bug Fixes

* correct project agents directory path to &lt;cwd&gt;/.pi/agents ([#428](https://github.com/gotgenes/pi-packages/issues/428)) ([eb5af78](https://github.com/gotgenes/pi-packages/commit/eb5af78193fa3cc574da6b8d80efd643ebce0ef9))


### Documentation

* correct project agent override path to &lt;cwd&gt;/.pi/agents ([#428](https://github.com/gotgenes/pi-packages/issues/428)) ([d193d6a](https://github.com/gotgenes/pi-packages/commit/d193d6a61155fb4e4a064800509cdbbd84b0ceb9))
* fix stale project agents path in troubleshooting and ADR-0001 ([#428](https://github.com/gotgenes/pi-packages/issues/428)) ([95effeb](https://github.com/gotgenes/pi-packages/commit/95effebfd0b2e87db4512c91adc134b2470f26a3))

## [13.2.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v13.1.2...pi-permission-system-v13.2.0) (2026-06-17)


### Features

* **pi-permission-system:** add external-directory typed+resolved policy aliases ([#418](https://github.com/gotgenes/pi-packages/issues/418)) ([ae653d1](https://github.com/gotgenes/pi-packages/commit/ae653d11fa52403cc5a78cd0148bc102de923d3c))


### Bug Fixes

* **pi-permission-system:** match external_directory patterns against typed and resolved paths ([#418](https://github.com/gotgenes/pi-packages/issues/418)) ([d08e645](https://github.com/gotgenes/pi-packages/commit/d08e64509d980c818708ecd2b7152ba6fc05946d))


### Documentation

* **pi-permission-system:** document external_directory symlink alias matching ([#418](https://github.com/gotgenes/pi-packages/issues/418)) ([8760273](https://github.com/gotgenes/pi-packages/commit/876027313457591ab5f175c689aa3074143db388))

## [13.1.2](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v13.1.1...pi-permission-system-v13.1.2) (2026-06-16)


### Documentation

* **pi-permission-system:** clarify external_directory surface in README ([#413](https://github.com/gotgenes/pi-packages/issues/413)) ([c09929b](https://github.com/gotgenes/pi-packages/commit/c09929be209050c1f85e9e01dbb231f99e940f82))
* **pi-permission-system:** document external_directory allow-list for outside-CWD caches ([#413](https://github.com/gotgenes/pi-packages/issues/413)) ([86b1d87](https://github.com/gotgenes/pi-packages/commit/86b1d87ff92e63c26d3f81ddb41aad7aab085074))
* **pi-permission-system:** show external_directory allow-list in example config and schema ([#413](https://github.com/gotgenes/pi-packages/issues/413)) ([8178a7e](https://github.com/gotgenes/pi-packages/commit/8178a7ebc3237e188b8e492d5c3a8bfca9b197aa))

## [13.1.1](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v13.1.0...pi-permission-system-v13.1.1) (2026-06-13)


### Bug Fixes

* preserve forwarded-permission responses dir while requests pending ([#398](https://github.com/gotgenes/pi-packages/issues/398)) ([9914e70](https://github.com/gotgenes/pi-packages/commit/9914e7093c5addee80bd39f2ff99211991b4a238))
* recreate forwarded-permission responses dir before write ([#398](https://github.com/gotgenes/pi-packages/issues/398)) ([67d34ef](https://github.com/gotgenes/pi-packages/commit/67d34efb33dbda28f363a004d0945c2a4aacea29))

## [13.1.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v13.0.0...pi-permission-system-v13.1.0) (2026-06-13)


### Features

* **pi-permission-system:** add DenyWithReason type and shared guard ([51750e1](https://github.com/gotgenes/pi-packages/commit/51750e188592520798eaf9676a15a709a779cf96)), closes [#395](https://github.com/gotgenes/pi-packages/issues/395)
* **pi-permission-system:** append custom reason to denial messages ([d8e5756](https://github.com/gotgenes/pi-packages/commit/d8e575632678b806d381f1436dbb06197d742104)), closes [#395](https://github.com/gotgenes/pi-packages/issues/395)
* **pi-permission-system:** build deny rules with reason in normalizeFlatConfig ([186c15a](https://github.com/gotgenes/pi-packages/commit/186c15a74944bc2800bcea738984021169fabc8d)), closes [#395](https://github.com/gotgenes/pi-packages/issues/395)
* **pi-permission-system:** preserve deny-with-reason from JSON config ([3201bfd](https://github.com/gotgenes/pi-packages/commit/3201bfd55d68aac1ee87ac452723f6d0783dba6d)), closes [#395](https://github.com/gotgenes/pi-packages/issues/395)
* **pi-permission-system:** thread deny reason into PermissionCheckResult ([ed712e4](https://github.com/gotgenes/pi-packages/commit/ed712e47458a662e3d1159e2f5096c709ab2ddf5)), closes [#395](https://github.com/gotgenes/pi-packages/issues/395)


### Documentation

* **pi-permission-system:** document deny-with-reason config form ([45be4e7](https://github.com/gotgenes/pi-packages/commit/45be4e72c0ca43040cb0f55ca196a0cab0b9fc14)), closes [#395](https://github.com/gotgenes/pi-packages/issues/395)

## [13.0.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v12.0.0...pi-permission-system-v13.0.0) (2026-06-12)


### ⚠ BREAKING CHANGES

* A relative bash path token now also matches absolute allowlist rules naming the same file, resolved against the effective directory after literal cd commands. A token under a config like `path: { "*": "ask", "/workspace/project/*": "allow" }` moves from `ask` to `allow`. Tokens after a non-literal cd (e.g. cd "$DIR") stay conservative and match only their literal form.
* When Pi's working directory is known, a relative path input now also matches absolute allowlist rules naming the same file. A config like `path: { "*": "ask", "/workspace/project/*": "allow" }` moves a relative `src/App.jsx` from `ask` to `allow`. To keep tighter control, narrow the allowlist patterns or add an explicit `path` deny for the sensitive paths.

### Features

* add alias-aware evaluateAnyValue ([#393](https://github.com/gotgenes/pi-packages/issues/393)) ([2b7d240](https://github.com/gotgenes/pi-packages/commit/2b7d24091fbeb078bcfbc363bc0062199ee1de24))
* add cd-aware pathRuleCandidates to BashProgram ([#393](https://github.com/gotgenes/pi-packages/issues/393)) ([102a491](https://github.com/gotgenes/pi-packages/commit/102a491ef73e225a6a93008195ff958e4c5bd315))
* add path-policy value derivation ([#393](https://github.com/gotgenes/pi-packages/issues/393)) ([d34e57f](https://github.com/gotgenes/pi-packages/commit/d34e57fe96c74b2ba87e9d0ebe9be5055db0855f))
* add resolvePathPolicy resolver method ([#393](https://github.com/gotgenes/pi-packages/issues/393)) ([8ec81da](https://github.com/gotgenes/pi-packages/commit/8ec81da65e7f994beb5f65bead8b11174277fa53))
* match relative path inputs against absolute allowlists ([#393](https://github.com/gotgenes/pi-packages/issues/393)) ([6d0c564](https://github.com/gotgenes/pi-packages/commit/6d0c564d1d7b48227898d0be5fbbf5c91cc7ca89))
* normalize path inputs to cwd-aware policy values ([#393](https://github.com/gotgenes/pi-packages/issues/393)) ([3c2784f](https://github.com/gotgenes/pi-packages/commit/3c2784fc2199b4903a0aaa8a22a971c1bfb4969d))
* resolve bash path tokens with cd-aware policy values ([#393](https://github.com/gotgenes/pi-packages/issues/393)) ([7bcdbe7](https://github.com/gotgenes/pi-packages/commit/7bcdbe708a29448cbfda4a76b7e8917795fbb741))


### Documentation

* document cwd-aware path policy matching ([#393](https://github.com/gotgenes/pi-packages/issues/393)) ([8ab53a2](https://github.com/gotgenes/pi-packages/commit/8ab53a2de6c4deea5bbcd9c72a36ec0943e1a69a))
* **pi-permission-system:** update Development section to current scripts and tooling ([ebda301](https://github.com/gotgenes/pi-packages/commit/ebda301798290f528f930917b6792a5c21379a5d))

## [12.0.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v11.0.0...pi-permission-system-v12.0.0) (2026-06-12)


### ⚠ BREAKING CHANGES

* extension and MCP tools that expose a filesystem path (input.path, or input.arguments.path for MCP) are now subject to the path and external_directory permission gates. Tools previously ungated may now prompt or be denied under existing path rules.

### Features

* add extensible tool input path extraction ([#352](https://github.com/gotgenes/pi-packages/issues/352)) ([3a54ea1](https://github.com/gotgenes/pi-packages/commit/3a54ea16be4d621bd7474f7a728d97ce9781a994))
* add tool access extractor registry ([#352](https://github.com/gotgenes/pi-packages/issues/352)) ([7a34f01](https://github.com/gotgenes/pi-packages/commit/7a34f0187f6b3fbb75e056082f04d3b805a37c8a))
* expose registerToolAccessExtractor via permissions service ([#352](https://github.com/gotgenes/pi-packages/issues/352)) ([5e02c16](https://github.com/gotgenes/pi-packages/commit/5e02c163b212adf9648a2631e4788f030539a36a))
* gate extension and MCP path tools by default ([#352](https://github.com/gotgenes/pi-packages/issues/352)) ([1d53f4f](https://github.com/gotgenes/pi-packages/commit/1d53f4ffa1a08e953b96437e9adf0214c6ca7465))


### Documentation

* document path-aware extension/MCP gating and registerToolAccessExtractor ([#352](https://github.com/gotgenes/pi-packages/issues/352)) ([a2f825f](https://github.com/gotgenes/pi-packages/commit/a2f825f031ec26f1c47dbf13d056e724fda87021))

## [11.0.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v10.10.1...pi-permission-system-v11.0.0) (2026-06-11)


### ⚠ BREAKING CHANGES

* The permission system no longer auto-activates pi's off-by-default tools (`find`, `grep`, `ls`) in the main session. Users who want them active should enable them via pi's own `activeTools` configuration rather than relying on the permission system to expose every non-denied tool.

### Features

* add getActive to ToolRegistry wired to pi.getActiveTools ([#385](https://github.com/gotgenes/pi-packages/issues/385)) ([79c4594](https://github.com/gotgenes/pi-packages/commit/79c459443294c1b58643b746e3511fc17c9f8961))


### Bug Fixes

* respect pi's default active tool set in before_agent_start ([#385](https://github.com/gotgenes/pi-packages/issues/385)) ([bf5be48](https://github.com/gotgenes/pi-packages/commit/bf5be48ca8b06e8cb08f66d08eccb85af0673987))


### Documentation

* clarify before_agent_start filters pi's active tool set ([#385](https://github.com/gotgenes/pi-packages/issues/385)) ([bdb5a6a](https://github.com/gotgenes/pi-packages/commit/bdb5a6a08e3c1bb611c8b1795c4d46856104b3b0))

## [10.10.1](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v10.10.0...pi-permission-system-v10.10.1) (2026-06-11)


### Documentation

* fix bash rule precedence examples and wording ([#387](https://github.com/gotgenes/pi-packages/issues/387)) ([9e18d6f](https://github.com/gotgenes/pi-packages/commit/9e18d6faab6e3ceaa1a8839f5b6753d5457a2a28))

## [10.10.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v10.9.0...pi-permission-system-v10.10.0) (2026-06-10)


### Features

* **pi-permission-system:** add case-insensitive and Windows-separator options to wildcard matcher ([587b3e8](https://github.com/gotgenes/pi-packages/commit/587b3e88d0deed365ab690d38145e2f9ce8eaee6))


### Bug Fixes

* **pi-permission-system:** auto-allow infrastructure reads case-insensitively on Windows ([a3f137a](https://github.com/gotgenes/pi-packages/commit/a3f137ad5edb8f42378144fa9ca556996954155c))
* **pi-permission-system:** auto-detect Pi's install directory for infrastructure reads ([#382](https://github.com/gotgenes/pi-packages/issues/382)) ([c3d89ba](https://github.com/gotgenes/pi-packages/commit/c3d89ba4f58805fb5012258beb2db108ef61ebbe))
* **pi-permission-system:** include an optional Pi package dir in infrastructure reads ([da667ec](https://github.com/gotgenes/pi-packages/commit/da667eca95f02f8de246bdc42ca90df7696fe2ca))
* **pi-permission-system:** make path containment case-insensitive on Windows via path.relative ([c10b84a](https://github.com/gotgenes/pi-packages/commit/c10b84ad4508b1cf8ead763e3fa0560a1e9ba370))
* **pi-permission-system:** match external_directory/path patterns case-insensitively on Windows ([3ed92da](https://github.com/gotgenes/pi-packages/commit/3ed92dabc1643fb5e0c52b9eac76e0940f8a8dc4))


### Documentation

* **pi-permission-system:** document Windows case-insensitive matching and Pi-install auto-allow ([c98d33b](https://github.com/gotgenes/pi-packages/commit/c98d33b775eea9cbe83f019222841a6ab820942f))

## [10.9.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v10.8.0...pi-permission-system-v10.9.0) (2026-06-10)


### Features

* add ToolInputFormatterRegistrar write-side interface ([#366](https://github.com/gotgenes/pi-packages/issues/366)) ([e000eb0](https://github.com/gotgenes/pi-packages/commit/e000eb02a507c06e241b5a35cac5334e06dca1e2))

## [10.8.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v10.7.2...pi-permission-system-v10.8.0) (2026-06-10)


### Features

* add CacheKeyGate for agent-start cache keys ([#365](https://github.com/gotgenes/pi-packages/issues/365)) ([e99285c](https://github.com/gotgenes/pi-packages/commit/e99285c50fef3f6fd8ea7dac00080eeb9957adaa))


### Documentation

* mark Phase 5 Step 4 complete ([#365](https://github.com/gotgenes/pi-packages/issues/365)) ([4bd0e30](https://github.com/gotgenes/pi-packages/commit/4bd0e30fb4cb03d6cff76242f75955e9698c7d0d))

## [10.7.2](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v10.7.1...pi-permission-system-v10.7.2) (2026-06-10)


### Miscellaneous Chores

* **deps:** bump tooling dependencies to latest minor/patch ([8b9105d](https://github.com/gotgenes/pi-packages/commit/8b9105d4011816fe8085dfed3a3b9d7bc9918c56))

## [10.7.1](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v10.7.0...pi-permission-system-v10.7.1) (2026-06-09)


### Bug Fixes

* surface full chained command in bash permission prompt ([#333](https://github.com/gotgenes/pi-packages/issues/333)) ([7f448fb](https://github.com/gotgenes/pi-packages/commit/7f448fb6e394bc37f94c98e04332abdcc8528c46))

## [10.7.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v10.6.0...pi-permission-system-v10.7.0) (2026-06-09)


### Features

* add normalizeOptionalStringArray to common ([8be9154](https://github.com/gotgenes/pi-packages/commit/8be9154d7a492f13526f7bd8d4e33fc2e209f98d))


### Bug Fixes

* carry piInfrastructureReadPaths through the unified config loader ([#347](https://github.com/gotgenes/pi-packages/issues/347)) ([51bc145](https://github.com/gotgenes/pi-packages/commit/51bc145c15cc54bc69333d1e6cc48c74dda267d1))

## [10.6.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v10.5.3...pi-permission-system-v10.6.0) (2026-06-08)


### Features

* **pi-permission-system:** add best-effort canonicalizePath helper ([5b5002e](https://github.com/gotgenes/pi-packages/commit/5b5002e1b5400485f30a9f22440a88d14ed5135d))


### Bug Fixes

* **pi-permission-system:** canonicalize bash external-path containment ([#345](https://github.com/gotgenes/pi-packages/issues/345)) ([89f8e9b](https://github.com/gotgenes/pi-packages/commit/89f8e9bb35cd268e46a2b124663f44c11a44be97))
* **pi-permission-system:** canonicalize tool-call external-directory containment ([#345](https://github.com/gotgenes/pi-packages/issues/345)) ([d7f3bd1](https://github.com/gotgenes/pi-packages/commit/d7f3bd1c02d115621cd87065de240b816837065f))


### Documentation

* **pi-permission-system:** note symlink canonicalization in architecture ([b758a48](https://github.com/gotgenes/pi-packages/commit/b758a48bc55485ad9e751543db59858886ba360c))

## [10.5.3](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v10.5.2...pi-permission-system-v10.5.3) (2026-06-08)


### Bug Fixes

* merge tool preview length fields across config layers ([803fbb4](https://github.com/gotgenes/pi-packages/commit/803fbb4a118d4c26dc7b23fcec3f88d23aec0065))
* parse tool preview length fields in unified config loader ([3241956](https://github.com/gotgenes/pi-packages/commit/3241956b5656bc44788061c4a0a4ee334cb3ace5))

## [10.5.2](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v10.5.1...pi-permission-system-v10.5.2) (2026-06-08)


### Bug Fixes

* **pi-permission-system:** expand $HOME in normalizePathForComparison ([#350](https://github.com/gotgenes/pi-packages/issues/350)) ([1b92ed3](https://github.com/gotgenes/pi-packages/commit/1b92ed3d2364174d3287171c58ce8452239b3e8d))
* **pi-permission-system:** home-expand path values before matching ([#350](https://github.com/gotgenes/pi-packages/issues/350)) ([48a7b37](https://github.com/gotgenes/pi-packages/commit/48a7b3783857b449442d30edefe04f8255e5f4f8))


### Documentation

* **pi-permission-system:** note path values are home-expanded for matching ([#350](https://github.com/gotgenes/pi-packages/issues/350)) ([e9c264d](https://github.com/gotgenes/pi-packages/commit/e9c264de85d327a0bfbcd84401a259cb509a5dfa))

## [10.5.1](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v10.5.0...pi-permission-system-v10.5.1) (2026-06-07)


### Documentation

* correct SkillPermissionChecker comment after resolver rewire ([#341](https://github.com/gotgenes/pi-packages/issues/341)) ([1528382](https://github.com/gotgenes/pi-packages/commit/15283820a920fead92b348410828332b69f0a0d9))

## [10.5.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v10.4.0...pi-permission-system-v10.5.0) (2026-06-07)


### Features

* add PermissionResolver class and route gate runner through it ([#340](https://github.com/gotgenes/pi-packages/issues/340)) ([4133601](https://github.com/gotgenes/pi-packages/commit/41336018d495f85b30b7b77fadb5912870f0dedd))


### Bug Fixes

* suppress fallow unused-class-member for pre-Step-8 resolver methods ([#340](https://github.com/gotgenes/pi-packages/issues/340)) ([fd65626](https://github.com/gotgenes/pi-packages/commit/fd65626ae867457edeb829ea28d0ab94fe51dea6))

## [10.4.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v10.3.1...pi-permission-system-v10.4.0) (2026-06-07)


### Features

* add context-owning PromptingGateway ([1885be2](https://github.com/gotgenes/pi-packages/commit/1885be28fb797eb5ed67a7a30d51e58fa73e3ff0))


### Documentation

* mark Phase 4 Step 6 complete; drop unused beforeEach import ([217057a](https://github.com/gotgenes/pi-packages/commit/217057ab5f8a1d3290322b442e267287b31635cf))

## [10.3.1](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v10.3.0...pi-permission-system-v10.3.1) (2026-06-06)


### Bug Fixes

* share one PermissionManager and SessionRules across gate and RPC paths ([#337](https://github.com/gotgenes/pi-packages/issues/337)) ([7dd1e65](https://github.com/gotgenes/pi-packages/commit/7dd1e65493fa0061a3b84eb329457f939b953e0a))

## [10.3.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v10.2.0...pi-permission-system-v10.3.0) (2026-06-05)


### Features

* add ConfigStore owning extension config state ([5941733](https://github.com/gotgenes/pi-packages/commit/5941733a67c0ad9aef3d3b2e5908a82e76ac8603))

## [10.2.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v10.1.0...pi-permission-system-v10.2.0) (2026-06-04)


### Features

* add PermissionManager.configureForCwd and agentDir option ([5a2d363](https://github.com/gotgenes/pi-packages/commit/5a2d3634a0b8466a5d6aa8baa170a9bf53e068fb))

## [10.1.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v10.0.0...pi-permission-system-v10.1.0) (2026-06-03)


### Features

* add DecisionReporter and GateDecisionReporter ([530211d](https://github.com/gotgenes/pi-packages/commit/530211da9158a012e86f37311e326f4e2b571c55))
* add GatePrompter and SessionApprovalRecorder session roles ([2f761e4](https://github.com/gotgenes/pi-packages/commit/2f761e44fd07c98fe98147275f75fc170163b06d))
* add GateRunner class consolidating gate dispatch ([a390558](https://github.com/gotgenes/pi-packages/commit/a390558f19723fa911924b2d1878d4d874d6966d))
* add getToolPreviewLimits and getInfrastructureReadDirs to PermissionSession ([#327](https://github.com/gotgenes/pi-packages/issues/327)) ([a0bf166](https://github.com/gotgenes/pi-packages/commit/a0bf1662119eeeb4b390c668c6993c7ff87194bf))
* add PermissionResolver.resolve to PermissionSession ([c922bbd](https://github.com/gotgenes/pi-packages/commit/c922bbddcfb47a2ec88d349f3a797b633bd58f45))
* add skill_input denial context ([#326](https://github.com/gotgenes/pi-packages/issues/326)) ([71e9d28](https://github.com/gotgenes/pi-packages/commit/71e9d28c5f6c8a09d2bfa9fe21cca6c55948898b))
* introduce SkillInputGatePipeline collaborator ([#329](https://github.com/gotgenes/pi-packages/issues/329)) ([4ddd5af](https://github.com/gotgenes/pi-packages/commit/4ddd5af1c476ab3c3eb29ce456a33b273c386ca0))
* introduce ToolCallGatePipeline collaborator ([#327](https://github.com/gotgenes/pi-packages/issues/327)) ([3a87727](https://github.com/gotgenes/pi-packages/commit/3a877274091bfc2db3998ca915f76ecbdd2ac1e7))


### Bug Fixes

* drop vestigial events field; document makeReporter in package skill ([9e0a8a7](https://github.com/gotgenes/pi-packages/commit/9e0a8a7d89b4c081d21465e02b7aa77c18ddd1b0))


### Documentation

* document SkillInputGatePipeline in architecture and package skill ([#329](https://github.com/gotgenes/pi-packages/issues/329)) ([9193c86](https://github.com/gotgenes/pi-packages/commit/9193c86ecc2fa6b18da6a7c7e4a9f9efbbc807ed))
* record the composition-root collaborator extraction ([#320](https://github.com/gotgenes/pi-packages/issues/320)) ([dab8890](https://github.com/gotgenes/pi-packages/commit/dab8890df05e003bb9136924ab2d344c7fe69319))
* standardize and correct package READMEs ([4c270ad](https://github.com/gotgenes/pi-packages/commit/4c270adac97ca816fa1889a879d1d4fe19cdd464))

## [10.0.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v9.2.0...pi-permission-system-v10.0.0) (2026-06-02)


### ⚠ BREAKING CHANGES

* **pi-permission-system:** the permissions:ready event payload no longer includes protocolVersion. Consumers that read it must rely on package semver instead.

### Features

* **pi-permission-manager:** broadcast permission prompts on permissions:prompt channel ([8540f3b](https://github.com/gotgenes/pi-packages/commit/8540f3b462b76a4789c4c17a75fadf254ae39feb))
* **pi-permission-system:** drop protocolVersion from permissions:ready ([6728a93](https://github.com/gotgenes/pi-packages/commit/6728a93af7edbc6953d20f448f1c3f54f9b7893f))
* **pi-permission-system:** harden prompt broadcasts ([067bafd](https://github.com/gotgenes/pi-packages/commit/067bafd80ef983fd8b9ab00914cf1cec9b6db915))
* **pi-permission-system:** make ready and decision broadcasts best-effort ([00a895f](https://github.com/gotgenes/pi-packages/commit/00a895f9377bcb7b598acbc6c95d7bc7cc83c515))
* **pi-permission-system:** preserve display fields for forwarded prompts ([9970912](https://github.com/gotgenes/pi-packages/commit/997091228736bbd4395d8bd16aeb9f4a4ae7e0b2))
* **pi-permission-system:** slim ui_prompt payload and centralize construction ([7a1ec56](https://github.com/gotgenes/pi-packages/commit/7a1ec56a827e90fe80a0f7de48e1222b5271700d))


### Bug Fixes

* **pi-permission-system:** drop manual CHANGELOG Unreleased section ([f14e4f5](https://github.com/gotgenes/pi-packages/commit/f14e4f5d9b5ae1d6b207a913aefdd71980a46dd6))


### Documentation

* **pi-permission-system:** document the lean ui_prompt contract ([0b3c11c](https://github.com/gotgenes/pi-packages/commit/0b3c11c57a7b718d2f73a184802f8c5dcb95fbe7))

## [9.2.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v9.1.0...pi-permission-system-v9.2.0) (2026-06-02)


### Features

* flag relative paths conservatively after a non-literal cd ([6e631a0](https://github.com/gotgenes/pi-packages/commit/6e631a0c62633e0be3a498752a3bf3614d357d65)), closes [#307](https://github.com/gotgenes/pi-packages/issues/307)
* fold sequential current-shell cd into the bash effective directory ([7fd8e95](https://github.com/gotgenes/pi-packages/commit/7fd8e9525196ffa558a2b59ea9f4cf66943f9010)), closes [#307](https://github.com/gotgenes/pi-packages/issues/307)
* scope cd inside subshells and persist it across brace groups ([37b948c](https://github.com/gotgenes/pi-packages/commit/37b948c7e9fd5d9ddac3aa8c6b456039132f7c4e)), closes [#307](https://github.com/gotgenes/pi-packages/issues/307)

## [9.1.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v9.0.1...pi-permission-system-v9.1.0) (2026-06-02)


### Features

* evaluate nested bash command substitutions and subshells ([#306](https://github.com/gotgenes/pi-packages/issues/306)) ([0e52d64](https://github.com/gotgenes/pi-packages/commit/0e52d645bc2f604b1317781edf48578936e0ae34))
* surface nested execution context in bash deny and ask messages ([#306](https://github.com/gotgenes/pi-packages/issues/306)) ([9d88543](https://github.com/gotgenes/pi-packages/commit/9d88543c855d16910d71c7e783c451160753c52d))


### Documentation

* document nested bash command evaluation ([#306](https://github.com/gotgenes/pi-packages/issues/306)) ([352e206](https://github.com/gotgenes/pi-packages/commit/352e206ce673ba73d57b1a4dbf24a409adf32e70))

## [9.0.1](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v9.0.0...pi-permission-system-v9.0.1) (2026-06-01)


### Bug Fixes

* enumerate top-level bash commands in BashProgram ([cdb41e1](https://github.com/gotgenes/pi-packages/commit/cdb41e1ed03ad2219f5ba0a3ec79130bd39f3686))
* evaluate each bash sub-command with most-restrictive precedence ([85e48b2](https://github.com/gotgenes/pi-packages/commit/85e48b258dad84756a05fe11615d6d5de68a8659))
* gate bash command chains per sub-command ([#301](https://github.com/gotgenes/pi-packages/issues/301)) ([3f80097](https://github.com/gotgenes/pi-packages/commit/3f800977a909b2efc2a21ffefe933804b1c0eafd))


### Documentation

* document per-sub-command bash chain evaluation ([#301](https://github.com/gotgenes/pi-packages/issues/301)) ([e195a70](https://github.com/gotgenes/pi-packages/commit/e195a706d192f3acaeb232c6ed580890ac3c0652))

## [9.0.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v8.3.2...pi-permission-system-v9.0.0) (2026-06-01)


### ⚠ BREAKING CHANGES

* unpublishPermissionsService() now requires the service to remove as its sole argument. The package's public export is service.ts, so this changes the published API surface.

### Features

* scope service teardown to the publishing instance ([#302](https://github.com/gotgenes/pi-packages/issues/302)) ([72180e9](https://github.com/gotgenes/pi-packages/commit/72180e906f7370c842cd5e31a11726c2971fc988))


### Bug Fixes

* keep the parent's service published across child shutdown ([#302](https://github.com/gotgenes/pi-packages/issues/302)) ([300214c](https://github.com/gotgenes/pi-packages/commit/300214ca21d985bfba7231f261c022c394d8bf5a))


### Documentation

* document session_start service publication and ready timing ([#302](https://github.com/gotgenes/pi-packages/issues/302)) ([a894fb8](https://github.com/gotgenes/pi-packages/commit/a894fb8d5c2bbc7cd9d33769859d172c5a7dbb73))

## [8.3.2](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v8.3.1...pi-permission-system-v8.3.2) (2026-06-01)


### Bug Fixes

* **pi-permission-system:** key subagent registry by session id and drop vestigial agentName ([d299c54](https://github.com/gotgenes/pi-packages/commit/d299c5421f41ab0829fb83fcf4e030d1c7af6d56))
* **pi-permission-system:** resolve subagent detection and forwarding target by session id ([0f7e079](https://github.com/gotgenes/pi-packages/commit/0f7e0795b911797e645f4d44c42bb314bf0cb103))


### Documentation

* **retro:** add retro notes for issue [#296](https://github.com/gotgenes/pi-packages/issues/296) ([75743ab](https://github.com/gotgenes/pi-packages/commit/75743abe92604de142ff6e77c9c0fbc44266e12a))

## [8.3.1](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v8.3.0...pi-permission-system-v8.3.1) (2026-06-01)


### Bug Fixes

* add process-global SubagentSessionRegistry accessor ([#296](https://github.com/gotgenes/pi-packages/issues/296)) ([d3fd3b0](https://github.com/gotgenes/pi-packages/commit/d3fd3b04223b2d276873094ad8c14f239654b8c8))
* share SubagentSessionRegistry across parent and child sessions ([#296](https://github.com/gotgenes/pi-packages/issues/296)) ([fed676a](https://github.com/gotgenes/pi-packages/commit/fed676aaa485abe8db158e522ba898705f3dff94))


### Documentation

* explain process-global subagent registry across session buses ([#296](https://github.com/gotgenes/pi-packages/issues/296)) ([1804dbb](https://github.com/gotgenes/pi-packages/commit/1804dbbb766d7b7fbc0e49da877f3238f5c3e8dc))
* use ADR-NNNN with links docs-wide ([c6b6431](https://github.com/gotgenes/pi-packages/commit/c6b6431c004f324931f23be46cf2e47e8fdac919))

## [8.3.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v8.2.1...pi-permission-system-v8.3.0) (2026-06-01)


### Features

* add built-in MCP input summarizer ([#283](https://github.com/gotgenes/pi-packages/issues/283)) ([2d47e36](https://github.com/gotgenes/pi-packages/commit/2d47e360b475c72c76026ea5ea4ebf6446b58c3e))
* add ToolInputFormatterRegistry ([#283](https://github.com/gotgenes/pi-packages/issues/283)) ([c2c2b3d](https://github.com/gotgenes/pi-packages/commit/c2c2b3d64664b03cf6715e630e0bb59c4d1b650c))
* consult custom formatter registry in ToolPreviewFormatter ([#283](https://github.com/gotgenes/pi-packages/issues/283)) ([9a0d756](https://github.com/gotgenes/pi-packages/commit/9a0d75600f7aa364c06bee7c0419c64d9a5325e9))
* expose registerToolInputFormatter on PermissionsService ([#283](https://github.com/gotgenes/pi-packages/issues/283)) ([2287484](https://github.com/gotgenes/pi-packages/commit/2287484e24392fffac37962e41ad985446e75d2d))


### Documentation

* add authoring guide for tool input formatters ([#283](https://github.com/gotgenes/pi-packages/issues/283)) ([6d154a1](https://github.com/gotgenes/pi-packages/commit/6d154a14a7a1f26ded4f1d77d50b52d200b70a27))
* document tool input formatter seam ([#283](https://github.com/gotgenes/pi-packages/issues/283)) ([2fc9ff1](https://github.com/gotgenes/pi-packages/commit/2fc9ff1df97341b8825ef13c99a3ffd651dcd8e0))

## [8.2.1](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v8.2.0...pi-permission-system-v8.2.1) (2026-05-31)


### Bug Fixes

* remove stale PermissionGateHandler import in tool-call.test.ts ([#288](https://github.com/gotgenes/pi-packages/issues/288)) ([67259f6](https://github.com/gotgenes/pi-packages/commit/67259f666938e15473016edfeafcb718abe304f7))

## [8.2.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v8.1.0...pi-permission-system-v8.2.0) (2026-05-31)


### Features

* add SessionApproval value object and SessionRules.record ([8f98d92](https://github.com/gotgenes/pi-packages/commit/8f98d9223a424b0993d51c2d9106e7d01c6819d7))
* centralize decision-event construction in buildDecisionEvent ([19c2c83](https://github.com/gotgenes/pi-packages/commit/19c2c837b1907a4c302105ee86715533477247d4))

## [8.1.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v8.0.0...pi-permission-system-v8.1.0) (2026-05-31)


### Features

* add toolInputPreviewMaxLength and toolTextSummaryMaxLength config fields ([#266](https://github.com/gotgenes/pi-packages/issues/266)) ([3a7dafb](https://github.com/gotgenes/pi-packages/commit/3a7dafbb0bb8534dabda7eeba6c4d35ba2e8708b))
* use configured preview limits in permission prompts ([#266](https://github.com/gotgenes/pi-packages/issues/266)) ([83e2829](https://github.com/gotgenes/pi-packages/commit/83e2829175a55f2f0436c742e19e3753ee171e47))


### Documentation

* document configurable tool-preview length knobs ([#266](https://github.com/gotgenes/pi-packages/issues/266)) ([6d0b134](https://github.com/gotgenes/pi-packages/commit/6d0b134be4ef4c90ddf582b32058c3ec9d2eb13f))

## [8.0.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v7.4.1...pi-permission-system-v8.0.0) (2026-05-30)


### ⚠ BREAKING CHANGES

* `registerSubagentSession` and `unregisterSubagentSession` are removed from the `PermissionsService` interface and its implementation. The `SubagentSessionInfo` type is no longer re-exported from the public service module.

### Features

* remove inbound subagent-registration methods from PermissionsService ([#267](https://github.com/gotgenes/pi-packages/issues/267)) ([552735a](https://github.com/gotgenes/pi-packages/commit/552735a97eec939fc06130bce059c78f03eb8e58))


### Documentation

* **pi-permission-system:** describe event-driven subagent registration ([#267](https://github.com/gotgenes/pi-packages/issues/267)) ([8c39b87](https://github.com/gotgenes/pi-packages/commit/8c39b8785aa389d96b5f38996711d8aa3dbeb284))

## [7.4.1](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v7.4.0...pi-permission-system-v7.4.1) (2026-05-30)


### Bug Fixes

* **pi-permission-system:** resolve bash paths against leading cd target ([c655a7e](https://github.com/gotgenes/pi-packages/commit/c655a7e737aeac9a8f10909804260c65d339c8b7))


### Documentation

* **pi-permission-system:** document cd-aware bash path resolution ([a2e6541](https://github.com/gotgenes/pi-packages/commit/a2e65410e89eb1e62579078c16af05aead013603))

## [7.4.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v7.3.3...pi-permission-system-v7.4.0) (2026-05-29)


### Features

* register subagent child sessions via lifecycle events ([cd324dc](https://github.com/gotgenes/pi-packages/commit/cd324dc5f8b18fe69ba8802eda0b17a6a36ccc58))


### Documentation

* document event-based subagent child lifecycle ([62621fa](https://github.com/gotgenes/pi-packages/commit/62621fa9abd093b5deadb3c15139179ae85ad519))

## [7.3.3](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v7.3.2...pi-permission-system-v7.3.3) (2026-05-28)


### Bug Fixes

* respect config-level allow/deny in bash external-directory gate ([#249](https://github.com/gotgenes/pi-packages/issues/249)) ([1437ff3](https://github.com/gotgenes/pi-packages/commit/1437ff3e3c0bdde93927ba9fdf9e3cf5b52e7c0c))


### Documentation

* plan fix for bash external-directory config-level allow bypass ([#249](https://github.com/gotgenes/pi-packages/issues/249)) ([9e09f35](https://github.com/gotgenes/pi-packages/commit/9e09f35e6cfad09b53a1b55b54fcd44af4ed6a7b))
* **retro:** add planning stage notes for issue [#249](https://github.com/gotgenes/pi-packages/issues/249) ([fe13214](https://github.com/gotgenes/pi-packages/commit/fe132144869db93bfc83c4e940abb7d3ce813d46))
* **retro:** add TDD stage notes for issue [#249](https://github.com/gotgenes/pi-packages/issues/249) ([b5d22f6](https://github.com/gotgenes/pi-packages/commit/b5d22f6d67f7d2c28ed406c99bc0458df9024713))

## [7.3.2](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v7.3.1...pi-permission-system-v7.3.2) (2026-05-27)


### Documentation

* replace \n with &lt;br/&gt; in Mermaid node labels ([3312a45](https://github.com/gotgenes/pi-packages/commit/3312a4559100cf9ae923f67819653b5a99fceb12))

## [7.3.1](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v7.3.0...pi-permission-system-v7.3.1) (2026-05-26)


### Bug Fixes

* resolve pre-existing lint errors in pi-autoformat and pi-permission-system ([68fd516](https://github.com/gotgenes/pi-packages/commit/68fd516e33ddbb9a5e37ef19e949ee9ecdc37252))


### Documentation

* update subagent integration docs for native permission bridge ([#101](https://github.com/gotgenes/pi-packages/issues/101)) ([0bd456b](https://github.com/gotgenes/pi-packages/commit/0bd456befa8ea6918e74f4393d844868795edc77))

## [7.3.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v7.2.0...pi-permission-system-v7.3.0) (2026-05-25)


### Features

* **pi-permission-system:** add SubagentSessionRegistry class ([a0ef16b](https://github.com/gotgenes/pi-packages/commit/a0ef16b8302f95b30cc11cb121441dbd164c276c))
* **pi-permission-system:** detect in-process subagents via session registry ([c90b824](https://github.com/gotgenes/pi-packages/commit/c90b824b4515a1d5ca259348ae0b60c7d70f29d4))
* **pi-permission-system:** expose registry and getToolPermission on PermissionsService ([984d2bb](https://github.com/gotgenes/pi-packages/commit/984d2bbb76f08cea91b5c0117eb356ae576ad6be))
* **pi-permission-system:** resolve forwarding target from subagent registry ([5eb15af](https://github.com/gotgenes/pi-packages/commit/5eb15afe680bfd36627c2c21165b59a0ea5e227c))


### Documentation

* **pi-permission-system:** document subagent session registry API ([93c5c3e](https://github.com/gotgenes/pi-packages/commit/93c5c3e72b2b757a99eba17d1c6885ea49271403))
* **pi-permission-system:** update architecture for subagent registry ([7b32e6a](https://github.com/gotgenes/pi-packages/commit/7b32e6a247e789b927e5cb3f19a367db0c110353))
* plan subagent session registry and tool-level permission query ([#221](https://github.com/gotgenes/pi-packages/issues/221)) ([a11d91a](https://github.com/gotgenes/pi-packages/commit/a11d91aa1e13e846030deb0af37444c44eeda7c8))
* **retro:** add planning stage notes for issue [#221](https://github.com/gotgenes/pi-packages/issues/221) ([cf434c2](https://github.com/gotgenes/pi-packages/commit/cf434c2f9711f26290a4635aea519f1f56e98cc7))
* **retro:** add TDD stage notes for issue [#221](https://github.com/gotgenes/pi-packages/issues/221) ([e050898](https://github.com/gotgenes/pi-packages/commit/e05089840ee6bbb07cbeab5c55367e2dcd304866))

## [7.2.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v7.1.4...pi-permission-system-v7.2.0) (2026-05-24)


### Features

* add eslint config with type-aware rules and import enforcement ([4fb3cc6](https://github.com/gotgenes/pi-packages/commit/4fb3cc678da10d350b85c464318476ba9ae99dca))

## [7.1.4](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v7.1.3...pi-permission-system-v7.1.4) (2026-05-23)


### Bug Fixes

* add package.json imports field for #src/#test path aliases ([#157](https://github.com/gotgenes/pi-packages/issues/157)) ([75b4598](https://github.com/gotgenes/pi-packages/commit/75b45980810583452f7741678359c004900c8bd0))

## [7.1.3](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v7.1.2...pi-permission-system-v7.1.3) (2026-05-23)


### Documentation

* **retro:** add retro notes for issue [#155](https://github.com/gotgenes/pi-packages/issues/155) ([4aa3250](https://github.com/gotgenes/pi-packages/commit/4aa3250471198013dfeb1f3d3ebe6752abfb65d5))

## [7.1.2](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v7.1.1...pi-permission-system-v7.1.2) (2026-05-23)


### Bug Fixes

* resolve fallow dead-code warnings ([2113f6b](https://github.com/gotgenes/pi-packages/commit/2113f6bc49812ce32ac68d0e2dd88e0a60b4474a))


### Documentation

* plan barrel discipline enforcement ([#155](https://github.com/gotgenes/pi-packages/issues/155)) ([58692cf](https://github.com/gotgenes/pi-packages/commit/58692cf98235ee5cc82e714943fb4238b78601c4))

## [7.1.1](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v7.1.0...pi-permission-system-v7.1.1) (2026-05-22)


### Documentation

* **retro:** add retro notes for issue [#122](https://github.com/gotgenes/pi-packages/issues/122) ([d17f86d](https://github.com/gotgenes/pi-packages/commit/d17f86d2d0a3b33113a606cb32754d5ebbd3a215))

## [7.1.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v7.0.1...pi-permission-system-v7.1.0) (2026-05-22)


### Features

* support glob patterns in piInfrastructureReadPaths ([#122](https://github.com/gotgenes/pi-packages/issues/122)) ([7ebce24](https://github.com/gotgenes/pi-packages/commit/7ebce24ff36f573c3165fdf49e4b470f68d79b69))


### Documentation

* document piInfrastructureReadPaths glob support ([#122](https://github.com/gotgenes/pi-packages/issues/122)) ([94fa688](https://github.com/gotgenes/pi-packages/commit/94fa688f1c41a6cf1d7bb49a3934728741dd1001))
* fix misleading ** examples and clarify * matches all characters ([00563dc](https://github.com/gotgenes/pi-packages/commit/00563dc90e3e800e0fc1b0f3ad0a9ed8c78f86b7))
* plan glob support for piInfrastructureReadPaths ([#122](https://github.com/gotgenes/pi-packages/issues/122)) ([1450d8b](https://github.com/gotgenes/pi-packages/commit/1450d8b61529d54c21df49d364d8bbcc1c7e55ec))

## [7.0.1](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v7.0.0...pi-permission-system-v7.0.1) (2026-05-21)


### Documentation

* **retro:** add retro notes for issue [#78](https://github.com/gotgenes/pi-packages/issues/78) ([594d3e1](https://github.com/gotgenes/pi-packages/commit/594d3e13512facbf4b6241b9a394aca8e59c0707))
* **retro:** add retro notes for issue [#78](https://github.com/gotgenes/pi-packages/issues/78) ([5f93117](https://github.com/gotgenes/pi-packages/commit/5f93117969524af86b28db979649032e860fc72e))

## [7.0.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v6.0.2...pi-permission-system-v7.0.0) (2026-05-21)


### ⚠ BREAKING CHANGES

* GateDescriptor.messages has been replaced by GateDescriptor.denialContext. Any code constructing a GateDescriptor must provide a DenialContext instead of pre-formatted message strings.

### Features

* add centralized denial message formatter ([#78](https://github.com/gotgenes/pi-packages/issues/78)) ([99f2d36](https://github.com/gotgenes/pi-packages/commit/99f2d362d669dd4d6a6a18365fecd42dd0d77eaa))


### Bug Fixes

* remove broken relative links in archived plan 0042 ([07bcca4](https://github.com/gotgenes/pi-packages/commit/07bcca49d506f5726ca96a4b9128b77635e84b7e))


### Documentation

* add README to archived plans directory ([c3fcb9f](https://github.com/gotgenes/pi-packages/commit/c3fcb9f7f669c1d25207225e807970eea1c9adc8))
* archive pre-monorepo plans, plan soften denial messages ([#78](https://github.com/gotgenes/pi-packages/issues/78)) ([7709f8f](https://github.com/gotgenes/pi-packages/commit/7709f8f85a0b7c002a943a222f6005d6069245c1))


### Code Refactoring

* remove messages from GateDescriptor ([#78](https://github.com/gotgenes/pi-packages/issues/78)) ([d3cae38](https://github.com/gotgenes/pi-packages/commit/d3cae387ea57c23ede6df27156d1a026aa6b58f2))

## [6.0.2](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v6.0.1...pi-permission-system-v6.0.2) (2026-05-20)


### Miscellaneous Chores

* enforce MD029 ordered list numbering ([95f8574](https://github.com/gotgenes/pi-packages/commit/95f8574ea0309b9c519785442bc357ffde29ee4a))

## [6.0.1](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v6.0.0...pi-permission-system-v6.0.1) (2026-05-19)


### Bug Fixes

* re-enable MD057 and fix broken links ([52a88b1](https://github.com/gotgenes/pi-packages/commit/52a88b1c74fbc4d78d92b1eef8c46e016a8e3fda))


### Documentation

* enforce one-sentence-per-line across all markdown files ([a533869](https://github.com/gotgenes/pi-packages/commit/a533869e09ea33a2da8c4ac022d9be4674be4b18))

## [6.0.0](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v5.18.3...pi-permission-system-v6.0.0) (2026-05-19)


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

## [5.18.3](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v5.18.2...pi-permission-system-v5.18.3) (2026-05-17)


### Documentation

* **retro:** add retro notes for issue [#58](https://github.com/gotgenes/pi-packages/issues/58) ([27c8a2d](https://github.com/gotgenes/pi-packages/commit/27c8a2d9910029a5e94e1b2eac76735a85c242eb))

## [5.18.2](https://github.com/gotgenes/pi-packages/compare/pi-permission-system-v5.18.1...pi-permission-system-v5.18.2) (2026-05-17)


### Bug Fixes

* bash path gate skips tokens matching only universal default ([#58](https://github.com/gotgenes/pi-packages/issues/58)) ([33fd169](https://github.com/gotgenes/pi-packages/commit/33fd1693b0c409b16c6a05072f52df78427713a1))
* restore per-package lint:md and lint scripts ([0e42617](https://github.com/gotgenes/pi-packages/commit/0e42617c443a7f8695f33855fa17058fc1712f27))
* skip path gate when no explicit path rules configured ([#58](https://github.com/gotgenes/pi-packages/issues/58)) ([a6d55e1](https://github.com/gotgenes/pi-packages/commit/a6d55e17bea4fbb8d4b46259da38ac4c8b919455))
* use root markdownlint config from all packages ([30192f8](https://github.com/gotgenes/pi-packages/commit/30192f8ccfc5c3c420f9f9b602df174baf263e92))


### Documentation

* add redirect AGENTS.md to each package subdirectory ([cbdcd29](https://github.com/gotgenes/pi-packages/commit/cbdcd297194c814f545ae93eaa7418e9337450d3))
* plan fix path gate firing for universal default ([#58](https://github.com/gotgenes/pi-packages/issues/58)) ([ae9bbab](https://github.com/gotgenes/pi-packages/commit/ae9bbab1b2f3062bfad754a1a8b9f1a2c3ea29f7))


### Miscellaneous Chores

* consolidate configs into monorepo root ([8583eaf](https://github.com/gotgenes/pi-packages/commit/8583eaf0764ac98def1987f20fafcc25e912b134))
* remove per-package pi-autoformat configs ([b2d405a](https://github.com/gotgenes/pi-packages/commit/b2d405a0a278341e4f6ff1c8b607533eaa4f021a))
* replace markdownlint-cli2 with rumdl ([d8dc789](https://github.com/gotgenes/pi-packages/commit/d8dc7897d854bf11396b85bc8c365e8e2ed7e66c))
* update package.json URLs to monorepo ([b92dbfa](https://github.com/gotgenes/pi-packages/commit/b92dbfaeaeb6cf2823272cb6fb6f206fb99a5009))

## [5.18.1](https://github.com/gotgenes/pi-permission-system/compare/v5.18.0...v5.18.1) (2026-05-15)


### Documentation

* plan Pi GitHub Tools extension ([#153](https://github.com/gotgenes/pi-permission-system/issues/153)) ([6f8566f](https://github.com/gotgenes/pi-permission-system/commit/6f8566feba22981e3f726aae8544bab53dce8a8a))
* **retro:** add retro notes for issue [#145](https://github.com/gotgenes/pi-permission-system/issues/145) ([70ff363](https://github.com/gotgenes/pi-permission-system/commit/70ff36369a902f82d78e277ba9fa7948bb62d82c))
* update /ship-issue to use pi-github-tools ([#153](https://github.com/gotgenes/pi-permission-system/issues/153)) ([7a4de21](https://github.com/gotgenes/pi-permission-system/commit/7a4de21ee16f7a1fff3ef8cf6e2b3a0516183ab5))
* update docs and pattern-suggest for path surface ([6defcdb](https://github.com/gotgenes/pi-permission-system/commit/6defcdb5430296c82da6eefc1980ab109dedc202))

## [5.18.0](https://github.com/gotgenes/pi-permission-system/compare/v5.17.0...v5.18.0) (2026-05-14)


### Features

* add package.json exports field for cross-extension import ([#145](https://github.com/gotgenes/pi-permission-system/issues/145)) ([1091de5](https://github.com/gotgenes/pi-permission-system/commit/1091de5eb673050c3b83448ee69cffb876c407d9))
* add Symbol.for()-backed service accessor module ([#145](https://github.com/gotgenes/pi-permission-system/issues/145)) ([6a7ddab](https://github.com/gotgenes/pi-permission-system/commit/6a7ddab6e3e58ca0f93807255e9e48716d96ca24))
* publish permissions service on startup, clear on shutdown ([#145](https://github.com/gotgenes/pi-permission-system/issues/145)) ([97bea7b](https://github.com/gotgenes/pi-permission-system/commit/97bea7bec043de4f6abb823846cef5c04a069517))


### Documentation

* deprecate permissions:rpc:check types in favor of service accessor ([#145](https://github.com/gotgenes/pi-permission-system/issues/145)) ([a64b1b9](https://github.com/gotgenes/pi-permission-system/commit/a64b1b91f141e1a98b576433280ad09d95ec3011))
* document service accessor and deprecate RPC check ([#145](https://github.com/gotgenes/pi-permission-system/issues/145)) ([931a14e](https://github.com/gotgenes/pi-permission-system/commit/931a14efec1ef9bc53075f8974bfd1eeff7e0749))
* plan Symbol.for()-backed service accessor ([#145](https://github.com/gotgenes/pi-permission-system/issues/145)) ([d9448bc](https://github.com/gotgenes/pi-permission-system/commit/d9448bc8c9ee71714599a18f03cf516a5ffca2cb))
* **retro:** add retro notes for issue [#148](https://github.com/gotgenes/pi-permission-system/issues/148) ([84e0262](https://github.com/gotgenes/pi-permission-system/commit/84e026264e292357c18c0333b1d1bd561f70149b))

## [5.17.0](https://github.com/gotgenes/pi-permission-system/compare/v5.16.0...v5.17.0) (2026-05-14)


### Features

* bash path gate with broader token extraction ([#148](https://github.com/gotgenes/pi-permission-system/issues/148)) ([affe202](https://github.com/gotgenes/pi-permission-system/commit/affe20284c7b579facc46ba489a1b6b0e2acc949))
* broader token extraction for path rules ([#148](https://github.com/gotgenes/pi-permission-system/issues/148)) ([6303641](https://github.com/gotgenes/pi-permission-system/commit/6303641a6efc3265e209799b93d4c8bcbc17c6a0))
* evaluateMostRestrictive helper for cross-cutting path evaluation ([#148](https://github.com/gotgenes/pi-permission-system/issues/148)) ([5260f21](https://github.com/gotgenes/pi-permission-system/commit/5260f21f149f8cd9b3331c4e418bc9091db2acdb))
* integrate path gates into permission pipeline ([#148](https://github.com/gotgenes/pi-permission-system/issues/148)) ([36fb30e](https://github.com/gotgenes/pi-permission-system/commit/36fb30e2564a8707b8e6eb8b798b90d536623c53))
* path gate for tool path restrictions ([#148](https://github.com/gotgenes/pi-permission-system/issues/148)) ([cc53681](https://github.com/gotgenes/pi-permission-system/commit/cc5368103686eee0849644cffce463c2851dff3c))
* register path as a special permission surface ([#148](https://github.com/gotgenes/pi-permission-system/issues/148)) ([356bcf7](https://github.com/gotgenes/pi-permission-system/commit/356bcf74b3028894319ea3c63b5d4b014b7bfe48))


### Documentation

* document cross-cutting path permission surface ([#148](https://github.com/gotgenes/pi-permission-system/issues/148)) ([3bd4478](https://github.com/gotgenes/pi-permission-system/commit/3bd4478c95197550485910c4364d35203ff53ada))
* include edit alongside write in config examples ([#147](https://github.com/gotgenes/pi-permission-system/issues/147)) ([f083ccc](https://github.com/gotgenes/pi-permission-system/commit/f083ccc0316e0689390e5ecc16e14ab40baca1d9))
* plan path-aware bash permission rules ([#148](https://github.com/gotgenes/pi-permission-system/issues/148)) ([71ff973](https://github.com/gotgenes/pi-permission-system/commit/71ff973edd57d75801b75044e238139e90a8490f))
* **retro:** add retro notes for issue [#147](https://github.com/gotgenes/pi-permission-system/issues/147) ([e40402b](https://github.com/gotgenes/pi-permission-system/commit/e40402b018703c37c8af436dc4e15665216f59c7))

## [5.16.0](https://github.com/gotgenes/pi-permission-system/compare/v5.15.0...v5.16.0) (2026-05-13)


### Features

* decision events include file path for path-bearing tools ([#147](https://github.com/gotgenes/pi-permission-system/issues/147)) ([eea226d](https://github.com/gotgenes/pi-permission-system/commit/eea226d990d4358983cc319d54b7544849b2b453))
* normalizeInput returns file path for path-bearing tools ([#147](https://github.com/gotgenes/pi-permission-system/issues/147)) ([0b48995](https://github.com/gotgenes/pi-permission-system/commit/0b4899563ed3aaf2dd264650a98964168e7ecba1))
* path-scoped session approvals for path-bearing tools ([#147](https://github.com/gotgenes/pi-permission-system/issues/147)) ([1feacc5](https://github.com/gotgenes/pi-permission-system/commit/1feacc53d4ac1653bf974886ce77e13aff014b68))


### Documentation

* document per-tool path patterns ([#147](https://github.com/gotgenes/pi-permission-system/issues/147)) ([81245f6](https://github.com/gotgenes/pi-permission-system/commit/81245f6ac98500e6c4d3c2191ceb2db032284f05))
* plan per-tool path patterns for path-bearing tools ([#147](https://github.com/gotgenes/pi-permission-system/issues/147)) ([9458706](https://github.com/gotgenes/pi-permission-system/commit/9458706d85e4711b73677ee1abcc8f3ad7d18a2e))

## [5.15.0](https://github.com/gotgenes/pi-permission-system/compare/v5.14.1...v5.15.0) (2026-05-13)


### Features

* add PI_SUBAGENT_PARENT_SESSION convention for parent session resolution ([3829195](https://github.com/gotgenes/pi-permission-system/commit/3829195c7de1f755adf9aa35809de699434d9aae)), closes [#143](https://github.com/gotgenes/pi-permission-system/issues/143)


### Documentation

* add Cross-Extension Integration section to AGENTS.md ([#145](https://github.com/gotgenes/pi-permission-system/issues/145)) ([90209f7](https://github.com/gotgenes/pi-permission-system/commit/90209f75ecd0845b6ac13c6c4895da32a4c82909))

## [5.14.1](https://github.com/gotgenes/pi-permission-system/compare/v5.14.0...v5.14.1) (2026-05-11)


### Bug Fixes

* show tool name instead of bare wildcard in session-approval label ([1a65c30](https://github.com/gotgenes/pi-permission-system/commit/1a65c3017f25012c3a7ced63f26d40fcecea81d3))
* surface-prefixed session-approval labels for all permission surfaces ([759da03](https://github.com/gotgenes/pi-permission-system/commit/759da03be9c0d847ec6de58e161ef2e7cbbc70b8))


### Documentation

* **retro:** add retro notes for issue [#122](https://github.com/gotgenes/pi-permission-system/issues/122) ([7867db2](https://github.com/gotgenes/pi-permission-system/commit/7867db22054df00e13aa6c88347238dadaa63166))

## [5.14.0](https://github.com/gotgenes/pi-permission-system/compare/v5.13.0...v5.14.0) (2026-05-09)


### Features

* support ? single-character wildcard in permission patterns ([#122](https://github.com/gotgenes/pi-permission-system/issues/122)) ([7b56f49](https://github.com/gotgenes/pi-permission-system/commit/7b56f4979a3479912dcc1d903f52a517587b95f6))


### Documentation

* document ? wildcard and update OpenCode compatibility ([#122](https://github.com/gotgenes/pi-permission-system/issues/122)) ([31ace5f](https://github.com/gotgenes/pi-permission-system/commit/31ace5f36a11299750994c2b9e6084dbecc240ba))
* plan ? single-character wildcard support ([#122](https://github.com/gotgenes/pi-permission-system/issues/122)) ([a7a2963](https://github.com/gotgenes/pi-permission-system/commit/a7a296337809ee7c107f86b87b64bfeb3709467f))
* **retro:** add retro notes for issue [#1](https://github.com/gotgenes/pi-permission-system/issues/1) ([b1c66f1](https://github.com/gotgenes/pi-permission-system/commit/b1c66f18d1aed5cc95a1fccb1a9c6c0f44f5cd11))

## [5.13.0](https://github.com/gotgenes/pi-permission-system/compare/v5.12.0...v5.13.0) (2026-05-08)


### Features

* warn that this is a pnpm project on global npm pass-throughs ([f643149](https://github.com/gotgenes/pi-permission-system/commit/f64314981126331ec96ec6a20418440eff1738e7))


### Bug Fixes

* pass through npm install/uninstall -g in PATH shim ([eaf4256](https://github.com/gotgenes/pi-permission-system/commit/eaf4256446b2c1ec3ecba98d11cc75b1406931af))
* prevent double-loading extension in dev via project settings ([6c39f33](https://github.com/gotgenes/pi-permission-system/commit/6c39f33890e61b5e0fde41d178aad9df93592cc9))


### Documentation

* plan external_directory integration tests ([#1](https://github.com/gotgenes/pi-permission-system/issues/1)) ([695ffeb](https://github.com/gotgenes/pi-permission-system/commit/695ffeb6d7a648df3dd9e18a01c20ff22266857b))
* **retro:** add retro notes for double-prompt investigation ([37734a5](https://github.com/gotgenes/pi-permission-system/commit/37734a57aee972aa4c732d92eeda424dd40443ee))
* **retro:** add retro notes for issue [#123](https://github.com/gotgenes/pi-permission-system/issues/123) ([5dbea33](https://github.com/gotgenes/pi-permission-system/commit/5dbea3379963b6231a4a101c889a4594705b12b6))


### Miscellaneous Chores

* switch ask tool from pi-ask-user to @eko24ive/pi-ask ([0087458](https://github.com/gotgenes/pi-permission-system/commit/00874585724d79fbeda1fca84b998db3bcd1a043))

## [5.12.0](https://github.com/gotgenes/pi-permission-system/compare/v5.11.2...v5.12.0) (2026-05-08)


### Features

* support trailing wildcard optionality ([#123](https://github.com/gotgenes/pi-permission-system/issues/123)) ([c25b0b5](https://github.com/gotgenes/pi-permission-system/commit/c25b0b5c59e5d5739a3b6c99de18444a4e7820ec))


### Documentation

* plan trailing wildcard optionality ([#123](https://github.com/gotgenes/pi-permission-system/issues/123)) ([a6a50d2](https://github.com/gotgenes/pi-permission-system/commit/a6a50d28284bb624a3695d361b5b9f2a9861f470))
* **retro:** add retro notes for issue [#113](https://github.com/gotgenes/pi-permission-system/issues/113) ([7412740](https://github.com/gotgenes/pi-permission-system/commit/7412740c876c42cc1cd63f95ee4cb0ea0de72e68))
* update wildcard optionality docs ([#123](https://github.com/gotgenes/pi-permission-system/issues/123)) ([562adaf](https://github.com/gotgenes/pi-permission-system/commit/562adaff9726096004dc4f5214550af2dc2fc118))

## [5.11.2](https://github.com/gotgenes/pi-permission-system/compare/v5.11.1...v5.11.2) (2026-05-08)


### Documentation

* plan removal of legacy path defaults from logging and extension-config ([#113](https://github.com/gotgenes/pi-permission-system/issues/113)) ([27ec0d8](https://github.com/gotgenes/pi-permission-system/commit/27ec0d8668c8c006f94c544e55d10c0eb272ddab))


### Miscellaneous Chores

* approve @google/genai build scripts in pnpm-workspace.yaml ([23b177f](https://github.com/gotgenes/pi-permission-system/commit/23b177f8c5e00d5bc9812fa826c34844cc665d7a))
* upgrade pnpm to 11.0.8 and update deps ([31eb848](https://github.com/gotgenes/pi-permission-system/commit/31eb848539ff411cb7b6f422cd0244d6c9765ac7))

## [5.11.1](https://github.com/gotgenes/pi-permission-system/compare/v5.11.0...v5.11.1) (2026-05-08)


### Documentation

* **retro:** add retro notes for issue [#130](https://github.com/gotgenes/pi-permission-system/issues/130) ([e2ed7cb](https://github.com/gotgenes/pi-permission-system/commit/e2ed7cbbabe2dabf5689704c14b59fc662c1e7d4))


### Miscellaneous Chores

* migrate @mariozechner/* deps to @earendil-works/* ([8908be1](https://github.com/gotgenes/pi-permission-system/commit/8908be17624a60ff3272b9e0e0a720a239de2de5))

## [5.11.0](https://github.com/gotgenes/pi-permission-system/compare/v5.10.0...v5.11.0) (2026-05-08)


### Features

* add ToolRegistry interface ([#130](https://github.com/gotgenes/pi-permission-system/issues/130)) ([5e886fd](https://github.com/gotgenes/pi-permission-system/commit/5e886fd4bc67ddac56a7f2b7b445f6f172e60668))
* PermissionSession absorbs prompting methods ([#130](https://github.com/gotgenes/pi-permission-system/issues/130)) ([4ae81e6](https://github.com/gotgenes/pi-permission-system/commit/4ae81e6e32164926202633ec7831a4f3db69fc70))


### Documentation

* plan handler classes to replace HandlerDeps ([#130](https://github.com/gotgenes/pi-permission-system/issues/130)) ([e8bc1a4](https://github.com/gotgenes/pi-permission-system/commit/e8bc1a40596aa6a032b367e642d19a03ca622394))
* **retro:** add retro notes for issue [#129](https://github.com/gotgenes/pi-permission-system/issues/129) ([23c29a2](https://github.com/gotgenes/pi-permission-system/commit/23c29a2148f6647565e6997d9c56341b43e74118))
* update architecture for handler classes ([#130](https://github.com/gotgenes/pi-permission-system/issues/130)) ([02d02b6](https://github.com/gotgenes/pi-permission-system/commit/02d02b647ec366eee3dc572afbaf436b1264b052))

## [5.10.0](https://github.com/gotgenes/pi-permission-system/compare/v5.9.0...v5.10.0) (2026-05-08)


### Features

* PermissionSession class with delegation methods ([#129](https://github.com/gotgenes/pi-permission-system/issues/129)) ([a8486ce](https://github.com/gotgenes/pi-permission-system/commit/a8486ce1d0678a7617e3cc6d8131e5f3080a1bea))
* PermissionSession lifecycle, cache, agent name, and infra methods ([#129](https://github.com/gotgenes/pi-permission-system/issues/129)) ([8f6edf7](https://github.com/gotgenes/pi-permission-system/commit/8f6edf727856a974dc8061c1ff6003838d916662))


### Documentation

* plan PermissionSession extraction ([#129](https://github.com/gotgenes/pi-permission-system/issues/129)) ([9dc21b4](https://github.com/gotgenes/pi-permission-system/commit/9dc21b457ff5ca5e95b920eed1e5b48511175cdf))
* **retro:** add retro notes for issue [#128](https://github.com/gotgenes/pi-permission-system/issues/128) ([9794053](https://github.com/gotgenes/pi-permission-system/commit/979405305ee5ddeac97186ea949373aff947a210))
* update architecture for PermissionSession ([#129](https://github.com/gotgenes/pi-permission-system/issues/129)) ([d452c50](https://github.com/gotgenes/pi-permission-system/commit/d452c50a7edb7ca1c2c7715836b007386814e1b3))

## [5.9.0](https://github.com/gotgenes/pi-permission-system/compare/v5.8.0...v5.9.0) (2026-05-08)


### Features

* add ForwardingManager class ([#128](https://github.com/gotgenes/pi-permission-system/issues/128)) ([7790380](https://github.com/gotgenes/pi-permission-system/commit/7790380eb0291f55724425a0bd6bd0b45cf15d91))


### Documentation

* plan ForwardingManager extraction ([#128](https://github.com/gotgenes/pi-permission-system/issues/128)) ([2f10450](https://github.com/gotgenes/pi-permission-system/commit/2f10450974adaedd7a43e8a7d986f8f61a0508db))
* **retro:** add retro notes for issue [#127](https://github.com/gotgenes/pi-permission-system/issues/127) ([2dde534](https://github.com/gotgenes/pi-permission-system/commit/2dde53416c535331972367ca2a44ba302b25d2a0))

## [5.8.0](https://github.com/gotgenes/pi-permission-system/compare/v5.7.0...v5.8.0) (2026-05-08)


### Features

* add SessionLogger interface and createSessionLogger factory ([#127](https://github.com/gotgenes/pi-permission-system/issues/127)) ([8765ab8](https://github.com/gotgenes/pi-permission-system/commit/8765ab8cfe461324fc2a89c80486d3dde190d9d9))


### Documentation

* plan SessionLogger extraction ([#127](https://github.com/gotgenes/pi-permission-system/issues/127)) ([b13ac62](https://github.com/gotgenes/pi-permission-system/commit/b13ac62513d4b233ee4fc3f554324a54518f75ba))
* **retro:** add retro notes for issue [#126](https://github.com/gotgenes/pi-permission-system/issues/126) ([3d8a38a](https://github.com/gotgenes/pi-permission-system/commit/3d8a38a09f9dfd2570178c856aec260ebdba89b1))
* update architecture doc for SessionLogger ([#127](https://github.com/gotgenes/pi-permission-system/issues/127)) ([8fa4123](https://github.com/gotgenes/pi-permission-system/commit/8fa41237dc1b43cbe4487ba7d0acf75dc768ad9c))

## [5.7.0](https://github.com/gotgenes/pi-permission-system/compare/v5.6.3...v5.7.0) (2026-05-08)


### Features

* extract ExtensionPaths value object ([#126](https://github.com/gotgenes/pi-permission-system/issues/126)) ([85bc347](https://github.com/gotgenes/pi-permission-system/commit/85bc347d3ed487210ffbed4c1c53616b5cf0d978))


### Documentation

* add handler decomposition plan ([#126](https://github.com/gotgenes/pi-permission-system/issues/126), [#127](https://github.com/gotgenes/pi-permission-system/issues/127), [#128](https://github.com/gotgenes/pi-permission-system/issues/128), [#129](https://github.com/gotgenes/pi-permission-system/issues/129), [#130](https://github.com/gotgenes/pi-permission-system/issues/130)) ([5a116a6](https://github.com/gotgenes/pi-permission-system/commit/5a116a6cf2f6ef29f5e6550821bb26b6e1c3a90f))
* add structural design heuristics, design-review skill, and plan-issue hook ([d8e3233](https://github.com/gotgenes/pi-permission-system/commit/d8e32330baa25fa5a5abaf75f8e442ce650fe5a9))
* extract code-style, testing, and markdown-conventions skills from AGENTS.md ([9d5ba7a](https://github.com/gotgenes/pi-permission-system/commit/9d5ba7a4a4a7a9e9fbdfe869fb42840238351b81))
* plan ExtensionPaths value object extraction ([#126](https://github.com/gotgenes/pi-permission-system/issues/126)) ([d76e6cc](https://github.com/gotgenes/pi-permission-system/commit/d76e6cc255dc124a7a914e8d178113e5b7c8bddd))
* rename target-architecture to architecture, strip progress indicators ([9776550](https://github.com/gotgenes/pi-permission-system/commit/9776550351f3b59f96bdad614cc5129a7be52a51))
* **retro:** add retro notes for issue [#110](https://github.com/gotgenes/pi-permission-system/issues/110) ([5597de3](https://github.com/gotgenes/pi-permission-system/commit/5597de3c9c64c3d672a1fc77ba7910e952545824))

## [5.6.3](https://github.com/gotgenes/pi-permission-system/compare/v5.6.2...v5.6.3) (2026-05-07)


### Documentation

* **retro:** add retro notes for issue [#109](https://github.com/gotgenes/pi-permission-system/issues/109) ([7d46cf4](https://github.com/gotgenes/pi-permission-system/commit/7d46cf4576d13d1d348355de88fb3dda6297be5a))
* update architecture for external-directory split ([#110](https://github.com/gotgenes/pi-permission-system/issues/110)) ([2e86fe7](https://github.com/gotgenes/pi-permission-system/commit/2e86fe79bc5de8076f775949824adadd4d366d7c))
* update plan for [#110](https://github.com/gotgenes/pi-permission-system/issues/110) after [#109](https://github.com/gotgenes/pi-permission-system/issues/109) landed ([3541d57](https://github.com/gotgenes/pi-permission-system/commit/3541d5739385b77ea8b21752595efd5cb75a6789))

## [5.6.2](https://github.com/gotgenes/pi-permission-system/compare/v5.6.1...v5.6.2) (2026-05-07)


### Documentation

* clarify bash arity table usage difference with OpenCode ([b387480](https://github.com/gotgenes/pi-permission-system/commit/b3874801a5084fa762cf521b743c21e3ed328d79))
* clarify doom_loop is not a Pi surface, not just deprecated ([8c38ab2](https://github.com/gotgenes/pi-permission-system/commit/8c38ab24dbcc4ecb1da8baa1276facfdfa21e785))
* detail superior bash path extraction vs OpenCode's allowlist approach ([b16767b](https://github.com/gotgenes/pi-permission-system/commit/b16767b5df0d9d8cf960a47f4bfbaa788ee21def))
* merge doom_loop into OpenCode-only surfaces row ([85756a7](https://github.com/gotgenes/pi-permission-system/commit/85756a72917d43931c9026c0120d6f2731bfae5e))
* move bash arity/tree-sitter to shared concepts (both at parity) ([6fd7cdc](https://github.com/gotgenes/pi-permission-system/commit/6fd7cdcad2917ab98fb80f80fe2abc8cc5c6bd36))
* plan deduplicate shared helpers ([#109](https://github.com/gotgenes/pi-permission-system/issues/109)) ([52bff2e](https://github.com/gotgenes/pi-permission-system/commit/52bff2ef7cf0f5d64cf27f90381b558ed8427ac6))
* plan split external-directory into focused modules ([#110](https://github.com/gotgenes/pi-permission-system/issues/110)) ([b2a4610](https://github.com/gotgenes/pi-permission-system/commit/b2a4610430e27f8ec9456c70e31ce54aa866ac30))
* **retro:** add retro notes for issue [#106](https://github.com/gotgenes/pi-permission-system/issues/106) ([a945814](https://github.com/gotgenes/pi-permission-system/commit/a945814799264396fa8fc94249791fdbc22b58c1))
* update target architecture for extracted helpers ([52693d6](https://github.com/gotgenes/pi-permission-system/commit/52693d6c0b0164d38b2746a40df9aab7031b47b2))

## [5.6.1](https://github.com/gotgenes/pi-permission-system/compare/v5.6.0...v5.6.1) (2026-05-07)


### Documentation

* document OpenCode compatibility ([#106](https://github.com/gotgenes/pi-permission-system/issues/106)) ([be9b2ab](https://github.com/gotgenes/pi-permission-system/commit/be9b2ab70ffcb839b0400f86ad46bd8d79089f15))
* plan document OpenCode compatibility ([#106](https://github.com/gotgenes/pi-permission-system/issues/106)) ([57aa584](https://github.com/gotgenes/pi-permission-system/commit/57aa5844a823779b4dfb3524c2bb4b696c56bd34))
* **retro:** add retro notes for issue [#118](https://github.com/gotgenes/pi-permission-system/issues/118) ([cb89995](https://github.com/gotgenes/pi-permission-system/commit/cb8999511d7e2ae3ca5b6e0b4510bbb9b4a114f9))

## [5.6.0](https://github.com/gotgenes/pi-permission-system/compare/v5.5.1...v5.6.0) (2026-05-07)


### Features

* implement runGateCheck gate runner ([#118](https://github.com/gotgenes/pi-permission-system/issues/118)) ([46da4b6](https://github.com/gotgenes/pi-permission-system/commit/46da4b616cddef22d9e1d198a3aac9c640d62bac))


### Documentation

* plan gate runner extraction ([#118](https://github.com/gotgenes/pi-permission-system/issues/118)) ([8c0eb18](https://github.com/gotgenes/pi-permission-system/commit/8c0eb1881dabc19dba65f72ba5c30ae02e4070a0))
* **retro:** add retro notes for issue [#111](https://github.com/gotgenes/pi-permission-system/issues/111) ([e327323](https://github.com/gotgenes/pi-permission-system/commit/e327323187822e779454eeafd7372c6256f869ba))
* update target architecture for gate runner ([#118](https://github.com/gotgenes/pi-permission-system/issues/118)) ([40e1b1b](https://github.com/gotgenes/pi-permission-system/commit/40e1b1b016730e9be3da18fcb831001a2f498081))

## [5.5.1](https://github.com/gotgenes/pi-permission-system/compare/v5.5.0...v5.5.1) (2026-05-07)


### Documentation

* plan narrow handler dependencies by splitting ExtensionRuntime ([#111](https://github.com/gotgenes/pi-permission-system/issues/111)) ([cb44dee](https://github.com/gotgenes/pi-permission-system/commit/cb44deea383fbcca8c8ba25bd4098f7dd8c35bfb))
* **retro:** add retro notes for issue [#108](https://github.com/gotgenes/pi-permission-system/issues/108) ([e967fd9](https://github.com/gotgenes/pi-permission-system/commit/e967fd96c6ed0a9ac0a4f0037889f1d9c88ebd97))
* update target architecture for gate interfaces and SessionState ([#111](https://github.com/gotgenes/pi-permission-system/issues/111)) ([85620c4](https://github.com/gotgenes/pi-permission-system/commit/85620c4486fdcf756c7039c15bdd8a295621ad37))

## [5.5.0](https://github.com/gotgenes/pi-permission-system/compare/v5.4.0...v5.5.0) (2026-05-07)


### Features

* extract FilePolicyLoader from PermissionManager ([705d800](https://github.com/gotgenes/pi-permission-system/commit/705d800ec326d99798be2abaeba83235adae55b2))


### Bug Fixes

* pass through npm calls targeting .pi/npm directory ([4104712](https://github.com/gotgenes/pi-permission-system/commit/4104712a17baa2b1eae5fd6388357b672798f8bb))


### Documentation

* add PolicyLoader to target architecture ([fbbb85f](https://github.com/gotgenes/pi-permission-system/commit/fbbb85f76830880c8b3906f3694c7a7f7bb7fab5))
* plan extract PolicyLoader from PermissionManager ([#108](https://github.com/gotgenes/pi-permission-system/issues/108)) ([4d5f0df](https://github.com/gotgenes/pi-permission-system/commit/4d5f0df11af4bd87061ca38c19a14cc807dd6e84))
* **retro:** add retro notes for issue [#107](https://github.com/gotgenes/pi-permission-system/issues/107) ([d979562](https://github.com/gotgenes/pi-permission-system/commit/d979562cee6e2aca0e1f2d232c8d18ddb7926dd4))

## [5.4.0](https://github.com/gotgenes/pi-permission-system/compare/v5.3.4...v5.4.0) (2026-05-07)


### Features

* add npm shim to enforce pnpm usage via mise ([6a446b2](https://github.com/gotgenes/pi-permission-system/commit/6a446b2e94c125f36377a2388dba2adbd0305459))


### Documentation

* add redundant integration test cleanup step ([#107](https://github.com/gotgenes/pi-permission-system/issues/107)) ([236d812](https://github.com/gotgenes/pi-permission-system/commit/236d812f35821860fd5253fedb0e8b26386a34ac))
* expand gate test surfaces in plan ([#107](https://github.com/gotgenes/pi-permission-system/issues/107)) ([d671556](https://github.com/gotgenes/pi-permission-system/commit/d671556054d35c4d542f9501600c546cb3574207))
* plan extract per-gate functions from handleToolCall ([#107](https://github.com/gotgenes/pi-permission-system/issues/107)) ([c867d34](https://github.com/gotgenes/pi-permission-system/commit/c867d345e70aad0be953275e5712270e154f4f0a))
* update architecture for gate extraction ([#107](https://github.com/gotgenes/pi-permission-system/issues/107)) ([fe4c967](https://github.com/gotgenes/pi-permission-system/commit/fe4c967d683be96031a7070390a8b8687dbb28ba))

## [5.3.4](https://github.com/gotgenes/pi-permission-system/compare/v5.3.3...v5.3.4) (2026-05-06)


### Documentation

* center logo with HTML align ([707f3e7](https://github.com/gotgenes/pi-permission-system/commit/707f3e7b6dead1d7f82942e4925ca137248e77ab))
* convert logo to PNG for npm compatibility ([c81e094](https://github.com/gotgenes/pi-permission-system/commit/c81e0949bcb6bd7acd11950050fcd4eb678d6e51))
* remove width constraint on logo ([d50930a](https://github.com/gotgenes/pi-permission-system/commit/d50930ac4e6dd7fe6e94f42338775b8e3a0093eb))

## [5.3.3](https://github.com/gotgenes/pi-permission-system/compare/v5.3.2...v5.3.3) (2026-05-06)


### Documentation

* add project logo, remove lock emoji from title ([3de430f](https://github.com/gotgenes/pi-permission-system/commit/3de430f9d139526550012dde13b2370622b0adf1))
* increase logo size to 200px ([cd983c8](https://github.com/gotgenes/pi-permission-system/commit/cd983c8bca92cd5378aace9ab8ba10419e45a825))

## [5.3.2](https://github.com/gotgenes/pi-permission-system/compare/v5.3.1...v5.3.2) (2026-05-06)


### Documentation

* fix ordered list continuation, use realistic quick-start config ([dd26166](https://github.com/gotgenes/pi-permission-system/commit/dd261666e497a280902790a5a50f7daf70a511a4))
* **retro:** add retro notes for issue [#98](https://github.com/gotgenes/pi-permission-system/issues/98) ([bf2bbc6](https://github.com/gotgenes/pi-permission-system/commit/bf2bbc61c748222ff4bef8234ed8543d7a93ad27))

## [5.3.1](https://github.com/gotgenes/pi-permission-system/compare/v5.3.0...v5.3.1) (2026-05-05)


### Documentation

* add permission frontmatter convention guide for subagent extensions ([c992959](https://github.com/gotgenes/pi-permission-system/commit/c99295960ad31e359fc1fbdea0ad45057d8366d8))
* add upstream issue template for subagent extension outreach ([79eef27](https://github.com/gotgenes/pi-permission-system/commit/79eef27fbee6786b5ef8c830ed0fce575d067b92))
* link permission frontmatter guide from README and target architecture ([df261fc](https://github.com/gotgenes/pi-permission-system/commit/df261fc36f9d9c527524b3301959a1be69bf8a51))
* plan shared permission frontmatter convention for subagent extensions ([#98](https://github.com/gotgenes/pi-permission-system/issues/98)) ([eec5763](https://github.com/gotgenes/pi-permission-system/commit/eec57637810a04c923ddff6e5991a8fbd95f4030))
* restructure README with inverted pyramid, extract reference docs ([db51142](https://github.com/gotgenes/pi-permission-system/commit/db51142e3bfc2283298c23a7a8517c72179f4611))
* **retro:** add retro notes for issue [#29](https://github.com/gotgenes/pi-permission-system/issues/29) ([be0620b](https://github.com/gotgenes/pi-permission-system/commit/be0620bc417297d43d5e7c0d04efd14f2844f147))

## [5.3.0](https://github.com/gotgenes/pi-permission-system/compare/v5.2.1...v5.3.0) (2026-05-05)


### Features

* add permission event types and emit helpers ([#29](https://github.com/gotgenes/pi-permission-system/issues/29)) ([45a4158](https://github.com/gotgenes/pi-permission-system/commit/45a415833818b78651671f6a33103e874cc137be))
* add permissions:rpc:check policy query RPC ([#29](https://github.com/gotgenes/pi-permission-system/issues/29)) ([b230ff8](https://github.com/gotgenes/pi-permission-system/commit/b230ff8078679d85a63f14888f3feb36054201ff))
* add permissions:rpc:prompt forwarding RPC ([#29](https://github.com/gotgenes/pi-permission-system/issues/29)) ([438227c](https://github.com/gotgenes/pi-permission-system/commit/438227c090d620c948cf91d26d8cf0b85ec9b66e))
* clean up RPC handlers on session shutdown ([#29](https://github.com/gotgenes/pi-permission-system/issues/29)) ([0a54a10](https://github.com/gotgenes/pi-permission-system/commit/0a54a108a824168bfab7059c3d78bd182dbbaccd))
* distinguish auto-approved from user-approved in decision events ([#29](https://github.com/gotgenes/pi-permission-system/issues/29)) ([746d988](https://github.com/gotgenes/pi-permission-system/commit/746d988fc0af4dd06e507b79069bf199b1c7dfd7))
* emit permission decision events from input handler ([#29](https://github.com/gotgenes/pi-permission-system/issues/29)) ([bfc21bb](https://github.com/gotgenes/pi-permission-system/commit/bfc21bba8c81aff58655df8928c43c4e68e9a2af))
* emit permission decision events from tool-call handler ([#29](https://github.com/gotgenes/pi-permission-system/issues/29)) ([40cf12e](https://github.com/gotgenes/pi-permission-system/commit/40cf12e78fcd52a37f7da46d75fb1c1b2a26d15e))
* emit permissions:ready on extension load ([#29](https://github.com/gotgenes/pi-permission-system/issues/29)) ([bfa3606](https://github.com/gotgenes/pi-permission-system/commit/bfa360633b25048e7f435141700dbbecaf77274c))


### Documentation

* document permission event API and RPC protocol ([#29](https://github.com/gotgenes/pi-permission-system/issues/29)) ([3872e54](https://github.com/gotgenes/pi-permission-system/commit/3872e5416bfb118b4ab5538a122ac3f9bccf40d7))
* plan permission event channel with decision broadcast and RPC ([#29](https://github.com/gotgenes/pi-permission-system/issues/29)) ([d31754a](https://github.com/gotgenes/pi-permission-system/commit/d31754ad90c02c11f6b92fcc3c33f8dbf76ccee3))
* **retro:** add retro notes for issue [#97](https://github.com/gotgenes/pi-permission-system/issues/97) ([43d66d9](https://github.com/gotgenes/pi-permission-system/commit/43d66d932fc4ed121a6789b241112c1bd6c777f0))

## [5.2.1](https://github.com/gotgenes/pi-permission-system/compare/v5.2.0...v5.2.1) (2026-05-05)


### Documentation

* document subagent extension coexistence ([#97](https://github.com/gotgenes/pi-permission-system/issues/97)) ([9bf2972](https://github.com/gotgenes/pi-permission-system/commit/9bf29726de98d44d7cfd8963f666be37fe807c9a))
* plan subagent extension coexistence documentation ([#97](https://github.com/gotgenes/pi-permission-system/issues/97)) ([4cf975f](https://github.com/gotgenes/pi-permission-system/commit/4cf975f505081c5df46b20a2dd2d65e9a9a877f9))
* **retro:** add retro notes for issue [#96](https://github.com/gotgenes/pi-permission-system/issues/96) ([8757ffc](https://github.com/gotgenes/pi-permission-system/commit/8757ffc3f186d137c65aea7abde9a383335584f8))

## [5.2.0](https://github.com/gotgenes/pi-permission-system/compare/v5.1.2...v5.2.0) (2026-05-05)


### Features

* add SUBAGENT_PARENT_SESSION_ENV_CANDIDATES, iterate in resolver ([#96](https://github.com/gotgenes/pi-permission-system/issues/96)) ([ac6831d](https://github.com/gotgenes/pi-permission-system/commit/ac6831d3418db0aee5d5ed4757d5833730a6e130))
* broaden SUBAGENT_ENV_HINT_KEYS for nicobailon + HazAT extensions ([#96](https://github.com/gotgenes/pi-permission-system/issues/96)) ([8adafdb](https://github.com/gotgenes/pi-permission-system/commit/8adafdb45af66cf99b000b3ad011bee5a2c90476))


### Documentation

* plan broaden subagent env hint keys ([#96](https://github.com/gotgenes/pi-permission-system/issues/96)) ([9fa97b7](https://github.com/gotgenes/pi-permission-system/commit/9fa97b7385e5b9203a35c80d15f980ac4501f788))
* update target-architecture subagent detection for [#96](https://github.com/gotgenes/pi-permission-system/issues/96) ([64cce35](https://github.com/gotgenes/pi-permission-system/commit/64cce3569c09cede690858af41d2f35611a8705f))

## [5.1.2](https://github.com/gotgenes/pi-permission-system/compare/v5.1.1...v5.1.2) (2026-05-05)


### Documentation

* fix README per-agent frontmatter example to flat format ([#78](https://github.com/gotgenes/pi-permission-system/issues/78)) ([1295427](https://github.com/gotgenes/pi-permission-system/commit/129542795218a6ada1f8d069a22b5ace5ec6c445))
* plan fix README frontmatter example and add missing tests ([#78](https://github.com/gotgenes/pi-permission-system/issues/78)) ([3fc99e1](https://github.com/gotgenes/pi-permission-system/commit/3fc99e1b3adf8193c94ac778617ca830488fa621))
* **retro:** add retro notes for issue [#93](https://github.com/gotgenes/pi-permission-system/issues/93) ([c9e8e89](https://github.com/gotgenes/pi-permission-system/commit/c9e8e89eb4057866198402add374d72a90a2fa2e))

## [5.1.1](https://github.com/gotgenes/pi-permission-system/compare/v5.1.0...v5.1.1) (2026-05-05)


### Bug Fixes

* discover global node_modules root from dev checkout via npm root -g fallback ([93aac81](https://github.com/gotgenes/pi-permission-system/commit/93aac81bd830ec260d2156b34ca8074f6c533255))


### Documentation

* note npm root -g fallback for dev checkout infrastructure reads ([d06caf7](https://github.com/gotgenes/pi-permission-system/commit/d06caf73371c7ea73f1c56a5efb86b2023292dd3))
* plan createRequire fallback for dev checkout infra read bypass ([#93](https://github.com/gotgenes/pi-permission-system/issues/93)) ([7750044](https://github.com/gotgenes/pi-permission-system/commit/775004477efff0d3cd2eb5ba7a0fcbdd98f3d122))
* plan npm root -g fallback for dev checkout infra read bypass ([#93](https://github.com/gotgenes/pi-permission-system/issues/93)) ([85e697c](https://github.com/gotgenes/pi-permission-system/commit/85e697c5062a36fd150bd4d6b377ca906b3a1dbf))
* **retro:** add retro notes for issue [#91](https://github.com/gotgenes/pi-permission-system/issues/91) ([d2d1263](https://github.com/gotgenes/pi-permission-system/commit/d2d1263955741053b2cf8718830d88043b9cdd8e))

## [5.1.0](https://github.com/gotgenes/pi-permission-system/compare/v5.0.0...v5.1.0) (2026-05-05)


### Features

* command-aware path extraction for pattern-first commands ([#91](https://github.com/gotgenes/pi-permission-system/issues/91)) ([befca23](https://github.com/gotgenes/pi-permission-system/commit/befca2341e1b54d9ed7e6ff3c3d465776afcc50d))


### Documentation

* plan command-aware path extraction for sed/awk/grep/rg/sd ([#91](https://github.com/gotgenes/pi-permission-system/issues/91)) ([be88a6a](https://github.com/gotgenes/pi-permission-system/commit/be88a6ab66ab386ce5843b3dd12218fc7968ee15))
* **retro:** add retro notes for issue [#88](https://github.com/gotgenes/pi-permission-system/issues/88) ([453a8ba](https://github.com/gotgenes/pi-permission-system/commit/453a8ba69fb68f24200be7a604f4fac4738c0cfe))

## [5.0.0](https://github.com/gotgenes/pi-permission-system/compare/v4.9.0...v5.0.0) (2026-05-05)


### ⚠ BREAKING CHANGES

* Rule.origin and PermissionCheckResult.origin are now required fields. Code that constructs Rule or PermissionCheckResult literals must include an origin value.

### Features

* add RuleOrigin type and origin field to Rule ([b4452d1](https://github.com/gotgenes/pi-permission-system/commit/b4452d1cc9e87a8315edcd6f5f2b1425310bd0b6))
* display rule origins in /permission-system show output ([af34c8e](https://github.com/gotgenes/pi-permission-system/commit/af34c8e808c7fa67bbe68635f776ec0fd8717bfa))
* include rule origin in permission review log entries ([b19fdf6](https://github.com/gotgenes/pi-permission-system/commit/b19fdf69b48248430410643ee20bee58535b99d9))
* make Rule.origin and PermissionCheckResult.origin required ([937a9f5](https://github.com/gotgenes/pi-permission-system/commit/937a9f5c4a9442611606fa3b27962555ed8c25a9))
* propagate origin to synthesized default rule ([04f9130](https://github.com/gotgenes/pi-permission-system/commit/04f91304ec5ba975ac512989c90757528a30ef7b))
* track and propagate rule origin through checkPermission ([327bc60](https://github.com/gotgenes/pi-permission-system/commit/327bc60e7f79aafd19995337f62244fd8b0c191f))


### Documentation

* plan rule origin provenance tracking ([#88](https://github.com/gotgenes/pi-permission-system/issues/88)) ([d8f8840](https://github.com/gotgenes/pi-permission-system/commit/d8f884028f03682a896dd0d6e8e5a335d8e669f5))
* **retro:** add retro notes for issue [#48](https://github.com/gotgenes/pi-permission-system/issues/48) ([2187a53](https://github.com/gotgenes/pi-permission-system/commit/2187a53d2af30d6a68f664b1ce4af0dc30b39061))
* update target architecture for required Rule.origin ([edf0620](https://github.com/gotgenes/pi-permission-system/commit/edf06209ce148b70131a5abf361070571db51e7b))
* update target architecture for rule origin provenance ([c82435b](https://github.com/gotgenes/pi-permission-system/commit/c82435bb75dd7b22331986c6a23bfe5cf1849ca7))

## [4.9.0](https://github.com/gotgenes/pi-permission-system/compare/v4.8.0...v4.9.0) (2026-05-05)


### Features

* bypass external_directory gate for Pi infrastructure reads ([229a352](https://github.com/gotgenes/pi-permission-system/commit/229a35222dd47f1d0c079f0bcd34760569e912f3))


### Bug Fixes

* skip regex patterns in bash external-directory path extraction ([9fe4ba6](https://github.com/gotgenes/pi-permission-system/commit/9fe4ba6d259c25aa0a9e3a5508884d26a303cac3))


### Documentation

* document piInfrastructureReadPaths config and infrastructure auto-allow ([65e0ac8](https://github.com/gotgenes/pi-permission-system/commit/65e0ac8ef8a4973c261628e026c3772faa0849ab))
* plan auto-allow reads from Pi infrastructure directories ([#48](https://github.com/gotgenes/pi-permission-system/issues/48)) ([06b8d44](https://github.com/gotgenes/pi-permission-system/commit/06b8d441d569b1c2893f5c434357eb8b2fc9180f))
* **retro:** add retro notes for issue [#53](https://github.com/gotgenes/pi-permission-system/issues/53) ([1988d7a](https://github.com/gotgenes/pi-permission-system/commit/1988d7ab09432df09825c560ba377233e0d3ab33))

## [4.8.0](https://github.com/gotgenes/pi-permission-system/compare/v4.7.0...v4.8.0) (2026-05-05)


### Features

* add expandHomePath utility for ~ and $HOME expansion ([18264e1](https://github.com/gotgenes/pi-permission-system/commit/18264e104f6aa12ca004a127d0f7b09b9e4fb740))
* expand ~ and $HOME in wildcard patterns at compile time ([3c7e0c2](https://github.com/gotgenes/pi-permission-system/commit/3c7e0c2ab92c1e6bb58fdab32cfd9ae2c72e100a))


### Documentation

* document ~/$HOME pattern expansion in schema, example config, and README ([8ad5190](https://github.com/gotgenes/pi-permission-system/commit/8ad51909512ca294c83876868407866290234882))
* plan home directory expansion in permission patterns ([#53](https://github.com/gotgenes/pi-permission-system/issues/53)) ([b5b77b6](https://github.com/gotgenes/pi-permission-system/commit/b5b77b640006b67b51420135be8fb78484c9d9a1))
* **retro:** add retro notes for issue [#52](https://github.com/gotgenes/pi-permission-system/issues/52) ([7fc8113](https://github.com/gotgenes/pi-permission-system/commit/7fc8113390fd1dd9cf09c05e903d597c16d80104))
* sleep before pulling release commit and tag ([af701b5](https://github.com/gotgenes/pi-permission-system/commit/af701b543b20f274ca9f8aa904af0a39bc232c26))

## [4.7.0](https://github.com/gotgenes/pi-permission-system/compare/v4.6.0...v4.7.0) (2026-05-05)


### Features

* add bash arity table with prefix lookup ([#52](https://github.com/gotgenes/pi-permission-system/issues/52)) ([56a8e81](https://github.com/gotgenes/pi-permission-system/commit/56a8e81911a5869bceabf9076bca6e1bb709814b))
* integrate arity table into suggestBashPattern ([#52](https://github.com/gotgenes/pi-permission-system/issues/52)) ([5a3c809](https://github.com/gotgenes/pi-permission-system/commit/5a3c8094319166a8f3bd7c97a68af6b8cd0d0205))


### Documentation

* document bash arity table ([#52](https://github.com/gotgenes/pi-permission-system/issues/52)) ([376ae5c](https://github.com/gotgenes/pi-permission-system/commit/376ae5cdd9d3a9d28f0e26ec26455f44b45b56d7))
* plan bash arity table for smart approval patterns ([#52](https://github.com/gotgenes/pi-permission-system/issues/52)) ([6a78244](https://github.com/gotgenes/pi-permission-system/commit/6a78244b7552563e331bb2d426aa0abd35ef9065))
* **retro:** add retro notes for issue [#60](https://github.com/gotgenes/pi-permission-system/issues/60) ([54ed04a](https://github.com/gotgenes/pi-permission-system/commit/54ed04a85e47a5b1ceb9d496851474856fb0fa17))

## [4.6.0](https://github.com/gotgenes/pi-permission-system/compare/v4.5.0...v4.6.0) (2026-05-05)


### Features

* bump tsconfig target to ES2023 ([#60](https://github.com/gotgenes/pi-permission-system/issues/60)) ([7557ffd](https://github.com/gotgenes/pi-permission-system/commit/7557ffdc6ee17a03aeb173f5439b1aab3437a311))


### Documentation

* plan tsconfig ES2023 bump ([#60](https://github.com/gotgenes/pi-permission-system/issues/60)) ([7005929](https://github.com/gotgenes/pi-permission-system/commit/70059296bb68a9f1aeb832ffdc9e89746c3d2c3e))
* **retro:** add retro notes for issue [#81](https://github.com/gotgenes/pi-permission-system/issues/81) ([7eb892e](https://github.com/gotgenes/pi-permission-system/commit/7eb892ee04c98e6edf8de7ddba5d1d973f1bc902))
* update AGENTS.md ES version floor to ES2023 ([#60](https://github.com/gotgenes/pi-permission-system/issues/60)) ([3fe87da](https://github.com/gotgenes/pi-permission-system/commit/3fe87da121a591ceb083506d0ac6a14b2cd8217a))

## [4.5.0](https://github.com/gotgenes/pi-permission-system/compare/v4.4.1...v4.5.0) (2026-05-05)


### Features

* add evaluateFirst multi-candidate evaluate helper ([6b1fa60](https://github.com/gotgenes/pi-permission-system/commit/6b1fa603e6eaf750624d1f553ddb84755ab9b78e))
* add input normalizer for non-MCP surfaces ([6d25624](https://github.com/gotgenes/pi-permission-system/commit/6d256241e3f599aa9db5952a16b10d10b72e5321))
* add MCP input normalization to input-normalizer ([6fa58b2](https://github.com/gotgenes/pi-permission-system/commit/6fa58b211f06eef5885f1e6f238285cdb77aab09))
* concatenate session rules into composed ruleset ([e85e844](https://github.com/gotgenes/pi-permission-system/commit/e85e844f414c6dfd14ffbbc74826c976d8f0f234))


### Documentation

* mark unified checkPermission as implemented in target architecture ([bb7214a](https://github.com/gotgenes/pi-permission-system/commit/bb7214a8363b6b1ad70ae1233f297d28c36cd423))
* plan unified checkPermission evaluate path ([#81](https://github.com/gotgenes/pi-permission-system/issues/81)) ([6562328](https://github.com/gotgenes/pi-permission-system/commit/65623287aa899424829b0e31e7c9aa46f17e3f81))
* **retro:** add retro notes for issue [#82](https://github.com/gotgenes/pi-permission-system/issues/82) ([f748fe0](https://github.com/gotgenes/pi-permission-system/commit/f748fe00105dbce087ec0a41653171c53364d531))

## [4.4.1](https://github.com/gotgenes/pi-permission-system/compare/v4.4.0...v4.4.1) (2026-05-05)


### Documentation

* plan delete deprecated defaults.ts stub ([#82](https://github.com/gotgenes/pi-permission-system/issues/82)) ([36fcace](https://github.com/gotgenes/pi-permission-system/commit/36fcaceab824b4334315767ba1cfd3fe24cff1b7))
* **retro:** add retro notes for issue [#80](https://github.com/gotgenes/pi-permission-system/issues/80) ([bfa11d5](https://github.com/gotgenes/pi-permission-system/commit/bfa11d539920dc24efbcab33329595da4e93e152))


### Miscellaneous Chores

* delete deprecated defaults.ts stub ([#82](https://github.com/gotgenes/pi-permission-system/issues/82)) ([40ae42a](https://github.com/gotgenes/pi-permission-system/commit/40ae42ad710bc502f19d8a27e409cc22a6bca4f8))

## [4.4.0](https://github.com/gotgenes/pi-permission-system/compare/v4.3.0...v4.4.0) (2026-05-05)


### Features

* wire PermissionPrompter and remove runtime promptPermission ([#80](https://github.com/gotgenes/pi-permission-system/issues/80)) ([8e0980a](https://github.com/gotgenes/pi-permission-system/commit/8e0980a207f9f665ad2af3ad635d73e28d313c91))


### Documentation

* add permission-prompter architecture note ([#80](https://github.com/gotgenes/pi-permission-system/issues/80)) ([6cc1b60](https://github.com/gotgenes/pi-permission-system/commit/6cc1b6089a332f262919d20ad27d5ca7a69b0b6d))
* add permission-prompter to target architecture module map ([#80](https://github.com/gotgenes/pi-permission-system/issues/80)) ([c5cf101](https://github.com/gotgenes/pi-permission-system/commit/c5cf101af827dc108c66c5dffff94e05d4234e4c))
* add permission-prompter to v3 architecture module map ([#80](https://github.com/gotgenes/pi-permission-system/issues/80)) ([94be5b5](https://github.com/gotgenes/pi-permission-system/commit/94be5b58b9018b1918102089bb2fff8401d8bad5))
* plan extract PermissionPrompter class ([#80](https://github.com/gotgenes/pi-permission-system/issues/80)) ([50fcf34](https://github.com/gotgenes/pi-permission-system/commit/50fcf3400ed8574b036cacd2afc1b9e2161d41c6))
* remove interim permission-prompter from target architecture map ([#80](https://github.com/gotgenes/pi-permission-system/issues/80)) ([f300f08](https://github.com/gotgenes/pi-permission-system/commit/f300f086b42d9d52ff0668b63a191addebe3140e))
* **retro:** add retro notes for issue [#51](https://github.com/gotgenes/pi-permission-system/issues/51) ([79a564d](https://github.com/gotgenes/pi-permission-system/commit/79a564d24977da7cffa3d9d65391a75dd0d7e99c))
* update target architecture for completed work and new issues ([#80](https://github.com/gotgenes/pi-permission-system/issues/80)) ([e661345](https://github.com/gotgenes/pi-permission-system/commit/e661345c8a699e702cbaa9adb7d61c80a25010d2))

## [4.3.0](https://github.com/gotgenes/pi-permission-system/compare/v4.2.0...v4.3.0) (2026-05-04)


### Features

* add pattern-suggest module for session approval patterns ([0752604](https://github.com/gotgenes/pi-permission-system/commit/0752604ea63a3bcbf4a8d15f6a9760dde4de9b9d))
* dynamic session approval label in permission dialog ([4737f0d](https://github.com/gotgenes/pi-permission-system/commit/4737f0dbe69b579dca057a149788408cb63e52ec))
* extend checkPermission session evaluation to all surfaces ([ffc6731](https://github.com/gotgenes/pi-permission-system/commit/ffc67312e09fb0df0c4dbcb572a625b92c3cd018))
* extend permission gate with sessionApproval pass-through ([a77bad7](https://github.com/gotgenes/pi-permission-system/commit/a77bad7d9193a5500678bf18ac7854da0be2e79f))
* generalize session approvals to all permission surfaces ([#51](https://github.com/gotgenes/pi-permission-system/issues/51)) ([2fcc2e3](https://github.com/gotgenes/pi-permission-system/commit/2fcc2e37db4f704702fd3d4c64a1388ab417c407))


### Documentation

* document generalized session approvals ([#51](https://github.com/gotgenes/pi-permission-system/issues/51)) ([233666e](https://github.com/gotgenes/pi-permission-system/commit/233666e496dd81165dec44ef4242bca090750edd))
* plan generalized session approvals for all surfaces ([#51](https://github.com/gotgenes/pi-permission-system/issues/51)) ([3b40cf9](https://github.com/gotgenes/pi-permission-system/commit/3b40cf954c9f598c7c3c199a4137e897c4fce4b2))
* **retro:** add retro notes for issue [#74](https://github.com/gotgenes/pi-permission-system/issues/74) ([0eb2ea0](https://github.com/gotgenes/pi-permission-system/commit/0eb2ea001669cba1436d564af9e28ca0ff26c77e))

## [4.2.0](https://github.com/gotgenes/pi-permission-system/compare/v4.1.1...v4.2.0) (2026-05-04)


### Features

* replace shell-quote with tree-sitter-bash for AST-based path extraction ([7dce2a4](https://github.com/gotgenes/pi-permission-system/commit/7dce2a4d264d26171a1d54db265f12f3f1d342c6))


### Documentation

* note tree-sitter follow-up addressed by [#74](https://github.com/gotgenes/pi-permission-system/issues/74) ([bd835bd](https://github.com/gotgenes/pi-permission-system/commit/bd835bda62af9aa9149149c24ddb14927d52abf4))
* note tree-sitter-bash AST parser in architecture docs ([ecec2a6](https://github.com/gotgenes/pi-permission-system/commit/ecec2a6db375434a4bc2f920a21741fe29786896))
* plan tree-sitter-bash AST-based path extraction ([#74](https://github.com/gotgenes/pi-permission-system/issues/74)) ([1693794](https://github.com/gotgenes/pi-permission-system/commit/1693794fd423eaf872400a2a6dc3b0d0faeba13a))
* rename current-architecture.md to v3-architecture.md ([38d91c5](https://github.com/gotgenes/pi-permission-system/commit/38d91c587a842caa71b32f379ed5723e73f490f4))
* **retro:** add retro notes for issue [#73](https://github.com/gotgenes/pi-permission-system/issues/73) ([d73097d](https://github.com/gotgenes/pi-permission-system/commit/d73097d7dcda097fb79b6213b482bac8642f4a90))
* update bash external-directory description for tree-sitter AST parser ([d022d3d](https://github.com/gotgenes/pi-permission-system/commit/d022d3d87ab0cc0192ba9adbaf3b9bf379dfa414))

## [4.1.1](https://github.com/gotgenes/pi-permission-system/compare/v4.1.0...v4.1.1) (2026-05-04)


### Bug Fixes

* add dotAll flag so wildcard `*` matches newlines ([#73](https://github.com/gotgenes/pi-permission-system/issues/73)) ([57085e3](https://github.com/gotgenes/pi-permission-system/commit/57085e3c9dbe80204e5629a3c18f8c1f307226f8))


### Documentation

* plan dotAll fix for wildcard multiline matching ([#73](https://github.com/gotgenes/pi-permission-system/issues/73)) ([b9c0a5b](https://github.com/gotgenes/pi-permission-system/commit/b9c0a5bcabc0f77e85d4932f7e2cf584a1bc0223))

## [4.1.0](https://github.com/gotgenes/pi-permission-system/compare/v4.0.1...v4.1.0) (2026-05-04)


### Features

* replace regex tokenizer with shell-quote ([#72](https://github.com/gotgenes/pi-permission-system/issues/72)) ([1568992](https://github.com/gotgenes/pi-permission-system/commit/1568992fb82b45c84b10e3cc9c50777f42d30dfa))


### Documentation

* plan shell-quote tokenizer migration ([#72](https://github.com/gotgenes/pi-permission-system/issues/72)) ([0390e06](https://github.com/gotgenes/pi-permission-system/commit/0390e06de5ca0e5cc79e438f2a94db610ca90289))
* **retro:** add retro notes for issue [#68](https://github.com/gotgenes/pi-permission-system/issues/68) ([4775453](https://github.com/gotgenes/pi-permission-system/commit/47754539806fbe15f739ea0eaa4a100a69db82ef))

## [4.0.1](https://github.com/gotgenes/pi-permission-system/compare/v4.0.0...v4.0.1) (2026-05-04)


### Bug Fixes

* skip bare-slash tokens in bash external-directory extraction ([#68](https://github.com/gotgenes/pi-permission-system/issues/68)) ([84f9a88](https://github.com/gotgenes/pi-permission-system/commit/84f9a88243c0033ddf1ca72894ceb42eb0f5f298))


### Documentation

* plan skip bare-slash tokens in external-directory extraction ([#68](https://github.com/gotgenes/pi-permission-system/issues/68)) ([f4fded8](https://github.com/gotgenes/pi-permission-system/commit/f4fded847ab7f4c8b82ebcd08edb0cb640d18fa7))
* plan skip bare-slash tokens in external-directory extraction ([#68](https://github.com/gotgenes/pi-permission-system/issues/68)) ([f33964a](https://github.com/gotgenes/pi-permission-system/commit/f33964a34da726e3667319bf2015193de171767c))
* **retro:** add retro notes for issue [#66](https://github.com/gotgenes/pi-permission-system/issues/66) ([61d7e5c](https://github.com/gotgenes/pi-permission-system/commit/61d7e5ca30c20c48f52152f9443ede1900010410))

## [4.0.0](https://github.com/gotgenes/pi-permission-system/compare/v3.11.0...v4.0.0) (2026-05-04)


### ⚠ BREAKING CHANGES

* permissions.schema.json replaces defaultPolicy/tools/bash/mcp/ skills/special with a single 'permission' object where each key is a surface name and the value is a PermissionState string or pattern-action map. config.example.json updated to use flat format.
* warning message now directs users to the flat permission format ({ "permission": { ... } }) instead of the legacy pi-permissions.jsonc paths. The set of detected misplaced keys is unchanged (legacy keys still warned). The flat-format "permission" key is explicitly not flagged.
* PermissionManager now reads policy from permission.permission (FlatPermissionConfig) instead of defaultPolicy/tools/bash/mcp/skills/special.
* PermissionDefaultPolicy type is removed from types.ts. ScopeConfig is simplified to { permission?: FlatPermissionConfig }. defaults.ts is stubbed out pending full PermissionManager migration (step 5).
* UnifiedPermissionConfig now has permission?: FlatPermissionConfig instead of defaultPolicy/tools/bash/mcp/skills/special fields. Legacy files parsed with the flat-format parser produce no permission rules (old-format keys are not translated). Migration warnings are still emitted for legacy file paths.
* synthesizeDefaults() now accepts PermissionState (the universal default) instead of PermissionDefaultPolicy. synthesizeOverrides() and OverrideScope are removed. composeRuleset() signature reduced from 4 parameters to 3 (no overrides layer). PermissionManager is updated in a follow-up step.
* introduces FlatPermissionConfig type and normalizeFlatConfig(). The legacy normalizeConfig() remains temporarily until PermissionManager is updated in a follow-up step.

### Features

* add normalizeFlatConfig for flat permission format ([#66](https://github.com/gotgenes/pi-permission-system/issues/66)) ([c8f6177](https://github.com/gotgenes/pi-permission-system/commit/c8f61770e081447801fa301c661cacd591a4368f))
* remove PermissionDefaultPolicy and legacy defaults ([#66](https://github.com/gotgenes/pi-permission-system/issues/66)) ([404ffa1](https://github.com/gotgenes/pi-permission-system/commit/404ffa115708b8c6cf02df79910adb0cd0b0ce2f))
* replace config-loader with flat permission format ([#66](https://github.com/gotgenes/pi-permission-system/issues/66)) ([0bd8d71](https://github.com/gotgenes/pi-permission-system/commit/0bd8d71fa770a290fa3834aa598aa75d71fe6cfc))
* simplify synthesize layer for flat config ([#66](https://github.com/gotgenes/pi-permission-system/issues/66)) ([c9a73a4](https://github.com/gotgenes/pi-permission-system/commit/c9a73a4d393a36a21e5d0617c1d803806da569e0))
* update misplaced-key detection for flat format ([#66](https://github.com/gotgenes/pi-permission-system/issues/66)) ([5b8e9da](https://github.com/gotgenes/pi-permission-system/commit/5b8e9da475c056c621759e32d58ba36a67b35174))
* update PermissionManager for flat permission config ([#66](https://github.com/gotgenes/pi-permission-system/issues/66)) ([eb578b0](https://github.com/gotgenes/pi-permission-system/commit/eb578b0585c7081a703254cf404bb2a6e81a5e06))
* update schema and example for flat permission format ([#66](https://github.com/gotgenes/pi-permission-system/issues/66)) ([32dd44d](https://github.com/gotgenes/pi-permission-system/commit/32dd44da1ee7498633c22858675f65e4ed36a8e2))


### Documentation

* acknowledge MasuRii/pi-permission-system as the upstream origin ([fe8b642](https://github.com/gotgenes/pi-permission-system/commit/fe8b642ba83e2cacfc2f42e460b62d3270f62354))
* add legacy-to-flat migration guide ([#66](https://github.com/gotgenes/pi-permission-system/issues/66)) ([d415cc4](https://github.com/gotgenes/pi-permission-system/commit/d415cc451c06cf8b580e9924aac0e73fc537872b))
* add migration guide and fork-language revision to plan ([#66](https://github.com/gotgenes/pi-permission-system/issues/66)) ([be58dd1](https://github.com/gotgenes/pi-permission-system/commit/be58dd18ae85ddbe058f9075244fd36e4538c842))
* link MasuRii profile and acknowledge OpenCode inspiration ([21e5bc7](https://github.com/gotgenes/pi-permission-system/commit/21e5bc765db26a0cf9109dc396f969bb0c414c02))
* plan flat permission config format ([#66](https://github.com/gotgenes/pi-permission-system/issues/66)) ([b5e0657](https://github.com/gotgenes/pi-permission-system/commit/b5e0657ab2925c569eac167a604def34b9473284))
* remove unrelated pi extensions section from README ([22d0057](https://github.com/gotgenes/pi-permission-system/commit/22d0057d8feee6a3ae425e8f19d1dffec4387580))
* **retro:** add retro notes for issue [#65](https://github.com/gotgenes/pi-permission-system/issues/65) ([9e85dcb](https://github.com/gotgenes/pi-permission-system/commit/9e85dcb8efe95daadb1aaf1704eb0536b91d8d31))
* revise fork language from friendly to full fork ([#66](https://github.com/gotgenes/pi-permission-system/issues/66)) ([bcea397](https://github.com/gotgenes/pi-permission-system/commit/bcea3973cb2e6bad7a49c594f85418f292a30d23))

## [3.11.0](https://github.com/gotgenes/pi-permission-system/compare/v3.10.0...v3.11.0) (2026-05-04)


### Features

* add "session" source to PermissionCheckResult ([#65](https://github.com/gotgenes/pi-permission-system/issues/65)) ([039ae26](https://github.com/gotgenes/pi-permission-system/commit/039ae26c5756ae51d97da27aee53a7ca8b55fa91))
* add synthesize module (synthesizeDefaults, synthesizeOverrides, synthesizeBaseline, composeRuleset) ([#65](https://github.com/gotgenes/pi-permission-system/issues/65)) ([e0469b2](https://github.com/gotgenes/pi-permission-system/commit/e0469b26a49cdb2858b1d441615f5511d5c271d5))
* compose ruleset with synthesized defaults and overrides ([#65](https://github.com/gotgenes/pi-permission-system/issues/65)) ([dac47c1](https://github.com/gotgenes/pi-permission-system/commit/dac47c1ce4fe6b98ee657e2cb7dca46c1dbf5c89))
* remove separate session pre-check from tool_call ([#65](https://github.com/gotgenes/pi-permission-system/issues/65)) ([d156e9b](https://github.com/gotgenes/pi-permission-system/commit/d156e9be08c053ebe62bb5f198d3f0ee411c6728))
* tag session rules with layer metadata ([#65](https://github.com/gotgenes/pi-permission-system/issues/65)) ([2346f95](https://github.com/gotgenes/pi-permission-system/commit/2346f957e0e552846870576c129f1fc8a620ef0d))


### Documentation

* drop backward-compat language for config format ([#66](https://github.com/gotgenes/pi-permission-system/issues/66)) ([fabde91](https://github.com/gotgenes/pi-permission-system/commit/fabde91e86afc08ac8ccf11c211a701d01a4d91a))
* plan generalized session approvals and update target architecture ([#51](https://github.com/gotgenes/pi-permission-system/issues/51)) ([23a019a](https://github.com/gotgenes/pi-permission-system/commit/23a019af3ef381f89a145ab8d435c2447b538894))
* plan synthesize defaults into ruleset and unify evaluate path ([#65](https://github.com/gotgenes/pi-permission-system/issues/65)) ([295fd10](https://github.com/gotgenes/pi-permission-system/commit/295fd10d77827b547ad14c50d73709c3f45cbebf))
* **retro:** add retro notes for issue [#57](https://github.com/gotgenes/pi-permission-system/issues/57) ([cffb3a5](https://github.com/gotgenes/pi-permission-system/commit/cffb3a56ee8059015f89bbe7ba2922eee45d3dda))
* update architecture for synthesized defaults and deprecate getSurfaceDefault() ([#65](https://github.com/gotgenes/pi-permission-system/issues/65)) ([e703809](https://github.com/gotgenes/pi-permission-system/commit/e7038090ce9e8b42e6f4c4423bcf8c03fb1aa3ea))

## [3.10.0](https://github.com/gotgenes/pi-permission-system/compare/v3.9.0...v3.10.0) (2026-05-04)


### Features

* migrate tool_call external_directory to SessionRules ([42c2bd9](https://github.com/gotgenes/pi-permission-system/commit/42c2bd91dbc35c6e4343133fb907f43a6a2550bf))
* remove SessionApprovalCache ([9d5a5be](https://github.com/gotgenes/pi-permission-system/commit/9d5a5be8251491a66b2826183ca22cbd5a232374))
* replace SessionApprovalCache with SessionRules in runtime ([4cec9c5](https://github.com/gotgenes/pi-permission-system/commit/4cec9c553779afa8a5fb62bf2ffbd35a43af3e23))


### Documentation

* plan replace SessionApprovalCache with session Ruleset ([#57](https://github.com/gotgenes/pi-permission-system/issues/57)) ([ed1cefe](https://github.com/gotgenes/pi-permission-system/commit/ed1cefec2fd81542084460eb02cd3706b7093c07))
* **retro:** add retro notes for issue [#56](https://github.com/gotgenes/pi-permission-system/issues/56) ([f97f65c](https://github.com/gotgenes/pi-permission-system/commit/f97f65c448bd907866042bf9804378f441ae7c36))
* update session approval references ([#57](https://github.com/gotgenes/pi-permission-system/issues/57)) ([40e5e89](https://github.com/gotgenes/pi-permission-system/commit/40e5e89bf29b404b36fedaa48c896391d30574f6))

## [3.9.0](https://github.com/gotgenes/pi-permission-system/compare/v3.8.0...v3.9.0) (2026-05-03)


### Features

* add normalizeConfig and defaults modules ([84f9c3e](https://github.com/gotgenes/pi-permission-system/commit/84f9c3ef1c665e8d55b694ecf8bbec2dff41b093))
* evaluate() accepts optional defaultAction parameter ([69dde81](https://github.com/gotgenes/pi-permission-system/commit/69dde81d05722065307b04102a8af6935df0e17c))


### Bug Fixes

* remove unused imports flagged by biome ([62704a3](https://github.com/gotgenes/pi-permission-system/commit/62704a3b5c833af74a3bd27942ffc4247c92c12c))


### Documentation

* mark [#42](https://github.com/gotgenes/pi-permission-system/issues/42) and [#43](https://github.com/gotgenes/pi-permission-system/issues/43) complete in target architecture ([04430f2](https://github.com/gotgenes/pi-permission-system/commit/04430f2ea000e9607541262a71ad2be633dc7bb6))
* mark [#56](https://github.com/gotgenes/pi-permission-system/issues/56) complete in target architecture ([2fe95c5](https://github.com/gotgenes/pi-permission-system/commit/2fe95c577ec97e78c1390db91020294ba25662e0))
* plan unify Rule type and normalize config into flat Ruleset ([#56](https://github.com/gotgenes/pi-permission-system/issues/56)) ([61e8c48](https://github.com/gotgenes/pi-permission-system/commit/61e8c4800f39a173b69f2773e8b2f09fa9c7318b))
* **retro:** add retro notes for issue [#43](https://github.com/gotgenes/pi-permission-system/issues/43) ([bd6aea6](https://github.com/gotgenes/pi-permission-system/commit/bd6aea6ed2e1dfdad1ef610f9abb8319d87460cd))

## [3.8.0](https://github.com/gotgenes/pi-permission-system/compare/v3.7.0...v3.8.0) (2026-05-03)


### Features

* define ExtensionRuntime and createExtensionRuntime factory ([#43](https://github.com/gotgenes/pi-permission-system/issues/43)) ([6ad3db6](https://github.com/gotgenes/pi-permission-system/commit/6ad3db6671629f6480a49e6be890dbaff211ad69))
* eliminate module-scope state in src/index.ts ([#43](https://github.com/gotgenes/pi-permission-system/issues/43)) ([45b2bc1](https://github.com/gotgenes/pi-permission-system/commit/45b2bc1f4bff3693f295892c942328cc6a53f5e0))
* relocate factory helpers into src/runtime.ts ([#43](https://github.com/gotgenes/pi-permission-system/issues/43)) ([88c1acd](https://github.com/gotgenes/pi-permission-system/commit/88c1acd4e99f24e808b60bbeee2cbed69c2a67ef))
* simplify HandlerDeps to use ExtensionRuntime ([#43](https://github.com/gotgenes/pi-permission-system/issues/43)) ([2ff5971](https://github.com/gotgenes/pi-permission-system/commit/2ff59712f88c8bde2095df7e475ecb0c19cb3335))
* thread logger through forwarded-permissions IO ([#43](https://github.com/gotgenes/pi-permission-system/issues/43)) ([66db158](https://github.com/gotgenes/pi-permission-system/commit/66db158cfe423cf503fc08fc472f31f595527381))


### Documentation

* plan eliminate module-scope mutable state ([#43](https://github.com/gotgenes/pi-permission-system/issues/43)) ([6a782d7](https://github.com/gotgenes/pi-permission-system/commit/6a782d7e8df871c15cf9d5c4b27c5e90f9e12d4d))
* **retro:** add retro notes for issue [#42](https://github.com/gotgenes/pi-permission-system/issues/42) ([9b91110](https://github.com/gotgenes/pi-permission-system/commit/9b91110832e562440c3a881bb16e5f0a7989b33a))
* update plan with implementation notes ([#43](https://github.com/gotgenes/pi-permission-system/issues/43)) ([d29a7c0](https://github.com/gotgenes/pi-permission-system/commit/d29a7c0d037f3e44791c713474190a1873a5d294))

## [3.7.0](https://github.com/gotgenes/pi-permission-system/compare/v3.6.0...v3.7.0) (2026-05-03)


### Features

* define HandlerDeps interface for handler extraction ([#42](https://github.com/gotgenes/pi-permission-system/issues/42)) ([a71e553](https://github.com/gotgenes/pi-permission-system/commit/a71e553ec988b4b222177f90a21519757cb62380))
* extract before_agent_start handler into src/handlers/before-agent-start.ts ([#42](https://github.com/gotgenes/pi-permission-system/issues/42)) ([9443a99](https://github.com/gotgenes/pi-permission-system/commit/9443a99b0e60b17868fc240782c2b31f53f409af))
* extract input handler into src/handlers/input.ts ([#42](https://github.com/gotgenes/pi-permission-system/issues/42)) ([196862a](https://github.com/gotgenes/pi-permission-system/commit/196862a86b270628b77f23049eb4902f85cde617))
* extract lifecycle handlers into src/handlers/lifecycle.ts ([#42](https://github.com/gotgenes/pi-permission-system/issues/42)) ([0edb194](https://github.com/gotgenes/pi-permission-system/commit/0edb194be90b5c5b5465acb4be38fbd2f749cdf9))
* extract tool_call handler into src/handlers/tool-call.ts ([#42](https://github.com/gotgenes/pi-permission-system/issues/42)) ([a4b81ca](https://github.com/gotgenes/pi-permission-system/commit/a4b81caa34da4959988ac311952a881ffdad72fe))


### Documentation

* align handler extraction plan with architecture docs ([#42](https://github.com/gotgenes/pi-permission-system/issues/42)) ([4d91e03](https://github.com/gotgenes/pi-permission-system/commit/4d91e03b9ba11beccc5855d81f1f15be707495b0))
* **retro:** add retro notes for issue [#55](https://github.com/gotgenes/pi-permission-system/issues/55) ([ee763ff](https://github.com/gotgenes/pi-permission-system/commit/ee763ffccfbf19b9ec3627ea29847251e1505020))
* update plan with implementation notes for handler extraction ([#42](https://github.com/gotgenes/pi-permission-system/issues/42)) ([73603b2](https://github.com/gotgenes/pi-permission-system/commit/73603b25f5b5a53b0dd4300620b1f8ef8c844353))

## [3.6.0](https://github.com/gotgenes/pi-permission-system/compare/v3.5.0...v3.6.0) (2026-05-03)


### Features

* add Rule, Ruleset, getDefaultAction, and evaluate() in src/rule.ts ([482e00a](https://github.com/gotgenes/pi-permission-system/commit/482e00a04289f46f14c4b94486fbd98232159d66))
* add wildcardMatch convenience function to wildcard-matcher ([fa65219](https://github.com/gotgenes/pi-permission-system/commit/fa6521954a71ab146f14b87dc0723434a6dfd5ae))


### Bug Fixes

* replace findLast with manual backwards loop in evaluate() ([1911f37](https://github.com/gotgenes/pi-permission-system/commit/1911f37dd6074d926f959aeefa3d795b29d1681c))


### Documentation

* mark [#55](https://github.com/gotgenes/pi-permission-system/issues/55) complete in target architecture refactoring sequence ([0c87289](https://github.com/gotgenes/pi-permission-system/commit/0c87289d053a7f8c33aaa21a515db28d097a1925))
* plan extract pure evaluate() function ([#55](https://github.com/gotgenes/pi-permission-system/issues/55)) ([fd11860](https://github.com/gotgenes/pi-permission-system/commit/fd118606ba90af83d2d9eb5e752e76353beaf0ba))
* **retro:** add retro notes for issue [#54](https://github.com/gotgenes/pi-permission-system/issues/54) ([d7c5e8a](https://github.com/gotgenes/pi-permission-system/commit/d7c5e8aaae31fa658bcfb235547662bf226e6855))

## [3.5.0](https://github.com/gotgenes/pi-permission-system/compare/v3.4.0...v3.5.0) (2026-05-03)


### Features

* deprecate doom_loop special permission key ([68e70e7](https://github.com/gotgenes/pi-permission-system/commit/68e70e71b68e5a76a071ef4613da356a91080158))
* remove doom_loop from type union and config-loader ([bf2f288](https://github.com/gotgenes/pi-permission-system/commit/bf2f2886a800187337e82954e812e6d05e9bd451))


### Documentation

* add architecture documents for current and target permission model ([aab1ac5](https://github.com/gotgenes/pi-permission-system/commit/aab1ac50c4478d2e393c2a796bf6fcc4ec606f79))
* plan doom_loop deprecation ([#54](https://github.com/gotgenes/pi-permission-system/issues/54)) ([2e730f5](https://github.com/gotgenes/pi-permission-system/commit/2e730f52189dd2996ebbe90dd5d2b3206a45d1f6))
* plan handler extraction from piPermissionSystemExtension ([#42](https://github.com/gotgenes/pi-permission-system/issues/42)) ([6ecd419](https://github.com/gotgenes/pi-permission-system/commit/6ecd4190fb9a60009eb695b4998ab8a1d1419139))
* remove doom_loop from schema, example, and README ([7f422e0](https://github.com/gotgenes/pi-permission-system/commit/7f422e086f0052e0d9449dbd0122c57b923b053d))
* **retro:** add retro notes for issue [#45](https://github.com/gotgenes/pi-permission-system/issues/45) ([14c5559](https://github.com/gotgenes/pi-permission-system/commit/14c55595c5abfaa51f8ec83369452db5f457836c))

## [3.4.0](https://github.com/gotgenes/pi-permission-system/compare/v3.3.0...v3.4.0) (2026-05-03)


### Features

* add "approve for session" option to permission dialog ([#45](https://github.com/gotgenes/pi-permission-system/issues/45)) ([909d5ee](https://github.com/gotgenes/pi-permission-system/commit/909d5ee540615f876852b3bdb60154487c2570fd))
* add SessionApprovalCache for ephemeral session approvals ([#45](https://github.com/gotgenes/pi-permission-system/issues/45)) ([4f97779](https://github.com/gotgenes/pi-permission-system/commit/4f9777980eba139c9c85a027eeddc84ff932911c))
* wire session approvals into external-directory gates ([#45](https://github.com/gotgenes/pi-permission-system/issues/45)) ([3ab156d](https://github.com/gotgenes/pi-permission-system/commit/3ab156dc4ad10bd37938a5096dc6c33970767b1a))


### Documentation

* document session-scoped approval option ([#45](https://github.com/gotgenes/pi-permission-system/issues/45)) ([eb1eb9c](https://github.com/gotgenes/pi-permission-system/commit/eb1eb9c0052e7dd88ad7162b322160cfd6e0e62b))
* plan session-scoped approvals for permission prompts ([#45](https://github.com/gotgenes/pi-permission-system/issues/45)) ([29dcede](https://github.com/gotgenes/pi-permission-system/commit/29dcede17ad68fd3980bf3289069e237de2b4ef0))
* **retro:** add retro notes for issue [#41](https://github.com/gotgenes/pi-permission-system/issues/41) ([fd2755f](https://github.com/gotgenes/pi-permission-system/commit/fd2755fcf4ec68c9e65e6128e9b869da1f368abb))

## [3.3.0](https://github.com/gotgenes/pi-permission-system/compare/v3.2.0...v3.3.0) (2026-05-03)


### Features

* add permission-gate module ([507a1b6](https://github.com/gotgenes/pi-permission-system/commit/507a1b6155513562958bb277cd7c38ed8d44c215)), closes [#41](https://github.com/gotgenes/pi-permission-system/issues/41)


### Documentation

* plan extract reusable permission-gate function ([#41](https://github.com/gotgenes/pi-permission-system/issues/41)) ([2458bf2](https://github.com/gotgenes/pi-permission-system/commit/2458bf28f6c698db78c7a65cfdb6afa488e5b6ee))
* **retro:** add retro notes for issue [#44](https://github.com/gotgenes/pi-permission-system/issues/44) ([963bb1b](https://github.com/gotgenes/pi-permission-system/commit/963bb1ba78d7e305a80732a55e385266e5222b82))

## [3.2.0](https://github.com/gotgenes/pi-permission-system/compare/v3.1.0...v3.2.0) (2026-05-03)


### Features

* add SAFE_SYSTEM_PATHS allowlist and isSafeSystemPath helper ([#44](https://github.com/gotgenes/pi-permission-system/issues/44)) ([331b53f](https://github.com/gotgenes/pi-permission-system/commit/331b53f1a6425c7ee641127cbc82b5aada1e7018))
* filter safe system paths from bash external path extraction ([#44](https://github.com/gotgenes/pi-permission-system/issues/44)) ([a0a907f](https://github.com/gotgenes/pi-permission-system/commit/a0a907f020cbf08722ea47be11d3f67fc95ef448))
* skip safe system paths in isPathOutsideWorkingDirectory ([#44](https://github.com/gotgenes/pi-permission-system/issues/44)) ([360594c](https://github.com/gotgenes/pi-permission-system/commit/360594c8ddfd6f7f45abe04352a514de292df357))


### Documentation

* clarify /dev/null redirect risks in plan [#44](https://github.com/gotgenes/pi-permission-system/issues/44) ([00c61e7](https://github.com/gotgenes/pi-permission-system/commit/00c61e75eb5bf3cd9d5fc3297024ef9642655b86))
* note safe system path allowlist in external-directory section ([#44](https://github.com/gotgenes/pi-permission-system/issues/44)) ([eaec9ae](https://github.com/gotgenes/pi-permission-system/commit/eaec9ae4ad88155bf2630bba9607920cbbdc8583))
* plan auto-allow /dev/null in external directory checks ([#44](https://github.com/gotgenes/pi-permission-system/issues/44)) ([90b94f4](https://github.com/gotgenes/pi-permission-system/commit/90b94f4e0ae01b3a9f9dc90c5426720742a652e2))

## [3.1.0](https://github.com/gotgenes/pi-permission-system/compare/v3.0.5...v3.1.0) (2026-05-03)


### Features

* add bash external-directory format helpers ([#39](https://github.com/gotgenes/pi-permission-system/issues/39)) ([5c7e93c](https://github.com/gotgenes/pi-permission-system/commit/5c7e93cbe5c428ab3ed5e32ab3f2bb8c3fe0431b))
* enforce external_directory gate on bash commands ([#39](https://github.com/gotgenes/pi-permission-system/issues/39)) ([5342139](https://github.com/gotgenes/pi-permission-system/commit/53421391c5f5f3b277e26ea7cbee23ef06b6db41))
* extract external paths from bash command tokens ([#39](https://github.com/gotgenes/pi-permission-system/issues/39)) ([8cb3c2a](https://github.com/gotgenes/pi-permission-system/commit/8cb3c2a1b56007ca10e634bd6be5b464ddfea957))


### Documentation

* document bash external_directory gate in README ([#39](https://github.com/gotgenes/pi-permission-system/issues/39)) ([d33e1ea](https://github.com/gotgenes/pi-permission-system/commit/d33e1ea2686e5390f9904d554668c00305702fc1))
* plan bash external_directory gate ([#39](https://github.com/gotgenes/pi-permission-system/issues/39)) ([ba80c64](https://github.com/gotgenes/pi-permission-system/commit/ba80c647668542f934e2c14148cf94fb11d110da))

## [3.0.5](https://github.com/gotgenes/pi-permission-system/compare/v3.0.4...v3.0.5) (2026-05-03)


### Miscellaneous Chores

* **deps:** update dependencies and clean up unused peers ([d8482a9](https://github.com/gotgenes/pi-permission-system/commit/d8482a9aab4a41798ba50e7b5db9ede1dcb7897a))

## [3.0.4](https://github.com/gotgenes/pi-permission-system/compare/v3.0.3...v3.0.4) (2026-05-03)


### Documentation

* plan drop .js extensions from internal imports ([#32](https://github.com/gotgenes/pi-permission-system/issues/32)) ([1d73759](https://github.com/gotgenes/pi-permission-system/commit/1d73759bafb4de02f20817d977eca181a5df5a54))
* **retro:** add retro notes for issue [#33](https://github.com/gotgenes/pi-permission-system/issues/33) ([4e4ef43](https://github.com/gotgenes/pi-permission-system/commit/4e4ef4397efe9fd0c75ac00b1b411eef50603f33))


### Miscellaneous Chores

* add lint:imports guard against .js extensions ([#32](https://github.com/gotgenes/pi-permission-system/issues/32)) ([fa0b924](https://github.com/gotgenes/pi-permission-system/commit/fa0b924fb5a8741de294eff8b2f2f94aded34f5d))

## [3.0.3](https://github.com/gotgenes/pi-permission-system/compare/v3.0.2...v3.0.3) (2026-05-03)


### Bug Fixes

* stop findSection at first non-body line instead of EOF ([#33](https://github.com/gotgenes/pi-permission-system/issues/33)) ([15c178e](https://github.com/gotgenes/pi-permission-system/commit/15c178ea1aa42c091885f0aeacd87ba5b298ce24))


### Documentation

* plan fix for findSection greedy end boundary ([#33](https://github.com/gotgenes/pi-permission-system/issues/33)) ([72a5f9e](https://github.com/gotgenes/pi-permission-system/commit/72a5f9e4ab14cc9959781994cdc7dc52f1dfa657))
* **retro:** add retro notes for issue [#35](https://github.com/gotgenes/pi-permission-system/issues/35) ([89830cb](https://github.com/gotgenes/pi-permission-system/commit/89830cb7c562ed092d4f08031584f0e0855326de))

## [3.0.2](https://github.com/gotgenes/pi-permission-system/compare/v3.0.1...v3.0.2) (2026-05-03)


### Documentation

* plan align test mock-cleanup and node:* default-export rules ([#35](https://github.com/gotgenes/pi-permission-system/issues/35)) ([480aa02](https://github.com/gotgenes/pi-permission-system/commit/480aa02183009a6693a6699948563345871f198d))
* **retro:** add retro notes for issue [#21](https://github.com/gotgenes/pi-permission-system/issues/21) ([c7aae09](https://github.com/gotgenes/pi-permission-system/commit/c7aae099a48e58506195d843de797a1ae45b723a))

## [3.0.1](https://github.com/gotgenes/pi-permission-system/compare/v3.0.0...v3.0.1) (2026-05-03)


### Documentation

* add descriptions to all JSON schema entities ([cb3a7ce](https://github.com/gotgenes/pi-permission-system/commit/cb3a7ce5257111159312ebb95a9f75dd4e4a9527))
* enrich JSON schema with examples, defaults, and markdown descriptions ([6f38d7e](https://github.com/gotgenes/pi-permission-system/commit/6f38d7edf01b950f20e2fab8604a398bf725a6c4))
* plan index.ts split into focused modules ([#21](https://github.com/gotgenes/pi-permission-system/issues/21)) ([ccd736a](https://github.com/gotgenes/pi-permission-system/commit/ccd736a83a4af208044eec925c80555ee645e344))
* **retro:** add retro notes for issue [#10](https://github.com/gotgenes/pi-permission-system/issues/10) ([31e59d6](https://github.com/gotgenes/pi-permission-system/commit/31e59d6172da7b0e9f02894afd2ba66a292de168))
* **retro:** correct formatting friction attribution ([#10](https://github.com/gotgenes/pi-permission-system/issues/10)) ([2e96b7b](https://github.com/gotgenes/pi-permission-system/commit/2e96b7bc1007a2ef55f95b29c40b8417c2c6c52f))
* update plan with Phase 2 unit tests using DI and vitest mocks ([#21](https://github.com/gotgenes/pi-permission-system/issues/21)) ([ad7f5fe](https://github.com/gotgenes/pi-permission-system/commit/ad7f5feeb856c84142a2a4258a9e173c8006532d))

## [3.0.0](https://github.com/gotgenes/pi-permission-system/compare/v2.0.0...v3.0.0) (2026-05-03)


### ⚠ BREAKING CHANGES

* Config is now loaded from ~/.pi/agent/extensions/pi-permission-system/config.json (global) and <cwd>/.pi/extensions/pi-permission-system/config.json (project). Legacy paths are detected and merged with migration warnings.
* Config and log file paths move from the extension install directory and ~/.pi/agent/ to the extensions/<id>/ convention.

### Features

* add config-paths module with new layout paths ([#10](https://github.com/gotgenes/pi-permission-system/issues/10)) ([532d2a1](https://github.com/gotgenes/pi-permission-system/commit/532d2a1f1d816c1cfba5419f7d0041382c848b31))
* add unified config loader ([#10](https://github.com/gotgenes/pi-permission-system/issues/10)) ([20143e0](https://github.com/gotgenes/pi-permission-system/commit/20143e0f7b608965d889433a6b9bbd6f9ab8b4cc))
* detect and merge legacy config paths ([#10](https://github.com/gotgenes/pi-permission-system/issues/10)) ([95046de](https://github.com/gotgenes/pi-permission-system/commit/95046de6a57d604c5f0d9fa8c13a64478ba15c89))
* implement config merge in unified loader ([#10](https://github.com/gotgenes/pi-permission-system/issues/10)) ([30b9afe](https://github.com/gotgenes/pi-permission-system/commit/30b9afe3d83940aa3ad708c9d6783bb2d4337743))
* update config-reporter for consolidated layout ([#10](https://github.com/gotgenes/pi-permission-system/issues/10)) ([96c9ef4](https://github.com/gotgenes/pi-permission-system/commit/96c9ef4964f9551b0fa89bbbc506f7660c055d74))
* wire index.ts to consolidated config layout ([#10](https://github.com/gotgenes/pi-permission-system/issues/10)) ([e7f8e5f](https://github.com/gotgenes/pi-permission-system/commit/e7f8e5f2fb094f0d291561258190d1892a1e6856))


### Documentation

* plan config layout consolidation ([#10](https://github.com/gotgenes/pi-permission-system/issues/10)) ([eb2924d](https://github.com/gotgenes/pi-permission-system/commit/eb2924d57655d06f67891574839aebfa0586a43d))
* **retro:** add retro notes for issue [#20](https://github.com/gotgenes/pi-permission-system/issues/20) ([4735f0c](https://github.com/gotgenes/pi-permission-system/commit/4735f0c646a0ede11c9a76083822969eb6ca4a8f))
* update schema, example, and docs for consolidated config ([#10](https://github.com/gotgenes/pi-permission-system/issues/10)) ([39b5c01](https://github.com/gotgenes/pi-permission-system/commit/39b5c01de1c8c721e998b244e9c825a6eb05f858))

## [2.0.0](https://github.com/gotgenes/pi-permission-system/compare/v1.2.1...v2.0.0) (2026-05-03)


### ⚠ BREAKING CHANGES

* the pi-permission-system:permission-request event channel is no longer emitted. No known consumers exist; the type was never exported. Re-adding with a proper public contract is tracked

### Features

* add /build-plan prompt template for non-TDD plans ([e98f13c](https://github.com/gotgenes/pi-permission-system/commit/e98f13c2ef32f51edda58ea065635bef31365baa))
* delete permission-request event channel ([#20](https://github.com/gotgenes/pi-permission-system/issues/20)) ([6a41cfa](https://github.com/gotgenes/pi-permission-system/commit/6a41cfadc56e709d255538f63ff63d587e1b64f3))


### Documentation

* plan delete permission-request event channel ([#20](https://github.com/gotgenes/pi-permission-system/issues/20)) ([e202350](https://github.com/gotgenes/pi-permission-system/commit/e2023509f9ab849f5a1d8bc28a5705b2898b912b))
* remove event channel from preserved-identity list ([#20](https://github.com/gotgenes/pi-permission-system/issues/20)) ([52299a2](https://github.com/gotgenes/pi-permission-system/commit/52299a27aeaed6e35849878fa224d8a78dcf0f6d))
* **retro:** add retro notes for issue [#22](https://github.com/gotgenes/pi-permission-system/issues/22) ([55629fe](https://github.com/gotgenes/pi-permission-system/commit/55629fed16b6d73b6d7b02698227e2adab7acd3e))
* update copyright in license ([b27994e](https://github.com/gotgenes/pi-permission-system/commit/b27994e7d67863ce8b28aa6bd680b60bc700d66d))

## [1.2.1](https://github.com/gotgenes/pi-permission-system/compare/v1.2.0...v1.2.1) (2026-05-03)


### Bug Fixes

* **retro:** correct MD060 rule — column alignment, not separator spacing ([7f116b8](https://github.com/gotgenes/pi-permission-system/commit/7f116b884c03d9c346a640f306bca934b91214cd))


### Documentation

* plan relax on-disk identity rule ([#22](https://github.com/gotgenes/pi-permission-system/issues/22)) ([d886862](https://github.com/gotgenes/pi-permission-system/commit/d886862a3686746f48e618ab2f950c7b1109d804))
* relax on-disk identity rule for config/log paths ([#22](https://github.com/gotgenes/pi-permission-system/issues/22)) ([352b103](https://github.com/gotgenes/pi-permission-system/commit/352b1038b1492b1f8222950edf4b6d093157128d))
* **retro:** add retro notes for issue [#19](https://github.com/gotgenes/pi-permission-system/issues/19) ([1d4a4a6](https://github.com/gotgenes/pi-permission-system/commit/1d4a4a6959905f102dea08273e7b827d8111a583))
* update README badges to match pi-autoformat style ([5c6ef1f](https://github.com/gotgenes/pi-permission-system/commit/5c6ef1fcfb2b6f5ee353765ebeeac7cdf09d2bbb))

## [1.2.0](https://github.com/gotgenes/pi-permission-system/compare/v1.1.0...v1.2.0) (2026-05-03)


### Features

* drop legacy settings.json fallback for MCP server names ([#19](https://github.com/gotgenes/pi-permission-system/issues/19)) ([3978f94](https://github.com/gotgenes/pi-permission-system/commit/3978f94acfe01b32e6e37c4fa0f5ca3b22881208))


### Documentation

* plan drop legacy settings.json MCP fallback ([#19](https://github.com/gotgenes/pi-permission-system/issues/19)) ([fd88aac](https://github.com/gotgenes/pi-permission-system/commit/fd88aac8e52c0b617b5ce2582c700bbb86b9bf84))
* **retro:** add retro notes for issue [#18](https://github.com/gotgenes/pi-permission-system/issues/18) ([1bb9cc5](https://github.com/gotgenes/pi-permission-system/commit/1bb9cc52abe159d77b8ab29960bafdb2740c9c98))

## [1.1.0](https://github.com/gotgenes/pi-permission-system/compare/v1.0.0...v1.1.0) (2026-05-03)


### Features

* emit deprecation warning for special.tool_call_limit ([#18](https://github.com/gotgenes/pi-permission-system/issues/18)) ([1170d40](https://github.com/gotgenes/pi-permission-system/commit/1170d401d3adc438ad3c69bf96f5264b981ed4d5))
* notify user of deprecated config fields at startup ([#18](https://github.com/gotgenes/pi-permission-system/issues/18)) ([3408672](https://github.com/gotgenes/pi-permission-system/commit/3408672afb94783f173b579e9e33fe088f0971f3))
* surface config issues from PermissionManager ([#18](https://github.com/gotgenes/pi-permission-system/issues/18)) ([4c8103b](https://github.com/gotgenes/pi-permission-system/commit/4c8103bed99c3d31813f5450a6f4d1938fd74f25))


### Documentation

* plan drop unread special.tool_call_limit from schema ([#18](https://github.com/gotgenes/pi-permission-system/issues/18)) ([c45f6f7](https://github.com/gotgenes/pi-permission-system/commit/c45f6f7e5a504cac4f6156a97f51ff9588639d94))
* remove tool_call_limit from schema and README ([#18](https://github.com/gotgenes/pi-permission-system/issues/18)) ([780b414](https://github.com/gotgenes/pi-permission-system/commit/780b41431b1ac06ccf11dca00e1c59575386bbd2))

## [1.0.0](https://github.com/gotgenes/pi-permission-system/compare/v0.8.0...v1.0.0) (2026-05-03)


### ⚠ BREAKING CHANGES

* The bundled temperature-stripping shim for OpenAI Responses-style APIs (openai-codex-responses, openai-responses, azure-openai-responses) has been removed. This module monkey-patched the provider stack at the process level and had no connection to permission enforcement. Users who need the shim can extract it into a standalone extension.

### Features

* remove out-of-scope model-option-compatibility provider shim ([#17](https://github.com/gotgenes/pi-permission-system/issues/17)) ([b390896](https://github.com/gotgenes/pi-permission-system/commit/b39089611fe565f81dacf7fa0bff3af36d50f7ce))


### Documentation

* plan removal of out-of-scope model-option-compatibility shim ([#17](https://github.com/gotgenes/pi-permission-system/issues/17)) ([a48f2ef](https://github.com/gotgenes/pi-permission-system/commit/a48f2ef025cbe970d21071b94552fcb9a4f7de89))
* **retro:** add retro notes for issue [#16](https://github.com/gotgenes/pi-permission-system/issues/16) ([ee710cb](https://github.com/gotgenes/pi-permission-system/commit/ee710cba9b1fe92a39016c61348d2a0eb2895d1f))

## [0.8.0](https://github.com/gotgenes/pi-permission-system/compare/v0.7.0...v0.8.0) (2026-05-03)


### Features

* replace vendored zellij-modal with direct pi-tui SettingsList ([#16](https://github.com/gotgenes/pi-permission-system/issues/16)) ([868675f](https://github.com/gotgenes/pi-permission-system/commit/868675ff2df1ab429dc48160c7e545ddc8a451e1))


### Documentation

* plan delete vendored zellij-modal and rebuild settings UI ([#16](https://github.com/gotgenes/pi-permission-system/issues/16)) ([35274da](https://github.com/gotgenes/pi-permission-system/commit/35274da005b90023de29bbc144abfa6ad27bb73c))


### Miscellaneous Chores

* add project-local pi-autoformat config ([13a6f33](https://github.com/gotgenes/pi-permission-system/commit/13a6f339a52a546812432bc055bdb32cc2bd6d90))

## [0.7.0](https://github.com/gotgenes/pi-permission-system/compare/v0.6.1...v0.7.0) (2026-05-02)


### Features

* add prek pre-commit hooks for Biome and markdownlint ([#14](https://github.com/gotgenes/pi-permission-system/issues/14)) ([1093e87](https://github.com/gotgenes/pi-permission-system/commit/1093e8774145517f4b65f1e489a86143d7c54fb0))
* align prek config with pi-autoformat conventions ([#14](https://github.com/gotgenes/pi-permission-system/issues/14)) ([a9b72aa](https://github.com/gotgenes/pi-permission-system/commit/a9b72aaecaa8c5d7fc5feac588ef2da2c4e5372d))


### Bug Fixes

* use check-only mode for pre-commit hooks ([#14](https://github.com/gotgenes/pi-permission-system/issues/14)) ([fc37f1f](https://github.com/gotgenes/pi-permission-system/commit/fc37f1f1aa6d3aed9a8b8c9c88a98bf021250996))


### Documentation

* plan prek pre-commit linting setup ([#14](https://github.com/gotgenes/pi-permission-system/issues/14)) ([5debd98](https://github.com/gotgenes/pi-permission-system/commit/5debd986bd24621105d1138daacb17fa4fb3ab8e))
* **retro:** add retro notes for issue [#13](https://github.com/gotgenes/pi-permission-system/issues/13) ([a0b889d](https://github.com/gotgenes/pi-permission-system/commit/a0b889d176ed607e5fcf3af793318ab35c871ac3))

## [0.6.1](https://github.com/gotgenes/pi-permission-system/compare/v0.6.0...v0.6.1) (2026-05-02)


### Bug Fixes

* consolidate duplicate session_start handlers ([#13](https://github.com/gotgenes/pi-permission-system/issues/13)) ([6f5591a](https://github.com/gotgenes/pi-permission-system/commit/6f5591ac6097f5411075e2d10469df9ec5445329))


### Documentation

* plan consolidate duplicate session_start handlers ([#13](https://github.com/gotgenes/pi-permission-system/issues/13)) ([3b045c2](https://github.com/gotgenes/pi-permission-system/commit/3b045c272a848687642bedca7da463ab56ade688))
* remove dual-handler caveat from AGENTS.md ([#13](https://github.com/gotgenes/pi-permission-system/issues/13)) ([5e8bf87](https://github.com/gotgenes/pi-permission-system/commit/5e8bf870fb3aa04c942e6804a5c2023c1e3e487e))
* **retro:** add retro notes for issue [#6](https://github.com/gotgenes/pi-permission-system/issues/6) ([8921a47](https://github.com/gotgenes/pi-permission-system/commit/8921a473f1864d2c0f3c8417f6effdcbc6b35e89))

## [0.6.0](https://github.com/gotgenes/pi-permission-system/compare/v0.5.0...v0.6.0) (2026-05-02)


### Features

* add getResolvedPolicyPaths to PermissionManager ([#6](https://github.com/gotgenes/pi-permission-system/issues/6)) ([663b892](https://github.com/gotgenes/pi-permission-system/commit/663b892fbcaa092c9ac139283ed2e7bdd7e42b43))
* emit config.resolved review-log entry at startup ([#6](https://github.com/gotgenes/pi-permission-system/issues/6)) ([6968171](https://github.com/gotgenes/pi-permission-system/commit/6968171aca2e86c60a104c09df7d58d5bb1e59aa))


### Documentation

* document config.resolved diagnostic log entry ([#6](https://github.com/gotgenes/pi-permission-system/issues/6)) ([332fe41](https://github.com/gotgenes/pi-permission-system/commit/332fe413457a6913021ffc4cb8d6e80a7cd7fff2))
* plan config.resolved diagnostic log entry ([#6](https://github.com/gotgenes/pi-permission-system/issues/6)) ([8d51ff3](https://github.com/gotgenes/pi-permission-system/commit/8d51ff3a4464866ba9604e3bd6b52ab9bfb8f258))

## [0.5.0](https://github.com/gotgenes/pi-permission-system/compare/v0.4.6...v0.5.0) (2026-05-02)


### Features

* add extension config, logging system, and permission request events ([6252d9e](https://github.com/gotgenes/pi-permission-system/commit/6252d9e44ae0611dd399208f66da685dec5d4dbf))
* add getToolPermission for tool-level permission checks ([fe3ab17](https://github.com/gotgenes/pi-permission-system/commit/fe3ab179501ef57e2786dc6815ec2255eba77bc5))
* add guidelines sanitization to system prompt sanitizer ([5689e4a](https://github.com/gotgenes/pi-permission-system/commit/5689e4a3bb028517b09ba4f1d2999936316acb33))
* add yolo mode and permission forwarding ([b36e113](https://github.com/gotgenes/pi-permission-system/commit/b36e113266669b30065ccc45fcc9ed3a37ebf18d))
* **caching:** add before-agent-start cache for active tools and prompt state ([b0f1c85](https://github.com/gotgenes/pi-permission-system/commit/b0f1c85e35f61cb1b05a2ab3f92a670fdfc45f02))
* detect misplaced permission keys in config.json ([#4](https://github.com/gotgenes/pi-permission-system/issues/4)) ([5be5eda](https://github.com/gotgenes/pi-permission-system/commit/5be5eda17a473b8cd3ed0fecc4d166a8339fae7b))
* loadPermissionSystemConfig warns on misplaced permission keys ([#4](https://github.com/gotgenes/pi-permission-system/issues/4)) ([4f0e173](https://github.com/gotgenes/pi-permission-system/commit/4f0e173e62037fef57fe724fd21f3327213f4570))
* **permission-system:** expose tool input params in logs and ask prompts ([e334964](https://github.com/gotgenes/pi-permission-system/commit/e334964a9a673d17acb29c8e6d82c539827aca6a))
* **permission:** add layered policy reload handling ([ad0a4da](https://github.com/gotgenes/pi-permission-system/commit/ad0a4dac4fc274736e8f20ad08145316b30d61cb))
* **permission:** add state and denial reason to permission prompts ([d499b94](https://github.com/gotgenes/pi-permission-system/commit/d499b94985b396006598b7011877cc9885efefd3))
* **permission:** forward subagent approval requests ([bb9086e](https://github.com/gotgenes/pi-permission-system/commit/bb9086e0e1b99a665fc5ddbcc1665f6421e8ccf7))
* **permission:** log sanitized tool input previews ([192b66c](https://github.com/gotgenes/pi-permission-system/commit/192b66ce7720a20d63910bdfc95f075130a43773))
* **special:** enforce external_directory CWD boundary in tool_call handler ([6c59781](https://github.com/gotgenes/pi-permission-system/commit/6c59781a6d69e33eb297ecfb60e6d5b21c3f88b6))
* **status:** add permission system status sync for yolo mode ([0b77943](https://github.com/gotgenes/pi-permission-system/commit/0b77943adbc8a87de2161fd8037d2d80505fbfd1))


### Bug Fixes

* **events:** listen on session_start instead of nonexistent session_switch ([2bbbaba](https://github.com/gotgenes/pi-permission-system/commit/2bbbaba9d0b31fe08c19e0819f11b4c1c705aa97))
* **package:** stop publishing config.json ([af1b531](https://github.com/gotgenes/pi-permission-system/commit/af1b5311112046f32e153332bb8e0fb996b6882e))
* **permission:** add model option compatibility guard ([d9dd506](https://github.com/gotgenes/pi-permission-system/commit/d9dd5063edd1c6a7410105a92c6c45fa9c195699))
* **permission:** harden prompt and external directory enforcement ([48c3af1](https://github.com/gotgenes/pi-permission-system/commit/48c3af165a6f2c1a4c689c436d8c6c4112ec6aae))
* **permission:** summarize file tool approval prompts ([3775894](https://github.com/gotgenes/pi-permission-system/commit/3775894f23756ad0ed06ae17961d547b0cb5bc47))
* **prompt:** remove denied tools from available tools section ([f22bccc](https://github.com/gotgenes/pi-permission-system/commit/f22bcccdca7f9ce9df066973e4735cd2e0427280))


### Documentation

* add AGENTS.md and .pi/prompts workflow templates ([bebc197](https://github.com/gotgenes/pi-permission-system/commit/bebc197f59ada2dfff24f6fc1ef3cf46b2415675))
* add readme and changelog ([07e29c5](https://github.com/gotgenes/pi-permission-system/commit/07e29c57a9fcb7731ec62531e7c9f1ef5883c0d1))
* add Related Pi Extensions cross-linking section ([facdf3f](https://github.com/gotgenes/pi-permission-system/commit/facdf3fda8a5ec2486a818ada2836ef7be039f40))
* clarify config.json vs permission-policy file ([#4](https://github.com/gotgenes/pi-permission-system/issues/4)) ([464e1d1](https://github.com/gotgenes/pi-permission-system/commit/464e1d19b637807bb754d95397db9cf59d446673))
* fix recipe ordering and clarify last-match-wins precedence ([70427f6](https://github.com/gotgenes/pi-permission-system/commit/70427f662b16b655fd23867c6960cfae0923b821))
* plan warn on misplaced permission keys in config.json ([#4](https://github.com/gotgenes/pi-permission-system/issues/4)) ([ffcef67](https://github.com/gotgenes/pi-permission-system/commit/ffcef6787b7ac1bb44acc958266eed9e1b5fbf9a))
* **release:** finalize 0.4.2 notes ([ea1c587](https://github.com/gotgenes/pi-permission-system/commit/ea1c58761e468dade823b3618e43b8909b6c4aee))
* **release:** prepare 0.4.3 notes ([73a255c](https://github.com/gotgenes/pi-permission-system/commit/73a255c991c7a14d10711f99973991a68ab50c1b))
* **release:** prepare 0.4.4 notes ([78f5c48](https://github.com/gotgenes/pi-permission-system/commit/78f5c48aab6a94c7bb7356af4db1798340522848))
* **release:** prepare v0.4.5 ([e5a713b](https://github.com/gotgenes/pi-permission-system/commit/e5a713b0e3a0149e2728b81c4ca85188ebe668eb))
* **release:** update CHANGELOG for 0.4.2 ([47084d6](https://github.com/gotgenes/pi-permission-system/commit/47084d6af8fb4b515dad4519c3487f9f6b11d287))
* update README for [@gotgenes](https://github.com/gotgenes) fork ([f6ff1dd](https://github.com/gotgenes/pi-permission-system/commit/f6ff1dd687e73722e3a1cc8b1f457e6dcc2227ff))


### Miscellaneous Chores

* add biome and markdownlint-cli2 tooling ([3140f32](https://github.com/gotgenes/pi-permission-system/commit/3140f32c4bc4be13f06e1ec337ce525317f565bf))
* add license, ignores, and assets ([f59ce79](https://github.com/gotgenes/pi-permission-system/commit/f59ce79a6a3c9b48994b9c4a15e5e81d853a7b2b))
* align npm keywords for discoverability ([fabbb4d](https://github.com/gotgenes/pi-permission-system/commit/fabbb4d024d41ac4c4d01e9218d0d4cc8538ae6b))
* bootstrap extension project ([4b3e7d5](https://github.com/gotgenes/pi-permission-system/commit/4b3e7d51c5b94ec580bd06943c427a5272ad2be2))
* bump version to 0.2.0 ([4df5864](https://github.com/gotgenes/pi-permission-system/commit/4df5864414cb5a252eb757b060034ca86e5c96eb))
* **deps:** update pi peer dependencies ([bf3d7e6](https://github.com/gotgenes/pi-permission-system/commit/bf3d7e6f3610ab69f2988a6748af5c6a6a1193eb))
* exclude docs folder from version control ([3fa6a49](https://github.com/gotgenes/pi-permission-system/commit/3fa6a496f4c28e65bbcb6787a3e9b5c636706ed3))
* pin typescript as devDependency ([2ff692f](https://github.com/gotgenes/pi-permission-system/commit/2ff692f36a1061df222364ebe4f44465423d7586))
* release v0.3.0 ([36a3d7e](https://github.com/gotgenes/pi-permission-system/commit/36a3d7ee2794b9350bdac5de029d9f074a2c63ad))
* release v0.4.1 ([da22e18](https://github.com/gotgenes/pi-permission-system/commit/da22e1879aaf0bf5d0673eefddd9df29f7f4e256))
* **release:** cut v0.1.1 ([5d8739b](https://github.com/gotgenes/pi-permission-system/commit/5d8739ba5ceabcbd940ebb61b8ffbbf05a962579))
* **release:** cut v0.1.2 ([f4f0fe7](https://github.com/gotgenes/pi-permission-system/commit/f4f0fe769f274d3cd1355015620b5636d934095f))
* **release:** cut v0.1.3 ([88667f2](https://github.com/gotgenes/pi-permission-system/commit/88667f2aa9c1c8de84ad6a9b798635b155a90b65))
* **release:** cut v0.1.4 ([6c9804b](https://github.com/gotgenes/pi-permission-system/commit/6c9804b4434681248edfde07cff75d32e50240c6))
* **release:** cut v0.1.5 ([cdaca30](https://github.com/gotgenes/pi-permission-system/commit/cdaca303c1e49bcbe542037204ed77e98f78d02e))
* **release:** cut v0.1.6 ([644660e](https://github.com/gotgenes/pi-permission-system/commit/644660e37e287b0121c7b5433095e536cd46ee92))
* **release:** cut v0.1.7 ([1e73124](https://github.com/gotgenes/pi-permission-system/commit/1e731249bc2fdaf5f2e37efdaa1fa58475cd75f9))
* **release:** cut v0.1.8 ([164a6e3](https://github.com/gotgenes/pi-permission-system/commit/164a6e3434a19b817725edb3ec9db9dd51856393))
* rename package and update metadata for [@gotgenes](https://github.com/gotgenes) fork ([cd9bc5f](https://github.com/gotgenes/pi-permission-system/commit/cd9bc5f4844210f6a547ce99a8efdef985be8c7f))
* **types:** replace types-shims.d.ts with real type packages ([3809612](https://github.com/gotgenes/pi-permission-system/commit/380961271ae5bc0f4e68becb42e00335e5e5c1c4))

## [Unreleased]

## [0.4.6] - 2026-04-28

### Added
- Added bounded, sanitized tool input previews to permission review logs for non-bash/non-MCP tool calls, inspired by PR #10 from @DevkumarPatel.

### Changed
- Reused the extension's safe JSON serialization path for generic tool approval previews so circular values and BigInts are summarized without raw full-input logging.
- Updated `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`, and `@mariozechner/pi-tui` peer dependencies to `^0.70.5`.

## [0.4.5] - 2026-04-27

### Fixed
- Added a model option compatibility guard for OpenAI Responses/Codex streams so unsupported `temperature` values are removed from stream options and outgoing payloads before provider calls.

## [0.4.4] - 2026-04-25

### Added
- Added runtime enforcement for the `external_directory` special permission on path-bearing tools (`read`, `write`, `edit`, `find`, `grep`, `ls`) before normal tool permission checks (thanks to @gotgenes for PR #9)
- Added readable `ask` prompt summaries for built-in file tools and bounded input previews for generic extension tools so users can make informed approval decisions (thanks to @beantownbytes for PR #8)
- Added `skill-prompt-sanitizer.ts` to parse and sanitize every `<available_skills>` block, including prompts with multiple skill sections

### Changed
- Updated `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui` peer dependencies to `^0.70.2`
- Refactored skill prompt filtering out of `src/index.ts` into a dedicated module for clearer ownership and reuse
- Permission prompts for `edit`, `write`, `read`, `find`, `grep`, and `ls` now show concise path/action summaries instead of raw multiline JSON

### Fixed
- Denied skills are now removed from all available-skill prompt blocks instead of only the first block
- Denied skill entries are no longer retained for later skill-read path matching after prompt sanitization
- External path access now honors `special.external_directory: deny` and blocks `ask` decisions when no UI or forwarding channel is available

### Tests
- Added runtime `tool_call` coverage for external directory deny, ask-without-UI, ask approval, internal path allow, and optional path omission
- Added prompt regression coverage for generic tool input previews and readable built-in file-tool approval summaries
- Added multi-block skill prompt sanitizer regression coverage

## [0.4.2] - 2026-04-20

### Added
- Added project-level permission layering from the active session workspace via `<cwd>/.pi/agent/pi-permissions.jsonc`
- Added project-level per-agent overrides via `<cwd>/.pi/agent/agents/<agent>.md` (thanks to @Talia-12 for PR #7)
- Added reload-aware permission manager refresh paths so policy caches are rebuilt when Pi reload events occur
- Added a dedicated `tests/` directory with modular test entrypoints and a shared test harness
- Added before-agent-start caching module to dedupe unchanged active-tool exposure and prompt state across `before_agent_start` lifecycle invocations
- Added `PermissionPromptDecision` type with `state` and `denialReason` fields for richer permission prompt resolution
- Added `getPolicyCacheStamp()` method to `PermissionManager` for cache invalidation tracking

### Changed
- Global path resolution now follows Pi's `getAgentDir()` helper, so global config, agents, sessions, and logs respect `PI_CODING_AGENT_DIR` (thanks to @jvortmann for PR #6)
- Updated `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui` peer dependencies to `^0.67.68`
- Updated TypeScript project configuration and npm scripts to run tests from `tests/` instead of `src/`
- Updated README documentation for project-level policy files, yolo mode config, test layout, and `PI_CODING_AGENT_DIR`
- Permission prompts and forwarding now return `PermissionPromptDecision` instead of boolean for richer resolution tracking
- Permission denial messages now include user-provided denial reasons when available

### Removed
- Removed the legacy packaged `asset/` directory because the README now uses externally hosted images instead of repository-bundled screenshots

### Fixed
- `/skill:<name>` permission handling now falls back to the current merged skill policy when no active agent context is available in the main session (thanks to @NSBeidou and @hidromagnetismo for reporting the issue)
- Skill denial messaging now reflects whether the block came from an agent-specific rule or the merged policy without agent context

### Tests
- Added coverage for project-level precedence across global, project, system-agent, and project-agent layers
- Added coverage for resolving config from `PI_CODING_AGENT_DIR`
- Added coverage for before-agent-start cache key generation and state deduplication
- Added coverage for cache invalidation on permission policy changes

## [0.4.1] - 2026-04-01

### Changed
- Updated npm keywords for improved discoverability (`pi-coding-agent`, `coding-agent`, `access-control`, `authorization`, `security`)
- Updated README permission prompt example image
- Added Related Pi Extensions cross-linking section to README

## [0.4.0] - 2026-04-01

### Added
- System prompt sanitizer now removes inactive tool guidelines from the `Guidelines:` section
- Guideline filtering based on allowed tools (e.g., removes task/mcp/bash/write guidance when tools are denied)
- New `TOOL_GUIDELINE_RULES` configuration for extensible guideline filtering
- Helper functions: `findSection()`, `removeLineSection()`, `sanitizeGuidelinesSection()`

### Changed
- Updated `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui` peer dependencies to ^0.64.0
- Updated `@sinclair/typebox` peer dependency to ^0.34.49
- Refactored system prompt sanitizer to handle both `Available tools:` and `Guidelines:` sections

### Tests
- Added tests for system prompt sanitizer removing Available tools section
- Added tests for guideline filtering based on allowed tools
- Added tests for inactive built-in write/edit/task/mcp guidance removal

## [0.3.1] - 2026-03-24

### Added
- Permission system status module (`status.ts`) to expose yolo mode status to the UI
- `syncPermissionSystemStatus()` function to sync status with the TUI status bar
- `PERMISSION_SYSTEM_STATUS_KEY` and `PERMISSION_SYSTEM_YOLO_STATUS_VALUE` constants for status identification

### Changed
- Integrated status sync on config load, config save, and extension unload
- Status is only exposed when yolo mode is enabled

### Tests
- Added test for permission-system status being undefined when yolo mode is disabled and "yolo" when enabled

## [0.3.0] - 2026-03-23

### Added
- Yolo mode for auto-approval when enabled — bypasses permission prompts for streamlined workflows
- Permission forwarding system for subagent-to-primary IPC communication
- Configuration modal UI with Zellij integration (`config-modal.ts`, `zellij-modal.ts`)
- `permission-forwarding.ts` module for subagent permission request routing
- `yolo-mode.ts` module for automatic permission approval when yolo mode is active

### Changed
- Updated `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui` peer dependencies to ^0.62.0
- Refactored `index.ts` to export new permission resolution utilities
- Expanded `extension-config.ts` with config normalization for new features
- Added `types-shims.d.ts` for Zellij modal type definitions

### Tests
- Added comprehensive tests for config modal functionality
- Added tests for permission forwarding behavior

## [0.2.2] - 2026-03-13

### Changed
- Removed delegation task restriction logic — the `task` tool is no longer restricted to orchestrator agent only
- Simplified tool permission lookup to use explicit `tools` entries for arbitrary registered tools instead of MCP fallback
- Renamed `TOOL_PERMISSION_NAMES` to `BUILT_IN_TOOL_PERMISSION_NAMES` to clarify it covers only canonical Pi tools
- Updated schema descriptions for `tools` and `mcp` fields to guide configuration usage

### Removed
- Removed delegation-specific permission checks (`isDelegationAllowedAgent`, `getDelegationBlockReason`) from permission evaluation

### Tests
- Added comprehensive test coverage for tool permission lookup behavior

## [0.2.1] - 2026-03-13

### Added
- Extension configuration system (`config.json`) with `debugLog` and `permissionReviewLog` options
- JSONL debug logging to `logs/pi-permission-system-debug.jsonl` when `debugLog` is enabled
- JSONL permission review logging to `logs/pi-permission-system-permission-review.jsonl` for auditing
- Permission request event emission on `pi-permission-system:permission-request` channel for external consumers
- New `extension-config.ts` module for config file management and path resolution
- New `logging.ts` module with `createPermissionSystemLogger` for structured log output

### Changed
- Replaced `console.warn`/`console.error` calls with structured logging to file
- Permission forwarding now logs request creation, response received, timeout, and user prompts
- Updated README documentation to cover extension config, logging, and event emission

## [0.2.0] - 2026-03-12

### Added
- `getToolPermission()` method to retrieve tool-level permission state without evaluating command-level rules, useful for tool injection decisions

## [0.1.8] - 2026-03-10

### Changed
- Refactored pattern compilation to support multiple sources for proper global+agent pattern merging
- Simplified `wildcard-matcher.ts` by removing unused `wildcardCount` and `literalLength` properties
- `BashFilter` now accepts pre-compiled patterns via `BashPermissionSource` type
- Replaced `compilePermissionPatterns` with `compilePermissionPatternsFromSources` for cleaner API

### Fixed
- Permission pattern priority now correctly implements last-match-wins hierarchy (opencode-style)
- MCP tool-level deny no longer blocks specific MCP allow patterns

### Tests
- Updated tests to reflect last-match-wins behavior
- Added test for specific MCP rules winning over `tools.mcp: deny`
- Rearranged test pattern declarations for clarity

## [0.1.7] - 2026-03-10

### Added
- `src/common.ts` — Shared utility module with `toRecord()`, `getNonEmptyString()`, `isPermissionState()`, `parseSimpleYamlMap()`, `extractFrontmatter()`
- `src/wildcard-matcher.ts` — Wildcard pattern compilation and matching with specificity sorting
- File stamp caching in `PermissionManager` for improved performance
- `tools.mcp` fallback permission for MCP operations
- MCP tool permission targets now inferred from configured server names in `mcp.json`

### Changed
- Refactored `bash-filter.ts` to use shared `wildcard-matcher.ts` module
- Refactored `index.ts` to use shared `common.ts` utilities
- Refactored `permission-manager.ts` to use shared modules and caching
- Pre-compiled wildcard patterns are now reused across permission checks
- Updated README architecture documentation to reflect new module organization

### Tests
- Added tests for MCP proxy tool inferring server-prefixed aliases from configured server names
- Added tests for `tools.mcp` fallback behavior
- Added tests for `task` using tool permissions instead of MCP fallback

## [0.1.6] - 2026-03-09

### Added
- Sanitized the `Available tools:` system prompt section so denied tools are removed before the agent starts.

### Changed
- Updated README documentation to describe system-prompt tool sanitization and refreshed the displayed package version.

### Fixed
- Prevented hidden tools from remaining advertised in the startup system prompt after runtime tool filtering.

## [0.1.5] - 2026-03-09

### Changed
- Added `repository`, `homepage`, and `bugs` package metadata so npm links back to the public GitHub repository and issue tracker.

## [0.1.4] - 2026-03-07

### Added
- Added permission request forwarding so non-UI subagent sessions can surface `ask` confirmations back to the main interactive session.
- Added filesystem-based request/response handling for both primary and legacy permission-forwarding directories.

### Changed
- Updated README documentation to describe subagent permission forwarding behavior and current architecture responsibilities.
- Added `package-lock.json` to the repository for reproducible local installs.

### Fixed
- Preserved interactive `ask` permission flows for delegated subagents that would otherwise fail without direct UI access.
- Improved cleanup and compatibility handling around legacy permission-forwarding directories.

## [0.1.3] - 2026-03-04

### Fixed
- Use absolute GitHub raw URL for README image to fix npm display

## [0.1.2] - 2026-03-04

### Changed
- Rewrote README.md with professional documentation standards
- Added comprehensive feature documentation, configuration reference, and usage examples

## [0.1.1] - 2026-03-02

### Changed
- Added `asset/` to the npm package `files` whitelist so README image assets are included in tarballs.

## [0.1.0] - 2026-03-02

### Changed
- Reorganized repository structure to match standard extension layout:
  - moved implementation and tests into `src/`
  - added root `index.ts` shim for Pi auto-discovery
  - standardized TypeScript project settings with Bundler module resolution
- Added package distribution metadata and scripts, including `pi.extensions` and publish file whitelist.
- Added repository scaffolding files (`README.md`, `CHANGELOG.md`, `LICENSE`, `.gitignore`, `.npmignore`) and config starter template.

### Preserved
- Global permission config path semantics remained `~/.pi/agent/pi-permissions.jsonc`.
- Permission schema location remained `schemas/permissions.schema.json`.
- Permission enforcement behavior remained intact.
