---
"@poetics/store": minor
"@poetics/cli": minor
"@poetics/mcp": minor
---

Serve the MCP write tools. `poetics_record_rationale` gives the newest uncommitted version its rationale. `poetics_declare_lineage` declares a rename, move, split or merge, checked against the code the way `poetics index` matches. `poetics_record_note` records or re-confirms a note and regenerates `GOTCHAS.md`. Writes are attributed to the calling agent. The store's `recordRationale` is implemented, and it gains `createNote`, `confirmNote` and `buildGotchas`; its `declareLineage` stub moves to `@poetics/cli`, which implements it. `poetics index` takes declarations.
