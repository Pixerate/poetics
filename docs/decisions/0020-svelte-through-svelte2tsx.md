# 0020. Svelte components enter the TypeScript program through svelte2tsx

- Status: Accepted (2026-11-11)
- Date: 2026-11-10

## Context

The plan indexes Svelte by turning each component into TSX with `svelte2tsx`
and reading that output with the same type checker as plain TypeScript
([ADR 0003](0003-typescript-compiler-api.md),
[ADR 0013](0013-compiler-api-without-ts-morph.md)). That way, a `.ts` utility
called from a component and a component imported by a `.ts` file resolve to
the same units.

Since the plan was written, the shape of an adapter has changed. React is a
`FrameworkPlugin` inside the TypeScript indexer: one `ts.Program` over the
files in scope, with hooks to claim units, describe their interfaces and name
edge kinds. `@poetics/adapter-svelte` is still a stub of the older
`FrameworkAdapter` interface in core, and the indexer cannot read a `.svelte`
file at all, since it is not TypeScript.

Options considered:

- **A separate Svelte indexer** with its own program over the generated TSX.
  Edges between Svelte and TypeScript would cross two checkers and need
  stitching by name, which is what ADR 0013 rules out.
- **Writing the generated TSX to disk** next to each component. This leaves
  files behind, races with editors and needs cleaning up.
- **Serving the generated TSX from the compiler host,** so the one program
  reads it as if it were the file. This is how `svelte-check` and the Svelte
  language server work.

What a component's hashes cover matters as much. If the content hash covered
the generated TSX, a `svelte2tsx` upgrade could change every component's hash
and mint a version of each, with no change to the code.

## Decision

**The indexer's compiler host serves each `.svelte` file as TSX.** A
`FrameworkPlugin` may declare the extensions it reads and a `transform(file,
text)` that returns the generated text and a source map. The host serves the
transformed text for those files, and module resolution resolves imports of
`./Button.svelte` to it. The indexer stays framework-free: `svelte2tsx`, with
`svelte` as its peer, is a dependency of `@poetics/adapter-svelte` only.
Spans, lines and unresolved uses found in generated code are mapped back to
the `.svelte` file through the source map. A use with no mapping, inside
code `svelte2tsx` added, is not reported.

**Each `.svelte` file is one `component` unit,** named after the file, as
Svelte's own tooling names it, with `framework: "svelte"`.

**Hashes are taken from what was written, interfaces from the checker:**

- The content hash and fingerprints cover the component's own source. Each
  `<script>` block is normalised as TypeScript, the same way as any other
  unit. Markup and `<style>` are normalised by dropping comments and
  collapsing whitespace. The generated TSX never enters a content hash.
- The interface hash comes from the checker's view of the generated code,
  like React's: for Svelte 5, the type of the `$props()` destructure,
  including callback and snippet props; for Svelte 4, the `export let`
  declarations, the event types of `createEventDispatcher` and the named
  slots. A codebase can mix both majors during a migration.
- The `svelte2tsx` version is part of the indexer's cache environment, so an
  upgrade re-indexes components but changes no content hash.

**Edges come from the generated code:** components used in markup are
`renders` edges, and functions called in template expressions are `calls`
edges. `{@render}` targets are snippets, which belong to the component that
declares them.

## Consequences

- `FrameworkPlugin` gains `extensions` and `transform`, which only the Svelte
  plugin uses at first. The indexer's cache keys and its import walk must
  read `.svelte` imports as well.
- `.svelte` files stop being "in scope but not indexed" in `poetics verify`,
  coverage and the identity gate (#66).
- Upgrading `svelte2tsx` re-indexes components but changes no content hash.
  If an upgrade changes an interface the checker reports, such as how slots
  are typed, that is recorded as an interface change and its callers are
  flagged.
- The work is tracked in milestone 3: the host and hashes (#69), Svelte 5
  interfaces and markup edges (#70), Svelte 4 interfaces (#71), and the
  identity gate over `.svelte` files (#66).
- These are left to later records or issues: functions in `<script>` as
  child units with `owner` (#72), rune helpers in `.svelte.ts` modules (#73),
  and Svelte's `setContext` and `getContext`, whose keys need a design of
  their own (#74, see [ADR 0016](0016-context-units.md)).
