# @poetics/cli

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
