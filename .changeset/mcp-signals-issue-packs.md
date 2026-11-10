---
"@poetics/core": minor
"@poetics/cli": minor
"@poetics/mcp": minor
---

The MCP server answers `poetics_signals` (a unit's linked issues and pull requests, with titles, states and review comments on its file) and `poetics_context_pack` with an `issue`: it picks the unit the issue most likely touches, says why, and adds the issue's text and the other issues linked from the same code. Issue text is read through the issue tracker on demand and never written to `.poetics/`. `IssueTracker` gains an optional `issue(number)`, which the GitHub tracker implements.
