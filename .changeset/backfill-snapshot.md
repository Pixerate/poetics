---
"@poetics/core": minor
"@poetics/store": minor
"@poetics/cli": minor
---

Add `poetics backfill --snapshot` (ADR 0011). It creates a unit for every export with none, with a rationale inferred from the repository's own commits, changesets, TSDoc, tests and docs, and an `inferred` record with a computed confidence. Units that already have a file are never written to; their gaps are listed instead. Versions gain an optional `inferred` field, which the index records as `inferred_confidence`.
