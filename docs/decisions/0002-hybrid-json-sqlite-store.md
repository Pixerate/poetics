# 0002. JSON unit files in git, SQLite as a local index

- Status: Accepted
- Date: 2026-10-27
- Closes the plan's open question "One JSON file per unit, or a single SQLite file?"

## Context

Unit metadata must travel with commits and branches, merge cleanly when several
people or agents work in parallel, be reviewable in pull requests, and be
writable by hand on day one before any tooling exists. Tools also need fast
queries: lookups by name, full-text search, and "who depends on this unit".

Three options were considered:

1. **One JSON file per unit in git** (the plan's original design). Merges rarely
   conflict because different units are different files; diffs are readable on
   GitHub; agents can write files by hand. Querying means reading every file.
2. **One SQLite file in git.** Fast queries and scales further, but every
   metadata change touches the same binary file. Branch merges need a custom
   merge driver that every clone, including CI runners, must install; without it
   the file corrupts or conflicts. Diffs need a textconv driver and still show
   as "binary file changed" on GitHub. Agents cannot hand-edit it on day one.
3. **Hybrid:** JSON files in git as the source of truth, and a SQLite index
   rebuilt from them locally.

## Decision

Hybrid.

- `.poetics/units/<uid>.json` is the source of truth, exactly as the plan
  describes, validated against `schemas/unit.schema.json`.
- `.poetics/cache/index.db` is a SQLite database, gitignored, built with Node's
  built-in `node:sqlite`. `@poetics/store`'s `rebuildIndex` updates it.
- The rebuild is **incremental**: unit files whose bytes are unchanged since the
  last run are skipped. It is **disposable**: deleting `cache/` and rebuilding
  produces an identical index. Both properties are unit-tested.
- If the index schema version changes, the index is dropped and rebuilt, never
  migrated.
- Very large monorepos can switch `store.layout` to `sharded`
  (`units/<first two uid characters>/<uid>.json`), the way git stores objects.

## Consequences

- No custom merge driver is needed for the database; git merges the JSON files.
  (A union merge driver for a single unit's `versions` array is still planned,
  for the rare case two branches append to the same unit.)
- Pull request diffs show exactly what an agent wrote about each unit, which
  the review policy depends on.
- There are two layers to keep in sync. Every read path must go through
  `rebuildIndex` first, or check that the index is fresh.
- Tens of thousands of small files are slower to read in a cold rebuild; the
  incremental rebuild and sharding mitigate this.
