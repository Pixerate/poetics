# 0005. Node 24, native type stripping and `node:sqlite`

- Status: Accepted
- Date: 2026-10-27

## Context

Scripts such as `scripts/validate.ts` must run on day one without a build step,
and the local index needs SQLite without a native add-on that breaks installs.

## Decision

- Node **24.15** is the minimum (`engines.node >= 24.15.0`) and Node 24 is the CI
  version. 24.15 is where `node:sqlite` became a release candidate; `import.meta.main`,
  which scripts use to detect direct execution, arrived in 24.2.
- TypeScript runs directly under Node's built-in type stripping. Source uses
  only erasable syntax (`erasableSyntaxOnly`), imports use `.ts` extensions,
  and `rewriteRelativeImportExtensions` turns them into `.js` in `dist/`.
- Workspace packages export a `poetics-source` condition pointing at
  `src/index.ts`. Scripts run with `node --conditions=poetics-source`, Vitest
  and `tsc` use the same condition, and published consumers get `dist/`.
- The SQLite index uses the built-in `node:sqlite` module.

## Consequences

- No `enum`, `namespace` or parameter properties in source.
- `node:sqlite` is a release candidate (stability 1.2) in Node 24.15, not yet
  stable, and `import.meta.main` is stability 1.0. Either could change in a later
  major. See `GOTCHAS.md`.
