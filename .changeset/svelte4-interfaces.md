---
"@poetics/adapter-svelte": minor
"@poetics/adapter-typescript": minor
---

Svelte 4 components record their full interface: `export let` props with their defaults, the events they dispatch or forward with the type a listener receives, and their named slots with the props each passes. The component signature gains optional `events` and `slots`, which Svelte 5 and React components leave out. A component rendered with content is one `renders` edge, and `sveltePlugin` takes an optional `svelteVersion`.
