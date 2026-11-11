# Identity gate: uids survive real refactors

Issue [#26](https://github.com/Pixerate/poetics/issues/26) (closed), continued for
`.svelte` files in [#66](https://github.com/Pixerate/poetics/issues/66) (phase 3). The plan's phase 1
gate asks that a unit's uid survive renames, moves, splits and merges on real
code: a React app, a Svelte app and a repository mixing both around shared
utilities. Phase 2's gate asks the same of a React app with the React adapter
on, so components and hooks are recorded as such, and phase 3's asks it of
`.svelte` components with the Svelte adapter on. [`results.md`](results.md)
has the latest measurements.

## Corpus

[`corpus.json`](corpus.json) pins each repository to a commit and limits it to
its source files:

| Repository | Kind | Why |
| --- | --- | --- |
| [shadcn-ui/taxonomy](https://github.com/shadcn-ui/taxonomy) | React | A Next.js app: components, routes, hooks and utilities |
| [huntabyte/shadcn-svelte](https://github.com/huntabyte/shadcn-svelte) | Svelte | Svelte 5 components with their TypeScript, plus a CLI |
| [TanStack/query](https://github.com/TanStack/query) | Mixed | `query-core`, shared by `react-query` and `svelte-query` |

`pnpm gate --fetch` downloads each one at its pinned commit, shallow and
source only, into `.cache/` (gitignored). Nothing from them is installed or
run: the indexer only parses their files, and without their dependencies,
types from packages stay unresolved. That changes interface hashes, but not the
content hashes and fingerprints that identity matching uses.

## Method

`pnpm gate [--rounds N] [--seed N] [--only name] [--adapters a,b]` (defaults:
10 rounds, seed 26, each corpus's `adapters`) runs, for each repository, in a throwaway git copy of its in-scope files:

1. **Seed:** `poetics index --write` on an empty store creates a unit for every
   export.
2. **Rounds:** each round applies one refactor of each kind below to units no
   earlier refactor touched, commits, runs `poetics index --write`, and checks
   every affected uid against where it should now be: kept, lost (removed
   although its code still exists), misplaced, or queued.

| Refactor | What it does | How it is recorded |
| --- | --- | --- |
| `rename` | Renames a function everywhere, as an editor would (by identifier, across files) | Inferred by `poetics index` |
| `move-file` | Moves a file into a `gate-moved/` folder beside it | Inferred |
| `move-unit` | Moves one exported declaration to the end of another file | Inferred |
| `rename-edit` | Renames a function and adds a statement to the top of its body | Inferred |
| `split` | Moves the second half of a function's body into a new `…Rest` function | Declared by hand, as the `poetics-refactor` skill says |
| `merge` | Moves one function's body into another's in the same file and deletes it | Declared by hand |
| `wrap` | Wraps a component declared as `export function Name` in `memo`, as `export const Name = memo(function Name …)` | Inferred; only with the React adapter |
| `rename-file` | Renames a Svelte component's file, `X.svelte` to `XGate.svelte`, which renames the component; its script's functions move with it | Inferred; only with the Svelte adapter |

Splits and merges are never inferred (#20), so the gate declares them the way
an agent following the skill would, and then checks that `poetics index`
leaves them alone. A queued match is resolved the way a person would, so later
rounds start from a correct store. Picks are seeded and made by place, not by
uid, so a run is repeatable.

A `.svelte` file's units are found in the TypeScript svelte2tsx makes of it, so
the refactors that edit text at a declaration's offsets (`rename-edit`,
`split`, `merge`, `wrap`) leave `.svelte` files alone, and `move-unit` moves
only between TypeScript files. `rename` renames a component's script functions
like any function, but never a component, whose name is its file's;
`rename-file` covers that. `move-file` moves `.svelte` files like any other.
Like `move-file`, `rename-file` does not rewrite imports: identity matching
reads each file on its own.

Each corpus lists its adapters in [`corpus.json`](corpus.json): taxonomy runs
with `typescript, react`, shadcn-svelte with `typescript, svelte`, and TanStack
Query with all three. `--adapters typescript` reruns phase 1's
configuration. The report counts the seeded units by kind and the uids kept by
the kind of unit each refactor picked.

## Phase 3 findings (2026-11-11)

- **Every `.svelte` component kept its uid:** 20 of 20 on shadcn-svelte and 4
  of 4 on TanStack Query, across 12 `rename-file` refactors and the files
  `move-file` moved. Nothing was queued or misplaced.
- With the Svelte adapter on, shadcn-svelte reads all 3,227 files in scope,
  where phase 2 left 2,128 `.svelte` files unread. It tracks **2,912 units
  where phase 2 tracked 512**: 2,128 components, plus 228 functions and 43
  types declared in `.svelte` files (functions in component scripts, which the
  components own, #72, and module-script exports).
- shadcn-svelte kept 91 of 95 uids and TanStack Query 74 of 77. Every miss is
  still a `rename-edit` of a one- or two-statement function in a `.ts` or
  `.svelte.ts` file, explained under phase 1. Each miss created one unit, so
  the units created that no refactor made (4 and 3) are those misses' new
  uids, not lost components.
- TanStack Query's Svelte package has two components, so `rename-file` ran
  twice there and was skipped for the other rounds. It has no `export
  function` React component, so `wrap` was skipped, as in phase 2.
- **Cost:** running svelte2tsx over 2,128 components makes shadcn-svelte's
  seeding take 8.0 s (1.6 s without the adapter), and a round's
  `poetics index` 4.2 s (0.8 s). Each round re-transforms every component; the
  indexer's per-file cache skips the checker for unchanged files, but not the
  transform. That is the cost to watch on large Svelte repositories.
- taxonomy (React only) is unchanged: 82 of 82.

## Phase 2 findings (2026-11-10)

- **taxonomy (the React app) kept every uid: 82 of 82**, across 59 components,
  20 functions and 3 hooks. All 10 `memo` wraps kept their uid. Nothing was
  queued or misplaced, and no unit was created that a refactor did not make.
- The React adapter tracks **209 units in taxonomy where phase 1 tracked 113**.
  The 96 it adds are shadcn/ui components declared as
  `const X = React.forwardRef(…)`. Without the adapter they were not units at
  all, so phase 1's 75 of 76 did not measure them.
- TanStack Query (mixed) kept 67 of 71 uids, and shadcn-svelte (where React
  is off) kept 99 of 101. Every miss is still a `rename-edit` of a one- to
  three-statement function, as in phase 1.
- TanStack Query has no `export function` components, so it has no `wrap`.
  `HydrationBoundary` is recorded as a function, not a component: it returns
  `children as React.ReactElement` with no JSX, and the adapter's rule is a
  PascalCase function that returns JSX. Its uid is tracked all the same.
- Timing is unchanged. A round's `poetics index` takes under half a second on
  taxonomy and TanStack Query, and seeding takes under 0.8 s.
- The gate now marks a unit that `poetics index` created after a miss as used.
  Before, a later round could refactor the same code under its new uid and
  count the miss twice; this happened once in this run's first pass.

## Phase 1 findings (2026-11-04)

- Renames, file moves, moving a unit between files, declared splits and
  declared merges kept every uid on all three repositories, with nothing
  misplaced and nothing queued.
- Every miss was a `rename-edit` of a one- to three-statement function. With
  so little code, one added statement changes too much of the shape to clear
  the 0.65 similarity threshold, so the unit is recorded as removed and its new
  code as created. Its history is not lost, since the old unit file stays, but
  it is not linked to the new one. Declaring the rename (`poetics-refactor`)
  avoids this, and it is the case to watch if the threshold is ever tuned.
- `poetics index` took under a second per round, and seeding about 1.5 s on the
  largest corpus (1,099 files).

## What this gate does not cover yet

- Edits inside `.svelte` files: `rename-edit`, `split` and `merge` only edit
  TypeScript, so a component or script function edited as it is renamed or
  moved is not measured.
- Svelte contexts ([#74](https://github.com/Pixerate/poetics/issues/74)), which
  are not units yet.
