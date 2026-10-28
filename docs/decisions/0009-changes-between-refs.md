# 0009. "What changed, and why" between two refs

- Status: Accepted
- Date: 2026-10-28

## Context

Poetics answers "why is this unit the way it is?" one unit at a time
(`poetics log`, `poetics why`, `poetics_history`), and `poetics impact` lists
components whose closure changed since a ref, without saying why. Nothing
answers the question an agent starting a task, or a reviewer opening a pull
request, asks first: what changed between here and there, and why?

Two ways to answer it:

- **Query the index by commit.** Every version carries a `commit`, so a range
  is a filter. But `commit` is backfilled by the indexer, which does not exist
  yet, and no version in this repository has one.
- **Diff the store between the two refs.** Versions are append-only, so the
  versions present at `to` and absent at `from` are exactly the changes in the
  range, each with its rationale, actor and links. Unit files that appear are
  new units; lineage turns an apparent delete-and-add into a rename or move.
  Walking the range commit by commit attributes each version to its commit
  without any backfill.

## Decision

A `poetics changes [<from>] [<to>]` command and a `poetics_changes` MCP tool
(defaults: `from` is the merge base with the default branch, `to` is the
working tree), both built on diffing `.poetics/` between the two refs.

- **Grouped by commit**, because that is how people think about change; each
  commit lists its unit versions with change class, rationale and links,
  interface changes and removals first.
- **Rationale is shown as written**, flagged when weak, always beside the
  commit subject. Linked issues stay references; their content is never
  inlined.
- **Commits that touched no unit** (config, CI, unexported code) are listed in
  their own section with only their subject, so the answer never looks more
  complete than it is.
- **Decision records and notes** added or changed in the range are listed as
  further sources of why.
- **Direct changes only.** `--impact` joins in `poetics impact` for components
  whose closure changed, rather than merging the two commands.
- **Removals are versions** ([ADR 0010](0010-removed-versions.md)), so they
  appear like any other change.

Output is structured first; the PR comment, and the changelog drafts from the
Changesets integration, render from the same data.

## Consequences

- The query needs git at query time. The `commit` backfill stays useful for the
  index and for `poetics log`, but `changes` does not wait on it.
- The quality of the answer is the quality of the rationale; `poetics:check`
  warnings on missing links and repeated rationale matter more now.
- `poetics changes` and `poetics_changes` landed as stubs, with the result
  type in `@poetics/store`. Since the query needs only git and the unit files,
  they were then built ahead of the indexer; only `--impact` waits for it.
