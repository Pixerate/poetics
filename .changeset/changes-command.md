---
"@poetics/store": minor
"@poetics/cli": minor
"@poetics/mcp": minor
---

Implement "what changed, and why" between two refs: `changesBetween` walks the
range with git and reports each commit's unit versions with rationale,
removals and interface changes first, plus commits that recorded no unit and
decisions and notes added. `poetics changes [from] [to]` prints it (or JSON
with `--json`), and the MCP server answers `poetics_changes`. `run` takes an
optional repository root. `--impact` waits for the indexer.
