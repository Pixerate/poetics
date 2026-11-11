---
"@poetics/adapter-svelte": minor
"@poetics/adapter-typescript": minor
---

Record Svelte contexts as `context` units (ADR 0021, #74): what `createContext()` from `svelte` returns, destructured into its getter and setter or kept whole, and an exported constant that its own module passes to `setContext`, `getContext` or `hasContext` as the key. A context's interface is its value type; setting or reading it is a `uses-context` edge. The TypeScript indexer accepts an array-destructured variable as a unit when a plugin claims it, and `DetectedUnit` gains `aliases`. Adds `svelteContextKind` and `svelteContextSignature`.
