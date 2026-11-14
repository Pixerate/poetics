---
name: poetics-svelte-component
description: Use when creating or editing Svelte components or .svelte.ts rune modules in a Poetics repo, so they take shapes the Svelte adapter resolves precisely.
---

# Svelte components the adapter can read

Each `.svelte` file is one component unit. Functions its scripts declare
without exporting (`function x() {}` or `const x = () => {}`) are child units
with `owner` set to the component's uid. Editing one records a version of it
and of the component: give each its own rationale.

- **Svelte 5 for new code.** Type `$props()` with a named type:
  `let { amount, onSelect }: PriceTagProps = $props();`. That type is the
  component's interface.
- **Callback props for events** (`onSelect`), not `createEventDispatcher`.
- **Snippets over slots** (`{@render children?.()}`), typed in the props.
- **Rune modules** go in `.svelte.ts` files and are indexed as TypeScript. A
  function there that calls `$state`, `$derived` or `$effect` itself is a
  rune helper, recorded as a `hook`: create its state in its own body rather
  than in a function it calls, so the adapter sees it.
- **Contexts:** prefer `export const [getX, setX] = createContext<T>()` from
  `svelte`. With `setContext`/`getContext`, use an exported constant key
  declared in the module that sets and gets it, never a string literal: only
  those are context units the adapter tracks (ADR 0021).
- **Avoid `<svelte:component this={x}>`** and dynamic component maps where an
  explicit component works; they become unresolved edges.
- **Docs** live in a `<!-- @component -->` comment at the top of the file,
  mirrored in the unit's `docs`.
- Svelte 4 components (`export let`, events, slots) stay supported; convert them
  only when the task asks, and record that as an `interface` change.
- Follow `poetics-change` to record the unit, and run `pnpm check` (`sv check`).
