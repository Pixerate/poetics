---
"@poetics/core": minor
"@poetics/store": minor
"@poetics/cli": minor
---

`poetics backfill --draft` drafts each version's rationale through a command the repository configures in `backfill.draft.command` (ADR 0017); Poetics names no model or provider. The command reads one JSON draft request on stdin and writes one JSON draft on stdout. Poetics keeps the extracted rationale unless the draft cites only evidence it was given, sets `diffOnly` exactly when it cites nothing, and quotes no pull request or review text. Pull request text is sent only for public repositories or with `--draft-private`. Drafts are cached in `.poetics/cache/drafts.json`. `IssueTracker` gains an optional `visibility`, and the config schema gains `backfill.draft`.
