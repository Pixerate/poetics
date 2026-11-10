---
"@poetics/cli": minor
---

`poetics backfill` gives `high` confidence only when the evidence is about the unit alone: a commit that introduced or changed nothing else, a review comment on its lines, or, in snapshot mode, the unit's own doc comment. A changeset, commit message or pull request that names the unit among others is now `medium` (ADR 0018).
