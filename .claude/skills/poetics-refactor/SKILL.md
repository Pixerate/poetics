---
name: poetics-refactor
description: Use before renaming, moving, splitting or merging any function, hook or component in a Poetics repo, so the unit keeps its identity and history.
---

# Refactor without losing identity

A unit's `uid` never changes. Renames and moves keep the same unit file; you
record what happened so history carries over. Day-one version: you edit unit
files by hand. When `poetics_declare_lineage` lands, step 3 becomes a call to
it, checked against the diff.

1. **Before touching code**, find every unit you will rename, move, split or
   merge (`poetics-orient`) and note each uid.
2. **Make the code change.**
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
     Do not delete the merged units' files; append a final version with
     rationale "Merged into <uid>" so their history stays readable.
4. **Append a version** to each unit whose source text changed, per
   `poetics-change`. A pure move with identical text needs no new version.
5. **Check**: `pnpm validate` and `pnpm test`.

Never work around a problem by deleting unit files or rewriting `versions`.
If a declaration does not fit these cases, stop and ask.
