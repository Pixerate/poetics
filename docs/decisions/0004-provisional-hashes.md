# 0004. Provisional git blob hashes until the indexer exists

- Status: Accepted
- Date: 2026-10-27

## Context

Poetics is its own first user from the first commit, but the indexer that
computes normalised syntax-tree hashes (BLAKE3, `b3:`) arrives in phase 1.
Hand-written unit files still need version hashes.

## Decision

Until then, a version's `contentHash` is the git blob hash of the unit's
declaration text (from `export` to its closing brace, without the trailing
newline), written `git:<40 hex>` and marked `"provisional": true`.
`pnpm provisional-hash <file> <start> <end>` computes it.

`scripts/validate.ts` enforces that `git:` hashes and `provisional: true` always
appear together, and the config policy `allowProvisionalHashes` can forbid them
once the indexer lands.

## Consequences

- Provisional hashes change with formatting, so a reformat looks like a change
  until the indexer replaces them. Do not record versions for formatting-only
  edits.
- The phase 1 indexer's first job is a rehash migration: reconcile every
  hand-written unit with the code and replace `git:` hashes with `b3:` ones while
  keeping history. Poetics' own store is the first test corpus.
