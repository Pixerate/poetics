# Data model and store

## Units

A **unit** is anything Poetics tracks: a function, hook, component or type. It
has three identifiers:

| Identifier | What it is | Changes when |
| --- | --- | --- |
| `uid` | ULID minted when the unit is first seen | Never, even across renames and moves |
| `contentHash` | Hash of the normalised syntax tree | The logic changes (not formatting) |
| `interfaceHash` | Hash of the public signature | Callers could break |

A unit's **closure hash** also covers everything it depends on, so a component's
closure version changes when any function it uses changes.

## Versions

`versions` is an append-only array, oldest first. Each entry has:

| Field | Notes |
| --- | --- |
| `contentHash`, `interfaceHash`, `closureHash` | `b3:<64 hex>` from the indexer, or provisional `git:<40 hex>` ([ADR 0004](decisions/0004-provisional-hashes.md)) |
| `provisional` | Must be `true` exactly when any hash is `git:` |
| `parent` | Previous version's `contentHash`, or `null` for the first |
| `change` | `created` (first version only), `interface`, `behaviour`, `cosmetic`, or `removed` (last version only) |
| `commit` | Commit that introduced it; omitted in hand-written entries and backfilled from git |
| `actor` | `{ kind: "human" }` or an agent with `tool`, `model`, `session`, `task`, `reviewed` |
| `rationale` | Why this unit changed, citing its source |
| `links` | URLs or typed references `{ kind, ref, url? }` — never issue content |
| `deps` | `uid → contentHash` of each dependency when this version was captured |

Human authorship and dates come from git. Agent provenance is stored because git
only records the committer.

## Files

```
.poetics/
  config.json           validated by schemas/config.schema.json
  units/<uid>.json      validated by schemas/unit.schema.json
  notes/<id>.json       validated by schemas/note.schema.json
  poetics.lock          optional, validated by schemas/lock.schema.json
  cache/index.db        gitignored SQLite index
  cache/typescript.json gitignored per-file cache of the TypeScript indexer
```

The JSON files are the source of truth ([ADR 0002](decisions/0002-hybrid-json-sqlite-store.md)).
Each file carries `"$schema": "../../schemas/unit.schema.json"` so editors
validate as you type.

### Rules beyond the schema

`checkStore` (run by `pnpm validate`) also enforces:

- the filename matches the `uid`, and no uid appears twice;
- each version's `parent` is the previous `contentHash`, hashes are not repeated,
  and only the first version is `created`;
- `provisional` matches the hash family, and policy may forbid provisional hashes;
- `location.file`, linked test files, `owner` and `deps` all point at things that
  exist (unknown lineage uids are warnings);
- lock pins refer to known units;
- `removed` is only ever the last version ([ADR 0010](decisions/0010-removed-versions.md)).

### Removed units

Unit files are never deleted. When an export is deleted from the code, its unit
gains a final version with `"change": "removed"`, a rationale saying why, and
`contentHash` set to git's empty-blob hash
(`git:e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`, `REMOVED_CONTENT_HASH` in
`@poetics/core`), marked `provisional` and with no interface or closure hash. A
removed unit's `location.file` and linked tests need not exist; drift and
coverage skip it; live units that still depend on it get a warning. An export
that later reappears with the same name gets a new uid.

### Sharding

`store.layout` is `flat` by default. For very large monorepos it can be
`sharded`, which stores `units/<first two uid characters>/<uid>.json`, the way
git stores objects. Readers already accept both layouts; switching is a file
move plus a config change.

## Notes

Gotchas, workarounds and invariants are **notes**: one JSON file each in
`.poetics/notes/`, anchored to what they are about
([ADR 0006](decisions/0006-notes-replace-gotchas.md)).

| Field | Notes |
| --- | --- |
| `id` | ULID; the filename |
| `kind` | `gotcha` (surprise and fix), `workaround` (deliberate detour), `invariant` (a rule to keep) |
| `area` | Grouping in `GOTCHAS.md`: `tooling`, `node`, `schemas`, `sqlite`, `store`, `releases`, … |
| `title`, `cause`, `fix` | Plain text |
| `symptoms` | Exact text seen (errors, log lines), never paraphrased, so errors can be matched to notes |
| `anchors` | `units` (`uid` plus `observedAt`, the contentHash it was confirmed against), `paths`, `dependencies` (`name` and semver `range`), `commands` |
| `check` | The `test`, `validator` rule, `command` or `config` that catches it |
| `status` | `active`, `resolved` (needs `resolvedBy`) or `superseded` (needs `supersededBy`) |
| `actor`, `links` | As on versions |

`checkStore` validates each note's schema, that its id matches its filename,
that anchored units and paths and `test`/`config` check files exist, and that
`supersededBy` names another note. It **warns** when an active note's anchored
unit has a newer version than `observedAt`: confirm the note still holds and
update `observedAt`, or retire it.

`GOTCHAS.md` is generated by `renderGotchas` (`pnpm gotchas`): active notes in
full, grouped by area and ordered by id, then a table of retired notes. CI runs
`pnpm gotchas --check`.

## The SQLite index

`@poetics/store`'s `rebuildIndex` builds `.poetics/cache/index.db` with
`node:sqlite`:

| Table | Contents |
| --- | --- |
| `unit_files` | Path, SHA-256 of the file bytes, uid — drives incremental rebuilds |
| `units` | One row per unit with its latest content hash and version count |
| `versions` | Every version, flattened |
| `deps` | The newest version's dependencies; indexed by `to_uid` for reverse lookups |
| `test_links`, `lineage` | Flattened from the unit file |
| `units_fts` | FTS5 table of each unit's name (with its camelCase parts), docs and every version's rationale, for `searchUnits` |
| `meta` | `schema_version` |

Guarantees, covered by tests in `packages/store/src/index-db.test.ts`:

- **Incremental:** files with unchanged bytes are skipped.
- **Disposable:** deleting `cache/` and rebuilding gives an identical dump.
- **Atomic:** a rebuild runs in one transaction; an unreadable unit file rolls
  it back.
- **Never migrated:** a different `INDEX_SCHEMA_VERSION` drops the tables and
  rebuilds.

When you add a column or table, bump `INDEX_SCHEMA_VERSION` and add it to the
`TABLES` list so `dumpIndex` compares it.

## The TypeScript indexer's cache

`@poetics/adapter-typescript` keeps what it found per file in a JSON cache
(`cache/typescript.json` by convention; the caller passes the path). Each entry
holds the file's units, with their hashes, signatures and edges, under a key:
a Merkle hash of the file's path, its text and whether it is in scope, over
every project file it imports, directly or not. Unchanged keys skip the
checker. The whole cache is dropped when its environment changes: the cache
format (`CACHE_VERSION` in `indexer.ts`), the TypeScript version, the compiler
options or the lockfile. Like `index.db`, it is disposable.

Each indexed unit carries three hashes, all `b3:`:

| Hash | Over |
| --- | --- |
| `contentHash` | The normalised syntax tree of all the unit's declarations, its own name left out. Comments, formatting, quote style, redundant parentheses, numeric spelling, quoted keys, export style and JSX re-wrapping never change it. |
| `runtimeHash` | The same tree with types, type-only declarations and TypeScript-only modifiers erased. Equal runtime hashes with different content hashes mean a types-only change. |
| `interfaceHash` | The signature: for functions and hooks, the visible overloads' type parameters, parameters (rest, optional, type, default value; not names) and return type, with omitted types as the checker prints them; for types, their structure. |

Global declarations reached without an import are not part of a file's key.
