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

## Late-adopting repositories (2026-11-12, #64)

`pnpm eval:backfill --corpus [--fetch] [--only name]` backfills the repositories
in [`corpus.json`](corpus.json), which never used Poetics, at a pinned commit.
`--fetch` clones each with its full history into `.cache/` (gitignored; nothing
is installed or run). In a throwaway clone it writes a config for the corpus's
scope, runs the snapshot backfill offline, then records and commits the units
and walks the whole first-parent history for their prehistory, deleted exports
included. With no recorded rationale to compare against, it reports what
backfill infers: confidence, the evidence each rationale rests on, its length
in content words, and run time. [`corpus-results.md`](corpus-results.md) has
the latest run. The corpora are two of the identity gate's:

| | taxonomy | TanStack Query |
| --- | --- | --- |
| Commits (first-parent) | 134 (96) | 6,015 (5,627) |
| Units | 209 | 287 |
| Snapshot `high` / `medium` | 4% / 96% | 93% / 7% |
| Snapshot rationale, content words (median) | 2 | 14 |
| Snapshot evidence | commit message only | doc comment on 261 of 287 units; changesets on 38 |
| History walk: versions, `high` | 456, 3% | 898, 15% |
| History rationale, content words (median) | 2 | 4 |
| Deleted exports recovered | 35 | 72 |
| Snapshot / history walk time | 3.3 s / 16.9 s | 8.1 s / 156 s |

- **Without doc comments or changesets, backfill has little to say.**
  taxonomy has no TSDoc and terse commit messages, so every rationale is a
  message such as "initial commit" or "implement mdx pages": two content words
  at the median, against 15 for the rationale this repository records. No
  version fell back to "nothing says why", and none was `low`: a commit
  message always exists, however empty.
- **Doc comments carry TanStack Query's snapshot,** as they carry this
  repository's (ADR 0019): 261 of 287 units have one, and 93% of versions are
  `high`. Its history walk has only commit messages to go on (doc comments
  are read at the snapshot only), so history rationale is 4 words at the
  median and 85% `medium`.
- **Confidence overrated empty messages** in two ways, fixed by
  [ADR 0022](../../docs/decisions/0022-backfill-thin-commit-evidence.md).
  A commit counted as about one unit when it introduced only one unit that
  still exists, so a large "initial commit" whose other exports were later
  deleted gave its survivor `high`: 4 of taxonomy's 8 `high` versions. And a
  one-unit commit's message stood alone even when the unit had a doc comment:
  TanStack Query's `IsServerValue` was `high` with "feat: environmentManager".
  Now a commit is about one unit only if it introduced one export when it was
  made, and the doc comment always leads. The table above is from before the
  change; `corpus-results.md` is after.
- **Pull requests were not read.** Both runs are offline. TanStack Query
  merges through pull requests (`v4 alpha (#3060)`), so a run with a GitHub
  token would give its history walk more than commit messages; that is the
  next corpus measurement.
- **History mode scales with the walk, without a default limit:** 5,628
  commits took 2.6 minutes (28 ms a commit), and taxonomy's 97 took 17 s
  (175 ms a commit, since most of its commits touch many components). That
  answers #64's question for repositories of this size: a full walk is
  affordable, and `poetics backfill --history <from>` already bounds one.

## Thin commit evidence (2026-11-13, ADR 0022)

[ADR 0022](../../docs/decisions/0022-backfill-thin-commit-evidence.md) counts
what a commit introduced when it was made, not what survives, and leads every
rationale with the unit's doc comment, a one-unit commit's included. Both evals
before and after, at `b51daea`:

| | Before | After |
| --- | --- | --- |
| This repository, 347 pairs: mean recall / overlap | 42% / 13% | 42% / 13% |
| The 7 rationales the doc-comment rule changed: recall / overlap | 35% / 17% | 50% / 22% |
| taxonomy snapshot: `high` / `medium` | 8 / 201 | 4 / 205 |
| TanStack Query snapshot: `high` / `medium` | 266 / 21 | 265 / 22 |
| Snapshot time, taxonomy / TanStack Query | 4.4 s / 9.2 s | 5.7 s / 9.6 s |

A commit's files are read only for a unit with no doc comment whose commit
has one surviving unit, and only as far as a second export, which keeps the
snapshot within about a second of before.

## What this eval cannot say yet

- **The recorded rationale is not human ground truth.** All 303 recorded
  versions in the pairs were written by an agent and are unreviewed, often in
  the same session as the commit message they are compared with. The eval
  measures agreement with that record, not correctness.
- **Lexical scores miss meaning.** Two rationales can agree in different
  words. A drafted run (`--draft` with a configured command) and a semantic
  judgment, by people or by a judging command, are the next measurements.
- **Agreement on late-adopting repositories.** The corpus runs show what
  backfill infers there, not whether it is right: those repositories have no
  recorded rationale to compare with.
