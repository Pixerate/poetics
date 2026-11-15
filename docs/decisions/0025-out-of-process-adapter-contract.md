# 0025. Out-of-process adapters answer batched JSON requests on stdin and stdout

- Status: Proposed
- Date: 2026-11-15
- Completes: [ADR 0008](0008-out-of-process-adapters.md), which deferred the
  contract until the React adapter gate had passed

## Context

ADR 0008 decided that adapters for languages the TypeScript checker cannot
read run out of process and emit JSON that the core consumes, with the core
the only writer of `.poetics/`. It left the contract until the adapter
interface had been proven. The React and Svelte gates now pass, and Swift is
next ([#11](https://github.com/Pixerate/poetics/issues/11)).

The in-process adapters hand the core an `IndexedUnit` for each unit: a key,
name, kind, framework, span, doc comment, content and interface hashes, a
fingerprint for matching moved code, a signature, edges and unresolved uses.
Five places call the TypeScript indexer directly: indexing, rehash, backfill,
the MCP server's code reader and the gate scripts. Some of them read a file
as it was at an earlier commit, not as it is on disk: the base snapshot that
classifies a change, backfill's count of what a commit introduced
([ADR 0022](0022-backfill-thin-commit-evidence.md)), and the history walk.

Options considered:

- **A long-running server** speaking JSON-RPC, as language servers do. Fast
  for repeated queries, but it brings process lifetime, restarts and
  concurrency into the core for a tool that runs in short batches.
- **One process per file.** Simple, but Swift tools start slowly, and
  ADR 0008 already requires batched discovery.
- **One process per batch, JSON on stdin and stdout.** The shape drafting uses
  ([ADR 0017](0017-drafting-through-a-command.md)): no shell, no port, and
  testable with a fixture file.

## Decision

**An external adapter is a command, run once per batch.** A config entry in
`adapters` can be an object as well as a name:

```json
{ "name": "swift", "command": ["poetics-swift"], "include": ["**/*.swift"], "timeoutSeconds": 120 }
```

The command is an argv array, run without a shell from the repository root.
Files in scope that match its `include` go to it, and to no other adapter.

**The core writes one request on stdin:** `protocol` (1), the repository
`root`, and `files`, each with a repository-relative `path` and, when the
core is reading the file as it was at a commit, its `text`. Without `text`,
the adapter reads the file from disk. All files of one batch are one program:
the adapter resolves edges among them.

**The adapter writes one response on stdout:**

- `protocol`, and `adapter`: its `name`, `version` and `rules`, an integer it
  raises whenever a change to its normalisation changes the hashes of
  unchanged code. The core uses `rules` to know when hashes need re-recording.
- `files`: one entry per requested path, with `units` (possibly empty), or
  `error` when that file could not be read.
- For each unit: `key` (unique in the batch: `path#name`, with whatever the
  language needs to keep it unique), `name`, `owner` (the key of the unit it
  is declared inside, if any), `kind`, `framework`, `startLine` and `endLine`
  (1-based, inclusive), `docs`, `contentHash`, `interfaceHash`, an optional
  `runtimeHash` (only for languages with erasable types), `fingerprint`
  (subtree hashes, for matching code that moved while it was edited),
  `signatureText` (the declaration up to its body, as written), `edges` and
  `unresolved`.
- Each edge has `to` (a key in the batch), `kind`, and `resolution`: `exact`
  (resolved by a compiler or build index) or `name` (the only unit in the
  batch with that name). Each unresolved use has a `kind`, a `line`, the
  `name` used and a `reason`.

Hashes are `b3:` followed by 64 hex digits. **Adapters own their
normalisation:** the core never recomputes content or interface hashes, and
only combines them into closure hashes.

**Failure never removes units.** If the command fails, times out or writes no
valid response, the batch fails and `poetics index` stops with the adapter's
stderr. A file with an `error`, or missing from the response, counts as not
read: its units keep their last version and are reported, not removed.

**This repository owns the contract:** the request and response schemas in
`schemas/`, and shared fixtures, each an adapter response together with the
unit files the core writes for it. An adapter's own repository runs its
output through the core and the schemas to check it conforms.

**Every in-process caller goes through one adapter interface,** which the
TypeScript, React and Svelte adapters implement in process. Reading a file at
a commit is a request with `text`, so backfill, rehash and the history walk
work for any language.

## Consequences

- A new language needs a command that speaks this protocol, and no change to
  the core beyond widening `UnitKind`, `Framework` or `EdgeKind` when it brings
  kinds of its own.
- Edges never cross adapters: a Swift unit cannot call a TypeScript unit, as
  ADR 0008 already accepted.
- Edges resolved by name are weaker than exact ones. The core keeps
  `resolution` with each edge, and impact warnings say when they rest on a
  name match.
- An adapter that raises `rules` triggers the re-recording of interface
  hashes made stale by its new rules, by whatever mechanism the core uses for
  the in-process adapters.
- The five direct callers of the TypeScript indexer are refactored onto the
  adapter interface before the first external adapter is wired in. The gate
  and backfill evals then run for any language.
- Structured signatures stay in-process only: the contract carries
  `signatureText` for people and `interfaceHash` for change detection, which
  is all the core needs from an external adapter.
