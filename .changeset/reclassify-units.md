---
"@poetics/store": minor
"@poetics/cli": minor
---

`poetics index` now reclassifies units whose recorded kind or framework no longer matches what the adapters see, such as functions the React adapter claims as components in a store recorded before it. Reclassifying changes no versions and needs no rationale. The store gains `reclassifyUnit`.
