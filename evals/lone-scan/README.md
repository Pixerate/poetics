# Lone-pair history scan: what stage 6 meets in real commits

Identity matching's stage 6 ([ADR 0028](../../docs/decisions/0028-lone-pair-in-a-file.md),
[ADR 0030](../../docs/decisions/0030-lone-pair-keeps-base-name.md)) pairs a
file's one leftover tracked unit with its one new unit. It needs a similarity
of 0.2, or none at all when the two keep their base name, the name before any
argument labels. The [identity gate](../gate/README.md) cannot tell whether
that is right, because its own refactors make exactly this shape. This scan
looks at the shape in real history instead. [`results.md`](results.md) has
the latest run.

## Method

`pnpm lone-scan [--fetch] [--only name] [--commits N]` (default 1,500
commits) uses the gate's [corpus](../gate/corpus.json): the same
repositories, scope and adapters. For each repository it walks the non-merge
commits back from the pinned commit. For each commit it:

1. takes the in-scope files the commit modified (added, deleted and renamed
   files are left out, and so is any commit touching more than 40 files);
2. indexes them as they were before the commit and after it;
3. runs identity matching on the two, with no floor on stage 6, and records
   every pair stage 6 is left with, its score, and whether it keeps its base
   name.

`--fetch` clones each repository's full history, bare, into `.cache/`
(gitignored). Nothing is checked out, installed or run, and each commit's files
are written to a temporary folder only to be parsed. The Swift corpora need
`poetics-swift` on `PATH`, as for the gate.

## Reading the results

The scan finds pairs; it cannot judge them. For each pair in `results.md`,
decide from the names, the commit and if need be its diff whether the second
unit is the first one changed (same unit) or a different unit that replaced
it. Then compare that with the band it falls in:

- **Matched at 0.2 or more**, and **matched below 0.2 because they keep
  their base name**: stage 6 pairs these. A different unit here carries the
  old unit's history, and `poetics:check` raises `lone-match` for it
  ([ADR 0029](../../docs/decisions/0029-inferred-lineage-says-how.md)).
- **Not matched**: stage 6 leaves these as one unit removed and one created.
  The same unit here loses its uid.

The scan stands in for a whole commit with only the files it modified. It
does not see units that moved to or from other files in the same commit,
which `poetics index` would weigh too. So a pair here may in practice be
decided by an earlier stage.

## Judged runs

### Swift (2026-11-26)

Alamofire (1,530 commits) and IceCubesApp (1,500), with the scan script that
became this command. That run walked back from each repository's latest commit
and took every Swift file, tests included, so it found more pairs than
`results.md`, which uses the gate's pinned commits and scope. It found 90 lone
pairs, judged from names and commit messages:

| Band | Pairs | Same unit | Different unit | Unclear |
| --- | --- | --- | --- | --- |
| 0.2 or more | 63 | about 61 | about 2 | 0 |
| Below 0.2, keeps base name | 11 | 11 | 0 | 0 |
| Below 0.2, changes base name | 16 | about 6 | about 7 | 3 |

That is the evidence for ADR 0030. Most pairs at 0.2 or more are signature
changes: in Swift, adding a parameter renames a function. Every pair below 0.2
that keeps its base name, such as `ExploreView.init()` to
`ExploreView.init(scrollToTopSignal:)`, is the same unit.

### TypeScript and Svelte (2026-11-26)

The first run of this command found 7 lone pairs in taxonomy, shadcn-svelte
and TanStack Query.

- `Config` to `ResolvedConfig` (0.667) is the same type, renamed.
- Four of the five not matched were judged different units for ADR 0028:
  `setRegistry` to `getRegistryIndexes`, `resolveImport` to
  `resolveImportAlias`, `getAliases` to `getTSConfig`, and
  `urlSplitLastPathSegment` to `resolveURL`. All score 0.083 or less.
- `getRegistryStyles` to `getStyles` (0.0, not matched) and `BasicPage` to
  `PagePage` (0.284, matched) are not judged yet.

None of these keeps its base name, since TypeScript names have no labels.
