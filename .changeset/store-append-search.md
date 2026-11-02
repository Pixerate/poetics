---
"@poetics/store": minor
---

`appendVersion` writes a version to a unit file, append-only and optionally schema-validated, and `searchUnits` searches names, docs and rationale through a new FTS5 table in the index (`INDEX_SCHEMA_VERSION` 2). `WriteContext` gains an optional `validator`.
