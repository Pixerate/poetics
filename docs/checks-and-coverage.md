# Change checks and coverage

`pnpm validate` checks that `.poetics/` is consistent with itself. Two more
commands check it against the code ([ADR 0007](decisions/0007-change-check-and-coverage.md)):

| Command | Answers |
| --- | --- |
| `pnpm poetics:check` | Did this change record itself in `.poetics/` properly? |
| `pnpm poetics:coverage` | How much of the codebase does `.poetics/` cover, and how well? |

Both read the scope from `.poetics/config.json` (`include` and `exclude`
globs) and find trackable declarations the way the store expects: exported
functions (hooks when named `use*`) and exported types or interfaces in
`.ts`/`.tsx` files, hashed from `export` to the end of the declaration with
leading TSDoc excluded. Declarations are matched to units by file and name.
`.svelte` files are listed as "not yet indexable" until the Svelte adapter
lands.

## `pnpm poetics:check`

```bash
pnpm poetics:check
```

```bash
pnpm poetics:check --since origin/main --json
```

Compares the working tree (including untracked files) with `--since`
(default `HEAD`; a branch is compared with its merge base). Pull requests run
it in CI against their base branch; `pnpm preflight` runs it against `HEAD`
before you commit.

| Finding | Level | Meaning and fix |
| --- | --- | --- |
| `untracked` | error | A changed file has an export with no unit. Mint a uid and create one; the message gives the line range and hash. |
| `stale` | error | An export changed but its unit's latest `contentHash` is older. Append a version; the message gives the new hash. |
| `orphaned` | error | A unit's declaration is gone from a changed or deleted file. Record lineage if it moved or was renamed, or append a `removed` version saying why it went. |
| `duplicate` | error | Two units claim the same file and name. Merge them with lineage. |
| `rewritten-history` | error | Earlier versions in a unit file were edited or removed. Versions are append-only. |
| `deleted-unit` | error | A unit file was deleted. Restore it and append a `removed` version instead ([ADR 0010](decisions/0010-removed-versions.md)). |
| `missing-lineage` | error | A unit's name or location changed without a new `lineage` entry. |
| `no-links` | warning | A new version cites no issue, task, decision or plan section. |
| `repeated-rationale` | warning | Three or more new versions share one rationale. Say what changed for each unit. |
| `unverified` | warning | A `behaviour` or `interface` version, but none of the unit's linked tests changed (or it has none). |
| `callers-not-updated` | warning | An `interface` or `removed` version, but units depending on it got no version. |
| `unverifiable` | warning | The latest hash is a `b3:` hash, which needs the indexer to compare. |

Exit code 1 on any error. Provisional hashes are hashes of raw text, so a
formatting-only edit to an export shows as `stale`; run the formatter before
the check, and the phase 1 indexer's syntax-tree hashes remove this.

## `pnpm poetics:coverage`

```bash
pnpm poetics:coverage
```

| Metric | Covered / total |
| --- | --- |
| `tracked` | Exports in scope that have a unit / exports in scope |
| `fresh` | Tracked units whose latest version matches the code / tracked units |
| `linkedRationale` | Versions with at least one link / versions |
| `reviewed` | Agent-written versions a human approved / agent-written versions |
| `tested` | Units with linked tests / units |
| `documented` | Units with docs / units |

It prints overall figures and one column per area (`packages/<name>`, or the
top-level folder), plus note health. A dash means the area has nothing to
measure for that metric. `--json` gives the full report.

### Thresholds

`policy.coverage` in `.poetics/config.json` sets minimums (0–1) for the
overall figures; the command exits 1 when one is missed, which fails CI.
This repository uses:

```json
"coverage": { "tracked": 1, "fresh": 1, "linkedRationale": 1, "tested": 0.75, "documented": 0.4 }
```

Raise `tested` and `documented` as they improve; never lower a threshold to
get a change through. `reviewed` has no minimum yet, because human review of
agent rationale is not wired into pull requests.

## Adopting Poetics gradually

Start with a narrow `include` (one package), set `tracked` and `fresh` to 1
for it, and widen the scope package by package. The per-area columns show
progress.
