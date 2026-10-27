# Decision records

One short record per significant choice, numbered in order. Unit rationale
links to them with `{ "kind": "decision", "ref": "docs/decisions/0002-…" }`.
Open questions live as GitHub issues labelled `question`; each is closed by a
new record here.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-text-is-source-of-truth.md) | Source text stays the source of truth | Accepted |
| [0002](0002-hybrid-json-sqlite-store.md) | JSON unit files in git, SQLite as a local index | Accepted |
| [0003](0003-typescript-compiler-api.md) | TypeScript compiler API, not tree-sitter | Accepted |
| [0004](0004-provisional-hashes.md) | Provisional git blob hashes until the indexer exists | Accepted |
| [0005](0005-node-24-type-stripping.md) | Node 24, native type stripping and `node:sqlite` | Accepted |

New records copy [`template.md`](template.md).
