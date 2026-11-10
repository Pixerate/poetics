# @poetics/adapter-svelte

## 0.1.4

### Patch Changes

- Updated dependencies [[`299615f`](https://github.com/Pixerate/poetics/commit/299615fadd2c5f4f62c2372e564af4833896a6e5)]:
  - @poetics/core@0.4.0

## 0.1.3

### Patch Changes

- Updated dependencies [[`4d52ae2`](https://github.com/Pixerate/poetics/commit/4d52ae2cf980b9e22ff2a02dbd2879b4c8aaa0dc), [`25a0219`](https://github.com/Pixerate/poetics/commit/25a021942e58edb41a3569379b9f4277f8316962), [`9fa9bf4`](https://github.com/Pixerate/poetics/commit/9fa9bf41326306e2112c6cea7a373750799b24eb), [`590a911`](https://github.com/Pixerate/poetics/commit/590a911fc1fc56266de9bb833c064c11d32228f3), [`52fdda8`](https://github.com/Pixerate/poetics/commit/52fdda88e21439e04970902aa5c9ed0e3976c11e), [`e238728`](https://github.com/Pixerate/poetics/commit/e23872825cff8ea5d63b7a3330f431a1800c5470)]:
  - @poetics/core@0.3.0

## 0.1.2

### Patch Changes

- [`b70f34f`](https://github.com/Pixerate/poetics/commit/b70f34fb688e8e71bbf63a375ab3aa0f2c2b692c) Thanks [@surrealroad](https://github.com/surrealroad)! - Published `exports` no longer include the `poetics-source` condition, which pointed at `src/index.ts`, a file the packages don't ship. Consumers running with `--conditions=poetics-source` now resolve to `dist/` instead of failing.
- Updated dependencies [[`b70f34f`](https://github.com/Pixerate/poetics/commit/b70f34fb688e8e71bbf63a375ab3aa0f2c2b692c)]:
  - @poetics/core@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [[`02d4607`](https://github.com/Pixerate/poetics/commit/02d460760e1a6f155fa030346f6a2f6a3c0e362a)]:
  - @poetics/core@0.2.0

## 0.1.0

### Minor Changes

- [`ed9ebd8`](https://github.com/Pixerate/poetics/commit/ed9ebd87250609a39068752b5c10d5292a32973a) Thanks [@surrealroad](https://github.com/surrealroad)! - Seed the packages with typed interface stubs from the plan. `@poetics/core` mints uids and computes provisional hashes; `@poetics/store` validates the `.poetics/` JSON store and maintains the local SQLite index.

### Patch Changes

- Updated dependencies [[`ed9ebd8`](https://github.com/Pixerate/poetics/commit/ed9ebd87250609a39068752b5c10d5292a32973a)]:
  - @poetics/core@0.1.0
