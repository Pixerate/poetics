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

### Swift: every function in Alamofire

The gate picks a few units at random. To see the whole distribution, we
measured every function in the Alamofire corpus (`dea4bab`, 101 files) with
the Swift adapter, on both sides of the question.

**Renamed and edited.** Each function with a body got the gate's
rename-edit on its own: `_ = 0` at the top of its body and `Gate` on its base
name. Of 1,660 functions, 353 were missed by stages 1 to 5. They had 4 to 66
entries. (Another 61 could not be measured, because renaming the text also
renamed an overload.)

| Lone floor | Rename-edits kept | Unrelated same-file pairs it would pair |
| --- | --- | --- |
| 0.2 | 339 of 353 (96%) | 15,092 of 46,850 (32%) |
| 0.3 | 321 (91%) | 12,003 (26%) |
| 0.4 | 282 (80%) | 7,560 (16%) |
| 0.5 | 208 (59%) | 3,743 (8%) |

The 14 that a floor of 0.2 does not keep score 0.176 to 0.182:

- 11 are empty default implementations (`func request(_:didCreateTask:) {}`).
  Their first statement outweighs everything else in them.
- 3 are artefacts. Their name is also a parameter name and an argument label,
  so the text rename rewrote those too. The gate never picks such a function.

**Unrelated.** As a stand-in for deleting one function and writing another
in one commit, we scored every pair of different functions that sit in the
same file. The right column counts pairs that score at least the floor and
that stage 4 would not already pair (below 0.65, or under 8 entries). Where
the smaller function has fewer than 14 entries, 0.2 pairs 1,868 of 16,304
(11.5%).

Swift code in one file is often alike: protocol default implementations,
or the `HTTPHeader` factories. Stage 4 already pairs 3,728 of these
unrelated pairs (8%) on its own. Functions that live side by side are
probably more alike than a deleted function and the unrelated one that
replaces it, so the right column is a pessimistic estimate. Still, no floor
separates the two groups in Swift the way 0.08 and 0.25 separate them in the
TypeScript and Svelte history above.

The interface hash is no help here. The Swift adapter's interface hash
includes the name, so every rename changes it (all 353).

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
  (IceCubes with seed 7 gets there only with the gate fix in Pixerate/poetics#108;
  before it, the gate's split crashed in that run.)
- In the history above, the stage pairs nothing wrongly. Of the 7 lone
  pairs it sees, it pairs only the type that was renamed.
- The evidence is thin. The gate makes exactly this shape, and the real
  history has 7 lone pairs from one repository. If wrong pairs show up,
  raising `loneThreshold` or adding a minimum size to this stage are the
  levers.
- In Swift the floor does not separate the two cases. On Alamofire it keeps
  96% of small rename-edits, but would also pair about a third of unrelated
  same-file functions (11.5% where the smaller one has under 14 entries).
  Raising it costs rename-edits faster than it removes wrong pairs: 0.5
  keeps 59% and still pairs 8%. So in Swift, `via: "lone"` is a guess the
  file makes likely, not a measurement, and is worth a look in review.
- Deleting one function and writing an unrelated one in the same file, in
  one commit, can now carry the old history across when they share some
  shape. `via: "lone"` in the plan is where to catch it, and a declared
  lineage or a split into two commits avoids it.
- Splits and merges are still only applied when declared.
