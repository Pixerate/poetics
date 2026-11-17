# Adapter protocol fixtures

Example batches for the out-of-process adapter protocol
([ADR 0025](../../../docs/decisions/0025-out-of-process-adapter-contract.md)):
each folder holds a `request.json` the core sends, the `response.json` an
adapter answers with, and `units.json`, the units `poetics index` records for
that response (key, kind, framework, owner, docs, hashes and change). They validate against
[`adapter-request.schema.json`](../../adapter-request.schema.json) and
[`adapter-response.schema.json`](../../adapter-response.schema.json), and pass
`checkAdapterResponse` from `@poetics/core`.

An adapter in another repository (such as `poetics-swift`) can use them in two
ways: as the shape its output must take, and as test input for its own
schema checks. The hashes are stand-ins, since the core treats them as opaque.
`packages/cli/src/command-adapter.test.ts` replays each response through a
command adapter and checks the units written against `units.json`.

| Fixture | Shows |
| --- | --- |
| `swift-basic` | ADR 0026's Swift units: a type with members owned across an extension, overloads keyed by argument labels, an `#if` declaration as one unit, a member of another module's type, edges resolved by name, an unresolved use, a file read at a commit (`text`), and a file the adapter could not read. |
