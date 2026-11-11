# 0021. Svelte contexts are context units, keyed by what declares them

- Status: Proposed
- Date: 2026-11-11

## Context

[ADR 0016](0016-context-units.md) made React contexts units of kind `context`,
with `uses-context` edges from every provider and consumer, and left Svelte's
contexts for the Svelte adapter (#74). A React context is one value,
`createContext(…)`, that providers and consumers both name. Svelte has two
APIs, and neither gives the same handle:

- `setContext(key, value)` and `getContext(key)` take a key, which can be any
  value: a string, a symbol or an object. Components agree on a context only by
  passing the same key.
- `createContext<T>()` (Svelte 5.40) returns a typed getter and setter,
  usually destructured: `export const [getUser, setUser] = createContext<User>()`.
  The pair is the context; nothing else names it.

Options considered for keys:

- **Every key, string literals included.** Two components using `"user"` would
  share a unit with no declaration to place it at, so it could not be moved,
  renamed or given history, and a typo would silently split it.
- **No keys, only `createContext`.** Simple, but most existing Svelte code uses
  keys, and its contexts would stay invisible.
- **A key that is a declaration.** An exported constant has a place, a name
  and a uid like any unit, and every `setContext(KEY, …)` resolves to it
  through the checker.

## Decision

**A Svelte context is a `context` unit with `framework: "svelte"`,** claimed by
the Svelte plugin through `FrameworkPlugin.value`, in two shapes:

- **What `createContext()` from `svelte` returns,** exported. When it is
  destructured, the unit is named after its first element, the getter, and
  both elements are its aliases: a use of either is a use of the context. The
  indexer accepts an array-destructured variable as a unit only when a plugin
  claims it. Kept whole (`export const userContext = createContext<User>()`),
  it is named after the variable.
- **An exported module-level `const` that the same module passes to
  `setContext`, `getContext` or `hasContext` as the key.** This is the usual
  shape: a module declares the key with the helpers that set and get it.
  Detection reads only the key's own module, so a key used only in other files
  is not a unit.

A literal or computed key is not tracked: it has no declaration to be a unit
of.

**Its interface is the type of the value** setters give and getters read, and
its `default` is always null, since Svelte has no default. For
`createContext<T>()` that is `T` as written, or as the getter returns it. For
a key, it is the type written on its `setContext<T>`/`getContext<T>` calls in
its own module, else the types its `setContext` calls there give, else
`unknown`.

**Every use is a `uses-context` edge,** from components and functions alike:
calling the getter or setter, or passing the key to `setContext`,
`getContext` or `hasContext`.

## Consequences

- A change to a context's value type is an interface change, and every
  component and function that sets or reads it is flagged as a caller to
  review, as for React.
- `DetectedUnit` gains `aliases`, the declarations whose uses resolve to the
  unit. Only Svelte's context pairs use it today.
- React's plugin claims any `createContext` call by name. Svelte's claims only
  a `createContext` imported from `svelte`, and runs first (#73), so in a
  repository with both adapters each context goes to its own framework.
- A context whose key is a string literal, or is declared in a file that never
  uses it, stays invisible. The `poetics-svelte-component` skill steers new
  code to `createContext`, or to an exported key beside its helpers.
- A key's value type is read only from its own module. Setters elsewhere that
  pass other types do not change its interface, since `setContext` accepts any
  value for any key.
