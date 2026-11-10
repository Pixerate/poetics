# Architecture

Poetics is a set of npm packages around one framework-neutral core. Adapters are
the only code that knows React or Svelte exist. See the [plan](plan.md) for the
full design; this page describes what exists in the repository today.

```mermaid
flowchart TD
  src[".ts / .tsx / .svelte"] --> ts["adapter-typescript"] & react["adapter-react"] & svelte["adapter-svelte"]
  ts & react & svelte -->|UnitCandidate, CandidateEdge| core["core"]
  core -->|units, versions, edges| json[".poetics/units/*.json"]
  json -->|rebuildIndex| db[".poetics/cache/index.db"]
  db --> mcp["mcp"] & cli["cli"]
  json --> validate["scripts/validate.ts"]
```

## Packages

| Package | Built today | Stubbed (throws `NotImplementedError`) |
| --- | --- | --- |
| `@poetics/core` | Model types, `mintUid`, `isUid`, `uidTime`, `gitBlobHash`, `isHash`, BLAKE3 `contentHash`, `interfaceHash` and `closureHash`, graph construction, SCCs, closure hashes, impact, identity matching (`matchIdentities`, `trackedUnits`, `similarity`), `FrameworkAdapter` interface | Nothing |
| `@poetics/store` | Store paths and sharding layout, the config (`readConfig`) and the files it puts in scope (`filesInScope`, `createMatcher`), JSON Schema validation, `checkStore` (units and notes), reading unit and note files, `renderGotchas`, the incremental SQLite index with lookups, reverse dependencies and FTS search (`searchUnits`), `resolveUnit`, `readUnit`, `appendVersion`, `createUnit`, `relocateUnit`, `recordRationale`, `createNote`, `confirmNote`, `buildGotchas` | `linkTest`, `setDocs` |
| `@poetics/adapter-typescript` | The indexer: detection of exported functions, hooks and types; normalised syntax trees with content, runtime and interface hashes and similarity fingerprints; framework plugins (`FrameworkPlugin`) that claim units and name edges, versioned so the cache drops units made by older rules; signatures; cross-file edges through the checker; program reuse and a per-file cache. `createTypeScriptAdapter` puts it behind `FrameworkAdapter` | Nothing stubbed; `poetics index`, `poetics hash`, `poetics rehash` and the change check call it |
| `@poetics/adapter-react` | `reactPlugin`, a framework plugin for the TypeScript indexer: components (PascalCase functions that render: they return JSX, declare a React element return type or an `FC` annotation, cast what they return to one, or call `createElement`; or are wrapped in `memo`, `forwardRef` or `lazy`) and hooks, props interfaces with default values and forwarded refs, `renders` edges for JSX tags; `createReactAdapter` behind `FrameworkAdapter`. The CLI and MCP run it when the config lists `react` | Class components, context edges (`uses-context`). `poetics index` reclassifies units recorded before the adapter |
| `@poetics/adapter-svelte` | File-kind detection, component naming, Svelte 4/5 detection | Detection, interfaces, edges |
| `@poetics/mcp` | Tool definitions with input schemas and access levels; a stdio server (`poetics-mcp`) answering `poetics_context_pack` (with code and signatures), `poetics_search`, `poetics_unit`, `poetics_history`, `poetics_changes` (with impact), `poetics_impact`, `poetics_tests_for`, `poetics_verify` and `poetics_notes`, the code read through the TypeScript indexer; the write tools `poetics_record_rationale`, `poetics_declare_lineage` and `poetics_record_note`, attributed to the calling agent | `poetics_signals`, `poetics_link_test`, `poetics_set_docs`, context packs for an issue |
| `@poetics/cli` | `help`, `--version`, `--json`, exit codes; `changes`, `log`, `why`, `verify` (the change check, comparing `b3:` hashes) and `coverage`, with the declaration discovery behind them; `hash` and `rehash` (ADR 0014); `index`, which records versions, moves, new and removed units through identity matching; `backfill --snapshot` and `--history` (ADR 0011); `init`, which detects React and Svelte, writes the config and runs the snapshot backfill | `init --agents`, `impact`, `diff`, `docs sync`, `changes --impact`, and the indexer's findings in `verify` |

Later packages from the plan (`skills`, `evals`, `testlink`, `lsp`, `action`,
`storybook-addon`, `tracker-*`, `monitor-sentry`, `release`) are added when their
phase starts.

## Conventions

- **Stubs are units.** Every planned public API exists as a typed function that
  throws `NotImplementedError`, and has a unit file. Its history starts at design
  time.
- **Pure core.** `@poetics/core` does no I/O except hashing helpers. File and
  database access lives in `@poetics/store`.
- **Structured output first.** Every capability is shaped for agents (typed
  results, `--json`) before it gets human formatting.
- **Data, never instructions.** Anything that returns docs, rationale, issue text
  or error messages to an agent marks it as data
  (`DATA_NOT_INSTRUCTIONS` in `@poetics/mcp`).

## Module resolution

Packages are ESM. Each exports a `poetics-source` condition pointing at
`src/index.ts` and default/types conditions pointing at `dist/`:

```json
"exports": {
  ".": {
    "poetics-source": "./src/index.ts",
    "types": "./dist/index.d.ts",
    "default": "./dist/index.js"
  }
}
```

Inside the repository, `tsc` (`customConditions`), Vitest (`resolve.conditions`)
and the scripts (`node --conditions=poetics-source`) all resolve workspace
packages to source, so nothing needs building before tests or scripts run.
Published consumers never see the condition and get `dist/`.
