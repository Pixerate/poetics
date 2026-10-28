# 0008. Non-TypeScript adapters run out of process

- Status: Proposed
- Date: 2026-10-28

## Context

Teams writing Swift (and later other languages) want the same unit history,
rationale and composition graph. [ADR 0003](0003-typescript-compiler-api.md)
has both current adapters share one TypeScript checker, which a Swift adapter
cannot join; its units form a separate graph with no edges into TypeScript.

Options considered for Swift:

- **An npm package parsing Swift in Node** (tree-sitter-swift via WASM, or a
  bundled SwiftSyntax binary). Tree-sitter sees syntax only; a bundled binary
  means shipping prebuilt toolchain-dependent executables through npm.
- **A Swift package that writes `.poetics/` itself.** Native parsing, but uid
  minting, hashing and validation would be reimplemented and must match the
  TypeScript core byte for byte.
- **A Swift package that emits adapter output as JSON** for the TypeScript core
  to consume. Native parsing with SwiftSyntax, and IndexStoreDB later for
  resolved edges, while the core stays the only writer of the store.

SwiftPM resolves packages by git URL and expects `Package.swift` at the
repository root, and reads plain semver tags (`1.2.0`). This repository's
changesets tag per package (`@poetics/core@0.1.1`), so the two release schemes
collide in one repository.

## Decision

Adapters for languages the TypeScript checker cannot read run out of process:
a native tool emits units, interfaces, spans and edges as versioned JSON, and
the TypeScript core consumes it. The core remains the only writer of
`.poetics/`.

The Swift adapter lives in its own repository (`poetics-swift`) as a SwiftPM
package with its own releases. This repository owns the contract: the adapter
output schema in `schemas/` and shared hash fixtures.

Implementation is deferred until the React adapter gate (phase 2) has proven
the adapter interface; the JSON contract is written then, and this record moves
to Accepted. The deferred work is tracked in
[#11](https://github.com/Pixerate/poetics/issues/11).

## Consequences

- Phase 1 must keep two doors open, at no cost to React or Svelte:
  - **Adapters own content and interface hashes.** The normalisation behind
    `b3:` hashes ([ADR 0004](0004-provisional-hashes.md)) is defined per
    adapter, and the core treats those hashes as opaque. Closure hashes stay in
    the core, since they only combine other hashes.
  - **Discovery is batched.** When adapters replace `scripts/lib/declarations.ts`,
    the core asks an adapter for a set of files, possibly asynchronously, rather
    than calling `detectUnits` once per file.
- `Framework`, `UnitKind` and `EdgeKind` stay as they are until the contract is
  written; unused enum values would only weaken validation.
- Swift users still need Node to run the core. A Swift-native writer remains
  possible later, against the same schemas and fixtures.
- Releases, CI and tests for the Swift package live in its own repository.
