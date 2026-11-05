---
name: poetics-refactor
description: Use before renaming, moving, splitting or merging any function, hook or component in a Poetics repo, so the unit keeps its identity and history.
---

# Refactor without losing identity

A unit's `uid` never changes. Renames and moves keep the same unit file; you
record what happened so history carries over. `pnpm poetics index` infers
renames and moves; for what it queues, and for every split and merge, call
`poetics_declare_lineage` with the kind, the old units (`from`) and the new
places as `file#name` (`to`). It is checked against the code: a declaration
the code disagrees with is rejected with the reason, and nothing is written.
Without an MCP server, step 3 below is the same thing by hand.

1. **Before touching code**, find every unit you will rename, move, split or
   merge (`poetics-orient`) and note each uid.
2. **Make the code change**, then run `pnpm poetics index` (a dry run). It
   follows renames and moves itself, by content or by syntax-tree similarity,
   and lists them as `>` lines; `--write` records them with lineage. Lines
   starting with `?` are matches it would not guess (look-alikes): declare
   those by hand as below, and run it again. Splits and merges are never
   inferred.
3. **Declare lineage** in each affected unit file:
   - **Rename or move:** keep the same file and uid. Update `name` and/or
     `location.file`, and append to `lineage`:
     `{ "kind": "move", "from": "src/old/path.ts" }` or
     `{ "kind": "rename", "from": "oldName" }`.
   - **Split:** the original uid continues as the part that keeps the old
     name. Mint uids for the new parts (`pnpm mint-uid 2`); each new unit's
     `lineage` gets `{ "kind": "split", "uids": ["<original uid>"] }` and the
     original gets `{ "kind": "split", "uids": ["<new uids>"] }`.
   - **Merge:** the surviving unit gets `{ "kind": "merge", "uids": [<merged uids>] }`.
     Do not delete the merged units' files; append a final `removed` version
     (see `poetics-change`) with rationale "Merged into <uid>: <why>" so their
     history stays readable.
4. **Append a version** to each unit whose source text changed, per
   `poetics-change`. A pure move with identical text needs no new version.
5. **Check**: `pnpm validate`, `pnpm poetics:check` and `pnpm test`. The
   check fails a unit whose name or location changed without a new lineage
   entry, a unit left behind in a deleted file, and a deleted unit file.

Never work around a problem by deleting unit files or rewriting `versions`.
If a declaration does not fit these cases, stop and ask.
