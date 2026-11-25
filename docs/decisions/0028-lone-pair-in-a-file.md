# 0028. A lone removed and created unit in one file pair at a lower threshold

- Status: Proposed
- Date: 2026-11-25
- Refines: identity matching as [`docs/data-model.md`](../data-model.md)
  describes it

## Context

Similarity matching needs a Jaccard score of 0.65 and at least 8 fingerprint
entries. Both protect units that resemble others by chance. The cost lands on
small functions that are renamed and edited together. One added statement
changes about four entries, so a unit with _n_ entries scores about
(_n_ − 2) / (_n_ + 4) against its old self. That reaches 0.65 only at 14
entries or more.

The identity gate measured this cost. Across seeds 26, 7 and 99 it made 147
rename-edits and lost 30 uids. Every one of the 30 had 4 to 13 entries and
scored between 0.25 and 0.65. In every one, the file had exactly one unit left
unmatched on each side: the unit that was renamed and edited.

How often is a file's one removed unit and one created unit a different unit?
We looked at real history for files where a commit removed some exports and
added others:

| History | Commits | One removed and one created | Their similarity |
| --- | --- | --- | --- |
| Poetics | 121 | none | n/a |
| TanStack Query | 600 | none (one merge of two into one) | n/a |
| shadcn-svelte | 900 | 6 different units | 0.00 to 0.08 |
| shadcn-svelte | (same) | 1 type renamed and edited | 0.67 |

Options considered:

- **Lower the threshold or the minimum size everywhere.** This trades away
  the guard that keeps unrelated units in other files apart. The closest
  unrelated pair in this repository already scores 0.61.
- **Pair any lone removed and created unit in a file.** This would pair all
  6 of the different units above.
- **Pair them when they share some shape.** A floor of 0.2 sits between the
  different units (0.08 at most) and the gate's losses (0.25 at least).
- **Queue them for a person.** Safe, but a small rename-edit is common, and
  a queue that fills with the right answer teaches people to approve it
  without looking.

## Decision

**A sixth stage pairs a file's lone removed unit with its lone created unit
when their similarity is at least 0.2.**

- It runs last, after the held groups are decided, on what is still open.
- For each file and namespace (types and values apart), it looks at the
  tracked units that are still open and the code units that are still open.
  If there is exactly one of each, and their similarity is at least 0.2, they
  are the same unit.
- The minimum size does not apply. The file and the lack of any alternative
  stand in for the evidence a small unit's shape cannot give.
- A match from this stage is recorded with `via: "lone"` and its score, so a
  reviewer can tell it apart from a stage 4 match. `poetics index` prints
  `(lone 0.42)` beside the planned rename.
- `MatchOptions.loneThreshold` sets the floor.

## Consequences

- The gate keeps every uid on all five corpora and all three seeds. It
  misplaces none, queues none, and creates no unit that no refactor made.
- In the history above, the stage pairs nothing wrongly. Of the 7 lone
  pairs it sees, it pairs only the type that was renamed.
- The evidence is thin. The gate makes exactly this shape, and the real
  history has 7 lone pairs from one repository. Tiny helpers of 4 to 6
  entries could share enough leaf subtrees by chance to pass 0.2, and
  nothing we looked at tests that. If wrong pairs show up, raising
  `loneThreshold` or adding a minimum size to this stage are the levers.
- Deleting one function and writing an unrelated one in the same file, in
  one commit, can now carry the old history across when they share some
  shape. `via: "lone"` in the plan is where to catch it, and a declared
  lineage or a split into two commits avoids it.
- Splits and merges are still only applied when declared.
