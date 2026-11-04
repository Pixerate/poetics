# 0011. Backfill: capture the current state, then the history behind it

- Status: Accepted (2026-11-04)
- Date: 2026-10-28
- Revised: 2026-11-04, after the indexer (#19), identity matching (#20), the
  rehash ([ADR 0014](0014-rehash-versions.md)) and `poetics index` (#24) landed.
  See [Revisions](#revisions).

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

- **`versions` is append-only** and `poetics verify` fails on edited history.
  Units this repository already records start at a `created` version with
  `parent: null`; history from before adoption cannot be prepended without
  rewriting that version, and no exception is made for it.
- **Links are references, never content**
  ([plan: issue trackers](../plan.md#issue-trackers)). Issue and pull request
  text must not be copied into git, in a link or in a rationale, and it reaches
  agents as data, never as instructions.

Options considered for where inferred history goes:

- **Prepend to `versions`.** One list, but it rewrites the first recorded
  version and breaks the append-only rule for every adopted unit.
- **Only backfill units with no versions.** Keeps the rule, but a repository
  that recorded by hand first, like this one, can never recover its history.
- **A separate, write-once `prehistory` array** that ends where `versions`
  begins. Recorded history stays untouched, and `poetics log` reads both.

## Decision

One command, `poetics backfill`, with two modes, built on the phase 1 indexer,
identity matching and `poetics index`. `poetics init` runs the snapshot mode.

### Mode 1: `poetics backfill --snapshot`

Snapshot mode is `poetics index` with a different rationale: it shares
`planIndex`'s detection, hashing, docs and test linking, so the two cannot
drift apart, and replaces the run's single rationale with one per unit drawn
from the evidence below.

- **Units with no file** get one, as `poetics index` creates them: a minted
  uid, `b3:` hashes, location, `docs` from TSDoc or `@component`, and static
  test links. The `created` version's `commit` is the commit that introduced
  the unit's code (the last commit that touched its span when that cannot be
  told), and its rationale says why the unit exists.
- **Units with a file are never written to.** Their recorded versions stay as
  they are, and so do omitted `commit` fields: the commit that added a version
  is already known from the unit file's git history, which is how
  `poetics changes` finds it, so filling it in would edit history for no gain.
  Missing test links or docs are listed in the report for someone to add.
- **Notes are proposed, not written:** `HACK` and `workaround` comments and
  review comments that state a rule are listed in the report as candidate
  `workaround` and `invariant` notes for a human or agent to record.

### Mode 2: `poetics backfill --history [<from>] [<to>]`

Walks the range (default: the repository's root to the oldest recorded
version, or `HEAD` for a fresh store) on the first-parent line, so each step
is one merged change:

- At each step, the units of the changed files are read from the commit
  syntactically (content hash, runtime hash, fingerprint and signature text,
  which need no type checker) and matched to the step before with
  `matchIdentities`, the same matcher `poetics index` uses. Units are followed
  through renames and moves between files, not only through renamed files.
- A version is emitted whenever a unit's content hash changes. Its `change` is
  classified as `poetics index` does, except that an interface change is told
  from the signature text: the checker's interface hash needs each historic
  commit's dependencies, which are rarely available. `inferred` records this.
- Where matching would only queue a unit (look-alikes, or a small function
  renamed and edited in one commit, the case the phase 1 gate measured), that
  unit's prehistory stops there, and the report says where and why. History is
  never guessed.
- Exports deleted before adoption are recovered with `removed` versions when
  `--include-removed` is given.
- Versions go into a new `prehistory` array, oldest first. `prehistory` and
  `versions` are joined by commit, not by hash: `prehistory` ends at or before
  the commit where `versions[0]` was recorded. `versions[0]` keeps its
  `parent: null` and, in a store recorded before the rehash, its `git:` hash,
  so nothing recorded changes. `prehistory` is write-once: `poetics verify`
  lets a commit add it or extend it further back, and fails on any other edit.
- `prehistory[0]` is `created`, and `versions[0]` stays `created`: ADR 0010's
  rule becomes "`created` is the first version of each list". `removed` stays
  last in `versions` only.
- Each commit is mapped to its pull request offline first (`Merge pull
  request #N`, a squash subject ending `(#N)`), and through the GitHub API
  only when that fails.

### Evidence, not guesses

Every source is an **evidence collector** with one job: given a unit and a
commit (or the current tree), return typed evidence items, each with its
source, a reference, and the text it found. Collectors for git, changesets,
comments, tests and docs are local and always run. GitHub collectors run only
with a token.

Evidence falls in two groups, and only one of them is ever written down:

- **In the repository:** commits, changesets, changelog entries, comments,
  tests, docs and decision records. These are already in git, so quoting them
  in a rationale exposes nothing new.
- **Outside it:** pull request descriptions, review comments and issues. Their
  text is never written to `.poetics/`, in any tier. They contribute links,
  raise or lower `confidence`, and feed `--draft` only as described below.

Rationale is written in two tiers:

1. **Extracted** (default, deterministic, offline): the most specific evidence
   from the repository, quoted or lightly trimmed. A changeset that names the
   package beats a commit body, which beats a subject. With nothing better, the
   rationale is the commit message, as the plan already says. A pull request
   that gives the reason is linked, not quoted.
2. **Drafted** (`--draft`, optional model call): a per-unit rationale
   synthesised from the evidence items, which must cite them and must say when
   the only evidence is the diff. Evidence text is passed to the model as data.
   Pull request and issue text is passed only for public repositories, or when
   the user opts in with `--draft-private`, and even then the draft must not
   quote it.

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
  rationale. Only its kind comes from git: `human`, or an agent when a
  `Co-Authored-By` trailer names one (with `reviewed: false`). Author names and
  emails are never written to `.poetics/`; as the plan says, human authorship
  comes from git through the version's commit.
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
  stored as `github-issue` links; issue text is fetched only to set confidence
  and, under the `--draft` rule above, to draft rationale. It is never written
  to `.poetics/`.
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
  `docs/data-model.md`; the write-once `prehistory` rule and ADR 0010's amended
  `created` rule in `checkStore` and `poetics verify`; `inferred` in the index.
  `poetics backfill` joins `packages/cli/src/commands.ts` and
  `docs/getting-started.md`, and a `poetics-backfill` skill tells agents how to
  review the report.
- Snapshot mode with the local collectors lands first, on top of
  `poetics index`, and lets `poetics init` (#24) finish. History mode and the
  GitHub collectors land with the issue tracker integration in phase 2.
- Open questions, to be filed as issues:
  - Is the first-parent walk enough, or do long-lived branches merged without
    squashing need their own commits attributed?
  - Should candidate notes ever be written automatically when evidence is
    `high` (for example a reviewer's "never do X")?
  - Does re-parsing every historic revision scale to large repositories, or
    does history mode need a sampling or `--paths` limit by default?

## Revisions

2026-11-04, before acceptance, to fit what phase 1 built and two rules the
first draft broke:

- Extracted rationale quotes only evidence already in the repository; pull
  request and issue text is linked, never quoted, and reaches `--draft` only
  for public repositories or with `--draft-private`. The first draft quoted PR
  descriptions, which would have put their text in git.
- Units that already have a file are never written to. The first draft filled
  in omitted `commit` fields, which edits recorded versions; the commit is
  already known from the unit file's history.
- Snapshot mode is `poetics index` with per-unit rationale, sharing its code.
- History mode follows units with `matchIdentities` between commits, stops a
  unit's prehistory where matching would only queue it, and classifies
  interface changes from signature text.
- `prehistory` and `versions` are joined by commit rather than by `parent`,
  since `versions[0]` cannot change; ADR 0010's `created` rule applies to each
  list.
- `actor` takes only its kind from git; author names and emails are never
  stored.
