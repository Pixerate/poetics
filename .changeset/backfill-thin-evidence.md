---
"@poetics/cli": minor
---

Backfill no longer treats thin commit evidence as being about one unit (ADR 0022, #64). A commit is about one unit only if it introduced one export when it was made, so a survivor of a large commit whose other exports were later deleted is `medium`, not `high`. The unit's doc comment now leads every snapshot rationale, a one-unit commit's text included. Adds `exportsIntroduced`.
