# 0024. A rehash also follows an adapter rule change

- Status: Proposed
- Date: 2026-11-14

## Context

`poetics index` treats a unit as up to date when its code has the latest
version's `contentHash`, and classifies the next edit by comparing that
version's stored `interfaceHash` with the one it computes now
([ADR 0014](0014-rehash-versions.md)). Both hashes depend on the adapters'
rules, not only on the code. The Svelte adapter's rules went from 4 to 6 during
#72–#74 ([ADR 0020](0020-svelte-through-svelte2tsx.md)), and the change to how
a component's props are read gave six of the site's components a different
`interfaceHash` for the same code. Their content hashes did not change, so
nothing noticed. The first later edit, a one-word text change to
`Overview.svelte`, was classified as `interface`, and `poetics verify` asked for
its callers to be updated. A reclassification (a function the React adapter now
claims as a component) does the same: its interface becomes its props.

The options were:

- **Ignore stored interface hashes made under other rules:** record the rules
  version in each version and skip the comparison when it differs. That needs a
  new field, and the edit is then classified `behaviour` even when the interface
  did change.
- **Compute the base code's interface hash under the current rules:** correct
  for every edit, but it needs a type-checked program of the code at the base
  ref, not the syntactic snapshot `poetics index` reads today.
- **Re-record the interface hash when the rules change it:** append a version
  saying the code is the same and its interface hash is now this, so history
  stays append-only and later comparisons use the current rules.

## Decision

Re-record it, with the `rehash` change class. A `rehash` version now means *the
same code, re-recorded under the indexer's current hashes*, and comes in two
forms:

- after a `git:` version, as in ADR 0014;
- after a `b3:` version with the **same** `contentHash` and a **different**
  `interfaceHash`. It is the one version allowed to repeat its parent's
  `contentHash`, and its `parent` is that hash.

`poetics index` plans this rehash for every unit it would otherwise count as up
to date when the adapters now compute a different interface hash, including a
unit it reclassifies. It needs no rationale: the version carries its own, and
links this record. `poetics rehash` plans the same versions, so a repository
can catch up in one run. The change check accepts such a rehash only when the
code's `b3:` hash is both its parent and its `contentHash`.

## Consequences

- Running `poetics index` after a commit that changes an adapter's rules
  re-records every unit whose interface hash moved, before anyone edits them.
- An edit made in the same run as a rule change is still compared with the
  stored interface hash, since the old one cannot be recomputed from a
  syntactic snapshot. Index after a rule change, before editing what it covers.
- `pnpm validate` allows the repeated `contentHash` only for this rehash; any
  other repeat is still an error.
- Code that finds a version by `contentHash` finds the earlier of the two,
  which records the same code.
