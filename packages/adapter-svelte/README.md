# @poetics/adapter-svelte

Poetics adapter that indexes Svelte components: each `.svelte` file is turned into TypeScript by `svelte2tsx` and read by the TypeScript indexer's checker, so components and `.ts` code resolve to the same units ([ADR 0020](../../docs/decisions/0020-svelte-through-svelte2tsx.md)). `svelte` is a peer dependency.

Part of [Poetics](../../README.md). Pre-alpha: see [architecture](../../docs/architecture.md) for what is built and what is stubbed.
