# 0007. A per-change check and a coverage report

- Status: Accepted
- Date: 2026-10-27

## Context

`pnpm validate` only checks that `.poetics/` agrees with itself. Nothing
checked it against the code, so a commit that changed an exported function
without recording a version passed CI, and there was no way to see how much of
a codebase Poetics actually covered. The first run of the coverage report found
nine adapter declarations that the seed had never given units, because the
one-off generator skipped `index.ts` files.

## Decision

Two day-one commands, built on one shared discovery module
(`scripts/lib/declarations.ts`) that finds exported functions and types in the
configured scope and hashes them the way the store does:

- **`pnpm poetics:check [--since <ref>]`** compares the working tree with a
  base (default `HEAD`, the merge base for branches). Errors: untracked exports,
  stale units, orphaned units, duplicates, rewritten history, moves without
  lineage. Warnings: versions without links, repeated rationale, behaviour or
  interface versions without test changes, interface changes whose dependents
  got no version. Pull requests run it against their base branch; `pnpm
  preflight` runs it before commits.
- **`pnpm poetics:coverage`** reports tracked, fresh, linked-rationale,
  reviewed, tested and documented ratios, overall and per area, plus note
  health. `policy.coverage` in the config sets minimums that fail CI.

Declarations are matched to units by file and name; lineage keeps that match
correct across renames and moves.

## Consequences

- Unrecorded changes now fail pull requests, for humans and agents alike.
- Provisional text hashes make formatting-only edits look like changes until
  the indexer's syntax-tree hashes land.
- The discovery module is a stand-in for adapter detection; `.svelte` files
  are reported as not yet indexable. Phase 1 replaces it with the adapters and
  moves both commands into `poetics verify` and `poetics coverage`, and the
  GitHub Action posts the check's findings on the pull request.
