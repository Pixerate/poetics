# @poetics/cli

## 0.6.0

### Minor Changes

- [#67](https://github.com/Pixerate/poetics/pull/67) [`1126038`](https://github.com/Pixerate/poetics/commit/1126038605e3ee809b4bc37ffabefb34f9929353) Thanks [@surrealroad](https://github.com/surrealroad)! - The MCP server answers `poetics_signals` (a unit's linked issues and pull requests, with titles, states and review comments on its file) and `poetics_context_pack` with an `issue`: it picks the unit the issue most likely touches, says why, and adds the issue's text and the other issues linked from the same code. Issue text is read through the issue tracker on demand and never written to `.poetics/`. `IssueTracker` gains an optional `issue(number)`, which the GitHub tracker implements.

### Patch Changes

- Updated dependencies [[`1126038`](https://github.com/Pixerate/poetics/commit/1126038605e3ee809b4bc37ffabefb34f9929353)]:
  - @poetics/core@0.7.0
  - @poetics/adapter-react@0.3.3
  - @poetics/adapter-typescript@0.2.3
  - @poetics/store@0.4.1

## 0.5.0

### Minor Changes

- [#63](https://github.com/Pixerate/poetics/pull/63) [`df077c8`](https://github.com/Pixerate/poetics/commit/df077c87d63f1aa44931ac85f9fe2ede3137780d) Thanks [@surrealroad](https://github.com/surrealroad)! - `poetics backfill` gives `high` confidence only when the evidence is about the unit alone: a commit that introduced or changed nothing else, a review comment on its lines, or, in snapshot mode, the unit's own doc comment. A changeset, commit message or pull request that names the unit among others is now `medium` (ADR 0018).

### Patch Changes

- [#63](https://github.com/Pixerate/poetics/pull/63) [`f7afe4a`](https://github.com/Pixerate/poetics/commit/f7afe4a062a0d3ea83a16e30182956b65c71be5b) Thanks [@surrealroad](https://github.com/surrealroad)! - `poetics backfill --snapshot` leads a unit's extracted rationale with its own doc comment when the changeset or commit text is shared with other units the commit introduced (ADR 0019). A one-unit commit's text stays the whole rationale.

## 0.4.0

### Minor Changes

- [#61](https://github.com/Pixerate/poetics/pull/61) [`f6a3cce`](https://github.com/Pixerate/poetics/commit/f6a3cce234ca2f956b4b65d2ee1cb4340223b0c9) Thanks [@surrealroad](https://github.com/surrealroad)! - `poetics backfill --draft` drafts each version's rationale through a command the repository configures in `backfill.draft.command` (ADR 0017); Poetics names no model or provider. The command reads one JSON draft request on stdin and writes one JSON draft on stdout. Poetics keeps the extracted rationale unless the draft cites only evidence it was given, sets `diffOnly` exactly when it cites nothing, and quotes no pull request or review text. Pull request text is sent only for public repositories or with `--draft-private`. Drafts are cached in `.poetics/cache/drafts.json`. `IssueTracker` gains an optional `visibility`, and the config schema gains `backfill.draft`.

### Patch Changes

- Updated dependencies [[`f6a3cce`](https://github.com/Pixerate/poetics/commit/f6a3cce234ca2f956b4b65d2ee1cb4340223b0c9)]:
  - @poetics/core@0.6.0
  - @poetics/store@0.4.0
  - @poetics/adapter-react@0.3.2
  - @poetics/adapter-typescript@0.2.2

## 0.3.0

### Minor Changes

- [#60](https://github.com/Pixerate/poetics/pull/60) [`f14d1a4`](https://github.com/Pixerate/poetics/commit/f14d1a4a510a7a89f7e12e9f8133684b76f7c131) Thanks [@surrealroad](https://github.com/surrealroad)! - `poetics backfill` collects pull request evidence (ADR 0011). Pull requests named in merge and squash subjects are linked as `github-pr`, no longer as issues. With a GitHub token (`GITHUB_TOKEN` or `gh auth token`) and an `origin` on github.com, both modes also link the pull requests containing each commit and the issues they close, and raise a version's confidence when a pull request names the unit or a review comment falls on its lines. Pull request and issue text is never written to `.poetics/`; responses are cached in `.poetics/cache/github.json`, a rate limit stops the collectors without failing the backfill, and `--offline` makes no calls. `@poetics/core` adds the `IssueTracker` interface, and a history walk leaves recorded prehistory alone when new evidence would change it.

### Patch Changes

- Updated dependencies [[`f14d1a4`](https://github.com/Pixerate/poetics/commit/f14d1a4a510a7a89f7e12e9f8133684b76f7c131)]:
  - @poetics/core@0.5.0
  - @poetics/adapter-react@0.3.1
  - @poetics/adapter-typescript@0.2.1
  - @poetics/store@0.3.2

## 0.2.1

### Patch Changes

- Updated dependencies [[`299615f`](https://github.com/Pixerate/poetics/commit/299615fadd2c5f4f62c2372e564af4833896a6e5)]:
  - @poetics/core@0.4.0
  - @poetics/adapter-typescript@0.2.0
  - @poetics/adapter-react@0.3.0
  - @poetics/store@0.3.1

## 0.2.0

### Minor Changes

- [#51](https://github.com/Pixerate/poetics/pull/51) [`4d52ae2`](https://github.com/Pixerate/poetics/commit/4d52ae2cf980b9e22ff2a02dbd2879b4c8aaa0dc) Thanks [@surrealroad](https://github.com/surrealroad)! - Add `poetics backfill --history` (ADR 0011). It walks the first-parent history, follows each unit through renames and moves with identity matching, and records the versions from before its unit file was committed in a new write-once `prehistory`, each marked `inferred` with rationale from its commit. A unit's prehistory stops where a match would only be queued. `poetics log` and `poetics why` show prehistory, and `poetics verify` and the store's checks enforce its rules. The store gains `setPrehistory` and `extendsPrehistory`.

- [#55](https://github.com/Pixerate/poetics/pull/55) [`7253403`](https://github.com/Pixerate/poetics/commit/72534039979cba5cb462cf20511bdd12c3b01c02) Thanks [@surrealroad](https://github.com/surrealroad)! - `poetics backfill --history --include-removed` recovers exports deleted before anyone recorded them. Each becomes a unit file with its reconstructed prehistory, a `created` version for the code as it last was, and a `removed` version from the commit that deleted it, all marked `inferred`. Code whose unit file was committed before its deletion is left to `poetics index`, and a rerun does not recover the same deletion twice.

- [#54](https://github.com/Pixerate/poetics/pull/54) [`b51bfcc`](https://github.com/Pixerate/poetics/commit/b51bfccffada77132919a630e5101da136c45459) Thanks [@surrealroad](https://github.com/surrealroad)! - `poetics backfill --history [<from>] [<to>]` walks only the first-parent commits after `<from>` up to `<to>`. Code that exists at `<from>` opens its prehistory at its first change in the range, so a later walk from further back extends it. Units recorded after `<to>` are reported rather than given a prehistory that stops short.

- [#43](https://github.com/Pixerate/poetics/pull/43) [`25a0219`](https://github.com/Pixerate/poetics/commit/25a021942e58edb41a3569379b9f4277f8316962) Thanks [@surrealroad](https://github.com/surrealroad)! - Add `poetics backfill --snapshot` (ADR 0011). It creates a unit for every export with none, with a rationale inferred from the repository's own commits, changesets, TSDoc, tests and docs, and an `inferred` record with a computed confidence. Units that already have a file are never written to; their gaps are listed instead. Versions gain an optional `inferred` field, which the index records as `inferred_confidence`.

- [#13](https://github.com/Pixerate/poetics/pull/13) [`4179058`](https://github.com/Pixerate/poetics/commit/41790589c7ba866ebec1c614447dbe207b28ca5f) Thanks [@surrealroad](https://github.com/surrealroad)! - Add the planned `poetics changes` command, `poetics_changes` MCP tool and
  `changesBetween` store API (stubs) for "what changed, and why" between two refs.

- [#14](https://github.com/Pixerate/poetics/pull/14) [`75c7809`](https://github.com/Pixerate/poetics/commit/75c7809053251aca256a5233df8f549cfc2a6939) Thanks [@surrealroad](https://github.com/surrealroad)! - Implement "what changed, and why" between two refs: `changesBetween` walks the
  range with git and reports each commit's unit versions with rationale,
  removals and interface changes first, plus commits that recorded no unit and
  decisions and notes added. `poetics changes [from] [to]` prints it (or JSON
  with `--json`), and the MCP server answers `poetics_changes`. `run` takes an
  optional repository root. `--impact` waits for the indexer.

- [#32](https://github.com/Pixerate/poetics/pull/32) [`a5da380`](https://github.com/Pixerate/poetics/commit/a5da3800ac2ec1d5478f7cc690d413d3bd627622) Thanks [@surrealroad](https://github.com/surrealroad)! - `poetics log <unit>` and `poetics why <unit>` print a unit's version history and the rationale chain behind it. `resolveUnit` moves from `@poetics/mcp` to `@poetics/store` and takes `(paths, db, ref)`.

- [#32](https://github.com/Pixerate/poetics/pull/32) [`9cda7f2`](https://github.com/Pixerate/poetics/commit/9cda7f2a092169e462564ccb3e79d821df58464e) Thanks [@surrealroad](https://github.com/surrealroad)! - `poetics verify [--since <ref>]` and `poetics coverage` run the change check and coverage report that were day-one scripts. The CLI now exports the declaration discovery, drift, change-check and coverage functions behind them, and depends on `typescript`.

- [#38](https://github.com/Pixerate/poetics/pull/38) [`35a768d`](https://github.com/Pixerate/poetics/commit/35a768d4eb418e6efb3ae405abd0eed14521014c) Thanks [@surrealroad](https://github.com/surrealroad)! - `poetics index` now follows test files git saw renamed since `--since`: it rewrites each live unit's `tests[].file` to the new path, moved unit or not, shows it as `= <unit> tests: <from> -> <to>` with a `relinked` count, and includes `relinks` in `--json`. Adds the `relinkTests` store writer.

- [#47](https://github.com/Pixerate/poetics/pull/47) [`ef7b943`](https://github.com/Pixerate/poetics/commit/ef7b943d35665af1ec21b4bcc7e87b2636804c05) Thanks [@surrealroad](https://github.com/surrealroad)! - Serve the MCP write tools. `poetics_record_rationale` gives the newest uncommitted version its rationale. `poetics_declare_lineage` declares a rename, move, split or merge, checked against the code the way `poetics index` matches. `poetics_record_note` records or re-confirms a note and regenerates `GOTCHAS.md`. Writes are attributed to the calling agent. The store's `recordRationale` is implemented, and it gains `createNote`, `confirmNote` and `buildGotchas`; its `declareLineage` stub moves to `@poetics/cli`, which implements it. `poetics index` takes declarations.

- [#36](https://github.com/Pixerate/poetics/pull/36) [`c1c0043`](https://github.com/Pixerate/poetics/commit/c1c0043bd0d0138fd0405e02146612ceed839381) Thanks [@surrealroad](https://github.com/surrealroad)! - Add `poetics index`. It records what changed since a ref: versions classified from their hashes, moves and renames with lineage through identity matching, new units with fresh uids, and removed units. Look-alike matches are reported, never guessed. It is a dry run by default; `--write` records the plan with a rationale that defaults to the commit messages since the ref. The store gains `createUnit` and `relocateUnit`.

- [#44](https://github.com/Pixerate/poetics/pull/44) [`4c5b49e`](https://github.com/Pixerate/poetics/commit/4c5b49ed6c0972695c06d07a51e19a218c2457e7) Thanks [@surrealroad](https://github.com/surrealroad)! - Add `poetics init`. It detects React and Svelte from the dependencies of the root and each workspace package (or from `.tsx` and `.svelte` files), writes `.poetics/config.json` scoped to each package's source, adds `.poetics/cache/` to `.gitignore`, and creates units with a snapshot backfill. It is a dry run without `--write`, and refuses a repository that already has a config. Snapshot backfill is also much faster on large repositories.

- [#45](https://github.com/Pixerate/poetics/pull/45) [`5fa1e89`](https://github.com/Pixerate/poetics/commit/5fa1e892c4b4f4e3a52f47770beedfae91c9b07a) Thanks [@surrealroad](https://github.com/surrealroad)! - Add the React adapter. `reactPlugin` plugs into the TypeScript indexer through a new `FrameworkPlugin` interface. It detects components (PascalCase functions that return JSX, or are wrapped in `memo`, `forwardRef` or `lazy`) and hooks, gives components their props, default prop values and forwarded ref as their interface, and records JSX tags as `renders` edges. `createReactAdapter` now takes the indexer's options. The CLI and MCP server run the plugin when `.poetics/config.json` lists `react` in `adapters`. `poetics init` now reads tsconfig files with TypeScript's own parser, so `paths` entries such as `"@/*"` no longer break it.

- [#46](https://github.com/Pixerate/poetics/pull/46) [`1159e9d`](https://github.com/Pixerate/poetics/commit/1159e9d60b3079056f190ed85e49a580ef46274e) Thanks [@surrealroad](https://github.com/surrealroad)! - `poetics index` now reclassifies units whose recorded kind or framework no longer matches what the adapters see, such as functions the React adapter claims as components in a store recorded before it. Reclassifying changes no versions and needs no rationale. The store gains `reclassifyUnit`.

- [#35](https://github.com/Pixerate/poetics/pull/35) [`52fdda8`](https://github.com/Pixerate/poetics/commit/52fdda88e21439e04970902aa5c9ed0e3976c11e) Thanks [@surrealroad](https://github.com/surrealroad)! - Add the rehash (ADR 0014). A new `rehash` change class re-records unchanged code under the indexer's `b3:` hash. `poetics rehash` plans and appends those versions, and `poetics hash` prints a file's unit hashes for hand-written versions. `poetics verify` and `poetics coverage` now compare `b3:` hashes instead of reporting them as unverifiable. `allowProvisionalHashes: false` now applies to each live unit's latest version only, and a note anchored to a unit stays confirmed through a rehash.

### Patch Changes

- [#48](https://github.com/Pixerate/poetics/pull/48) [`f674b0b`](https://github.com/Pixerate/poetics/commit/f674b0ba69d37ef67f6fe168ccaac5835e8cf00c) Thanks [@surrealroad](https://github.com/surrealroad)! - `poetics index` links each commit's issue references (`#N`, `owner/repo#N`) to the versions of units in the files that commit touched, instead of giving every version in the range every reference. References in an explicit `--rationale` still go on every version.

- [#37](https://github.com/Pixerate/poetics/pull/37) [`faa7163`](https://github.com/Pixerate/poetics/commit/faa71633c0fb4338c059cfe9ec2c54f2af8ca6ba) Thanks [@surrealroad](https://github.com/surrealroad)! - Move `readConfig`, `PoeticsConfig`, `CoverageThresholds`, `Scope`, `filesInScope`, `createMatcher` and `globToRegExp` from `@poetics/cli` into `@poetics/store`, which owns `.poetics/`. `@poetics/cli` still re-exports the config and scope functions.
- Updated dependencies [[`e47a3d4`](https://github.com/Pixerate/poetics/commit/e47a3d42e5dfc25a8e17e58735b10a528c62b509), [`4d52ae2`](https://github.com/Pixerate/poetics/commit/4d52ae2cf980b9e22ff2a02dbd2879b4c8aaa0dc), [`25a0219`](https://github.com/Pixerate/poetics/commit/25a021942e58edb41a3569379b9f4277f8316962), [`4179058`](https://github.com/Pixerate/poetics/commit/41790589c7ba866ebec1c614447dbe207b28ca5f), [`75c7809`](https://github.com/Pixerate/poetics/commit/75c7809053251aca256a5233df8f549cfc2a6939), [`a5da380`](https://github.com/Pixerate/poetics/commit/a5da3800ac2ec1d5478f7cc690d413d3bd627622), [`9fa9bf4`](https://github.com/Pixerate/poetics/commit/9fa9bf41326306e2112c6cea7a373750799b24eb), [`590a911`](https://github.com/Pixerate/poetics/commit/590a911fc1fc56266de9bb833c064c11d32228f3), [`35a768d`](https://github.com/Pixerate/poetics/commit/35a768d4eb418e6efb3ae405abd0eed14521014c), [`2b00ca8`](https://github.com/Pixerate/poetics/commit/2b00ca80421daf47fb1ad3eeb94461bb547f3032), [`98015d7`](https://github.com/Pixerate/poetics/commit/98015d790d9f42371dc89d87652b1974236ebf4b), [`ef7b943`](https://github.com/Pixerate/poetics/commit/ef7b943d35665af1ec21b4bcc7e87b2636804c05), [`c1c0043`](https://github.com/Pixerate/poetics/commit/c1c0043bd0d0138fd0405e02146612ceed839381), [`5fa1e89`](https://github.com/Pixerate/poetics/commit/5fa1e892c4b4f4e3a52f47770beedfae91c9b07a), [`2d9d2c2`](https://github.com/Pixerate/poetics/commit/2d9d2c2bb204000430a69194741c6837a2bc9d5d), [`4b15948`](https://github.com/Pixerate/poetics/commit/4b159485437b1bbe130d02692ec96b3e3d08e1b9), [`1159e9d`](https://github.com/Pixerate/poetics/commit/1159e9d60b3079056f190ed85e49a580ef46274e), [`52fdda8`](https://github.com/Pixerate/poetics/commit/52fdda88e21439e04970902aa5c9ed0e3976c11e), [`e238728`](https://github.com/Pixerate/poetics/commit/e23872825cff8ea5d63b7a3330f431a1800c5470), [`15dc817`](https://github.com/Pixerate/poetics/commit/15dc817e3a9864b2dfe2c9f51af222abd6426b27), [`faa7163`](https://github.com/Pixerate/poetics/commit/faa71633c0fb4338c059cfe9ec2c54f2af8ca6ba)]:
  - @poetics/adapter-typescript@0.1.0
  - @poetics/core@0.3.0
  - @poetics/store@0.3.0
  - @poetics/adapter-react@0.2.0

## 0.1.2

### Patch Changes

- [`b70f34f`](https://github.com/Pixerate/poetics/commit/b70f34fb688e8e71bbf63a375ab3aa0f2c2b692c) Thanks [@surrealroad](https://github.com/surrealroad)! - Published `exports` no longer include the `poetics-source` condition, which pointed at `src/index.ts`, a file the packages don't ship. Consumers running with `--conditions=poetics-source` now resolve to `dist/` instead of failing.
- Updated dependencies [[`b70f34f`](https://github.com/Pixerate/poetics/commit/b70f34fb688e8e71bbf63a375ab3aa0f2c2b692c)]:
  - @poetics/core@0.2.1
  - @poetics/store@0.2.1

## 0.1.1

### Patch Changes

- [`c064012`](https://github.com/Pixerate/poetics/commit/c064012fedef2489dbdef3509f00f45f3d23fd98) Thanks [@surrealroad](https://github.com/surrealroad)! - List the planned `poetics coverage` command and `poetics verify --since <ref>` in the CLI's help.
- Updated dependencies [[`02d4607`](https://github.com/Pixerate/poetics/commit/02d460760e1a6f155fa030346f6a2f6a3c0e362a)]:
  - @poetics/core@0.2.0
  - @poetics/store@0.2.0

## 0.1.0

### Minor Changes

- [`ed9ebd8`](https://github.com/Pixerate/poetics/commit/ed9ebd87250609a39068752b5c10d5292a32973a) Thanks [@surrealroad](https://github.com/surrealroad)! - Seed the packages with typed interface stubs from the plan. `@poetics/core` mints uids and computes provisional hashes; `@poetics/store` validates the `.poetics/` JSON store and maintains the local SQLite index.

### Patch Changes

- Updated dependencies [[`ed9ebd8`](https://github.com/Pixerate/poetics/commit/ed9ebd87250609a39068752b5c10d5292a32973a)]:
  - @poetics/core@0.1.0
  - @poetics/store@0.1.0
