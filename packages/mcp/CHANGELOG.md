# @poetics/mcp

## 0.4.5

### Patch Changes

- Updated dependencies [[`95cdbff`](https://github.com/Pixerate/poetics/commit/95cdbffb0b88e4fc9bdbaf5fb5635262fdbc2eae)]:
  - @poetics/cli@0.8.1

## 0.4.4

### Patch Changes

- [#79](https://github.com/Pixerate/poetics/pull/79) [`b4f919b`](https://github.com/Pixerate/poetics/commit/b4f919b0dc50e691122491e815ba72aa99472d4b) Thanks [@surrealroad](https://github.com/surrealroad)! - Track functions declared in a Svelte component's `<script>` and `<script module>` as child units owned by the component ([#72](https://github.com/Pixerate/poetics/issues/72)). Each has its own content hash, taken from the function as written, and its own interface and edges from the checker. An edit to one records a version of it and of its component, and the component's version lists its children's hashes in `deps`. Detected and indexed units gain `owner`; a component's edges no longer include what its script functions use; drift, the MCP code view and `poetics index` now include owned units; `relocateUnit` sets or clears the owner when a unit moves.
- Updated dependencies [[`b4f919b`](https://github.com/Pixerate/poetics/commit/b4f919b0dc50e691122491e815ba72aa99472d4b)]:
  - @poetics/adapter-typescript@0.5.0
  - @poetics/cli@0.8.0
  - @poetics/store@0.5.1

## 0.4.3

### Patch Changes

- Updated dependencies [[`5ed117c`](https://github.com/Pixerate/poetics/commit/5ed117cff779ccb2a8e5428066851f6bf10a8f51)]:
  - @poetics/adapter-typescript@0.4.0
  - @poetics/cli@0.7.2

## 0.4.2

### Patch Changes

- Updated dependencies []:
  - @poetics/cli@0.7.1

## 0.4.1

### Patch Changes

- [#76](https://github.com/Pixerate/poetics/pull/76) [`6c48ba7`](https://github.com/Pixerate/poetics/commit/6c48ba70a55ffd521055226e4896a910a48d05e0) Thanks [@surrealroad](https://github.com/surrealroad)! - Svelte components are indexed (ADR 0020). `@poetics/adapter-svelte` now exports `sveltePlugin`, a framework plugin for the TypeScript indexer that replaces the `createSvelteAdapter` stub. Each `.svelte` file is turned into TypeScript by `svelte2tsx` and read by the same checker as every other file, so components and `.ts` code resolve to each other. Each component is one `component` unit, hashed from its source as written, with its props type as its interface and `renders` edges to the components it uses.
  
  `FrameworkPlugin` gains `extensions`, `transform`, `ambient` and `detect` for files that are not TypeScript, and `version` may be a string. `filesInScope` reads `.svelte` files when the `svelte` adapter is configured, and `poetics index`, `verify`, `coverage`, `backfill` and the MCP tools use the Svelte plugin when it is.
- Updated dependencies [[`6c48ba7`](https://github.com/Pixerate/poetics/commit/6c48ba70a55ffd521055226e4896a910a48d05e0)]:
  - @poetics/adapter-typescript@0.3.0
  - @poetics/store@0.5.0
  - @poetics/cli@0.7.0

## 0.4.0

### Minor Changes

- [#67](https://github.com/Pixerate/poetics/pull/67) [`1126038`](https://github.com/Pixerate/poetics/commit/1126038605e3ee809b4bc37ffabefb34f9929353) Thanks [@surrealroad](https://github.com/surrealroad)! - The MCP server answers `poetics_signals` (a unit's linked issues and pull requests, with titles, states and review comments on its file) and `poetics_context_pack` with an `issue`: it picks the unit the issue most likely touches, says why, and adds the issue's text and the other issues linked from the same code. Issue text is read through the issue tracker on demand and never written to `.poetics/`. `IssueTracker` gains an optional `issue(number)`, which the GitHub tracker implements.

### Patch Changes

- Updated dependencies [[`1126038`](https://github.com/Pixerate/poetics/commit/1126038605e3ee809b4bc37ffabefb34f9929353)]:
  - @poetics/core@0.7.0
  - @poetics/cli@0.6.0
  - @poetics/adapter-react@0.3.3
  - @poetics/adapter-typescript@0.2.3
  - @poetics/store@0.4.1

## 0.3.4

### Patch Changes

- Updated dependencies [[`df077c8`](https://github.com/Pixerate/poetics/commit/df077c87d63f1aa44931ac85f9fe2ede3137780d), [`f7afe4a`](https://github.com/Pixerate/poetics/commit/f7afe4a062a0d3ea83a16e30182956b65c71be5b)]:
  - @poetics/cli@0.5.0

## 0.3.3

### Patch Changes

- Updated dependencies [[`f6a3cce`](https://github.com/Pixerate/poetics/commit/f6a3cce234ca2f956b4b65d2ee1cb4340223b0c9)]:
  - @poetics/core@0.6.0
  - @poetics/store@0.4.0
  - @poetics/cli@0.4.0
  - @poetics/adapter-react@0.3.2
  - @poetics/adapter-typescript@0.2.2

## 0.3.2

### Patch Changes

- Updated dependencies [[`f14d1a4`](https://github.com/Pixerate/poetics/commit/f14d1a4a510a7a89f7e12e9f8133684b76f7c131)]:
  - @poetics/core@0.5.0
  - @poetics/cli@0.3.0
  - @poetics/adapter-react@0.3.1
  - @poetics/adapter-typescript@0.2.1
  - @poetics/store@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [[`299615f`](https://github.com/Pixerate/poetics/commit/299615fadd2c5f4f62c2372e564af4833896a6e5)]:
  - @poetics/core@0.4.0
  - @poetics/adapter-typescript@0.2.0
  - @poetics/adapter-react@0.3.0
  - @poetics/cli@0.2.1
  - @poetics/store@0.3.1

## 0.3.0

### Minor Changes

- [#13](https://github.com/Pixerate/poetics/pull/13) [`4179058`](https://github.com/Pixerate/poetics/commit/41790589c7ba866ebec1c614447dbe207b28ca5f) Thanks [@surrealroad](https://github.com/surrealroad)! - Add the planned `poetics changes` command, `poetics_changes` MCP tool and
  `changesBetween` store API (stubs) for "what changed, and why" between two refs.

- [#14](https://github.com/Pixerate/poetics/pull/14) [`75c7809`](https://github.com/Pixerate/poetics/commit/75c7809053251aca256a5233df8f549cfc2a6939) Thanks [@surrealroad](https://github.com/surrealroad)! - Implement "what changed, and why" between two refs: `changesBetween` walks the
  range with git and reports each commit's unit versions with rationale,
  removals and interface changes first, plus commits that recorded no unit and
  decisions and notes added. `poetics changes [from] [to]` prints it (or JSON
  with `--json`), and the MCP server answers `poetics_changes`. `run` takes an
  optional repository root. `--impact` waits for the indexer.

- [#32](https://github.com/Pixerate/poetics/pull/32) [`a5da380`](https://github.com/Pixerate/poetics/commit/a5da3800ac2ec1d5478f7cc690d413d3bd627622) Thanks [@surrealroad](https://github.com/surrealroad)! - `poetics log <unit>` and `poetics why <unit>` print a unit's version history and the rationale chain behind it. `resolveUnit` moves from `@poetics/mcp` to `@poetics/store` and takes `(paths, db, ref)`.

- [#37](https://github.com/Pixerate/poetics/pull/37) [`2b00ca8`](https://github.com/Pixerate/poetics/commit/2b00ca80421daf47fb1ad3eeb94461bb547f3032) Thanks [@surrealroad](https://github.com/surrealroad)! - The MCP server reads the code. Context packs include the unit's code and signature, and the signatures of its callers and dependencies. `poetics_impact` ranks the units a change reaches through the composition graph, and `poetics_changes` does too with `impact: true`. `poetics_verify` reports what is behind in a path scope. The indexer gives each unit a `signatureText`, and counts what a private helper uses as used by the exported unit that calls it.

- [#31](https://github.com/Pixerate/poetics/pull/31) [`98015d7`](https://github.com/Pixerate/poetics/commit/98015d790d9f42371dc89d87652b1974236ebf4b) Thanks [@surrealroad](https://github.com/surrealroad)! - `poetics-mcp` serves MCP over stdio. It answers `poetics_context_pack` (token-budgeted), `poetics_search`, `poetics_unit`, `poetics_history`, `poetics_changes`, `poetics_tests_for` and `poetics_notes` from the store, and lists only those tools. `PoeticsServer` gains `tools()`, and `listen()` accepts streams. The store adds `readUnit`, a `match: "any"` option on `searchUnits`, and `docs` on `UnitRow`.

- [#47](https://github.com/Pixerate/poetics/pull/47) [`ef7b943`](https://github.com/Pixerate/poetics/commit/ef7b943d35665af1ec21b4bcc7e87b2636804c05) Thanks [@surrealroad](https://github.com/surrealroad)! - Serve the MCP write tools. `poetics_record_rationale` gives the newest uncommitted version its rationale. `poetics_declare_lineage` declares a rename, move, split or merge, checked against the code the way `poetics index` matches. `poetics_record_note` records or re-confirms a note and regenerates `GOTCHAS.md`. Writes are attributed to the calling agent. The store's `recordRationale` is implemented, and it gains `createNote`, `confirmNote` and `buildGotchas`; its `declareLineage` stub moves to `@poetics/cli`, which implements it. `poetics index` takes declarations.

- [#45](https://github.com/Pixerate/poetics/pull/45) [`5fa1e89`](https://github.com/Pixerate/poetics/commit/5fa1e892c4b4f4e3a52f47770beedfae91c9b07a) Thanks [@surrealroad](https://github.com/surrealroad)! - Add the React adapter. `reactPlugin` plugs into the TypeScript indexer through a new `FrameworkPlugin` interface. It detects components (PascalCase functions that return JSX, or are wrapped in `memo`, `forwardRef` or `lazy`) and hooks, gives components their props, default prop values and forwarded ref as their interface, and records JSX tags as `renders` edges. `createReactAdapter` now takes the indexer's options. The CLI and MCP server run the plugin when `.poetics/config.json` lists `react` in `adapters`. `poetics init` now reads tsconfig files with TypeScript's own parser, so `paths` entries such as `"@/*"` no longer break it.

### Patch Changes

- Updated dependencies [[`e47a3d4`](https://github.com/Pixerate/poetics/commit/e47a3d42e5dfc25a8e17e58735b10a528c62b509), [`4d52ae2`](https://github.com/Pixerate/poetics/commit/4d52ae2cf980b9e22ff2a02dbd2879b4c8aaa0dc), [`7253403`](https://github.com/Pixerate/poetics/commit/72534039979cba5cb462cf20511bdd12c3b01c02), [`b51bfcc`](https://github.com/Pixerate/poetics/commit/b51bfccffada77132919a630e5101da136c45459), [`25a0219`](https://github.com/Pixerate/poetics/commit/25a021942e58edb41a3569379b9f4277f8316962), [`4179058`](https://github.com/Pixerate/poetics/commit/41790589c7ba866ebec1c614447dbe207b28ca5f), [`75c7809`](https://github.com/Pixerate/poetics/commit/75c7809053251aca256a5233df8f549cfc2a6939), [`a5da380`](https://github.com/Pixerate/poetics/commit/a5da3800ac2ec1d5478f7cc690d413d3bd627622), [`9cda7f2`](https://github.com/Pixerate/poetics/commit/9cda7f2a092169e462564ccb3e79d821df58464e), [`9fa9bf4`](https://github.com/Pixerate/poetics/commit/9fa9bf41326306e2112c6cea7a373750799b24eb), [`590a911`](https://github.com/Pixerate/poetics/commit/590a911fc1fc56266de9bb833c064c11d32228f3), [`35a768d`](https://github.com/Pixerate/poetics/commit/35a768d4eb418e6efb3ae405abd0eed14521014c), [`f674b0b`](https://github.com/Pixerate/poetics/commit/f674b0ba69d37ef67f6fe168ccaac5835e8cf00c), [`2b00ca8`](https://github.com/Pixerate/poetics/commit/2b00ca80421daf47fb1ad3eeb94461bb547f3032), [`98015d7`](https://github.com/Pixerate/poetics/commit/98015d790d9f42371dc89d87652b1974236ebf4b), [`ef7b943`](https://github.com/Pixerate/poetics/commit/ef7b943d35665af1ec21b4bcc7e87b2636804c05), [`c1c0043`](https://github.com/Pixerate/poetics/commit/c1c0043bd0d0138fd0405e02146612ceed839381), [`4c5b49e`](https://github.com/Pixerate/poetics/commit/4c5b49ed6c0972695c06d07a51e19a218c2457e7), [`5fa1e89`](https://github.com/Pixerate/poetics/commit/5fa1e892c4b4f4e3a52f47770beedfae91c9b07a), [`2d9d2c2`](https://github.com/Pixerate/poetics/commit/2d9d2c2bb204000430a69194741c6837a2bc9d5d), [`4b15948`](https://github.com/Pixerate/poetics/commit/4b159485437b1bbe130d02692ec96b3e3d08e1b9), [`1159e9d`](https://github.com/Pixerate/poetics/commit/1159e9d60b3079056f190ed85e49a580ef46274e), [`52fdda8`](https://github.com/Pixerate/poetics/commit/52fdda88e21439e04970902aa5c9ed0e3976c11e), [`e238728`](https://github.com/Pixerate/poetics/commit/e23872825cff8ea5d63b7a3330f431a1800c5470), [`15dc817`](https://github.com/Pixerate/poetics/commit/15dc817e3a9864b2dfe2c9f51af222abd6426b27), [`faa7163`](https://github.com/Pixerate/poetics/commit/faa71633c0fb4338c059cfe9ec2c54f2af8ca6ba)]:
  - @poetics/adapter-typescript@0.1.0
  - @poetics/core@0.3.0
  - @poetics/store@0.3.0
  - @poetics/cli@0.2.0
  - @poetics/adapter-react@0.2.0

## 0.2.1

### Patch Changes

- [`b70f34f`](https://github.com/Pixerate/poetics/commit/b70f34fb688e8e71bbf63a375ab3aa0f2c2b692c) Thanks [@surrealroad](https://github.com/surrealroad)! - Published `exports` no longer include the `poetics-source` condition, which pointed at `src/index.ts`, a file the packages don't ship. Consumers running with `--conditions=poetics-source` now resolve to `dist/` instead of failing.
- Updated dependencies [[`b70f34f`](https://github.com/Pixerate/poetics/commit/b70f34fb688e8e71bbf63a375ab3aa0f2c2b692c)]:
  - @poetics/core@0.2.1
  - @poetics/store@0.2.1

## 0.2.0

### Minor Changes

- [`02d4607`](https://github.com/Pixerate/poetics/commit/02d460760e1a6f155fa030346f6a2f6a3c0e362a) Thanks [@surrealroad](https://github.com/surrealroad)! - Add notes: gotchas, workarounds and invariants as anchored records in `.poetics/notes/`. `@poetics/core` adds the `Note` types; `@poetics/store` validates notes, warns when an anchored unit has changed since a note was confirmed, and renders `GOTCHAS.md` with `renderGotchas`; `@poetics/mcp` defines the `poetics_notes` and `poetics_record_note` tools.

### Patch Changes

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
