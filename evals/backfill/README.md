# Backfill eval: inferred rationale against recorded rationale

Issue [#16](https://github.com/Pixerate/poetics/issues/16) asks for an eval of
`poetics backfill` ([ADR 0011](../../docs/decisions/0011-backfill.md)): run it on
this repository, whose rationale was recorded unit by unit as the code was
written, and compare what it infers with what was recorded.
[`results.md`](results.md) has the latest run.

## Method

`pnpm eval:backfill [--draft]`:

1. Clones this repository with its history into a scratch directory and
   removes `.poetics/units/` from the clone's working tree, so every unit is
   inferred from the repository alone. The checkout itself is not touched.
2. Runs the snapshot backfill offline, so a run is repeatable and free. With
   `--draft`, rationale is drafted through `backfill.draft.command`
   ([ADR 0017](../../docs/decisions/0017-drafting-through-a-command.md)); this
   repository configures none, so drafted rationale is not measured yet.
3. Pairs each inferred version with the recorded version that was committed
   in the same commit as its evidence: the commit that wrote the
   declaration's first line. A unit whose inferred commit recorded no
   version of it is counted as unpaired.
4. Scores each pair lexically, on content words (three letters or more, stop
   words removed, plurals folded):
   - **recall:** the share of the recorded rationale's words that the
     inferred one also has;
   - **overlap:** the Jaccard index of the two sets of words.

   Recall alone rewards long text that covers the whole change, so examples
   are ranked by overlap.

The results break the scores down by the confidence backfill gave and by the
evidence it used.

## Findings (2026-11-10, at `0ca3b0e`)

- 303 of 314 units paired. Mean recall is 30% and mean overlap 10%; 19% of
  inferred rationales recover at least half of the recorded wording. The
  inferred rationale is the change's reason (a changeset or commit message),
  while the recorded one says what this unit is for, so most of the gap is
  scope rather than error.
- **Confidence does not predict agreement.** `high` versions scored no better
  than `medium` (28% against 30% recall; 11% against 21% at 50% or more).
  Every `high` version here came from a changeset that names the unit, and
  a changeset describes its package's change even when it names one unit.
  Naming a unit is weaker evidence than the confidence rule assumes.
- TSDoc helps: versions whose evidence included the unit's own comment scored
  34% against 28% without it, and commit messages alone scored lowest (17%).
- The furthest pairs are types and helpers added inside a large first commit
  whose message describes a whole feature, such as the demo site's types.

## Confidence revised (2026-11-10, ADR 0018)

The finding above led to [ADR 0018](../../docs/decisions/0018-backfill-confidence-is-unit-specific.md):
naming a unit no longer makes a version `high`; a reason with evidence about
this unit alone does (a commit that introduced nothing else, a review comment
on its lines, or the unit's own doc comment in snapshot mode). The rationale
text is unchanged, so only the split by confidence moves. Both runs are on the
same corpus, at `7372c64` (311 pairs):

| Rule | Confidence | Pairs | Mean recall | Mean overlap | Recall ≥ 50% |
| --- | --- | --- | --- | --- | --- |
| Before: naming the unit gives `high` | high | 35 | 28% | 12% | 11% |
| | medium | 276 | 30% | 9% | 20% |
| After: evidence about this unit alone gives `high` | high | 190 | 32% | 10% | 24% |
| | medium | 121 | 25% | 8% | 12% |

- `high` now agrees better than `medium` on recall (32% against 25%) and
  doubles the share recovering half the recorded wording (24% against 12%).
  Overlap barely moves: the rationale is still the change's text, shared with
  other units.
- What the evidence was checked against: among the changesets that named the
  unit, those naming more than two other units from the same commit scored
  18% recall; using only the sentence that names the unit scored 9%. Neither
  was turned into a rule.
- The gain is mostly from the doc comment, which almost every export here has
  because this repository requires TSDoc. On a repository with little TSDoc,
  most versions will be `medium`. Versions whose rationale was a bare commit
  message scored about 18% whatever their confidence.
- The doc comment itself agrees better than the changeset: as the rationale
  of the 189 units that have one, it scores 25% overlap against 10%. Leading
  the extracted rationale with it would change what rationale says, not how
  sure it is, and is left for its own decision.

## Rationale leads with the doc comment (2026-11-10, ADR 0019)

The last finding led to [ADR 0019](../../docs/decisions/0019-backfill-rationale-leads-with-the-doc-comment.md):
when the change's text is shared with other units the commit introduced, the
unit's doc comment leads it, as its own paragraph. A one-unit commit's text
stays the whole rationale. Confidence is unchanged. Both runs are on the same
corpus, at `df077c8` (312 pairs):

| Rule | | Pairs | Mean recall | Mean overlap | Recall ≥ 50% |
| --- | --- | --- | --- | --- | --- |
| Before: the change's text | All | 312 | 30% | 10% | 19% |
| | high | 191 | 33% | 11% | 24% |
| | from: commit + comment | 26 | 18% | 6% | 12% |
| After: doc comment, then the change's text | All | 312 | 41% | 12% | 36% |
| | high | 191 | 50% | 15% | 51% |
| | from: commit + comment | 26 | 50% | 16% | 58% |

`medium` versions (no doc comment, shared text) are unchanged at 25% recall
and 8% overlap.

Variants measured on the 185 versions the rule changes, before choosing it:

| Rationale | Mean recall | Mean overlap | Recall ≥ 50% | Content words |
| --- | --- | --- | --- | --- |
| The change's text (before) | 32% | 10% | 24% | 34 |
| The doc comment alone | 32% | 25% | 24% | 11 |
| The doc comment, then the change's text (chosen) | 51% | 15% | 51% | 41 |
| Control: another unit's doc comment, then the change's text | 34% | 9% | 24% | 43 |

The recorded rationale averages 15 content words.

- Overlap rises with recall, so the gain is not just longer text, and the
  control confirms it: a doc comment that is not this unit's, of the same
  length, adds nothing.
- The doc comment alone agrees most tightly but drops the change's reason;
  leading with it keeps both.
- Also leading one-unit commits with the doc comment scored the same (51%
  against 50% recall for `high`), so the rule keeps ADR 0011's "most specific
  evidence wins" there.
- Bare commit messages gain most: they rarely say what a unit is for.
- This repository requires TSDoc, so the gain here is an upper bound: on a
  repository with little TSDoc most versions keep the change's text.

## What this eval cannot say yet

- **The recorded rationale is not human ground truth.** All 303 recorded
  versions in the pairs were written by an agent and are unreviewed, often in
  the same session as the commit message they are compared with. The eval
  measures agreement with that record, not correctness.
- **Lexical scores miss meaning.** Two rationales can agree in different
  words. A drafted run (`--draft` with a configured command) and a semantic
  judgment, by people or by a judging command, are the next measurements.
- **One repository.** This one records rationale per unit from its first
  commit, which is the case backfill exists to make unnecessary. Repositories
  adopting Poetics later have no such record to compare with.
