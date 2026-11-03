# 0013. The TypeScript compiler API directly, without ts-morph

- Status: Proposed
- Date: 2026-11-03

## Context

[ADR 0003](0003-typescript-compiler-api.md) chose the TypeScript type checker
over tree-sitter, and named ts-morph as the way to reach it. Building the
indexer (#19) showed what that would cost:

- ts-morph 28 does not use the project's `typescript`. Its `@ts-morph/common`
  bundles its own copy (6.0.2 today, next to the repo's pinned 6.0.3), so its
  nodes, types and checker are a second compiler in the same process.
- The Svelte adapter must feed `svelte2tsx` output into the same checker as
  plain TypeScript, so a Svelte component and a React component calling one
  utility resolve to the same unit. Two compilers make that harder.
- The CLI's declaration scan already uses the compiler API directly, and the
  indexer needs little of what ts-morph adds: symbol resolution, alias
  following and type printing are a few checker calls.

## Decision

The adapters use the `typescript` package's compiler API directly, at the
version the repo pins. ts-morph is not a dependency. The rest of ADR 0003
stands: the type checker, not a syntax-only parser, and TypeScript 6.

## Consequences

- One compiler and one version across the CLI, the indexer and the Svelte
  adapter, upgraded in one place.
- Program reuse, the compiler host and source-file caching are written by
  hand in `@poetics/adapter-typescript` (about 50 lines) rather than taken
  from ts-morph's `Project`.
- Code that walks syntax uses the compiler's own node guards (`ts.isX`),
  which are more verbose than ts-morph's wrappers.
