# 0022. Backfill counts what a commit introduced when it was made, and always leads with the doc comment

- Status: Proposed
- Date: 2026-11-13
- Amends: [ADR 0018](0018-backfill-confidence-is-unit-specific.md) (when a
  change is about one unit) and [ADR 0019](0019-backfill-rationale-leads-with-the-doc-comment.md)
  (when the doc comment leads)

## Context

ADR 0018 makes a snapshot version `high` when its evidence is about this unit
alone: the unit's own doc comment, or a change that introduced nothing else.
ADR 0019 leads the extracted rationale with the doc comment, but only when the
change's text is shared with other units. A one-unit commit's text stood
alone, because on this repository leading it as well scored the same (51%
against 50% recall).

The backfill eval on two repositories that adopted Poetics late (#64,
[`evals/backfill/`](../../evals/backfill/README.md)) found two ways that
overrates thin evidence:

- **"Introduced nothing else" counted only the units that survive.** A large
  commit such as "initial commit" counts as being about one unit when its other
  exports were deleted since, so its survivor gets `high` from a message that
  describes the whole repository. On taxonomy (no TSDoc, terse messages), 4 of
  its 8 `high` versions were such survivors.
- **A one-unit commit's text displaced the doc comment.** On TanStack Query,
  `IsServerValue` was `high` with the rationale "feat: environmentManager",
  while its doc comment says what it is. Late adopters' commit messages are
  often that short.

## Decision

- **A commit is about one unit only if it introduced one export when it was
  made.** For a unit with no doc comment whose commit has one surviving unit,
  backfill reads the in-scope files that commit added, changed or renamed, as
  the commit left them and as its parent had them, and counts the exports that
  are new, stopping at two. A rename is read against the file's old name, so a
  moved file introduces nothing. A unit with a doc comment is `high` whatever
  its commit introduced (ADR 0018), so nothing is read for it.
- **The doc comment leads the rationale whenever there is one,** followed by
  the change's text, a one-unit commit's included. The comment says what the
  unit is for, and the change's text says why it was added.

Confidence otherwise follows ADR 0018, and history mode is unchanged.

## Consequences

Measured with `pnpm eval:backfill` and `pnpm eval:backfill --corpus` at
`b51daea`, before and after:

| | Before | After |
| --- | --- | --- |
| This repository, 347 pairs: mean recall / overlap | 42% / 13% | 42% / 13% |
| The 7 rationales the second rule changed: recall / overlap | 35% / 17% | 50% / 22% |
| taxonomy snapshot: `high` / `medium` | 8 / 201 | 4 / 205 |
| TanStack Query snapshot: `high` / `medium` | 266 / 21 | 265 / 22 |
| TanStack Query rationale, content words (median) | 14 | 15 |
| Snapshot time, taxonomy / TanStack Query | 4.4 s / 9.2 s | 5.7 s / 9.6 s |

- The second rule changes few rationales here, because most of this
  repository's commits introduce several units. All 7 it changes recover more
  of the recorded rationale, and 6 of them overlap it more (one dips from 18%
  to 17%). ADR 0019 measured this variant as a tie across all `high`
  versions; looked at only where it changes the text, it helps.
- The first rule moves no version on this repository, whose large commits'
  exports mostly survive. On taxonomy it moves half of the `high` versions,
  all survivors of commits that introduced several exports.

- A version's confidence can only fall under the first rule, and only for a
  unit without a doc comment. A survivor of a large commit is now `medium`,
  as the other units of that commit were.
- Reading a commit's files before and after costs time in the snapshot, for
  the commits that can change a verdict only.
- Both rules still read only what the repository holds, so they need no model
  and hold for any repository.
