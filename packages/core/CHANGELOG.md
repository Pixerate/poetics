# @poetics/core

## 0.5.0

### Minor Changes

- [#60](https://github.com/Pixerate/poetics/pull/60) [`f14d1a4`](https://github.com/Pixerate/poetics/commit/f14d1a4a510a7a89f7e12e9f8133684b76f7c131) Thanks [@surrealroad](https://github.com/surrealroad)! - `poetics backfill` collects pull request evidence (ADR 0011). Pull requests named in merge and squash subjects are linked as `github-pr`, no longer as issues. With a GitHub token (`GITHUB_TOKEN` or `gh auth token`) and an `origin` on github.com, both modes also link the pull requests containing each commit and the issues they close, and raise a version's confidence when a pull request names the unit or a review comment falls on its lines. Pull request and issue text is never written to `.poetics/`; responses are cached in `.poetics/cache/github.json`, a rate limit stops the collectors without failing the backfill, and `--offline` makes no calls. `@poetics/core` adds the `IssueTracker` interface, and a history walk leaves recorded prehistory alone when new evidence would change it.

## 0.4.0

### Minor Changes

- [#59](https://github.com/Pixerate/poetics/pull/59) [`299615f`](https://github.com/Pixerate/poetics/commit/299615fadd2c5f4f62c2372e564af4833896a6e5) Thanks [@surrealroad](https://github.com/surrealroad)! - React contexts are units of a new kind, `context` (ADR 0016). The React adapter tracks `createContext` values, with their value type and default as the interface, and records every provider and consumer (`useContext`, `use`, `<Ctx.Provider>`, `<Ctx>`, `static contextType`) as a `uses-context` edge. `FrameworkPlugin` gains a `value` hook for exported variables that hold no function.

## 0.3.0

### Minor Changes

- [#51](https://github.com/Pixerate/poetics/pull/51) [`4d52ae2`](https://github.com/Pixerate/poetics/commit/4d52ae2cf980b9e22ff2a02dbd2879b4c8aaa0dc) Thanks [@surrealroad](https://github.com/surrealroad)! - Add `poetics backfill --history` (ADR 0011). It walks the first-parent history, follows each unit through renames and moves with identity matching, and records the versions from before its unit file was committed in a new write-once `prehistory`, each marked `inferred` with rationale from its commit. A unit's prehistory stops where a match would only be queued. `poetics log` and `poetics why` show prehistory, and `poetics verify` and the store's checks enforce its rules. The store gains `setPrehistory` and `extendsPrehistory`.

- [#43](https://github.com/Pixerate/poetics/pull/43) [`25a0219`](https://github.com/Pixerate/poetics/commit/25a021942e58edb41a3569379b9f4277f8316962) Thanks [@surrealroad](https://github.com/surrealroad)! - Add `poetics backfill --snapshot` (ADR 0011). It creates a unit for every export with none, with a rationale inferred from the repository's own commits, changesets, TSDoc, tests and docs, and an `inferred` record with a computed confidence. Units that already have a file are never written to; their gaps are listed instead. Versions gain an optional `inferred` field, which the index records as `inferred_confidence`.

- [#27](https://github.com/Pixerate/poetics/pull/27) [`9fa9bf4`](https://github.com/Pixerate/poetics/commit/9fa9bf41326306e2112c6cea7a373750799b24eb) Thanks [@surrealroad](https://github.com/surrealroad)! - Implement BLAKE3 `contentHash`, `interfaceHash` and `closureHash`, and the composition graph: `createGraph`, `stronglyConnectedComponents`, `computeClosureHashes` and `impactOf`, which takes a new `ImpactOptions` to flag direct callers of an interface change.

- [#34](https://github.com/Pixerate/poetics/pull/34) [`590a911`](https://github.com/Pixerate/poetics/commit/590a911fc1fc56266de9bb833c064c11d32228f3) Thanks [@surrealroad](https://github.com/surrealroad)! - Add identity matching. `matchIdentities` follows tracked units across renames, moves, splits and merges: declared lineage first, then file and name, then content hash, then syntax-tree similarity. Ambiguous matches are queued rather than guessed. The TypeScript indexer now gives each unit a similarity `fingerprint`.

- [#35](https://github.com/Pixerate/poetics/pull/35) [`52fdda8`](https://github.com/Pixerate/poetics/commit/52fdda88e21439e04970902aa5c9ed0e3976c11e) Thanks [@surrealroad](https://github.com/surrealroad)! - Add the rehash (ADR 0014). A new `rehash` change class re-records unchanged code under the indexer's `b3:` hash. `poetics rehash` plans and appends those versions, and `poetics hash` prints a file's unit hashes for hand-written versions. `poetics verify` and `poetics coverage` now compare `b3:` hashes instead of reporting them as unverifiable. `allowProvisionalHashes: false` now applies to each live unit's latest version only, and a note anchored to a unit stays confirmed through a rehash.

- [#13](https://github.com/Pixerate/poetics/pull/13) [`e238728`](https://github.com/Pixerate/poetics/commit/e23872825cff8ea5d63b7a3330f431a1800c5470) Thanks [@surrealroad](https://github.com/surrealroad)! - Record deletions as a final `removed` version instead of deleting unit files
  (`REMOVED_CONTENT_HASH`, `isRemoved`), and validate them in `checkStore`.

## 0.2.1

### Patch Changes

- [`b70f34f`](https://github.com/Pixerate/poetics/commit/b70f34fb688e8e71bbf63a375ab3aa0f2c2b692c) Thanks [@surrealroad](https://github.com/surrealroad)! - Published `exports` no longer include the `poetics-source` condition, which pointed at `src/index.ts`, a file the packages don't ship. Consumers running with `--conditions=poetics-source` now resolve to `dist/` instead of failing.

## 0.2.0

### Minor Changes

- [`02d4607`](https://github.com/Pixerate/poetics/commit/02d460760e1a6f155fa030346f6a2f6a3c0e362a) Thanks [@surrealroad](https://github.com/surrealroad)! - Add notes: gotchas, workarounds and invariants as anchored records in `.poetics/notes/`. `@poetics/core` adds the `Note` types; `@poetics/store` validates notes, warns when an anchored unit has changed since a note was confirmed, and renders `GOTCHAS.md` with `renderGotchas`; `@poetics/mcp` defines the `poetics_notes` and `poetics_record_note` tools.

## 0.1.0

### Minor Changes

- [`ed9ebd8`](https://github.com/Pixerate/poetics/commit/ed9ebd87250609a39068752b5c10d5292a32973a) Thanks [@surrealroad](https://github.com/surrealroad)! - Seed the packages with typed interface stubs from the plan. `@poetics/core` mints uids and computes provisional hashes; `@poetics/store` validates the `.poetics/` JSON store and maintains the local SQLite index.
