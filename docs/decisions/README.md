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
| [0006](0006-notes-replace-gotchas.md) | Gotchas are anchored notes; GOTCHAS.md is generated | Accepted |
| [0007](0007-change-check-and-coverage.md) | A per-change check and a coverage report | Accepted |
| [0008](0008-out-of-process-adapters.md) | Non-TypeScript adapters run out of process | Proposed |
| [0009](0009-changes-between-refs.md) | "What changed, and why" between two refs | Accepted |
| [0010](0010-removed-versions.md) | Removal is a version; unit files are never deleted | Accepted |
| [0011](0011-backfill.md) | Backfill: capture the current state, then the history behind it | Proposed |
| [0012](0012-open-items-as-notes.md) | Assumptions, considerations and planned work are notes | Proposed |

New records copy [`template.md`](template.md).
