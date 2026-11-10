---
"@poetics/cli": minor
---

`poetics backfill --history --include-removed` recovers exports deleted before anyone recorded them. Each becomes a unit file with its reconstructed prehistory, a `created` version for the code as it last was, and a `removed` version from the commit that deleted it, all marked `inferred`. Code whose unit file was committed before its deletion is left to `poetics index`, and a rerun does not recover the same deletion twice.
