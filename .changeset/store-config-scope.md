---
"@poetics/store": minor
"@poetics/cli": patch
---

Move `readConfig`, `PoeticsConfig`, `CoverageThresholds`, `Scope`, `filesInScope`, `createMatcher` and `globToRegExp` from `@poetics/cli` into `@poetics/store`, which owns `.poetics/`. `@poetics/cli` still re-exports the config and scope functions.
