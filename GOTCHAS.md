# GOTCHAS

Problems that cost someone time, and how to get past them. Add an entry in the
same commit as the fix; keep each to symptom, cause, fix.

## Tooling

### `pnpm ci` wipes `node_modules` instead of running checks

- **Symptom:** `pnpm ci` prints "Removing node_modules" and reinstalls.
- **Cause:** `ci` is a built-in pnpm command (clean install), so it shadows a
  package script of the same name.
- **Fix:** run `pnpm preflight` for the full local check.

### TypeScript is pinned to 6, not 7

- **Symptom:** upgrading to `typescript@7` breaks `sv check` and anything that
  imports the compiler API.
- **Cause:** TypeScript 7 (the native port) does not export the classic
  `typescript` JS API. `svelte-check` requires `^5 || ^6`, and ts-morph and
  `svelte2tsx` need the classic API.
- **Fix:** stay on `^6`. Dependabot will propose 7; close it until the Svelte
  tooling supports it. See ADR 0003.

### `sv check` downloads pnpm the first time

- **Symptom:** `pnpm check` prints "Corepack is about to download … pnpm".
- **Cause:** `sv check` runs `svelte-check` through the detected package
  manager via Corepack.
- **Fix:** harmless. Run `corepack enable` once so the pinned pnpm is cached.

## Node, type stripping and modules

### Workspace imports resolve to `dist/` and fail before a build

- **Symptom:** `ERR_MODULE_NOT_FOUND` for `@poetics/core/dist/index.js` when
  running a script or test.
- **Cause:** the `poetics-source` export condition was not passed, so Node used
  the `default` (built) entry.
- **Fix:** run scripts with `node --conditions=poetics-source` (the `pnpm`
  scripts already do). Vitest and `tsc` set the condition in their configs.

### Type stripping rejects some TypeScript syntax

- **Symptom:** `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` (or a `tsc` error from
  `erasableSyntaxOnly`) on `enum`, `namespace` or constructor parameter
  properties.
- **Cause:** Node only strips types; it does not transform syntax.
- **Fix:** use union types and `as const` objects instead of `enum`, and
  assign fields explicitly in constructors.

### Relative imports need `.ts` extensions

- **Symptom:** `ERR_MODULE_NOT_FOUND` for `./foo` at runtime.
- **Cause:** Node's ESM resolver does not guess extensions.
- **Fix:** import `./foo.ts`. `rewriteRelativeImportExtensions` turns it into
  `./foo.js` in `dist/`.

### `import.meta.main` needs Node 24.2+

- **Symptom:** a script's main block never runs on older Node.
- **Cause:** `import.meta.main` arrived in Node 24.2 (stability 1.0).
- **Fix:** use Node ≥ 24.15 (`engines` enforces it). Keep script logic in an
  exported function so tests import it without side effects.

## SQLite index

### `node:sqlite` is a release candidate, not stable

- **Symptom:** possible API changes or an experimental warning on some Node 24
  builds.
- **Cause:** `node:sqlite` became a release candidate (stability 1.2) in Node
  24.15; before that it was experimental.
- **Fix:** keep all SQLite access inside `packages/store/src/index-db.ts` so a
  change touches one file. The index is disposable, so a broken index is fixed
  with `pnpm reindex --fresh`.

### The index looks stale or wrong

- **Symptom:** lookups miss a unit you just added or show old data.
- **Cause:** the index is only updated by `rebuildIndex` (`pnpm reindex`).
- **Fix:** `pnpm reindex`. If in doubt, `pnpm reindex --fresh`; it is always
  safe to delete `.poetics/cache/`.

## Store

### `validate` says "has git: hashes but is not marked provisional"

- **Cause:** hand-written versions use `git:` hashes, which must carry
  `"provisional": true` (ADR 0004).
- **Fix:** add `"provisional": true` to that version.

### Provisional hashes change when code is reformatted

- **Cause:** a `git:` hash is a hash of the raw text, not the syntax tree.
- **Fix:** don't append versions for formatting-only edits; the phase 1 indexer
  replaces provisional hashes with syntax-tree hashes.

## Releases

### Nothing is published to npm

- **Cause:** every package is `"private": true` until a maintainer sets up the
  `@poetics` scope and trusted publishing (see `docs/ci-and-releases.md`).
- **Fix:** follow the one-time setup there, then remove `"private": true`.
