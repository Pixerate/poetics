# Identity gate: uids survive real refactors

Issue [#26](https://github.com/Pixerate/poetics/issues/26) (closed), continued for
`.svelte` files in [#66](https://github.com/Pixerate/poetics/issues/66) (phase 3). The plan's phase 1
gate asks that a unit's uid survive renames, moves, splits and merges on real
code: a React app, a Svelte app and a repository mixing both around shared
utilities. Phase 2's gate asks the same of a React app with the React adapter
on, so components and hooks are recorded as such, and phase 3's asks it of
`.svelte` components with the Svelte adapter on. [ADR 0026](../../docs/decisions/0026-swift-units.md)
asks it of an open-source Swift app and package, read by the out-of-process
`poetics-swift` adapter, before that adapter is recommended for real use.
[`results.md`](results.md) has the latest measurements.

## Corpus

[`corpus.json`](corpus.json) pins each repository to a commit and limits it to
its source files:

| Repository | Kind | Why |
| --- | --- | --- |
| [shadcn-ui/taxonomy](https://github.com/shadcn-ui/taxonomy) | React | A Next.js app: components, routes, hooks and utilities |
| [huntabyte/shadcn-svelte](https://github.com/huntabyte/shadcn-svelte) | Svelte | Svelte 5 components with their TypeScript, plus a CLI |
| [TanStack/query](https://github.com/TanStack/query) | Mixed | `query-core`, shared by `react-query` and `svelte-query` |
| [Dimillian/IceCubesApp](https://github.com/Dimillian/IceCubesApp) | Swift | A SwiftUI app with local SwiftPM packages, `#if` platform code and many extensions |
| [Alamofire/Alamofire](https://github.com/Alamofire/Alamofire) | Swift | A package: classes, protocols with default implementations, and extensions across files |

The Swift corpora run the adapter as the command `poetics-swift`, so its
binary must be on `PATH` (build it from the poetics-swift repository with
`swift build -c release` and add `.build/release`).

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

Swift is edited as text, since its adapter reports a unit's lines rather than
a syntax tree: bodies and statements are found by braces outside strings and
comments. A Swift unit's name carries its container and argument labels
(`Canvas.draw(_:in:)`), so `rename` changes only the base name, and only when
that name is declared once anywhere, stored properties and enum cases
included. Renaming a type renames its members' names with it, and `move-unit`
moves top-level declarations only, taking a type's members in that file
along. Types are refactored like functions, since in Swift they are most of
what is declared at the top level. Declarations inside `#if` are only renamed
or moved with their file. `wrap` and `rename-file` do not apply.

Each corpus lists its adapters in [`corpus.json`](corpus.json): taxonomy runs
with `typescript, react`, shadcn-svelte with `typescript, svelte`, and TanStack
Query with all three. `--adapters typescript` reruns phase 1's
configuration. The report counts the seeded units by kind and the uids kept by
the kind of unit each refactor picked.

## Swift findings (2026-11-21)

- **Members now follow their type** (ADR 0027): when a type is renamed or
  moved, each member pairs with the member of the same name in the type's
  match. Alamofire keeps **476 of 483** uids (was 469): `JSONEncoding.default`
  and `.prettyPrinted` keep theirs, and `EventMonitor`'s 5 identical methods
  are no longer queued. The other corpora are unchanged.
- What is left on Alamofire: 3 one-statement `rename-edit`s, the gate's
  rename of `startIndex` that also rewrote `headers.startIndex`, and the 3
  publisher types queued when `Combine.swift` moves.
- **The Combine queue (2026-11-24)** came from two refactors in one round:
  renaming `Protected.read(_:)` updated the calls in `DataResponsePublisher`,
  `DataStreamPublisher` and `DownloadResponsePublisher`, three near-copies,
  in the same commit that moved their file, so each resembled all three.
  Look-alikes in a similarity group now pair by a name each side has once
  when that pair is itself above the threshold, as shared content already
  did. Alamofire keeps **479 of 483**; the other corpora are unchanged.

## Swift findings (2026-11-20)

- **Alamofire's 2 unexplained units were the gate's own side effects.** The
  report now lists each unit created that no refactor made, with any unit
  removed that round that no refactor removed.
  - Renaming `DispatchQueue.after(_:execute:)` by text also rewrote the
    argument label of `HTTPHeaders.index(after:)`. A name used as an argument
    label or parameter name anywhere is no longer a rename candidate.
  - Renaming `Empty` renamed `Empty.emptyValue()` too, but the gate only
    checked members an earlier refactor already tracked. A type rename now
    checks every member of the type, and a type move checks those declared
    in it (not those in an extension, even in the same file).
- **Checking every member measures more, and finds real misses.** Alamofire
  keeps **469 of 483** uids (was 442 of 442) and IceCubesApp 146 of 147. Every
  unit created that no refactor made is now a miss's new uid. The misses:
  - **Members that name their type** lose their uid when it is renamed:
    `JSONEncoding.default` is `JSONEncoding { JSONEncoding() }`, so its name
    and content change together and it is too small to match by similarity.
  - **Identical members of a renamed type are queued:** `EventMonitor`'s 5
    empty default implementations share content, and pairing by name fails
    because every name changed with the type.
  - **The textual rename still overreaches** on names a library also
    declares: renaming `HTTPHeaders.startIndex` rewrote `headers.startIndex`
    in its own body, which an editor would not. These misses are the gate's.
  - 3 `rename-edit`s of one-statement functions, as on TypeScript.
  - Moving `Combine.swift` queued its 3 publisher types, which are alike but
    do not share content; this is not explained yet.

## Swift findings (2026-11-19)

- **Alamofire kept 442 of 442 uids and IceCubesApp 109 of 110**, over 10
  rounds each, across types, SwiftUI views (9 of 9), environment values and
  members owned across extensions. Nothing was misplaced or queued. The one
  miss is a `rename-edit` of a one-statement function, as on TypeScript.
- The adapter tracks 1,749 units in IceCubesApp's 367 files (168 SwiftUI
  components, 13 environment values and keys, 420 types, 1,148 functions)
  and 1,072 in Alamofire's 44.
- **Fingerprints were too coarse at first.** poetics-swift hashed one entry
  per statement, so almost every Swift function had fewer than the 8 entries
  similarity matching needs, and 5 of 5 `rename-edit`s on Alamofire lost
  their uid. It now shingles subtrees the way the TypeScript adapter does.
- **Identical units could not move.** Content leaves out a unit's own name,
  so Alamofire's empty default implementations in `EventMonitor` all hash
  alike, and moving their file queued every one. Identity matching now pairs
  units that share content by a name each side has once (`@poetics/core`).
- **The gate's own rename was too broad at first:** a unit name declared once
  among units can still be a stored property or an enum case elsewhere. A
  rename now needs the name declared once anywhere.
- Alamofire created 2 units no refactor made although no uid was missed;
  see the findings of 2026-11-20 for what they were.
- **Cost:** a round's `poetics index` first took 11.6 s on IceCubesApp and
  2.4 s on Alamofire (median). Profiling showed 10.8 s of IceCubesApp's in
  poetics-swift resolving names by scanning every unit of the batch for each
  use. With dictionary lookups (poetics-swift `f804097`, same output byte for
  byte) a round takes **2.4 s on IceCubesApp and 1.3 s on Alamofire**, and
  seeding 3.3 s and 1.7 s. That is in line with shadcn-svelte's 1.3 s for
  2,912 units. Caching unchanged files in the core would not be safe: edges
  are resolved across the whole batch (ADR 0025), so an unchanged file's
  edges change when another file renames what it calls. An adapter that needs
  more speed caches its own parsing.

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
- **Transform cache (2026-11-11):** the indexer now caches each file's
  imports and whether it changes globals, and roots a re-index's program at
  the files that changed and the files that declare globals, so a component
  that neither changed nor is imported by a changed file is never transformed.
  On the same machine, `pnpm gate --only shadcn-svelte` took a round's
  `poetics index` from 3.9 s to **1.3 s** (median; 1.4 s on a second run),
  with the same 91 of 95 uids kept and the same four misses. Indexing the
  corpus again with nothing changed takes 0.44 s instead of 1.95 s, and runs
  svelte2tsx on no component instead of all 2,128. Seeding still transforms
  everything: the indexer's share went from 5.6 s to 5.8–6.2 s (recording the
  new facts), and the gate's seeding, which also writes 2,912 unit files and
  commits them, measured 7.8 s before and 9.2–9.4 s after.
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
