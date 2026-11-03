---
"@poetics/cli": minor
---

`poetics verify [--since <ref>]` and `poetics coverage` run the change check and coverage report that were day-one scripts. The CLI now exports the declaration discovery, drift, change-check and coverage functions behind them, and depends on `typescript`.
