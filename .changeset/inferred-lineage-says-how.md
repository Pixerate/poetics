---
"@poetics/core": minor
"@poetics/cli": minor
---

Lineage entries that `poetics index` inferred from similar syntax trees now record how they were found, with `via` (`"similarity"` or `"lone"`) and `score` (ADR 0029). `poetics:check` warns with `lone-match` on each new entry found only as a file's lone leftover pair, and `poetics history` and `poetics why` show how an entry was found. `LineageEntry` gains `via` and `score`, and `LineageInference` is new.
