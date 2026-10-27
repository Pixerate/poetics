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
| `change` | `created` (first version only), `interface`, `behaviour` or `cosmetic` |
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
  poetics.lock          optional, validated by schemas/lock.schema.json
  cache/index.db        gitignored SQLite index
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
- lock pins refer to known units.

### Sharding

`store.layout` is `flat` by default. For very large monorepos it can be
`sharded`, which stores `units/<first two uid characters>/<uid>.json`, the way
git stores objects. Readers already accept both layouts; switching is a file
move plus a config change.

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
