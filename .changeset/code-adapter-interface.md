---
"@poetics/cli": minor
"@poetics/mcp": patch
---

Read code through one adapter interface (ADR 0025): `CodeAdapter`, `adaptersFor`, `indexWith`, `readTextsWith` and `readsAny` in `@poetics/cli`. Indexing, rehash, backfill, declaration discovery and the MCP server's code view use it instead of calling the TypeScript indexer, with the same results. `exportsIntroduced` now takes adapters instead of framework plugins. The history walk no longer calls an edit cosmetic when the unit has no runtime hash.
