# 0018. Backfill confidence is high only for evidence about this unit alone

- Status: Accepted (2026-11-10)
- Date: 2026-11-10
- Amends: [ADR 0011](0011-backfill.md), the `confidence` rule

## Context

ADR 0011 makes `inferred.confidence` `high` "when evidence speaks to this unit
or its package in this change": a changeset, a review comment on its lines, or
a commit touching only it. As built, a changeset, commit message or pull request
title or description that *named* the unit also gave `high`.

The backfill eval ([`evals/backfill/`](../../evals/backfill/README.md)) runs
the snapshot backfill on this repository and compares each inferred rationale
with the one recorded by hand. At `c764905`, `high` versions agreed no better
than `medium` (28% mean recall against 30%; 11% against 20% recovered half the
recorded wording or more). Every `high` version came from a changeset that
named the unit. A changeset describes its package's change even when it names
one unit; the changesets here name several units each, and those naming more
than two of the units their commit introduced scored lowest of all.

What did agree better was evidence written about this unit alone: the unit's
own doc comment (versions with one scored 32% against 26% without), and a
commit that introduced nothing else. Using only the sentence of a changeset
that names the unit did not help: it scored 9% recall, since it says less than
the whole changeset.

The recorded rationale used as the reference was written by an agent and is
unreviewed, and the eval covers one repository whose exports nearly all carry
TSDoc, so the rule below is kept to two general signals rather than fitted to
thresholds this repository happens to favour.

## Decision

`confidence` says how specifically the evidence speaks to this one unit:

- **`high`:** there is a reason (a changeset or commit message), and evidence
  about this unit alone: the commit introduced or changed only this unit, a
  review comment falls on its lines, or, in snapshot mode, the unit has its own
  doc comment. In history mode a doc comment says what the unit is, not why that
  commit changed it, so it does not count there.
- **`medium`:** the reason is shared with other units in the change, **even
  when it names this unit**. Naming no longer raises confidence, in a changeset,
  a commit message or a pull request's title or description. A pull request
  found for the commit still lifts `low` to `medium`.
- **`low`:** no reason at all: only the code, its doc comment, and the diff.

The rule is one function, `confidenceOf`, used by both modes. The extracted
rationale is unchanged: it is still the change's reason, and the doc comment
raises confidence without replacing it. (ADR 0019 later leads a shared reason
with the doc comment.)

## Consequences

- `high` now agrees measurably better than `medium` in the eval (see the
  numbers in [`evals/backfill/README.md`](../../evals/backfill/README.md)),
  where before it did not.
- More versions are `high` on a repository that documents its exports, and
  fewer on one whose changesets list the units they touch. A reviewer working
  through `low` and `medium` first sees the versions whose evidence is
  thinnest.
- A pull request title such as "Round formatPrice" no longer makes a version
  `high` on its own. If real repositories show that pull request text is more
  specific than changesets, it needs its own measurement: the eval runs offline
  and has no pull requests.
- In the eval, versions whose rationale was a bare commit message scored lowest
  even when the unit had a doc comment. The extracted rationale could lead with
  the doc comment when the change's text is shared, which agreed far better in
  the eval; that changes what rationale says, not how sure it is, and needs its
  own decision. [ADR 0019](0019-backfill-rationale-leads-with-the-doc-comment.md)
  makes it.
