# 0003. TypeScript compiler API, not tree-sitter

- Status: Accepted
- Date: 2026-10-27

## Context

Adapters must compute interface hashes, which need resolved types, and edges,
which need cross-file symbol resolution. A syntax-only parser such as
tree-sitter is faster but sees neither.

## Decision

Both adapters use the TypeScript type checker via ts-morph. The Svelte adapter
feeds `svelte2tsx` output into the same checker, so a Svelte component and a
React component calling one `.ts` utility resolve to the same unit.

The repo pins **TypeScript 6**. TypeScript 7 (the native port) does not ship
the classic compiler API that ts-morph, `svelte2tsx` and `svelte-check` depend
on.

## Consequences

- Indexing large repos is slower; incremental programs and a per-file hash
  cache are needed (phase 1).
- Tree-sitter can be added later as a pre-pass that skips unchanged files.
- Revisit the TypeScript 7 pin when its programmatic API is stable and the
  Svelte tooling supports it.
