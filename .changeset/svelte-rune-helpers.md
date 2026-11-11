---
"@poetics/adapter-svelte": minor
"@poetics/cli": patch
---

Record rune helpers as `hook` units with `framework: "svelte"` (#73): functions in `.svelte.ts` / `.svelte.js` modules or component scripts whose own body calls `$state`, `$derived` or `$effect`. Calls to them are `uses-hook` edges. Adds `createsRuneState`. The CLI now runs the Svelte plugin before React's, so a `use*` rune helper is not claimed as a React hook.
