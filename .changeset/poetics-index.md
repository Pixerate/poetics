---
"@poetics/cli": minor
"@poetics/store": minor
---

Add `poetics index`. It records what changed since a ref: versions classified from their hashes, moves and renames with lineage through identity matching, new units with fresh uids, and removed units. Look-alike matches are reported, never guessed. It is a dry run by default; `--write` records the plan with a rationale that defaults to the commit messages since the ref. The store gains `createUnit` and `relocateUnit`.
