---
"@poetics/mcp": minor
"@poetics/store": minor
---

`poetics-mcp` serves MCP over stdio. It answers `poetics_context_pack` (token-budgeted), `poetics_search`, `poetics_unit`, `poetics_history`, `poetics_changes`, `poetics_tests_for` and `poetics_notes` from the store, and lists only those tools. `PoeticsServer` gains `tools()`, and `listen()` accepts streams. The store adds `readUnit`, a `match: "any"` option on `searchUnits`, and `docs` on `UnitRow`.
