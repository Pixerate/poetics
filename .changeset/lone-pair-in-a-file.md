---
"@poetics/core": minor
---

Identity matching has a sixth stage: when a file has exactly one tracked unit and one new unit of a namespace left unmatched, they pair if their similarity is at least 0.2, whatever their size (ADR 0028). Small functions that are renamed and edited in one commit no longer lose their uids. `MatchVia` gains `"lone"` and `MatchOptions` gains `loneThreshold`.
