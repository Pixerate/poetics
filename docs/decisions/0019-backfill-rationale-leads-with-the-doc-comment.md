# 0019. Backfill rationale leads with the unit's doc comment when the change's text is shared

- Status: Proposed
- Date: 2026-11-10
- Amends: [ADR 0011](0011-backfill.md), the extracted-rationale rule

## Context

ADR 0011 extracts a snapshot unit's rationale from "the most specific
evidence": a changeset beats a commit body, which beats a subject, and the
unit's doc comment is used only when there is no change text at all. ADR 0018
then counted the doc comment as evidence about this unit alone, so it raises
confidence, but left the rationale as the change's text.

The change's text is usually not about this unit. When a commit introduces
several units, its changeset or message describes the whole change, and every
unit it introduced gets the same rationale. The doc comment is the only text
in the repository written about this one unit, and it says what the unit is
for, which is what a recorded rationale for a `created` version mostly says.

The backfill eval ([`evals/backfill/`](../../evals/backfill/README.md)) on
this repository at `df077c8` (312 pairs) compared what to extract for units
with a doc comment whose change text is shared. Overlap is reported with
recall because recall rewards longer text:

| Rationale for those units | Mean recall | Mean overlap | Recall ≥ 50% |
| --- | --- | --- | --- |
| The change's text (ADR 0011, before) | 32% | 10% | 24% |
| The doc comment alone | 32% | 25% | 24% |
| The doc comment, then the change's text | 51% | 15% | 51% |
| Control: another unit's doc comment, then the change's text | 34% | 9% | 24% |

(185 units; the control rotates doc comments between them, so it adds text of
the same length that is not about the unit.)

- The doc comment alone agrees most tightly (25% overlap) but recovers no more
  of the recorded wording, because it drops the reason for the change.
- The doc comment followed by the change's text raises both recall and
  overlap, and doubles the share recovering half the recorded wording.
- The control shows the gain is not length: adding a doc comment that is not
  this unit's leaves recall flat and lowers overlap.

The recorded rationale used as the reference was written by an agent and is
unreviewed, and this repository requires TSDoc on every export. So the rule
below is one general signal (is the change's text shared?) and is not tuned to
this corpus.

## Decision

In snapshot mode, when a unit has a doc comment and the change's text
(changeset or commit message) is **shared** with other units the commit
introduced, the extracted rationale is the doc comment followed by that text,
as two paragraphs. The doc comment says what the unit is for; the change's
text says why it was added.

When the commit introduced this unit alone, its text is already about this
unit, so it stays the whole rationale: the most specific evidence still wins.
With no change text the doc comment is the rationale, as before. Confidence is
unchanged (ADR 0018), and history mode is unchanged: there a doc comment says
what the unit is, not why that commit changed it.

The text is still quoted only from evidence already in the repository, so the
rule holds for any repository and needs no model.

## Consequences

- In the eval, mean recall rises from 30% to 41% and mean overlap from 10% to
  12% across all pairs; for `high` versions, 51% now recover half the recorded
  wording against 24%. Versions whose only reason was a bare commit message
  rise most (18% to 50% recall), since the doc comment carries what the
  message does not.
- The first line of a backfilled rationale, as `poetics backfill` prints it, is
  now the doc comment for most documented units, which tells them apart in the
  dry run where the shared text did not.
- The doc comment is quoted in both `docs` and the rationale. That is
  deliberate: `docs` follows the code, and the version records what was known
  when it was inferred.
- A repository with little TSDoc sees almost no change. The eval has one
  repository; the rule should be re-measured on one that adopted Poetics late.
