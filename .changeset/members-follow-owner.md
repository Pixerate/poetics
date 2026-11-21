---
"@poetics/core": minor
"@poetics/cli": patch
---

Identity matching has a fifth stage: a member whose owner was renamed or moved follows it, pairing with the member of the owner's match that has the same name within it (ADR 0027). Renaming a Swift type no longer loses members that mention it, or queues its identical members. `CodeUnit` gains `owner`, `TrackedUnit` gains `ownerUid`, and `MatchVia` gains `"owner"`.
