# 0014. The rehash is an appended version

- Status: Proposed
- Date: 2026-11-03

## Context

[ADR 0004](0004-provisional-hashes.md) gave hand-written versions provisional
`git:` hashes until the indexer could compute `b3:` hashes over normalised
syntax trees, and made the indexer's first job a rehash that keeps history.
The indexer (#19) and identity matching (#20) now exist. Versions are
append-only, and `poetics verify` fails any change that edits an earlier
version.

There were two ways to rehash (#21):

- **Rewrite in place:** replace each unit's latest `git:` hash with its `b3:`
  hash. History stays free of bookkeeping, but editing recorded versions needs
  a one-off exemption from the append-only rule.
- **Append:** give each unit a new version with its `b3:` hash. Every rule
  stays as it is, at the cost of one extra version per unit.

## Decision

The rehash appends. A new change class, `rehash`, means *the same code as the
previous version, now hashed by the indexer*. A `rehash` version:

- has a `b3:` `contentHash`, an `interfaceHash` from the indexer, and no
  `provisional` flag;
- directly follows a version with a `git:` hash, and is never the first;
- is only written when the unit's code still has the previous version's
  provisional hash, so it can never hide a code change. `poetics verify` checks
  this.

`poetics rehash` plans the migration and, with `--write`, appends the versions.
Once every live unit's latest version is `b3:`, `allowProvisionalHashes: false`
means that a live unit's latest version must not be provisional. Earlier `git:`
versions stay as they were recorded.

After the rehash, the freshness checks in `poetics verify` and `poetics coverage`
compare `b3:` content hashes, which need only the syntax tree. `poetics hash`
prints a unit's hashes for hand-written versions, in place of
`pnpm provisional-hash`.

## Consequences

- Every unit has one bookkeeping version. `poetics changes` lists rehash
  versions last, and the change check does not ask them for test changes or
  distinct rationale.
- `pnpm provisional-hash` and the `git:` hashing it did are retired for new
  versions; `git:` stays only for history and the removed sentinel.
- Formatting-only edits no longer look like changes, since `b3:` hashes ignore
  formatting and comments.
- A repository adopting Poetics later starts from backfill (ADR 0011) with `b3:`
  hashes and never needs a rehash.
