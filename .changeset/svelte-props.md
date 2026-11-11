---
"@poetics/adapter-svelte": minor
---

A Svelte component's interface now records each prop's default, `$bindable(…)` included. A props type the component declares for itself is recorded by its structure, so retyping a prop in a local `interface Props` is an interface change and renaming the interface is not. Props that `svelte2tsx` infers, or that a JavaScript component types in JSDoc, are recorded too.
