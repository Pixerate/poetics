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
| [0011](0011-backfill.md) | Backfill: capture the current state, then the history behind it | Accepted |
| [0012](0012-open-items-as-notes.md) | Assumptions, considerations and planned work are notes | Proposed |
| [0013](0013-compiler-api-without-ts-morph.md) | The TypeScript compiler API directly, without ts-morph | Proposed |
| [0014](0014-rehash-versions.md) | The rehash is an appended version | Proposed |
| [0015](0015-contradictions-in-intent.md) | Contradictions in intent are found by reading recorded intent together | Proposed |
| [0016](0016-context-units.md) | React contexts are units of their own kind | Accepted |
| [0017](0017-drafting-through-a-command.md) | Rationale is drafted by a command the repository configures | Accepted |
| [0018](0018-backfill-confidence-is-unit-specific.md) | Backfill confidence is high only for evidence about this unit alone | Accepted |
| [0019](0019-backfill-rationale-leads-with-the-doc-comment.md) | Backfill rationale leads with the unit's doc comment when the change's text is shared | Accepted |
| [0020](0020-svelte-through-svelte2tsx.md) | Svelte components enter the TypeScript program through svelte2tsx | Accepted |
| [0021](0021-svelte-context-units.md) | Svelte contexts are context units, keyed by what declares them | Accepted |

New records copy [`template.md`](template.md).
