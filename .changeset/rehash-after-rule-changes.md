---
"@poetics/cli": minor
"@poetics/store": minor
---

Re-record interface hashes that adapter rule changes made stale (ADR 0024). `poetics index` and `poetics rehash` now append a `rehash` version for unchanged `b3:` code whose interface hash the adapters compute differently, so the next edit is no longer misclassified as `interface`. The store check allows that rehash to repeat its parent's `contentHash`, and the change check accepts it on a `b3:` parent. `RehashEntry` gains `reason`. `poetics rehash` now finds Svelte components, which it missed by looking them up as `default`.
