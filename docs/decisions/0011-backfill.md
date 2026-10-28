# 0011. Backfill: capture the current state, then the history behind it

- Status: Proposed
- Date: 2026-10-28

## Context

A repository adopting Poetics has code, tests, docs and years of git, review
and issue history, but an empty `.poetics/`. The plan says `poetics init`
"backfills history from git", and the schema says the indexer backfills each
version's `commit`. Neither says what is read, what is written, or how an
inferred rationale is told apart from a recorded one.

Two different jobs hide behind the word:

- **Capture the current state.** Every exported unit gets a unit file: uid,
  hashes, location, docs, test links, and one `created` version whose rationale
  says why the unit exists, drawn from whatever evidence there is. Cheap,
  bounded by the size of the code, and useful on day one.
- **Capture historic change.** Walk past commits and reconstruct each unit's
  versions: when its content or interface changed, in which commit, and why.
  Expensive, bounded by the length of history, and only as good as the
  evidence each commit left behind.

The reason for a change is scattered. In rough order of how directly it speaks
about one unit's change:

| Source | What it gives | Where it lives |
| --- | --- | --- |
| Changesets and changelog entries | Per-package, human-written "what and why"; bump type hints at interface changes | `.changeset/*.md` in the commit, `CHANGELOG.md` |
| Pull request description and review comments | The author's why; reviewers' "this must stay so" on lines inside the unit | GitHub |
| Commit message | Subject, body, Conventional Commit type and scope, `Refs`/`Fixes` and `Co-Authored-By` trailers | git |
| Linked issues | The problem being solved | GitHub (Jira later) |
| Code comments | TSDoc (the unit's docs), inline "why" comments, `TODO`/`HACK`/`FIXME` | source |
| Tests | Tests added or changed with the unit, and their names, describe intended behaviour | source, git |
| Docs, plans and decision records | Which design a unit implements | `docs/`, READMEs |
| The code and its diff | Change class from hashes; intent only by inference | source, git |

Two existing rules constrain the design:

- **`versions` is append-only** and `poetics:check` fails on edited history.
  Units this repository already records start at a `created` version with
  `parent: null`; history from before adoption cannot be prepended without
  rewriting that version.
- **Links are references, never content**
  ([plan: issue trackers](../plan.md#issue-trackers)). Private issue and PR
  text must not be copied into git, and it reaches agents as data, never as
  instructions.

Options considered for where inferred history goes:

- **Prepend to `versions`.** One list, but it rewrites the first recorded
  version and breaks the append-only rule for every adopted unit.
- **Only backfill units with no versions.** Keeps the rule, but a repository
  that recorded by hand first, like this one, can never recover its history.
- **A separate, write-once `prehistory` array** that ends where `versions`
  begins. Recorded history stays untouched, and `poetics log` reads both.

## Decision

One command, `poetics backfill`, with two modes, built on the phase 1 indexer
for unit discovery and hashing. `poetics init` runs the snapshot mode.

### Mode 1: `poetics backfill --snapshot`

For each exported unit in the working tree:

- **Units with no file** get one: a minted uid, real hashes, location, `docs`
  from its TSDoc or `@component` comment, static test links, and a `created`
  version. That version's `commit` is the last commit that touched the unit's
  span, and its rationale says why the unit exists, from the commit and PR
  that introduced it, its comments, its tests and the docs that mention it.
- **Units with a file** only gain what is missing: an omitted `commit` is set
  to the commit that added the entry (the rule the schema already states, made
  explicit), and missing test links or docs are proposed. Recorded versions
  are otherwise never touched.
- **Notes are proposed, not written:** `HACK` and `workaround` comments and
  review comments that state a rule are listed in the report as candidate
  `workaround` and `invariant` notes for a human or agent to record.

### Mode 2: `poetics backfill --history [<from>] [<to>]`

Walks the range (default: the repository's root to the oldest recorded
version, or `HEAD` for a fresh store) on the first-parent line, so each step
is one merged change:

- For each unit, follow its file back with git's rename detection, re-parse
  the unit at every commit that touched the file, and emit a version whenever
  its content hash changes, with `change` classified from the hashes as the
  indexer does. Exports deleted before adoption are recovered with `removed`
  versions when `--include-removed` is given.
- Versions go into a new `prehistory` array, oldest first, whose last entry is
  the parent of the first recorded version. `prehistory` is write-once:
  `poetics:check` lets a commit add it or extend it further back, and fails on
  any other edit.
- Each commit is mapped to its pull request offline first (`Merge pull
  request #N`, a squash subject ending `(#N)`), and through the GitHub API
  only when that fails.

### Evidence, not guesses

Every source is an **evidence collector** with one job: given a unit and a
commit (or the current tree), return typed evidence items, each with its
source, a reference, and the text it found. Collectors for git, changesets,
comments, tests and docs are local and always run. GitHub collectors run only
with a token.

Rationale is written in two tiers:

1. **Extracted** (default, deterministic, offline): the most specific evidence
   available, quoted or lightly trimmed. A changeset or PR description that
   names the package beats a commit body, which beats a subject. With nothing
   better, the rationale is the commit message, as the plan already says.
2. **Drafted** (`--draft`, optional model call): a per-unit rationale
   synthesised from the evidence items, which must cite them, must say when
   the only evidence is the diff, and must not quote private issue or PR text.
   Evidence text is passed to the model as data.

Every backfilled version, in either mode, carries a new `inferred` field:

```json
"inferred": {
  "by": "poetics-backfill",
  "confidence": "medium",
  "sources": ["commit", "pull-request"],
  "drafted": false,
  "reviewed": false
}
```

- **`confidence` is computed from the evidence, not self-reported:** `high`
  when evidence speaks to this unit or its package in this change (a
  changeset, a review comment on its lines, a commit touching only it);
  `medium` when it speaks to the whole change (commit or PR text shared by
  many units); `low` when only the code and diff were available.
- **`actor` keeps its meaning**: who made the change, not who wrote the
  rationale. It comes from git, and becomes an agent when a `Co-Authored-By`
  trailer names one (with `reviewed: false`).
- **The evidence goes in `links`**: the commit, PR, issues, changeset and
  decision records, as typed references. Issue and PR text is never stored.
- Policy can treat inferred, unreviewed rationale like unreviewed agent
  rationale; `poetics coverage` reports inferred versions separately from
  recorded ones.

### GitHub first

GitHub is the first integration, behind the same small adapter the issue
tracker plan already describes, so Jira follows without touching the
collectors:

- **Pull requests:** for each commit, the PRs that contain it; their title,
  description and labels; review comments whose lines fall inside the unit's
  span at that commit.
- **Issues:** closing references on the PR and `Fixes`/`Refs` in commits,
  stored as `github-issue` links; issue text is fetched only to draft
  rationale and to set confidence, never written to `.poetics/`.
- **Credentials** come from `GITHUB_TOKEN` or `gh auth token`, never from
  `.poetics/`. Responses are cached under `.poetics/cache/` so a re-run makes
  no repeat calls and a long walk can resume after a rate limit.

### Output

Backfill writes unit files in the working tree and never commits. It prints a
report, structured first like `poetics changes`: units created, versions
inferred by confidence, units with only `low` evidence, candidate notes, and
sources that were unavailable (no token, rate limited). Re-running with the
same inputs writes the same files; versions are keyed by commit and content
hash, so nothing is duplicated.

## Consequences

- A repository is useful on the day it adopts Poetics, and its history becomes
  queryable without anyone re-typing it. `poetics log` and `poetics why` show
  `prehistory` then `versions`, marking inferred entries and their confidence.
- Inferred rationale is clearly labelled and never outranks recorded
  rationale. The quality of old answers is bounded by old evidence, and the
  report says so instead of hiding it.
- Poetics' own hand-recorded store is the evaluation corpus: running the
  snapshot mode on this repository's history and comparing extracted and
  drafted rationale to what was recorded measures the collectors and the
  drafting prompt before anyone else relies on them.
- Schema and model changes follow acceptance: `prehistory` and `inferred` in
  `schemas/unit.schema.json`, `packages/core/src/types.ts` and
  `docs/data-model.md`; `prehistory` and the `commit` fill-in in
  `poetics:check`'s history rules; `inferred` in the index. `poetics backfill`
  joins `packages/cli/src/commands.ts` and `docs/getting-started.md` as a
  stub, and a `poetics-backfill` skill tells agents how to review the report.
- Snapshot mode with local collectors lands with the indexer in phase 1;
  history mode and the GitHub collectors land with the issue tracker
  integration in phase 2.
- Open questions, to be filed as issues:
  - Is the first-parent walk enough, or do long-lived branches merged without
    squashing need their own commits attributed?
  - Should `--draft` be allowed to read private repositories' PR and issue
    text at all, or only public ones, by default?
  - Should candidate notes ever be written automatically when evidence is
    `high` (for example a reviewer's "never do X")?
  - Does re-parsing every historic revision scale to large repositories, or
    does history mode need a sampling or `--paths` limit by default?
