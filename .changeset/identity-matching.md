---
"@poetics/core": minor
"@poetics/adapter-typescript": minor
---

Add identity matching. `matchIdentities` follows tracked units across renames, moves, splits and merges: declared lineage first, then file and name, then content hash, then syntax-tree similarity. Ambiguous matches are queued rather than guessed. The TypeScript indexer now gives each unit a similarity `fingerprint`.
