---
"@poetics/core": minor
"@poetics/store": minor
"@poetics/cli": minor
---

Add `poetics backfill --history` (ADR 0011). It walks the first-parent history, follows each unit through renames and moves with identity matching, and records the versions from before its unit file was committed in a new write-once `prehistory`, each marked `inferred` with rationale from its commit. A unit's prehistory stops where a match would only be queued. `poetics log` and `poetics why` show prehistory, and `poetics verify` and the store's checks enforce its rules. The store gains `setPrehistory` and `extendsPrehistory`.
