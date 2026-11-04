---
"@poetics/mcp": minor
"@poetics/adapter-typescript": minor
---

The MCP server reads the code. Context packs include the unit's code and signature, and the signatures of its callers and dependencies. `poetics_impact` ranks the units a change reaches through the composition graph, and `poetics_changes` does too with `impact: true`. `poetics_verify` reports what is behind in a path scope. The indexer gives each unit a `signatureText`, and counts what a private helper uses as used by the exported unit that calls it.
