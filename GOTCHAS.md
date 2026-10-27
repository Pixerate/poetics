# GOTCHAS

<!-- Generated from .poetics/notes/ by `pnpm gotchas`. Do not edit by hand: add or change a note file instead (see the poetics-gotcha skill). -->

Problems that cost someone time, and how to get past them. Each entry is a note in `.poetics/notes/`, anchored to the code, files, dependencies or commands it is about.

## Tooling

### `pnpm ci` wipes `node_modules` instead of running checks

- **Symptom:** `Removing node_modules`
- **Cause:** `ci` is a built-in pnpm command (clean install), so it shadows a package script of the same name.
- **Fix:** Run `pnpm preflight` for the full local check. Never add a script named `ci`.
- **Applies to:** `pnpm ci`, `pnpm@>=10`, `package.json`
- **Caught by:** test `scripts/scripts.test.ts` (has no script named ci, which pnpm would shadow with its clean-install command)
- **Note:** `01M5YKKDB5X1GJ71RSBE5ZD7C9`

### TypeScript is pinned to 6, not 7

*Workaround.*

- **Cause:** TypeScript 7 (the native port) does not export the classic `typescript` JS API. `svelte-check` requires `^5 || ^6`, and ts-morph and `svelte2tsx` need the classic API.
- **Fix:** Stay on `^6`. Dependabot ignores TypeScript major updates; revisit when the Svelte tooling supports 7.
- **Applies to:** `typescript@^6`, `svelte-check@^4`, `.github/dependabot.yml`, `package.json`
- **Caught by:** config `.github/dependabot.yml`
- **See:** [docs/decisions/0003-typescript-compiler-api.md](docs/decisions/0003-typescript-compiler-api.md)
- **Note:** `01M5YKKDB6HEDGYN42QZJTVZR8`

### `sv check` downloads pnpm the first time

- **Symptom:** `Corepack is about to download`
- **Cause:** `sv check` runs `svelte-check` through the detected package manager via Corepack.
- **Fix:** Harmless. Run `corepack enable` once so the pinned pnpm is cached.
- **Applies to:** `pnpm check`, `sv check`, `evals/fixtures/svelte-app/package.json`
- **Note:** `01M5YKKDB7ZEAE3KHNYQYCNDRZ`

### `@types/node` must stay on the Node runtime's major

*Invariant.*

- **Cause:** Dependabot proposes major updates to `@types/node` (it bumped 24 to 26). Types from a newer major let code type-check against Node APIs that do not exist on the Node 24 runtime the repo targets.
- **Fix:** Keep `@types/node` on the same major as `engines.node` and `.nvmrc`. Dependabot ignores its major updates; bump all three together when moving to a new Node major.
- **Applies to:** `@types/node@^24`, `node@>=24.15`, `package.json`, `.nvmrc`, `.github/dependabot.yml`
- **Caught by:** test `scripts/scripts.test.ts` (keeps @types/node on the same major as engines and .nvmrc)
- **See:** [github-pr #2](https://github.com/Pixerate/poetics/pull/2)
- **Note:** `01M5YNW98CNNKNCWQQT77SECD3`

### Tests that commit in temporary git repos must disable signing

*Invariant.*

- **Symptom:** `error: 1Password: failed to fill whole buffer`; `fatal: failed to write commit object`
- **Cause:** Git inherits the user's global config, including `commit.gpgsign` and an SSH signer such as 1Password. A test that runs `git commit` in a temp repo would prompt the signer, or fail when it is locked or absent (as in CI).
- **Fix:** Commit through `runGit` in `scripts/lib/test-repo.ts`, which passes `-c commit.gpgsign=false` and a test identity on every call.
- **Applies to:** `git commit`, `scripts/lib/test-repo.ts`
- **Caught by:** config `scripts/lib/test-repo.ts`
- **See:** [docs/decisions/0007-change-check-and-coverage.md](docs/decisions/0007-change-check-and-coverage.md)
- **Note:** `01M5Z1HP0KRF5JE401H3B81EGN`

## Node, type stripping and modules

### Workspace imports resolve to `dist/` and fail before a build

- **Symptom:** `ERR_MODULE_NOT_FOUND`
- **Cause:** The `poetics-source` export condition was not passed, so Node used the `default` (built) entry.
- **Fix:** Run scripts with `node --conditions=poetics-source` (the `pnpm` scripts already do). Vitest and `tsc` set the condition in their configs.
- **Applies to:** `vitest.config.ts`, `tsconfig.base.json`, `package.json`
- **Caught by:** test `scripts/scripts.test.ts` (runs directly under Node with type stripping)
- **See:** [docs/decisions/0005-node-24-type-stripping.md](docs/decisions/0005-node-24-type-stripping.md)
- **Note:** `01M5YKKDB87N2DH9HD07X9D0ZF`

### Type stripping rejects some TypeScript syntax

- **Symptom:** `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`
- **Cause:** Node only strips types; it does not transform `enum`, `namespace` or constructor parameter properties.
- **Fix:** Use union types and `as const` objects instead of `enum`, and assign fields explicitly in constructors. `erasableSyntaxOnly` makes `tsc` reject them early.
- **Applies to:** `tsconfig.base.json`
- **Caught by:** config `tsconfig.base.json`
- **See:** [docs/decisions/0005-node-24-type-stripping.md](docs/decisions/0005-node-24-type-stripping.md)
- **Note:** `01M5YKKDB9E5CAKYK9Z1WP5W4S`

### Relative imports need `.ts` extensions

- **Symptom:** `ERR_MODULE_NOT_FOUND`
- **Cause:** Node's ESM resolver does not guess extensions.
- **Fix:** Import `./foo.ts`. `rewriteRelativeImportExtensions` turns it into `./foo.js` in `dist/`.
- **Applies to:** `tsconfig.base.json`
- **Caught by:** config `tsconfig.base.json`
- **Note:** `01M5YKKDBA6EPBM57MVPV5P99G`

### `import.meta.main` needs Node 24.2+

- **Cause:** `import.meta.main` arrived in Node 24.2 (stability 1.0).
- **Fix:** Use Node ≥ 24.15 (`engines` enforces it). Keep script logic in an exported function so tests import it without side effects.
- **Applies to:** `node@>=24.2`, `scripts`
- **Caught by:** config `package.json`
- **Note:** `01M5YKKDBBB0T8MJ5ZCSH55CZ8`

## JSON Schemas

### Ajv strict mode rejects `required` inside `if`/`then`

- **Symptom:** `strict mode: required property "resolvedBy" is not defined`
- **Cause:** Ajv's `strictRequired` wants every required property declared in the same schema object, and a `then` branch is its own object.
- **Fix:** Declare the property in the branch too: `"then": { "properties": { "resolvedBy": true }, "required": ["resolvedBy"] }`.
- **Applies to:** `schemas/note.schema.json`, `createValidator`
- **Caught by:** test `packages/store/src/schemas.test.ts`
- **Note:** `01M5YKKDBCJNDPDPD4PHF1QCRW`

## SQLite index

### Keep all `node:sqlite` access in `index-db.ts`

*Invariant.*

- **Cause:** `node:sqlite` became a release candidate (stability 1.2) in Node 24.15; before that it was experimental, and its API may still change.
- **Fix:** Only `packages/store/src/index-db.ts` imports `node:sqlite`, so an API change touches one file. The index is disposable: `pnpm reindex --fresh` fixes a broken one.
- **Applies to:** `node@>=24.15`, `packages/store/src/index-db.ts`, `openIndex`
- **See:** [docs/decisions/0005-node-24-type-stripping.md](docs/decisions/0005-node-24-type-stripping.md)
- **Note:** `01M5YKKDBDDA41D5W3J7NVVBR8`

### The index looks stale or wrong

- **Cause:** The index is only updated by `rebuildIndex` (`pnpm reindex`).
- **Fix:** `pnpm reindex`. If in doubt, `pnpm reindex --fresh`; it is always safe to delete `.poetics/cache/`.
- **Applies to:** `pnpm reindex`, `rebuildIndex`
- **See:** [docs/decisions/0002-hybrid-json-sqlite-store.md](docs/decisions/0002-hybrid-json-sqlite-store.md)
- **Note:** `01M5YKKDBE3TEHAAXA6W2YHQ8C`

## Store

### `validate` says a version has git: hashes but is not marked provisional

- **Symptom:** `has git: hashes but is not marked provisional`
- **Cause:** Hand-written versions use `git:` hashes, which must carry `"provisional": true`.
- **Fix:** Add `"provisional": true` to that version.
- **Applies to:** `pnpm validate`, `checkStore`
- **Caught by:** validator `has git: hashes but is not marked provisional`
- **See:** [docs/decisions/0004-provisional-hashes.md](docs/decisions/0004-provisional-hashes.md)
- **Note:** `01M5YKKDBFX6D69ZPHJDYC70BZ`

### Provisional hashes change when code is reformatted

- **Cause:** A `git:` hash is a hash of the raw text, not the syntax tree.
- **Fix:** Don't append versions for formatting-only edits; the phase 1 indexer replaces provisional hashes with syntax-tree hashes.
- **Applies to:** `gitBlobHash`, `provisionalHash`
- **See:** [docs/decisions/0004-provisional-hashes.md](docs/decisions/0004-provisional-hashes.md)
- **Note:** `01M5YKKDBGV4R0MAVRD0TWAXVZ`

## Resolved and superseded

| Note | Status |
| --- | --- |
| Nothing is published to npm (`01M5YKKDBHB74W1K94RSHWGRXK`) | Resolved by [docs/ci-and-releases.md](docs/ci-and-releases.md) |
