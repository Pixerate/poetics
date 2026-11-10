---
"@poetics/adapter-typescript": minor
"@poetics/adapter-svelte": minor
"@poetics/store": minor
"@poetics/cli": minor
"@poetics/mcp": patch
---

Svelte components are indexed (ADR 0020). `@poetics/adapter-svelte` now exports `sveltePlugin`, a framework plugin for the TypeScript indexer that replaces the `createSvelteAdapter` stub. Each `.svelte` file is turned into TypeScript by `svelte2tsx` and read by the same checker as every other file, so components and `.ts` code resolve to each other. Each component is one `component` unit, hashed from its source as written, with its props type as its interface and `renders` edges to the components it uses.

`FrameworkPlugin` gains `extensions`, `transform`, `ambient` and `detect` for files that are not TypeScript, and `version` may be a string. `filesInScope` reads `.svelte` files when the `svelte` adapter is configured, and `poetics index`, `verify`, `coverage`, `backfill` and the MCP tools use the Svelte plugin when it is.
