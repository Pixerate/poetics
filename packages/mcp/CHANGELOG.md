# @poetics/mcp

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
